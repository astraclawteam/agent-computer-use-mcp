const MAX_HISTORY = 14;
const REGRESSION_RATIO = 0.2;

const METRICS = Object.freeze({
  p95LatencyMs: (evidence) => evidence.report.metrics.calls.latencyMs.p95,
  rssPeakBytes: (evidence) => evidence.report.metrics.rss.peakBytes,
  rssSlopeBytesPerHour: (evidence) => evidence.report.metrics.rss.slopeBytesPerHour,
  handlePeak: (evidence) => evidence.report.metrics.handles.peak,
  reconnectsPerHour: (evidence) => (
    evidence.report.reconnectCount / (evidence.report.durationMs / 3_600_000)
  ),
  failureRate: (evidence) => evidence.report.metrics.calls.failureRate,
});

export function compareRuntimeEvidence(current, history = []) {
  const candidate = validateEvidence(current, "runtime.trend_current_invalid");
  if (!Array.isArray(history)) throw new TypeError("runtime.trend_history_invalid");
  const identity = trendIdentity(candidate.manifest);
  const matching = history
    .filter((entry) => isMatchingVerifiedEvidence(entry, identity))
    .sort((left, right) => Date.parse(right.manifest.startedAt) - Date.parse(left.manifest.startedAt))
    .slice(0, MAX_HISTORY);
  const metrics = {};
  const warnings = [];
  for (const [name, readMetric] of Object.entries(METRICS)) {
    const currentValue = metricNumber(readMetric(candidate), name);
    const historicalValues = matching.map((entry) => metricNumber(readMetric(entry), name));
    const baseline = median(historicalValues);
    const changeRatio = baseline === null ? null : ratio(currentValue, baseline);
    const regressedFromZero = baseline === 0 && currentValue > 0;
    const regressed = regressedFromZero
      || (changeRatio !== null && changeRatio >= REGRESSION_RATIO - Number.EPSILON);
    metrics[name] = {
      current: currentValue,
      median: baseline,
      changeRatio,
      regressed,
    };
    if (regressed) {
      warnings.push({
        code: "runtime.trend_regression",
        metric: name,
        current: currentValue,
        median: baseline,
        changeRatio,
        warningAt: REGRESSION_RATIO,
      });
    }
  }
  return {
    schemaVersion: 1,
    status: currentAbsoluteStatus(candidate),
    historyCount: matching.length,
    metrics,
    warnings,
  };
}

function isMatchingVerifiedEvidence(value, expectedIdentity) {
  try {
    const evidence = validateEvidence(value, "runtime.trend_history_entry_invalid");
    return evidence.status === "passed"
      && evidence.report.status === "passed"
      && evidence.report.violations.length === 0
      && trendIdentity(evidence.manifest) === expectedIdentity;
  } catch {
    return false;
  }
}

function validateEvidence(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  if (!value.manifest || !value.report) throw new TypeError(code);
  if (!Array.isArray(value.report.violations)) throw new TypeError(code);
  if (!Number.isFinite(Date.parse(value.manifest.startedAt))) throw new TypeError(code);
  finiteNumber(value.report.durationMs, code);
  if (value.report.durationMs <= 0) throw new TypeError(code);
  return value;
}

function trendIdentity(manifest) {
  const identity = {
    gate: requiredString(manifest.gate),
    platform: requiredString(manifest.machine?.platform),
    arch: requiredString(manifest.machine?.arch),
    coreName: requiredString(manifest.corePackage?.name),
    coreVersion: requiredString(manifest.corePackage?.version),
    platformName: requiredString(manifest.platformPackage?.name),
    platformVersion: requiredString(manifest.platformPackage?.version),
    driverId: requiredString(manifest.driver?.id),
    driverVersion: requiredString(manifest.driver?.version),
    driverSha256: sha256(manifest.driver?.sha256),
    modelId: requiredString(manifest.modelPack?.id),
    modelSha256: sha256(manifest.modelPack?.sha256),
  };
  return JSON.stringify(identity);
}

function currentAbsoluteStatus(evidence) {
  return evidence.status === "passed"
    && evidence.report.status === "passed"
    && evidence.report.violations.length === 0
    ? "passed"
    : "failed";
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function ratio(current, baseline) {
  if (baseline === 0) return current === 0 ? 0 : null;
  return (current - baseline) / Math.abs(baseline);
}

function finiteNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(code);
  return number;
}

function metricNumber(value, name) {
  const number = Number(value);
  const allowNegative = name === "rssSlopeBytesPerHour";
  if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
    throw new TypeError(`runtime.trend_${name}_invalid`);
  }
  return number;
}

function requiredString(value) {
  const text = String(value ?? "");
  if (!text || text.length > 256) throw new TypeError("runtime.trend_identity_invalid");
  return text;
}

function sha256(value) {
  const text = requiredString(value);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError("runtime.trend_identity_invalid");
  return text;
}
