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
    probeRuntime: async ({ rootPids }) => ({
      processIds: rootPids.filter((pid) => alive.has(pid)),
      processes: rootPids.filter((pid) => alive.has(pid)).map((pid) => ({ pid, rssBytes: 10_000, handles: 20 })),
      rssBytes: rootPids.filter((pid) => alive.has(pid)).length * 10_000,
      handles: rootPids.filter((pid) => alive.has(pid)).length * 20,
      listeningPorts: [],
      overlayProcessIds: [],
      cursorProcessIds: [],
    }),
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
