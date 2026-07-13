import assert from "node:assert/strict";
import { test } from "node:test";

import { runRuntimeSoak } from "../src/runtime-soak-runner.mjs";

test("runtime soak bounds concurrency reconnects faults and leaves no orphan sessions", async () => {
  let now = 0;
  let nextPid = 1000;
  const alive = new Set();
  const events = [];
  const report = await runRuntimeSoak({
    durationMs: 40,
    clientCount: 2,
    concurrency: 2,
    faultEveryRounds: 2,
    sampleIntervalMs: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    eventSink: { async append(type, payload) { events.push({ type, payload }); } },
    createSession: async () => {
      const pid = nextPid++;
      alive.add(pid);
      return {
        pid,
        async callTool() {
          now += 1;
          return { isError: false, structuredContent: { includeUserOverlay: false, startsDesktopControl: false } };
        },
        async fault() { alive.delete(pid); },
        async close() { alive.delete(pid); },
      };
    },
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      const requestedPids = rootPids.length > 0 ? rootPids : rootProcesses.map((root) => root.pid);
      const processIds = requestedPids.filter((pid) => alive.has(pid));
      return {
        processIds,
        processes: processIds.map((pid) => ({ pid, rssBytes: 10_000, handles: 20 })),
        rssBytes: processIds.length * 10_000,
        handles: processIds.length * 20,
        listeningPorts: [],
        overlayProcessIds: [],
        cursorProcessIds: [],
      };
    },
    isProcessAlive: async (pid) => alive.has(pid),
    cleanupDelayMs: 1,
  });

  assert.equal(report.status, "passed");
  assert.equal(report.clientCount, 2);
  assert.ok(report.completedCalls > 0);
  assert.ok(report.reconnectCount > 0);
  assert.equal(report.failedCalls, 0);
  assert.equal(report.overlayLeakCount, 0);
  assert.equal(report.desktopControlStartCount, 0);
  assert.equal(report.orphanProcessCount, 0);
  assert.ok(report.maxInFlight <= 4);
  assert.ok(report.p95LatencyMs >= 1);
  assert.ok(report.metrics.rss.peakBytes >= 20_000);
  assert.equal(events[0].type, "runtime.soak.started");
  assert.ok(events.some((event) => event.type === "runtime.sample"));
  assert.ok(events.some((event) => event.type === "runtime.session.faulted"));
  assert.equal(events.at(-1).type, "runtime.cleanup.completed");
});

test("runtime soak fails when resource growth exceeds the commercial threshold", async () => {
  let now = 0;
  let probe = 0;
  const report = await runRuntimeSoak({
    durationMs: 5,
    clientCount: 1,
    concurrency: 1,
    maxRssGrowthBytes: 100,
    maxHandleGrowth: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    createSession: async () => ({
      pid: 9,
      async callTool() { now += 1; return { isError: false, structuredContent: { includeUserOverlay: false } }; },
      async fault() {},
      async close() {},
    }),
    probeRuntime: async () => probe++ === 0
      ? runtimeProbe({ rssBytes: 1_000, handles: 10, processIds: [9] })
      : runtimeProbe({ rssBytes: 2_000, handles: 30, processIds: [] }),
    isProcessAlive: async () => false,
    cleanupDelayMs: 1,
  });

  assert.equal(report.status, "failed");
  assert.ok(report.violations.some((item) => item.code === "runtime.rss_growth_exceeded"));
  assert.ok(report.violations.some((item) => item.code === "runtime.handle_growth_exceeded"));
});

test("runtime soak retains call failures and uses the commercial failure-rate policy", async () => {
  let now = 0;
  let callCount = 0;
  const report = await runRuntimeSoak({
    durationMs: 2,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    sleep: async () => {},
    createSession: async () => ({
      pid: 7,
      async callTool() {
        now += 1;
        callCount += 1;
        return callCount === 1
          ? { isError: true, structuredContent: { includeUserOverlay: false } }
          : { isError: false, structuredContent: { includeUserOverlay: false } };
      },
      async close() {},
      async fault() {},
    }),
    probeRuntime: async () => runtimeProbe({ rssBytes: 1, handles: 1, processIds: [] }),
    isProcessAlive: async () => false,
    cleanupDelayMs: 1,
  });
  assert.equal(report.calls.length, 2);
  assert.equal(report.calls[0].status, "product-failure");
  assert.ok(report.violations.some((item) => item.code === "runtime.failure_rate_exceeded"));
});

test("runtime soak closes sessions and emits cleanup evidence after a call throws", async () => {
  let now = 0;
  let closed = 0;
  const events = [];
  const report = await runRuntimeSoak({
    durationMs: 1,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    eventSink: { async append(type, payload) { events.push({ type, payload }); } },
    createSession: async () => ({
      pid: 8,
      async callTool() { now += 1; throw new Error("transport interrupted"); },
      async close() { closed += 1; },
      async fault() {},
    }),
    probeRuntime: async () => runtimeProbe({ rssBytes: 1, handles: 1, processIds: [] }),
    isProcessAlive: async () => false,
    cleanupDelayMs: 1,
  });
  assert.equal(report.status, "failed");
  assert.ok(closed >= 1);
  assert.equal(events.at(-1).type, "runtime.cleanup.completed");
  assert.equal(report.metrics.cleanup.completed, true);
});

