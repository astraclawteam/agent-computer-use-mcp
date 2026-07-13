import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRuntimeMetrics,
  evaluateRuntimeTargets,
} from "../src/commercial-runtime-metrics.mjs";

test("runtime targets allow less than 0.1 percent failures and reject the boundary", () => {
  const belowBoundary = buildRuntimeMetrics({
    samples: stableSamples(),
    calls: calls(1001, 1),
    cleanup: cleanCleanup(),
  });
  const atBoundary = buildRuntimeMetrics({
    samples: stableSamples(),
    calls: calls(1000, 1),
    cleanup: cleanCleanup(),
  });

  assert.equal(belowBoundary.calls.failureRate, 1 / 1001);
  assert.equal(evaluateRuntimeTargets(belowBoundary).some((item) => item.code === "runtime.failure_rate_exceeded"), false);
  assert.equal(evaluateRuntimeTargets(atBoundary).some((item) => item.code === "runtime.failure_rate_exceeded"), true);
});

test("runtime metrics report net peak percentiles and least-squares slope", () => {
  const result = buildRuntimeMetrics({
    samples: [
      { elapsedMs: 0, rssBytes: 100, handles: 10 },
      { elapsedMs: 1_800_000, rssBytes: 200, handles: 20 },
      { elapsedMs: 3_600_000, rssBytes: 300, handles: 30 },
    ],
    calls: [
      { status: "passed", durationMs: 1 },
      { status: "passed", durationMs: 2 },
      { status: "passed", durationMs: 3 },
      { status: "passed", durationMs: 100 },
    ],
    cleanup: cleanCleanup(),
  });

  assert.deepEqual(result.rss, {
    initialBytes: 100,
    finalBytes: 300,
    netGrowthBytes: 200,
    peakBytes: 300,
    slopeBytesPerHour: 200,
  });
  assert.equal(result.handles.netGrowth, 20);
  assert.equal(result.handles.slopePerHour, 20);
  assert.deepEqual(result.calls.latencyMs, { p50: 2, p95: 100, p99: 100, maximum: 100 });
});

test("runtime targets report every commercial cleanup and policy violation", () => {
  const metrics = buildRuntimeMetrics({
    samples: [
      { elapsedMs: 0, rssBytes: 100, handles: 10 },
      { elapsedMs: 10_000, rssBytes: 200, handles: 20 },
    ],
    calls: [
      { status: "passed", durationMs: 10, kind: "policy-error", failClosed: false },
    ],
    cleanup: {
      orphanProcessCount: 1,
      residualPortCount: 2,
      overlayLeakCount: 3,
      cursorLeakCount: 4,
      completed: false,
    },
  });

  const codes = evaluateRuntimeTargets(metrics, {
    maxRssGrowthBytes: 50,
    maxHandleGrowth: 5,
    maxFailureRate: 0.001,
  }).map((item) => item.code);
  assert.deepEqual(codes, [
    "runtime.rss_growth_exceeded",
    "runtime.handle_growth_exceeded",
    "runtime.orphan_processes",
    "runtime.residual_ports",
    "runtime.overlay_leak",
    "runtime.cursor_leak",
    "runtime.policy_not_fail_closed",
    "runtime.cleanup_incomplete",
  ]);
});

test("runtime metrics reject unsorted or invalid samples instead of normalizing them silently", () => {
  assert.throws(
    () => buildRuntimeMetrics({
      samples: [{ elapsedMs: 10, rssBytes: 1, handles: 1 }, { elapsedMs: 0, rssBytes: 1, handles: 1 }],
      calls: [],
      cleanup: cleanCleanup(),
    }),
    /runtime.samples_not_monotonic/,
  );
  assert.throws(
    () => buildRuntimeMetrics({ samples: [], calls: [], cleanup: cleanCleanup() }),
    /runtime.samples_required/,
  );
});

function stableSamples() {
  return [
    { elapsedMs: 0, rssBytes: 1000, handles: 10 },
    { elapsedMs: 10_000, rssBytes: 1000, handles: 10 },
  ];
}

function calls(total, failed) {
  return Array.from({ length: total }, (_, index) => ({
    status: index < failed ? "product-failure" : "passed",
    durationMs: 1,
  }));
}

function cleanCleanup() {
  return {
    orphanProcessCount: 0,
    residualPortCount: 0,
    overlayLeakCount: 0,
    cursorLeakCount: 0,
    completed: true,
  };
}
