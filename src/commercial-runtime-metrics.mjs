export const COMMERCIAL_RUNTIME_TARGETS = Object.freeze({
  maxRssGrowthBytes: 128 * 1024 * 1024,
  maxHandleGrowth: 128,
  maxFailureRate: 0.001,
  maxOrphanProcessCount: 0,
  maxResidualPortCount: 0,
  maxOverlayLeakCount: 0,
  maxCursorLeakCount: 0,
  maxPolicyNotFailClosedCount: 0,
});

const FAILED_CALL_STATUSES = new Set([
  "product-failure",
  "infrastructure-error",
  "timeout",
]);

export function buildRuntimeMetrics(options = {}) {
  const samples = validateSamples(options.samples);
  const calls = validateCalls(options.calls ?? []);
  const cleanup = validateCleanup(options.cleanup ?? {});
  const rssValues = samples.map((sample) => sample.rssBytes);
  const handleValues = samples.map((sample) => sample.handles);
  const failedCalls = calls.filter((call) => call.failed === true || FAILED_CALL_STATUSES.has(call.status)).length;
  const durations = calls.map((call) => call.durationMs);
  const policyNotFailClosedCount = calls.filter(
    (call) => call.kind === "policy-error" && call.failClosed !== true,
  ).length;

  return {
    schemaVersion: 1,
    sampleCount: samples.length,
    rss: buildResourceSeries(samples, rssValues, "Bytes"),
    handles: buildResourceSeries(samples, handleValues, ""),
    calls: {
      total: calls.length,
      passed: calls.length - failedCalls,
      failed: failedCalls,
      failureRate: calls.length === 0 ? 0 : failedCalls / calls.length,
      policyNotFailClosedCount,
      latencyMs: {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        p99: percentile(durations, 0.99),
        maximum: durations.length === 0 ? 0 : Math.max(...durations),
      },
    },
    cleanup,
  };
}

export function evaluateRuntimeTargets(metrics, targets = {}) {
  const policy = { ...COMMERCIAL_RUNTIME_TARGETS, ...targets };
  const violations = [];
  if (metrics.rss.netGrowthBytes > policy.maxRssGrowthBytes) {
    violations.push({
      code: "runtime.rss_growth_exceeded",
      actual: metrics.rss.netGrowthBytes,
      maximum: policy.maxRssGrowthBytes,
    });
  }
  if (metrics.handles.netGrowth > policy.maxHandleGrowth) {
    violations.push({
      code: "runtime.handle_growth_exceeded",
      actual: metrics.handles.netGrowth,
      maximum: policy.maxHandleGrowth,
    });
  }
  if (metrics.calls.failureRate >= policy.maxFailureRate && metrics.calls.total > 0) {
    violations.push({
      code: "runtime.failure_rate_exceeded",
      actual: metrics.calls.failureRate,
      maximumExclusive: policy.maxFailureRate,
      failed: metrics.calls.failed,
      total: metrics.calls.total,
    });
  }
  appendCountViolation(violations, "runtime.orphan_processes", metrics.cleanup.orphanProcessCount, policy.maxOrphanProcessCount);
  appendCountViolation(violations, "runtime.residual_ports", metrics.cleanup.residualPortCount, policy.maxResidualPortCount);
  appendCountViolation(violations, "runtime.overlay_leak", metrics.cleanup.overlayLeakCount, policy.maxOverlayLeakCount);
  appendCountViolation(violations, "runtime.cursor_leak", metrics.cleanup.cursorLeakCount, policy.maxCursorLeakCount);
  appendCountViolation(
    violations,
    "runtime.policy_not_fail_closed",
    metrics.calls.policyNotFailClosedCount,
    policy.maxPolicyNotFailClosedCount,
  );
  if (metrics.cleanup.completed !== true) violations.push({ code: "runtime.cleanup_incomplete" });
  return violations;
}

function buildResourceSeries(samples, values, suffix) {
  const initial = values[0];
  const final = values.at(-1);
  const stem = suffix ? suffix : "";
  const result = {
    [`initial${stem}`]: initial,
    [`final${stem}`]: final,
    [`netGrowth${stem}`]: final - initial,
    [`peak${stem}`]: Math.max(...values),
  };
  if (suffix === "Bytes") result.slopeBytesPerHour = leastSquaresSlopePerHour(samples, values);
  else result.slopePerHour = leastSquaresSlopePerHour(samples, values);
  return result;
}

function leastSquaresSlopePerHour(samples, values) {
  if (samples.length < 2) return 0;
  const xs = samples.map((sample) => sample.elapsedMs / 3_600_000);
  const xMean = average(xs);
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - xMean;
    numerator += dx * (values[index] - yMean);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : round(numerator / denominator, 6);
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new TypeError("runtime.samples_required");
  let previous = -1;
  return samples.map((sample) => {
    const normalized = {
      elapsedMs: nonNegativeNumber(sample?.elapsedMs, "runtime.sample_elapsed_invalid"),
      rssBytes: nonNegativeNumber(sample?.rssBytes, "runtime.sample_rss_invalid"),
      handles: nonNegativeNumber(sample?.handles, "runtime.sample_handles_invalid"),
    };
    if (normalized.elapsedMs < previous) throw new TypeError("runtime.samples_not_monotonic");
    previous = normalized.elapsedMs;
    return normalized;
  });
}

function validateCalls(calls) {
  if (!Array.isArray(calls)) throw new TypeError("runtime.calls_invalid");
  return calls.map((call) => ({
    ...call,
    status: String(call?.status ?? "product-failure"),
    durationMs: nonNegativeNumber(call?.durationMs, "runtime.call_duration_invalid"),
  }));
}

function validateCleanup(cleanup) {
  return {
    orphanProcessCount: nonNegativeInteger(cleanup.orphanProcessCount ?? 0, "runtime.cleanup_orphans_invalid"),
    residualPortCount: nonNegativeInteger(cleanup.residualPortCount ?? 0, "runtime.cleanup_ports_invalid"),
    overlayLeakCount: nonNegativeInteger(cleanup.overlayLeakCount ?? 0, "runtime.cleanup_overlay_invalid"),
    cursorLeakCount: nonNegativeInteger(cleanup.cursorLeakCount ?? 0, "runtime.cleanup_cursor_invalid"),
    completed: cleanup.completed === true,
  };
}

function appendCountViolation(violations, code, actual, maximum) {
  if (actual > maximum) violations.push({ code, actual, maximum });
}

function nonNegativeNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(code);
  return number;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(code);
  return number;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