test("runtime soak duration excludes cleanup delay and cleanup probe time", async () => {
  let now = 0;
  let probeCount = 0;
  const report = await runRuntimeSoak({
    durationMs: 1,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    cleanupDelayMs: 100,
    createSession: async () => ({
      pid: 12,
      async callTool() { now += 1; return { isError: false, structuredContent: { includeUserOverlay: false } }; },
      async close() {},
      async fault() {},
    }),
    probeRuntime: async () => {
      probeCount += 1;
      if (probeCount >= 3) now += 50;
      return runtimeProbe({ rssBytes: 1, handles: 1, processIds: [] });
    },
    isProcessAlive: async () => false,
  });
  assert.equal(report.durationMs, 1);
});

test("runtime soak duration starts after sessions and the baseline probe are ready", async () => {
  let now = 0;
  const report = await runRuntimeSoak({
    durationMs: 2,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    sleep: async () => {},
    cleanupDelayMs: 0,
    createSession: async () => {
      now += 100;
      return {
        pid: 15,
        async callTool() { now += 1; return { isError: false, structuredContent: { includeUserOverlay: false } }; },
        async close() {},
        async fault() {},
      };
    },
    probeRuntime: async () => {
      now += 50;
      return runtimeProbe({ rssBytes: 1, handles: 1, processIds: [] });
    },
    isProcessAlive: async () => false,
  });
  assert.equal(report.calls.length, 2);
  assert.ok(report.durationMs >= 2);
});

test("runtime soak samples only the currently active session roots after reconnects", async () => {
  let now = 0;
  let nextPid = 40;
  const active = new Set();
  const sampledRoots = [];
  const report = await runRuntimeSoak({
    durationMs: 4,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 1,
    sampleIntervalMs: 1,
    now: () => now,
    wallClock: () => 1_000 + now,
    sleep: async () => {},
    cleanupDelayMs: 0,
    createSession: async () => {
      const pid = nextPid++;
      active.add(pid);
      return {
        pid,
        async callTool() {
          now += 1;
          return { isError: false, structuredContent: { includeUserOverlay: false } };
        },
        async fault() { active.delete(pid); },
        async close() { active.delete(pid); },
      };
    },
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      if (rootPids.length > 0) sampledRoots.push([...rootPids]);
      const processIds = rootPids.filter((pid) => active.has(pid));
      return runtimeProbe({
        rssBytes: processIds.length * 100,
        handles: processIds.length * 10,
        processIds,
        rootProcesses,
      });
    },
  });

  assert.equal(report.status, "passed");
  assert.ok(sampledRoots.length > 2);
  assert.equal(sampledRoots.every((roots) => roots.length === 1), true);
});

test("runtime soak cleanup excludes a different process that later reuses an owned PID", async () => {
  let now = 0;
  const cleanupProbes = [];
  const report = await runRuntimeSoak({
    durationMs: 1,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    wallClock: () => 10_000 + now,
    sleep: async () => {},
    cleanupDelayMs: 0,
    createSession: async () => ({
      pid: 77,
      async callTool() {
        now += 1;
        return { isError: false, structuredContent: { includeUserOverlay: false } };
      },
      async fault() {},
      async close() {},
    }),
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      if (rootProcesses.length > 0) {
        cleanupProbes.push(rootProcesses);
        const reusedAfterRetirement = 20_000 > rootProcesses[0].notCreatedAfterMs;
        return runtimeProbe({
          rssBytes: reusedAfterRetirement ? 0 : 100,
          handles: reusedAfterRetirement ? 0 : 10,
          processIds: reusedAfterRetirement ? [] : [77],
        });
      }
      return runtimeProbe({ rssBytes: 100, handles: 10, processIds: rootPids });
    },
    isProcessAlive: async () => true,
  });

  assert.equal(cleanupProbes.length, 1);
  assert.equal(cleanupProbes[0][0].pid, 77);
  assert.equal(cleanupProbes[0][0].notCreatedAfterMs, 10_001);
  assert.equal(report.orphanProcessCount, 0);
  assert.equal(report.status, "passed");
});

test("runtime soak deduplicates observed identities when Windows reuses a session PID", async () => {
  let now = 0;
  let generation = 0;
  let activeStartedAtMs = 0;
  let cleanupRoots = [];
  const report = await runRuntimeSoak({
    durationMs: 3,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 1,
    sampleIntervalMs: 1,
    now: () => now,
    wallClock: () => 30_000 + now,
    sleep: async () => {},
    cleanupDelayMs: 0,
    createSession: async () => {
      generation += 1;
      activeStartedAtMs = generation * 100;
      return {
        pid: 88,
        async callTool() {
          now += 1;
          return { isError: false, structuredContent: { includeUserOverlay: false } };
        },
        async fault() {},
        async close() {},
      };
    },
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      if (rootProcesses.length > 0) {
        cleanupRoots = rootProcesses;
        return runtimeProbe({ rssBytes: 0, handles: 0, processIds: [] });
      }
      return {
        ...runtimeProbe({ rssBytes: 100, handles: 10, processIds: rootPids }),
        processes: rootPids.map((pid) => ({ pid, startedAtMs: activeStartedAtMs, rssBytes: 100, handles: 10 })),
      };
    },
  });

  assert.equal(report.status, "passed");
  assert.equal(cleanupRoots.length, 1);
  assert.deepEqual(cleanupRoots[0], { pid: 88, startedAtMs: 300 });
});

