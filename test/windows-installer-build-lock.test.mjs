import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  INSTALLER_BUILD_LOCK_POLICY,
  installerBuildLockIsStale,
} from "../src/windows-installer-host.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("installer build lock policy allows a slow NativeAOT publish to finish", () => {
  assert.equal(INSTALLER_BUILD_LOCK_POLICY.buildWaitMs, 300_000);
  assert.equal(INSTALLER_BUILD_LOCK_POLICY.publishWaitMs, 600_000);
  assert.ok(INSTALLER_BUILD_LOCK_POLICY.orphanGraceMs < INSTALLER_BUILD_LOCK_POLICY.buildWaitMs);
});

test("installer build lock never expires while its owner process is alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-installer-lock-"));
  roots.push(root);
  const lockPath = join(root, "obj/build.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, "4242\n", "utf8");
  const old = new Date("2026-07-10T00:00:00.000Z");
  await utimes(lockPath, old, old);

  assert.equal(await installerBuildLockIsStale(lockPath, {
    now: () => new Date("2026-07-10T00:20:00.000Z"),
    processAlive: (pid) => pid === 4242,
  }), false);
  assert.equal(await installerBuildLockIsStale(lockPath, {
    now: () => new Date("2026-07-10T00:20:00.000Z"),
    processAlive: () => false,
  }), true);

  await writeFile(lockPath, "4242-corrupt\n", "utf8");
  await utimes(lockPath, old, old);
  assert.equal(await installerBuildLockIsStale(lockPath, {
    now: () => new Date("2026-07-10T00:20:00.000Z"),
    processAlive: () => true,
  }), true);
});
