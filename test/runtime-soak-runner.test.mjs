import assert from "node:assert/strict";
import { test } from "node:test";

import { runRuntimeSoak } from "../src/runtime-soak-runner.mjs";

test("runtime soak bounds concurrency reconnects faults and leaves no orphan sessions", async () => {
  let now = 0;
  let nextPid = 1000;
  const alive = new Set();
  const report = await runRuntimeSoak({
    durationMs: 40,
    clientCount: 2,
    concurrency: 2,
    faultEveryRounds: 2,
    now: () => now,
    sleep: async (ms) => { now += ms; },
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
    processProbe: async (pids) => Object.fromEntries(pids.map((pid) => [pid, { rssBytes: 10_000, handles: 20 }])),
    isProcessAlive: async (pid) => alive.has(pid),
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
    processProbe: async () => ({ 9: probe++ === 0
      ? { rssBytes: 1_000, handles: 10 }
      : { rssBytes: 2_000, handles: 30 } }),
    isProcessAlive: async () => false,
  });

  assert.equal(report.status, "failed");
  assert.ok(report.violations.some((item) => item.code === "runtime.rss_growth_exceeded"));
  assert.ok(report.violations.some((item) => item.code === "runtime.handle_growth_exceeded"));
});

test("runtime soak is exposed through the standard health phase catalog", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["8.0"], "runtime-soak");
});
