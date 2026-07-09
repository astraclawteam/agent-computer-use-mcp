import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";

import { materializeReleaseBundle } from "../src/release-bundle.mjs";
import {
  ensureWindowsInstallerBuilt,
  runWindowsInstaller,
} from "../src/windows-installer-host.mjs";

const fixtureRoots = [];

before(async () => {
  await ensureWindowsInstallerBuilt();
});

after(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("native installer performs install upgrade and rollback on real files", async () => {
  const harness = await createHarness();
  const v1 = await harness.bundle("0.0.1", "v1");
  const v2 = await harness.bundle("0.0.2", "v2");

  const installed = await harness.run("install", { bundleRoot: v1 });
  assert.equal(installed.status, "installed");
  assert.equal(installed.operation, "install");
  assert.equal(installed.currentVersion, "0.0.1");
  assert.equal(installed.previousVersion, null);
  assert.equal(installed.revision, 1);
  assert.equal(await readFile(join(installed.activePayloadRoot, "package/version.txt"), "utf8"), "v1");

  const upgraded = await harness.run("upgrade", { bundleRoot: v2 });
  assert.equal(upgraded.status, "installed");
  assert.equal(upgraded.operation, "upgrade");
  assert.equal(upgraded.currentVersion, "0.0.2");
  assert.equal(upgraded.previousVersion, "0.0.1");
  assert.equal(upgraded.revision, 2);
  assert.equal(await readFile(join(upgraded.activePayloadRoot, "package/version.txt"), "utf8"), "v2");

  const rolledBack = await harness.run("rollback");
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.currentVersion, "0.0.1");
  assert.equal(rolledBack.previousVersion, "0.0.2");
  assert.equal(rolledBack.revision, 3);
  assert.equal(await readFile(join(rolledBack.activePayloadRoot, "package/version.txt"), "utf8"), "v1");

  const persisted = JSON.parse(await readFile(join(harness.programRoot, "state/install-state.json"), "utf8"));
  assert.equal(persisted.currentVersion, "0.0.1");
  assert.equal(persisted.previousVersion, "0.0.2");
  assert.equal(persisted.revision, 3);
});

test("native installer rejects a corrupted upgrade without changing active state", async () => {
  const harness = await createHarness();
  const v1 = await harness.bundle("0.0.1", "v1");
  const corrupted = await harness.bundle("0.0.2", "v2");
  await harness.run("install", { bundleRoot: v1 });
  await writeFile(join(corrupted, "payload/package/version.txt"), "tampered", "utf8");

  const failed = await harness.run("upgrade", { bundleRoot: corrupted, expectedExitCode: 2 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "installer.size_mismatch");

  const status = await harness.run("status");
  assert.equal(status.status, "ready");
  assert.equal(status.currentVersion, "0.0.1");
  assert.equal(status.previousVersion, null);
  assert.equal(status.revision, 1);
  assert.deepEqual(await readdir(join(harness.programRoot, "transactions")), []);
  await assert.rejects(() => readFile(join(harness.programRoot, "releases/0.0.2/payload/package/version.txt")));
});

test("native installer initializes stable roots and rollback fails closed without previous release", async () => {
  const harness = await createHarness();
  const v1 = await harness.bundle("0.0.1", "v1");
  await harness.run("install", { bundleRoot: v1 });

  for (const path of [
    join(harness.programRoot, "releases"),
    join(harness.programRoot, "state"),
    join(harness.programRoot, "cache/assets"),
    join(harness.programRoot, "cache/downloads"),
    join(harness.programRoot, "transactions"),
    join(harness.dataRoot, "artifacts"),
    join(harness.dataRoot, "logs"),
    join(harness.dataRoot, "traces"),
    join(harness.dataRoot, "models"),
    join(harness.dataRoot, "runtime"),
  ]) {
    assert.equal((await stat(path)).isDirectory(), true);
  }
  assert.deepEqual(await readdir(join(harness.programRoot, "releases")), ["0.0.1"]);
  assert.deepEqual(await readdir(join(harness.programRoot, "state")), ["install-state.json"]);
  for (const path of [
    join(harness.programRoot, "cache/assets"),
    join(harness.programRoot, "cache/downloads"),
    join(harness.programRoot, "transactions"),
    join(harness.dataRoot, "artifacts"),
    join(harness.dataRoot, "logs"),
    join(harness.dataRoot, "traces"),
    join(harness.dataRoot, "models"),
    join(harness.dataRoot, "runtime"),
  ]) {
    assert.deepEqual(await readdir(path), []);
  }

  const failed = await harness.run("rollback", { expectedExitCode: 2 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "installer.rollback_unavailable");

  const status = await harness.run("status");
  assert.equal(status.currentVersion, "0.0.1");
  assert.equal(status.revision, 1);
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-installer-"));
  fixtureRoots.push(root);
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  let bundleSequence = 0;

  return {
    root,
    programRoot,
    dataRoot,
    async bundle(version, contents) {
      bundleSequence += 1;
      const sourceRoot = join(root, `source-${bundleSequence}`);
      const bundleRoot = join(root, `bundle-${bundleSequence}`);
      await writeFixture(sourceRoot, "package/version.txt", contents);
      await materializeReleaseBundle({
        packageName: "agent-computer-use-mcp",
        version,
        sourceRoot,
        outputRoot: bundleRoot,
        files: ["package/version.txt"],
        generatedAt: "2026-07-10T00:00:00.000Z",
      });
      return bundleRoot;
    },
    async run(operation, options = {}) {
      const result = await runWindowsInstaller(operation, {
        programRoot,
        dataRoot,
        bundleRoot: options.bundleRoot,
      });
      assert.equal(result.exitCode, options.expectedExitCode ?? 0, result.stderr || result.stdout);
      return result.report;
    },
  };
}

async function writeFixture(root, path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}
