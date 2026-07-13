import assert from "node:assert/strict";
import { test } from "node:test";

import { compareRuntimeEvidence } from "../src/runtime-evidence-trend.mjs";

test("runtime trend compares six metrics against the median of the latest fourteen matching runs", () => {
  const current = evidence({
    startedAt: "2026-07-15T00:00:00.000Z",
    p95: 125,
    rssPeak: 250,
    rssSlope: 25,
    handlePeak: 125,
    reconnectCount: 25,
    failureRate: 0.0005,
  });
  const history = Array.from({ length: 16 }, (_, index) => evidence({
    startedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    p95: index < 2 ? 1 : 100,
    rssPeak: index < 2 ? 1 : 200,
    rssSlope: index < 2 ? 1 : 20,
    handlePeak: index < 2 ? 1 : 100,
    reconnectCount: index < 2 ? 1 : 20,
    failureRate: index < 2 ? 0 : 0.0004,
  }));

  const result = compareRuntimeEvidence(current, history);

  assert.equal(result.status, "passed");
  assert.equal(result.historyCount, 14);
  assert.equal(result.metrics.p95LatencyMs.median, 100);
  assert.equal(result.metrics.rssPeakBytes.median, 200);
  assert.equal(result.metrics.rssSlopeBytesPerHour.median, 20);
  assert.equal(result.metrics.handlePeak.median, 100);
  assert.equal(result.metrics.reconnectsPerHour.median, 10);
  assert.equal(result.metrics.failureRate.median, 0.0004);
  assert.equal(result.metrics.p95LatencyMs.changeRatio, 0.25);
  assert.deepEqual(result.warnings.map((warning) => warning.metric).sort(), [
    "failureRate",
    "handlePeak",
    "p95LatencyMs",
    "reconnectsPerHour",
    "rssPeakBytes",
    "rssSlopeBytesPerHour",
  ]);
});

test("runtime trend excludes unverified and mismatched package platform driver or model history", () => {
  const current = evidence({ p95: 100 });
  const matching = evidence({ p95: 80 });
  const history = [
    matching,
    evidence({ p95: 1, verificationStatus: "failed" }),
    evidence({ p95: 1, platform: "linux" }),
    evidence({ p95: 1, coreVersion: "0.0.2" }),
    evidence({ p95: 1, platformVersion: "0.0.2" }),
    evidence({ p95: 1, driverSha: "d".repeat(64) }),
    evidence({ p95: 1, modelSha: "e".repeat(64) }),
    evidence({ p95: 1, gate: "release-candidate" }),
  ];

  const result = compareRuntimeEvidence(current, history);

  assert.equal(result.historyCount, 1);
  assert.equal(result.metrics.p95LatencyMs.median, 80);
});

test("trend warnings never fail a valid absolute gate or rescue an invalid current run", () => {
  const regressed = compareRuntimeEvidence(
    evidence({ p95: 200 }),
    [evidence({ p95: 100 })],
  );
  assert.equal(regressed.status, "passed");
  assert.ok(regressed.warnings.some((warning) => warning.metric === "p95LatencyMs"));

  const absoluteFailure = compareRuntimeEvidence(
    evidence({ reportStatus: "failed", violations: [{ code: "runtime.handle_growth_exceeded" }], p95: 10 }),
    [evidence({ p95: 100 })],
  );
  assert.equal(absoluteFailure.status, "failed");
  assert.equal(absoluteFailure.metrics.p95LatencyMs.changeRatio, -0.9);
});

test("runtime trend accepts negative RSS slopes and treats movement toward growth as regression", () => {
  const result = compareRuntimeEvidence(
    evidence({ rssSlope: -5 }),
    [evidence({ rssSlope: -10 })],
  );

  assert.equal(result.status, "passed");
  assert.equal(result.metrics.rssSlopeBytesPerHour.changeRatio, 0.5);
  assert.equal(result.metrics.rssSlopeBytesPerHour.regressed, true);
});

function evidence(options = {}) {
  const durationMs = options.durationMs ?? 7_200_000;
  return {
    status: options.verificationStatus ?? "passed",
    manifest: {
      gate: options.gate ?? "nightly",
      startedAt: options.startedAt ?? "2026-07-01T00:00:00.000Z",
      machine: { platform: options.platform ?? "win32", arch: "x64" },
      corePackage: { name: "agent-computer-use-mcp", version: options.coreVersion ?? "0.0.1" },
      platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: options.platformVersion ?? "0.0.1" },
      driver: { id: "cua-driver-windows-x64", version: "0.7.1", sha256: options.driverSha ?? "1".repeat(64) },
      modelPack: { id: "pp-ocr-v6-small", sha256: options.modelSha ?? "2".repeat(64) },
    },
    report: {
      status: options.reportStatus ?? "passed",
      durationMs,
      reconnectCount: options.reconnectCount ?? 20,
      violations: options.violations ?? [],
      metrics: {
        rss: {
          peakBytes: options.rssPeak ?? 200,
          slopeBytesPerHour: options.rssSlope ?? 20,
        },
        handles: { peak: options.handlePeak ?? 100 },
        calls: {
          failureRate: options.failureRate ?? 0.0004,
          latencyMs: { p95: options.p95 ?? 100 },
        },
      },
    },
  };
}
