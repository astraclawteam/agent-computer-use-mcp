import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import { buildReleaseSbom } from "../src/release-sbom.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release SBOM combines locked native assets with production npm components", async () => {
  const root = await fixtureRoot();
  const lock = releaseLock();
  const overlayBytes = Buffer.from("overlay", "utf8");
  const report = await buildReleaseSbom({
    outputPath: join(root, "sbom.cdx.json"),
    lock,
    payloadReport: {
      files: [{
        path: "helpers/overlay/GatewayComputerUseOverlay.exe",
        bytes: overlayBytes.length,
        sha256: sha256(overlayBytes),
      }],
    },
    baseSbom: {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        component: { type: "application", name: "agent-computer-use-mcp", version: "0.0.1", "bom-ref": "agent-computer-use-mcp@0.0.1" },
      },
      components: [
        { type: "library", name: "@modelcontextprotocol/sdk", version: "1.29.0", "bom-ref": "pkg:npm/%40modelcontextprotocol/sdk@1.29.0" },
        { type: "library", name: "onnxruntime-node", version: "1.27.0", "bom-ref": "pkg:npm/onnxruntime-node@1.27.0" },
      ],
    },
  });

  assert.equal(report.status, "passed");
  assert.equal(report.format, "CycloneDX");
  const sbom = JSON.parse(await readFile(report.outputPath, "utf8"));
  const componentIds = new Set([
    sbom.metadata.component.name,
    ...sbom.components.map((component) => component.name),
  ]);
  for (const id of [
    "agent-computer-use-mcp",
    "node-runtime-windows-x64",
    "cua-driver-windows-x64",
    "gateway-overlay-windows-x64",
    "onnxruntime-node",
    "ocr-model-pp-ocrv6-small-det",
    "ocr-model-pp-ocrv6-small-rec",
    "webview2-evergreen-standalone-windows-x64",
  ]) {
    assert.equal(componentIds.has(id), true, id);
  }
  const serialized = JSON.stringify(sbom);
  assert.equal(serialized.includes(resolve(".")), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.equal(serialized.includes("overlayPixels"), false);
  assert.equal(serialized.includes("recognizedText"), false);
  assert.deepEqual(
    sbom.components.map((component) => component["bom-ref"]),
    [...sbom.components.map((component) => component["bom-ref"])].sort((left, right) => left.localeCompare(right, "en")),
  );
});

test("release SBOM fails closed when a required production component is absent", async () => {
  const root = await fixtureRoot();
  await assert.rejects(
    () => buildReleaseSbom({
      outputPath: join(root, "sbom.cdx.json"),
      lock: releaseLock(),
      payloadReport: { files: [] },
      baseSbom: {
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        metadata: { component: { type: "application", name: "agent-computer-use-mcp", version: "0.0.1" } },
        components: [],
      },
    }),
    (error) => error?.code === "release.sbom_incomplete",
  );
});

test("release SBOM invokes the installed npm CLI without a shell", async () => {
  const root = await fixtureRoot();
  const overlayBytes = Buffer.from("overlay", "utf8");
  const report = await buildReleaseSbom({
    outputPath: join(root, "npm-sbom.cdx.json"),
    lock: releaseLock(),
    payloadReport: {
      files: [{
        path: "helpers/overlay/GatewayComputerUseOverlay.exe",
        bytes: overlayBytes.length,
        sha256: sha256(overlayBytes),
      }],
    },
    projectRoot: resolve("."),
  });

  assert.equal(report.status, "passed");
  assert.equal(JSON.parse(await readFile(report.outputPath, "utf8")).metadata.component.name, "agent-computer-use-mcp");
});

function releaseLock() {
  return {
    assets: [
      locked("node-runtime-windows-x64"),
      locked("cua-driver-windows-x64"),
      locked("ocr-model-pp-ocrv6-small-det"),
      locked("ocr-model-pp-ocrv6-small-rec"),
      locked("ocr-model-pp-ocrv6-small-rec-metadata"),
      locked("webview2-evergreen-standalone-windows-x64"),
    ],
  };
}

function locked(id) {
  const bytes = Buffer.from(id, "utf8");
  return {
    id,
    kind: "file",
    version: "1.0.0",
    source: { url: `https://example.test/${id}`, sizeBytes: bytes.length, sha256: sha256(bytes) },
    license: { spdx: "MIT", sourceUrl: "https://example.test/license" },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-release-sbom-"));
  roots.push(root);
  return root;
}
