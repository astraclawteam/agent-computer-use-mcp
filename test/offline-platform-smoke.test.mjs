import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { smokeOfflineBundle } from "../scripts/offline-platform-smoke.mjs";
import { assemblePlatformRelease } from "../src/platform-release-assembly.mjs";
import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("complete ZIP starts an official MCP client without network or desktop control", { timeout: 120_000 }, async () => {
  const root = await fixtureRoot();
  const coreRoot = join(root, "core");
  const platformRoot = join(root, "platform");
  await buildProtectedNpmPackage({ outputRoot: coreRoot });
  await buildWindowsPlatformPackage({
    outputRoot: platformRoot,
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    materialize: fixtureMaterializer,
  });
  const release = await assemblePlatformRelease({
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    generatedAt: "2026-07-11T00:00:00.000Z",
    outputRoot: join(root, "release"),
    corePackageRoot: coreRoot,
    platformPackageRoot: platformRoot,
  });

  const result = await smokeOfflineBundle({
    zipPath: release.assets.find(({ name }) => name.endsWith("windows-x64.zip")).path,
  });

  assert.equal(result.status, "passed");
  assert.equal(result.toolsListed, true);
  assert.equal(result.healthPassed, true);
  assert.equal(result.doctorPassed, true);
  assert.equal(result.platformVerified, true);
  assert.equal(result.networkDisabled, true);
  assert.equal(result.desktopControlStarted, false);
});

async function fixtureMaterializer(root) {
  await writeFixture(root, "cua-driver/cua-driver.exe", "driver");
  await writeFixture(root, "overlay/GatewayComputerUseOverlay.exe", "overlay");
  await writeFixture(root, "ocr-runtime/onnxruntime.dll", "runtime");
  await writeFixture(root, "models/pp-ocr-v6/det.onnx", "det");
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-offline-smoke-"));
  roots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}
