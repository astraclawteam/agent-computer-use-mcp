import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createDaemonLifecycleManager,
} from "../src/daemon-lifecycle.mjs";

test("daemon lifecycle acquires and releases a pid lock", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-daemon-"));
  const manager = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 4242, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: () => true,
  });

  const acquired = await manager.acquire({ role: "mcp-daemon" });

  assert.equal(acquired.status, "acquired");
  assert.equal(acquired.role, "mcp-daemon");
  assert.equal(acquired.pid, 4242);
  assert.equal(existsSync(acquired.lockPath), true);
  const lock = JSON.parse(readFileSync(acquired.lockPath, "utf8"));
  assert.equal(lock.module, "agent-computer-use-mcp");
  assert.equal(lock.role, "mcp-daemon");
  assert.equal(lock.pid, 4242);
  assert.equal(lock.includeUserOverlay, false);

  const released = await manager.release();
  assert.equal(released.status, "released");
  assert.equal(existsSync(acquired.lockPath), false);
});

test("daemon lifecycle reports duplicate startup when an active lock exists", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-daemon-duplicate-"));
  const first = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 1111, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: (pid) => pid === 1111,
  });
  const second = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 2222, startedAt: "2026-07-09T00:01:00.000Z" },
    isProcessAlive: (pid) => pid === 1111,
  });

  const firstAcquire = await first.acquire({ role: "mcp-daemon" });
  const duplicate = await second.acquire({ role: "mcp-daemon" });

  assert.equal(firstAcquire.status, "acquired");
  assert.equal(duplicate.status, "already_running");
  assert.equal(duplicate.existing.pid, 1111);
  assert.equal(duplicate.current.pid, 2222);
  assert.equal(duplicate.includeUserOverlay, false);
});

test("daemon lifecycle refuses to release a lock it never acquired", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-daemon-release-guard-"));
  const owner = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 1212, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: (pid) => pid === 1212,
  });
  const stranger = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 3434, startedAt: "2026-07-09T00:01:00.000Z" },
    isProcessAlive: (pid) => pid === 1212,
  });

  const acquired = await owner.acquire({ role: "mcp-daemon" });
  const release = await stranger.release();

  assert.equal(release.status, "not_owner");
  assert.equal(release.existing.pid, 1212);
  assert.equal(existsSync(acquired.lockPath), true);
});

test("daemon lifecycle repairs stale locks before acquiring", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-daemon-stale-"));
  const stale = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 3333, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: () => true,
  });
  await stale.acquire({ role: "mcp-daemon" });

  const repaired = createDaemonLifecycleManager({
    runtimeRoot,
    processInfo: { pid: 4444, startedAt: "2026-07-09T00:02:00.000Z" },
    isProcessAlive: () => false,
  });

  const acquire = await repaired.acquire({ role: "mcp-daemon" });

  assert.equal(acquire.status, "acquired");
  assert.equal(acquire.recoveredStaleLock.pid, 3333);
  assert.equal(acquire.pid, 4444);
  assert.equal(existsSync(acquire.lockPath), true);
});

test("Phase 2.6 has an executable daemon lifecycle smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.6"], "node src/phase-2-6-daemon-lifecycle.mjs");

  const result = await runNode(["src/phase-2-6-daemon-lifecycle.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.6");
  assert.equal(report.benchmark, "daemon-lifecycle-manager");
  assert.equal(report.firstAcquire, "acquired");
  assert.equal(report.duplicateStartup, "already_running");
  assert.equal(report.staleRecovered, true);
  assert.equal(report.releaseRemovedLock, true);
  assert.equal(report.includeUserOverlay, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
