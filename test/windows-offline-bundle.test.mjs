import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  buildWindowsOfflineBundle,
  prepareWindowsOfflineAssets,
} from "../src/windows-offline-bundle.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows offline bundle is deterministic complete and distribution-blocked", async () => {
  const root = await fixtureRoot();
  const fixture = await offlineFixture(root);
  const first = await buildWindowsOfflineBundle({
    ...fixture,
    outputRoot: join(root, "first"),
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  const second = await buildWindowsOfflineBundle({
    ...fixture,
    outputRoot: join(root, "second"),
    generatedAt: "2026-07-10T00:00:00.000Z",
  });

  assert.equal(first.status, "ready");
  assert.equal(first.installable, true);
  assert.equal(first.distributionStatus, "blocked_unsigned");
  assert.equal(first.firstEnableDownloadCount, 0);
  assert.equal(first.includeUserOverlay, false);
  assert.equal(first.startsDesktopControl, false);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.entries, second.entries);
  assert.ok(first.entries.includes("installer/AgentComputerUse.Installer.exe"));
  assert.ok(first.entries.includes("release/payload/runtime/node/node.exe"));
  assert.ok(first.entries.includes("release/payload/package/dist/launcher.mjs"));
  assert.ok(first.entries.includes("release/payload/package/node_modules/onnxruntime-node/package.json"));
  assert.ok(first.entries.includes("release/payload/helpers/overlay/GatewayComputerUseOverlay.exe"));
  assert.ok(first.entries.includes("trust/asset-manifest.json"));
  assert.ok(first.entries.includes("trust/asset-manifest.sig"));
  assert.ok(first.entries.includes("trust/keyring.json"));
  for (const asset of fixture.assets) {
    assert.ok(first.entries.includes(`assets/blobs/sha256/${asset.sha256}`));
  }
  assert.equal(JSON.parse(await readFile(fixture.trust.manifestPath, "utf8")).developmentOnly, true);
});

test("Windows offline bundle fails closed when a required runtime or asset is absent", async () => {
  const root = await fixtureRoot();
  const fixture = await offlineFixture(root);
  const cases = [
    ["portable-node", async (copy) => rm(join(copy.payloadBundleRoot, "payload/runtime/node/node.exe"))],
    ["protected-launcher", async (copy) => rm(join(copy.payloadBundleRoot, "payload/package/dist/launcher.mjs"))],
    ["onnx-runtime", async (copy) => rm(join(copy.payloadBundleRoot, "payload/package/node_modules/onnxruntime-node/package.json"))],
    ["overlay", async (copy) => rm(join(copy.payloadBundleRoot, "payload/helpers/overlay/GatewayComputerUseOverlay.exe"))],
    ["installer", async (copy) => rm(join(copy.payloadBundleRoot, "payload/bin/AgentComputerUse.Installer.exe"))],
    ["locked-asset", async (copy) => { copy.assets = copy.assets.slice(1); }],
  ];

  for (const [id, mutate] of cases) {
    const copy = { ...fixture, assets: [...fixture.assets] };
    await mutate(copy);
    await assert.rejects(
      () => buildWindowsOfflineBundle({
        ...copy,
        outputRoot: join(root, `missing-${id}`),
        generatedAt: "2026-07-10T00:00:00.000Z",
      }),
      (error) => error?.code === "release.offline_bundle_incomplete",
      id,
    );
    await restorePayloadFixture(fixture.payloadBundleRoot);
  }
});

