import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonSession } from "./daemon-session.mjs";

const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-10-"));
const firstFactory = fakeProcessFactory();
const secondFactory = fakeProcessFactory();
const first = createDaemonSession({
  runtimeRoot,
  processInfo: { pid: 20210, startedAt: "2026-07-09T00:00:00.000Z" },
  isProcessAlive: (pid) => pid === 20210,
  processFactory: firstFactory,
});
const duplicate = createDaemonSession({
  runtimeRoot,
  processInfo: { pid: 20211, startedAt: "2026-07-09T00:01:00.000Z" },
  isProcessAlive: (pid) => pid === 20210,
  processFactory: secondFactory,
});

try {
  const started = await first.start();
  const duplicateStart = await duplicate.start();
  firstFactory.starts[1].handle.emitExit(1, null);
  const degraded = first.health();
  const planned = first.recover("restart-ocr-sidecar", { approved: false });
  const recovered = first.recover("restart-ocr-sidecar", { approved: true });
  const closed = await first.close({ reason: "phase-2-10" });
  const closeStopsChildren = firstFactory.starts.every((entry) => entry.handle.killed === true);

  const passed = started.status === "started"
    && started.children.length === 3
    && duplicateStart.status === "already_running"
    && secondFactory.starts.length === 0
    && degraded.status === "degraded"
    && planned.status === "approval_required"
    && recovered.status === "restarted"
    && closed.lock.status === "released"
    && closeStopsChildren;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "2.10",
    benchmark: "daemon-session",
    startedChildren: started.children.length,
    duplicateStartsChildren: secondFactory.starts.length > 0,
    degradedAfterCrash: degraded.status === "degraded",
    recoverRequiresApproval: planned.status === "approval_required",
    restartedAfterApproval: recovered.status === "restarted",
    closedReleasesLock: closed.lock.status === "released",
    closeStopsChildren,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "2.10",
    benchmark: "daemon-session",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function fakeProcessFactory() {
  const starts = [];
  return {
    starts,
    start(spec) {
      const handle = {
        pid: starts.length + 1000,
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
