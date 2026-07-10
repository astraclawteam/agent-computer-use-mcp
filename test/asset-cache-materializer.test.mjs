import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { ensureWindowsInstallerBuilt, runWindowsInstaller } from "../src/windows-installer-host.mjs";
import { createOfflineDriverFixture } from "./helpers/asset-archive.mjs";

const fixtureRoots = [];

before(async () => {
  await ensureWindowsInstallerBuilt();
});

after(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("offline prepare activate and rollback use immutable content-addressed assets", async () => {
  const harness = await createHarness();
  const v1 = await createOfflineDriverFixture({ root: harness.root, version: "0.7.1", releaseId: "assets-v1" });
  const v2 = await createOfflineDriverFixture({ root: harness.root, version: "0.7.2", releaseId: "assets-v2" });

  const progress = [];
  const preparedV1 = await harness.prepare(v1, 0, {
    onProgress: async (event) => progress.push(event),
  });
  assert.equal(preparedV1.status, "prepared");
  assert.equal(preparedV1.cacheMissCount, 1);
  assert.equal(progress.length >= 3, true);
  assert.equal(progress[0].operationId, "asset-prepare-assets-v1");
  assert.equal(progress.every((event) => event.type === "progress" && event.terminal === false), true);
  assert.deepEqual([...progress].map((event) => event.sequence), progress.map((_, index) => index));
  assert.equal(progress.some((event) => event.state === "acquiring"), true);
  assert.equal(progress.some((event) => event.state === "materializing"), true);
  const activeV1 = await harness.activate(v1);
  assert.equal(activeV1.currentReleaseId, "assets-v1");
  assert.equal(activeV1.previousReleaseId, null);
  assert.equal(activeV1.revision, 1);
  assert.equal(await readFile(activeV1.assets[0].entryPoint, "utf8"), "driver-0.7.1");

  await harness.prepare(v2);
  const activeV2 = await harness.activate(v2);
  assert.equal(activeV2.currentReleaseId, "assets-v2");
  assert.equal(activeV2.previousReleaseId, "assets-v1");
  assert.equal(activeV2.revision, 2);

  const rolledBack = await harness.run("asset-rollback", v2);
  assert.equal(rolledBack.currentReleaseId, "assets-v1");
  assert.equal(rolledBack.previousReleaseId, "assets-v2");
  assert.equal(rolledBack.revision, 3);
  assert.equal(await readFile(rolledBack.assets[0].entryPoint, "utf8"), "driver-0.7.1");

  const cacheEntries = await readdir(join(harness.programRoot, "cache", "assets", "sha256"));
  assert.equal(cacheEntries.length > 0, true);
});

test("asset cache re-verifies hits and rejects corrupt offline blobs without state change", async () => {
  const harness = await createHarness();
  const fixture = await createOfflineDriverFixture({ root: harness.root, version: "0.7.1", releaseId: "assets-v1" });
  await harness.prepare(fixture);
  await harness.activate(fixture);

  const repeated = await harness.prepare(fixture);
  assert.equal(repeated.cacheHitCount, 1);
  assert.equal(repeated.cacheMissCount, 0);

  const corrupt = await createOfflineDriverFixture({ root: harness.root, version: "0.7.2", releaseId: "assets-v2" });
  await writeFile(corrupt.offlineBlobPath, "corrupt", "utf8");
  const failed = await harness.prepare(corrupt, 2);
  assert.equal(failed.error.code, "asset.download_size_mismatch");
  const status = await harness.run("asset-status", fixture);
  assert.equal(status.currentReleaseId, "assets-v1");
  assert.equal(status.revision, 1);
});

test("asset materializer rejects undeclared and traversal ZIP entries", async () => {
  const harness = await createHarness();
  const extra = await createOfflineDriverFixture({
    root: harness.root,
    fixtureId: "extra-file",
    releaseId: "assets-extra",
    archiveEntries: [
      { path: "cua-driver/cua-driver.exe", contentsBase64: Buffer.from("driver-0.7.1").toString("base64") },
      { path: "cua-driver/cua-driver-uia.exe", contentsBase64: Buffer.from("uia-0.7.1").toString("base64") },
      { path: "cua-driver/extra.txt", contentsBase64: Buffer.from("extra").toString("base64") },
    ],
  });
  const traversal = await createOfflineDriverFixture({
    root: harness.root,
    fixtureId: "traversal-file",
    releaseId: "assets-traversal",
    archiveEntries: [
      { path: "cua-driver/cua-driver.exe", contentsBase64: Buffer.from("driver-0.7.1").toString("base64") },
      { path: "cua-driver/cua-driver-uia.exe", contentsBase64: Buffer.from("uia-0.7.1").toString("base64") },
      { path: "../escape.txt", contentsBase64: Buffer.from("escape").toString("base64") },
    ],
  });

  assert.equal((await harness.prepare(extra, 2)).error.code, "asset.archive_unexpected_file");
  assert.equal((await harness.prepare(traversal, 2)).error.code, "asset.archive_path_invalid");
  await assert.rejects(() => readFile(join(harness.root, "escape.txt")));
});

test("asset materializer rejects a different payload reusing an installed version", async () => {
  const harness = await createHarness();
  const original = await createOfflineDriverFixture({ root: harness.root, fixtureId: "original", version: "0.7.1", releaseId: "assets-v1" });
  const conflict = await createOfflineDriverFixture({
    root: harness.root,
    fixtureId: "conflict",
    version: "0.7.1",
    releaseId: "assets-conflict",
    driverContents: "different-driver",
  });
  await harness.prepare(original);
  await harness.activate(original);

  const failed = await harness.prepare(conflict, 2);
  assert.equal(failed.error.code, "asset.version_conflict");
  const status = await harness.run("asset-status", original);
  assert.equal(status.currentReleaseId, "assets-v1");
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-assets-"));
  fixtureRoots.push(root);
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  return {
    root,
    programRoot,
    dataRoot,
    async prepare(fixture, expectedExitCode = 0, options = {}) {
      return this.run("asset-prepare", fixture, expectedExitCode, options);
    },
    async activate(fixture, expectedExitCode = 0) {
      return this.run("asset-activate", fixture, expectedExitCode);
    },
    async run(operation, fixture, expectedExitCode = 0, options = {}) {
      const result = await runWindowsInstaller(operation, {
        programRoot,
        dataRoot,
        manifestPath: fixture.manifestPath,
        signaturePath: fixture.signaturePath,
        keyringPath: fixture.keyringPath,
        offlineRoot: fixture.offlineRoot,
        assetIds: [fixture.asset.id],
        releaseId: fixture.manifest.releaseId,
        operationId: `${operation}-${fixture.manifest.releaseId}`,
        onProgress: options.onProgress,
      });
      assert.equal(result.exitCode, expectedExitCode, result.stderr || result.stdout);
      return result.report;
    },
  };
}