test("candidate preparation turns locked driver OCR and WebView2 bytes into installable asset views", async () => {
  const root = await fixtureRoot();
  const detBytes = Buffer.from("det", "utf8");
  const recBytes = Buffer.from("rec", "utf8");
  const metadata = [
    "PostProcess:",
    "  name: CTCLabelDecode",
    "  character_dict:",
    "    - A",
    "    - B",
    "",
  ].join("\n");
  const acquiredAssets = [];
  for (const [id, bytes] of [
    ["node-runtime-windows-x64", Buffer.from("node")],
    ["cua-driver-windows-x64", Buffer.from("driver-archive")],
    ["ocr-model-pp-ocrv6-small-det", detBytes],
    ["ocr-model-pp-ocrv6-small-rec", recBytes],
    ["ocr-model-pp-ocrv6-small-rec-metadata", Buffer.from(metadata)],
    ["webview2-evergreen-standalone-windows-x64", Buffer.from("webview2")],
  ]) {
    const path = await fixtureFile(join(root, "acquired"), id, bytes);
    acquiredAssets.push({ id, path, sizeBytes: bytes.length, sha256: sha256(bytes), version: "1.0.0" });
  }
  const lock = {
    assets: acquiredAssets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      source: { sizeBytes: asset.sizeBytes, sha256: asset.sha256, fileName: asset.id, url: `https://example.test/${asset.id}` },
      license: { spdx: "MIT", sourceUrl: "https://example.test/license" },
    })),
  };
  const driver = acquiredAssets.find((asset) => asset.id === "cua-driver-windows-x64");
  const prepared = await prepareWindowsOfflineAssets({
    lock,
    acquiredAssets,
    packageVersion: "0.0.1",
    outputRoot: join(root, "prepared"),
    generatedAt: "2026-07-10T00:00:00.000Z",
    driverDefinition: candidateDriverDefinition(driver),
  });

  assert.deepEqual(prepared.assets.map((asset) => asset.id), [
    "cua-driver-windows-x64",
    "ocr-model-pp-ocrv6-small",
    "webview2-evergreen-standalone-windows-x64",
  ]);
  assert.equal(prepared.modelPack.dictionaryEntries, 3);
  const manifest = JSON.parse(await readFile(prepared.trust.manifestPath, "utf8"));
  assert.equal(manifest.developmentOnly, true);
  assert.deepEqual(manifest.assets.map((asset) => asset.id), prepared.assets.map((asset) => asset.id));
  assert.equal(manifest.assets.find((asset) => asset.id === "webview2-evergreen-standalone-windows-x64").authenticode.mode, "microsoft");
});

async function offlineFixture(root) {
  const payloadBundleRoot = join(root, "release");
  await restorePayloadFixture(payloadBundleRoot);
  const trustRoot = join(root, "trust-source");
  const trust = {
    manifestPath: await fixtureFile(trustRoot, "asset-manifest.json", JSON.stringify({ developmentOnly: true })),
    signaturePath: await fixtureFile(trustRoot, "asset-manifest.sig", "candidate-signature"),
    keyringPath: await fixtureFile(trustRoot, "keyring.json", "candidate-keyring"),
  };
  const assets = [];
  for (const id of ["cua-driver-windows-x64", "ocr-model-pp-ocrv6-small", "webview2-evergreen-standalone-windows-x64"]) {
    const bytes = Buffer.from(`blob-${id}`, "utf8");
    const path = await fixtureFile(join(root, "asset-source"), `${id}.zip`, bytes);
    assets.push({ id, path, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  return {
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    payloadBundleRoot,
    assets,
    trust,
    requiredAssetIds: assets.map((asset) => asset.id),
    licenses: [{ id: "fixture", spdx: "MIT", sourceUrl: "https://example.test/license" }],
  };
}

async function restorePayloadFixture(root) {
  await rm(root, { recursive: true, force: true });
  await fixtureFile(root, "release-manifest.json", "{}\n");
  await fixtureFile(root, "payload/runtime/node/node.exe", "node");
  await fixtureFile(root, "payload/package/dist/launcher.mjs", "launcher");
  await fixtureFile(root, "payload/package/node_modules/onnxruntime-node/package.json", "{}");
  await fixtureFile(root, "payload/helpers/overlay/GatewayComputerUseOverlay.exe", "overlay");
  await fixtureFile(root, "payload/bin/AgentComputerUse.Installer.exe", "installer");
}

async function fixtureFile(root, path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function candidateDriverDefinition(asset) {
  return {
    id: asset.id,
    kind: "driver",
    version: asset.version,
    platform: { os: "win32", arch: "x64" },
    requiredBeforeFirstEnable: true,
    source: {
      kind: "https-or-offline",
      urls: ["https://example.test/driver.zip"],
      fileName: "driver.zip",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
    },
    content: {
      format: "raw",
      files: [{ path: "driver.exe", installPath: "bin/driver.exe", sizeBytes: asset.sizeBytes, sha256: asset.sha256, executable: true }],
    },
    provenance: { class: "third-party", repository: "trycua/cua", tag: "fixture", assetName: "driver.zip", upstreamSha256: asset.sha256 },
    authenticode: { mode: "vendor-unsigned", timestampRequired: false },
    install: { view: "cua-driver", entryPoint: "bin/driver.exe" },
  };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-offline-bundle-"));
  roots.push(root);
  return root;
}