test("runtime soak waits for exact owned identities to exit before declaring cleanup failure", async () => {
  let now = 0;
  let cleanupAttempts = 0;
  const report = await runRuntimeSoak({
    durationMs: 1,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    wallClock: () => 40_000 + now,
    sleep: async (ms) => { now += ms; },
    cleanupDelayMs: 0,
    cleanupTimeoutMs: 500,
    cleanupPollIntervalMs: 100,
    createSession: async () => ({
      pid: 99,
      async callTool() {
        now += 1;
        return { isError: false, structuredContent: { includeUserOverlay: false } };
      },
      async fault() {},
      async close() {},
    }),
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      if (rootProcesses.length > 0) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1
          ? runtimeProbe({ rssBytes: 100, handles: 10, processIds: [99] })
          : runtimeProbe({ rssBytes: 0, handles: 0, processIds: [] });
      }
      return runtimeProbe({ rssBytes: 100, handles: 10, processIds: rootPids });
    },
  });

  assert.equal(cleanupAttempts, 2);
  assert.equal(report.orphanProcessCount, 0);
  assert.equal(report.metrics.cleanup.completed, true);
  assert.equal(report.status, "passed");
});

test("runtime soak emits privacy-safe cleanup process classes after timeout", async () => {
  let now = 0;
  const events = [];
  const report = await runRuntimeSoak({
    durationMs: 1,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    now: () => now,
    wallClock: () => 50_000 + now,
    sleep: async (ms) => { now += ms; },
    cleanupDelayMs: 0,
    cleanupTimeoutMs: 100,
    cleanupPollIntervalMs: 100,
    eventSink: { async append(type, payload) { events.push({ type, payload }); } },
    createSession: async () => ({
      pid: 101,
      async callTool() {
        now += 1;
        return { isError: false, structuredContent: { includeUserOverlay: false } };
      },
      async fault() {},
      async close() {},
    }),
    probeRuntime: async ({ rootPids = [], rootProcesses = [] }) => {
      if (rootProcesses.length > 0) {
        return {
          ...runtimeProbe({ rssBytes: 200, handles: 20, processIds: [101, 102, 103] }),
          processes: [
            { pid: 101, name: "node.exe", startedAtMs: 1, rssBytes: 100, handles: 10 },
            { pid: 102, name: "conhost.exe", startedAtMs: 2, rssBytes: 50, handles: 5 },
            { pid: 103, name: "helper.exe", startedAtMs: 3, rssBytes: 50, handles: 5 },
          ],
        };
      }
      return runtimeProbe({ rssBytes: 100, handles: 10, processIds: rootPids });
    },
  });

  const cleanup = events.find((event) => event.type === "runtime.cleanup.completed").payload;
  assert.equal(report.status, "failed");
  assert.deepEqual(cleanup.processClasses, {
    root: 1,
    consoleHost: 1,
    other: 1,
  });
  assert.equal(JSON.stringify(cleanup).includes("node.exe"), false);
  assert.equal(JSON.stringify(cleanup).includes("helper.exe"), false);
});

test("commercial soak can discard call detail objects while retaining exact metrics", async () => {
  let now = 0;
  const report = await runRuntimeSoak({
    durationMs: 2,
    clientCount: 1,
    concurrency: 1,
    faultEveryRounds: 0,
    retainCallDetails: false,
    now: () => now,
    sleep: async () => {},
    cleanupDelayMs: 0,
    createSession: async () => ({
      pid: 111,
      async callTool() {
        now += 1;
        return { isError: false, structuredContent: { includeUserOverlay: false } };
      },
      async fault() {},
      async close() {},
    }),
    probeRuntime: async () => runtimeProbe({ rssBytes: 100, handles: 10, processIds: [] }),
  });

  assert.deepEqual(report.calls, []);
  assert.equal(report.metrics.calls.total, 2);
  assert.equal(report.metrics.calls.passed, 2);
  assert.equal(report.metrics.calls.failed, 0);
  assert.equal(report.status, "passed");
  assert.equal(report.violations.some((violation) => violation.code === "runtime.no_calls"), false);
});

test("runtime soak is exposed through the standard health phase catalog", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["8.0"], "runtime-soak");
});

function runtimeProbe({ rssBytes, handles, processIds }) {
  return {
    processIds,
    processes: processIds.map((pid) => ({ pid, rssBytes, handles })),
    rssBytes,
    handles,
    listeningPorts: [],
    overlayProcessIds: [],
    cursorProcessIds: [],
  };
}
