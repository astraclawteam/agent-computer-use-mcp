import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonLifecycleManager } from "./daemon-lifecycle.mjs";

const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-6-"));

const first = createDaemonLifecycleManager({
  runtimeRoot,
  processInfo: { pid: 10101, startedAt: "2026-07-09T00:00:00.000Z" },
  isProcessAlive: (pid) => pid === 10101,
});
const firstAcquire = await first.acquire({ role: "mcp-daemon" });

const duplicate = createDaemonLifecycleManager({
  runtimeRoot,
  processInfo: { pid: 20202, startedAt: "2026-07-09T00:01:00.000Z" },
  isProcessAlive: (pid) => pid === 10101,
});
const duplicateAcquire = await duplicate.acquire({ role: "mcp-daemon" });

const released = await first.release();
const releaseRemovedLock = released.status === "released"
  && existsSync(firstAcquire.lockPath) === false;

const staleRuntimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-6-stale-"));
const staleOwner = createDaemonLifecycleManager({
  runtimeRoot: staleRuntimeRoot,
  processInfo: { pid: 30303, startedAt: "2026-07-09T00:02:00.000Z" },
  isProcessAlive: () => true,
});
await staleOwner.acquire({ role: "mcp-daemon" });

const staleRecover = createDaemonLifecycleManager({
  runtimeRoot: staleRuntimeRoot,
  processInfo: { pid: 40404, startedAt: "2026-07-09T00:03:00.000Z" },
  isProcessAlive: () => false,
});
const recovered = await staleRecover.acquire({ role: "mcp-daemon" });

const passed = firstAcquire.status === "acquired"
  && duplicateAcquire.status === "already_running"
  && releaseRemovedLock
  && recovered.status === "acquired"
  && recovered.recoveredStaleLock?.pid === 30303
  && recovered.includeUserOverlay === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.6",
  benchmark: "daemon-lifecycle-manager",
  firstAcquire: firstAcquire.status,
  duplicateStartup: duplicateAcquire.status,
  staleRecovered: recovered.recoveredStaleLock?.pid === 30303,
  releaseRemovedLock,
  includeUserOverlay: false,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;
