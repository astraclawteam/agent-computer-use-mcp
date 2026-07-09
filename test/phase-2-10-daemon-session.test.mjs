import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("daemon session acquires one lock starts managed children and closes cleanly", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-session-"));
  const factory = fakeProcessFactory();
  const { createDaemonSession } = await import("../src/daemon-session.mjs");
  const session = createDaemonSession({
    runtimeRoot,
    processInfo: { pid: 5151, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: (pid) => pid === 5151,
    processFactory: factory,
  });

  const started = await session.start();

  assert.equal(started.status, "started");
  assert.equal(started.lock.status, "acquired");
  assert.equal(started.children.length, 3);
  assert.deepEqual(started.children.map((child) => child.name).sort(), ["cua-driver-mcp", "ocr-sidecar", "overlay"]);
  assert.equal(factory.starts.length, 3);
  assert.equal(started.includeUserOverlay, false);
  assert.equal(existsSync(started.lock.lockPath), true);

  const health = session.health();
  assert.equal(health.status, "healthy");
  assert.equal(health.lock.status, "held");
  assert.equal(health.children.length, 3);
  assert.equal(health.includeUserOverlay, false);

  const closed = await session.close({ reason: "test-finished" });
  assert.equal(closed.status, "closed");
  assert.equal(closed.lock.status, "released");
  assert.equal(closed.stoppedChildren, 3);
  assert.equal(existsSync(started.lock.lockPath), false);
  assert.equal(factory.starts.every((entry) => entry.handle.killed === true), true);
});

test("daemon session duplicate startup does not start child processes", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-session-duplicate-"));
  const firstFactory = fakeProcessFactory();
  const secondFactory = fakeProcessFactory();
  const { createDaemonSession } = await import("../src/daemon-session.mjs");
  const first = createDaemonSession({
    runtimeRoot,
    processInfo: { pid: 6161, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: (pid) => pid === 6161,
    processFactory: firstFactory,
  });
  const second = createDaemonSession({
    runtimeRoot,
    processInfo: { pid: 7171, startedAt: "2026-07-09T00:01:00.000Z" },
    isProcessAlive: (pid) => pid === 6161,
    processFactory: secondFactory,
  });

  const firstStart = await first.start();
  const duplicate = await second.start();

  assert.equal(firstStart.status, "started");
  assert.equal(duplicate.status, "already_running");
  assert.equal(duplicate.lock.status, "already_running");
  assert.equal(duplicate.children.length, 0);
  assert.equal(secondFactory.starts.length, 0);
  assert.equal(duplicate.includeUserOverlay, false);

  await first.close({ reason: "test-finished" });
});

test("daemon session reports degraded children and restarts only after approval", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-session-recover-"));
  const factory = fakeProcessFactory();
  const { createDaemonSession } = await import("../src/daemon-session.mjs");
  const session = createDaemonSession({
    runtimeRoot,
    processInfo: { pid: 8181, startedAt: "2026-07-09T00:00:00.000Z" },
    isProcessAlive: (pid) => pid === 8181,
    processFactory: factory,
  });
  await session.start();
  factory.starts[1].handle.emitExit(1, null);

  const degraded = session.health();
  const planned = session.recover("restart-ocr-sidecar", { approved: false });
  const recovered = session.recover("restart-ocr-sidecar", { approved: true });
  const healthy = session.health();

  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.recoverActions.some((action) => action.id === "restart-ocr-sidecar"), true);
  assert.equal(planned.status, "approval_required");
  assert.equal(planned.executesImmediately, false);
  assert.equal(recovered.status, "restarted");
  assert.equal(recovered.executesImmediately, true);
  assert.equal(healthy.status, "healthy");

  await session.close({ reason: "test-finished" });
});

test("Phase 2.10 has an executable daemon session smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.10"], "node src/phase-2-10-daemon-session.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["2.10"], "daemon-session");

  const result = await runNode(["src/phase-2-10-daemon-session.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.10");
  assert.equal(report.benchmark, "daemon-session");
  assert.equal(report.startedChildren, 3);
  assert.equal(report.duplicateStartsChildren, false);
  assert.equal(report.degradedAfterCrash, true);
  assert.equal(report.restartedAfterApproval, true);
  assert.equal(report.closedReleasesLock, true);
  assert.equal(report.closeStopsChildren, true);
  assert.equal(report.includeUserOverlay, false);
});

function fakeProcessFactory() {
  const starts = [];
  return {
    starts,
    start(spec) {
      const handle = {
        pid: starts.length + 9000,
        killed: false,
        listeners: new Map(),
        on(event, listener) {
          this.listeners.set(event, listener);
        },
        kill() {
          this.killed = true;
        },
        emitExit(code, signal) {
          this.listeners.get("exit")?.(code, signal);
        },
      };
      starts.push({ spec, handle });
      return handle;
    },
  };
}

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
