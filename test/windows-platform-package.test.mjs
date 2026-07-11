import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("builder produces a complete immutable Windows platform package", async () => {
  const root = await fixtureRoot();
  const outputRoot = join(root, "package");
  const result = await buildWindowsPlatformPackage({
    outputRoot,
    version: "1.2.3",
    sourceCommit: "a".repeat(40),
    materialize: fixtureMaterializer,
  });

  const packageJson = JSON.parse(await readFile(join(outputRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(outputRoot, "platform-manifest.json"), "utf8"));
  const sbom = JSON.parse(await readFile(join(outputRoot, "SBOM.cdx.json"), "utf8"));
  assert.equal(result.status, "passed");
  assert.equal(packageJson.name, "@agent-computer-use/win32-x64");
  assert.equal(packageJson.version, "1.2.3");
  assert.deepEqual(packageJson.os, ["win32"]);
  assert.deepEqual(packageJson.cpu, ["x64"]);
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(manifest.target, { platform: "win32", arch: "x64", id: "windows-x64" });
  assert.equal(manifest.files.some(({ path }) => path === "cua-driver/cua-driver.exe"), true);
  assert.equal(manifest.files.some(({ path }) => path === "overlay/GatewayComputerUseOverlay.exe"), true);
  assert.equal(manifest.files.some(({ path }) => path === "ocr-runtime/onnxruntime.dll"), true);
  assert.equal(manifest.files.some(({ path }) => path === "models/pp-ocr-v6/det.onnx"), true);
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal((await stat(join(outputRoot, "THIRD_PARTY_LICENSES.txt"))).isFile(), true);
});

test("builder fails closed before promotion when a required component is absent", async () => {
  const root = await fixtureRoot();
  const outputRoot = join(root, "package");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, "sentinel.txt"), "previous");

  await assert.rejects(
    buildWindowsPlatformPackage({
      outputRoot,
      version: "1.2.3",
      sourceCommit: "a".repeat(40),
      materialize: async (stageRoot) => writeFixture(stageRoot, "cua-driver/cua-driver.exe", "driver"),
    }),
    /platform\.component_missing/,
  );
  assert.equal(await readFile(join(outputRoot, "sentinel.txt"), "utf8"), "previous");
});

test("builder rejects installer cache source map browser payload and unknown binary entries", async () => {
  for (const forbiddenPath of [
    "installer/setup.exe",
    "cache/blob",
    "overlay/debug.map",
    "src/runtime.mjs",
    "overlay/app.asar",
    "overlay/chrome.dll",
    "ocr-runtime/unknown.dll",
    "cua-driver/browser.exe",
  ]) {
    const root = await fixtureRoot();
    await assert.rejects(
      buildWindowsPlatformPackage({
        outputRoot: join(root, "package"),
        version: "1.2.3",
        sourceCommit: "a".repeat(40),
        materialize: async (stageRoot) => {
          await fixtureMaterializer(stageRoot);
          await writeFixture(stageRoot, forbiddenPath, "forbidden");
        },
      }),
      /platform\.entry_forbidden/,
    );
  }
});

async function fixtureMaterializer(root) {
  await writeFixture(root, "cua-driver/cua-driver.exe", "driver");
  await writeFixture(root, "overlay/GatewayComputerUseOverlay.exe", "overlay");
  await writeFixture(root, "ocr-runtime/onnxruntime.dll", "runtime");
  await writeFixture(root, "models/pp-ocr-v6/det.onnx", "det");
  await writeFixture(root, "models/pp-ocr-v6/rec.onnx", "rec");
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-windows-platform-package-"));
  roots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, contents);
}

