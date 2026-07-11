import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { releaseAssetNames } from "../src/platform-package-contract.mjs";
import {
  assemblePlatformRelease,
  comparePlatformInventories,
} from "../src/platform-release-assembly.mjs";
import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release assembly emits two npm tarballs and a complete offline ZIP", async () => {
  const root = await fixtureRoot();
  const { coreRoot, platformRoot } = await packageFixtures(root);
  const result = await assemblePlatformRelease({
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    generatedAt: "2026-07-11T00:00:00.000Z",
    outputRoot: join(root, "release"),
    corePackageRoot: coreRoot,
    platformPackageRoot: platformRoot,
    installProductionDependencies: async (offlineRoot) => {
      await writeFixture(offlineRoot, "node_modules/@modelcontextprotocol/sdk/package.json", "{}");
    },
  });

  assert.deepEqual(result.assets.map(({ name }) => name), releaseAssetNames("0.0.1"));
  assert.equal(result.inventoryComparison.status, "identical");
  assert.equal(result.releaseManifest.version, "0.0.1");
  assert.equal(result.releaseManifest.target, "windows-x64");
  assert.equal(result.assets.some(({ name }) => /installer|setup|\.(?:exe|msi|msix)$/iu.test(name)), false);
});

test("offline platform subtree is byte-identical to the npm platform package root", async () => {
  const root = await fixtureRoot();
  const { platformRoot } = await packageFixtures(root);
  const offlinePlatformRoot = join(root, "offline-platform");
  await mkdir(offlinePlatformRoot, { recursive: true });
  await copyFixtureTree(platformRoot, offlinePlatformRoot);

  const identical = await comparePlatformInventories(platformRoot, offlinePlatformRoot);
  assert.equal(identical.status, "identical");

  await writeFile(join(offlinePlatformRoot, "cua-driver", "cua-driver.exe"), "changed");
  await assert.rejects(
    comparePlatformInventories(platformRoot, offlinePlatformRoot),
    /release\.platform_inventory_mismatch/,
  );
});

async function packageFixtures(root) {
  const coreRoot = join(root, "core");
  const platformRoot = join(root, "platform");
  await buildProtectedNpmPackage({ outputRoot: coreRoot });
  await buildWindowsPlatformPackage({
    outputRoot: platformRoot,
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    materialize: async (stageRoot) => {
      await writeFixture(stageRoot, "cua-driver/cua-driver.exe", "driver");
      await writeFixture(stageRoot, "overlay/GatewayComputerUseOverlay.exe", "overlay");
      await writeFixture(stageRoot, "ocr-runtime/onnxruntime.dll", "runtime");
      await writeFixture(stageRoot, "models/pp-ocr-v6/det.onnx", "det");
    },
  });
  return { coreRoot, platformRoot };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-platform-release-"));
  roots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}

async function copyFixtureTree(source, target) {
  const { cp } = await import("node:fs/promises");
  await cp(source, target, { recursive: true });
}
