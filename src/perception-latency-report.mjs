export const PERCEPTION_LATENCY_TARGETS = Object.freeze({
  smallUiCropWarmP95Ms: 200,
  ordinaryWindowRegionWarmP95Ms: 300,
  fullWindowFirstRunMs: 1000,
});

export const PERCEPTION_QUALITY_TARGETS = Object.freeze({
  ocrCharacterAccuracy: 0.97,
  criticalLabelRecall: 0.95,
  proposalPrecision: 0.98,
  proposalRecall: 0.90,
  guessedActionCount: 0,
});

export function buildPerceptionLatencyReport(options = {}) {
  if (Object.hasOwn(options, "samples")) throw reportError("perception.latency_samples_forbidden");
  const benchmark = options.benchmark;
  if (!isRecord(benchmark)) throw reportError("perception.benchmark_required");
  validateBenchmarkIdentity(benchmark);
  const samples = Array.isArray(benchmark.samples) ? benchmark.samples : [];
  const small = measuredDurations(samples, "small-ui-crop");
  const ordinary = measuredDurations(samples, "ordinary-window-region");
  const full = measuredDurations(samples, "full-window-diagnostic");
  const cases = {
    smallUiCrop: warmCase("small-ui-crop", small, PERCEPTION_LATENCY_TARGETS.smallUiCropWarmP95Ms),
    ordinaryWindowRegion: warmCase("ordinary-window-region", ordinary, PERCEPTION_LATENCY_TARGETS.ordinaryWindowRegionWarmP95Ms),
    fullWindowFirstRun: firstRunCase(full),
    fullWindowWarmDiagnostic: diagnosticCase(full.slice(1)),
  };
  const quality = Object.freeze({
    ocrCharacterAccuracy: finiteMetric(benchmark.ocr?.characterAccuracy),
    criticalLabelRecall: finiteMetric(benchmark.ocr?.criticalLabelRecall),
    proposalPrecision: finiteMetric(benchmark.proposal?.precision),
    proposalRecall: finiteMetric(benchmark.proposal?.recall),
    guessedActionCount: nonnegativeInteger(benchmark.proposal?.guessedActionCount),
  });
  const fullWindow = Object.freeze({
    actionLoopAllowed: benchmark.fullWindow?.actionLoopAllowed === true,
    diagnosticOnly: benchmark.fullWindow?.actionLoopAllowed !== true,
    progressAware: benchmark.fullWindow?.progressAware === true,
    cacheVerified: benchmark.fullWindow?.cacheVerified === true,
    cachePrimeMs: finiteOrNull(benchmark.fullWindow?.cachePrimeMs),
    cacheHitMs: finiteOrNull(benchmark.fullWindow?.cacheHitMs),
  });

  const violations = [];
  if (benchmark.status !== "measured" || benchmark.ocr?.failedSamples > 0 || benchmark.proposal?.failedSamples > 0) {
    violations.push({ code: "benchmark-provider-failure" });
  }
  addMinimumViolation(violations, quality.ocrCharacterAccuracy, PERCEPTION_QUALITY_TARGETS.ocrCharacterAccuracy, "ocr-character-accuracy-below-target");
  addMinimumViolation(violations, quality.criticalLabelRecall, PERCEPTION_QUALITY_TARGETS.criticalLabelRecall, "ocr-critical-label-recall-below-target");
  addMinimumViolation(violations, quality.proposalPrecision, PERCEPTION_QUALITY_TARGETS.proposalPrecision, "proposal-precision-below-target");
  addMinimumViolation(violations, quality.proposalRecall, PERCEPTION_QUALITY_TARGETS.proposalRecall, "proposal-recall-below-target");
  if (quality.guessedActionCount !== 0) violations.push({ code: "proposal-guessed-action-detected", actual: quality.guessedActionCount, target: 0 });
  violations.push(...cases.smallUiCrop.violations, ...cases.ordinaryWindowRegion.violations, ...cases.fullWindowFirstRun.violations);
  if (fullWindow.actionLoopAllowed) violations.push({ code: "full-window-ocr-in-action-loop" });
  if (!fullWindow.progressAware) violations.push({ code: "full-window-progress-missing" });
  if (!fullWindow.cacheVerified) violations.push({ code: "full-window-cache-missing" });

  return Object.freeze({
    status: violations.length === 0 ? "passed" : "failed",
    phase: "3.5",
    benchmark: "perception-corpus-gate",
    corpus: Object.freeze({
      packId: benchmark.corpus.packId,
      version: benchmark.corpus.version,
      tier: benchmark.corpus.tier,
      samples: benchmark.corpus.samples,
    }),
    identities: Object.freeze({
      ocr: sanitizeIdentity(benchmark.identities.ocr),
      visual: sanitizeIdentity(benchmark.identities.visual),
    }),
    targets: Object.freeze({ ...PERCEPTION_QUALITY_TARGETS, ...PERCEPTION_LATENCY_TARGETS }),
    quality,
    cases: Object.freeze(cases),
    fullWindow,
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
    includeUserOverlay: false,
    startsDesktopControl: false,
  });
}

function warmCase(id, values, targetMs) {
  if (values.length === 0) return failedMissingCase(id, `${id}-samples-missing`, targetMs);
  const warmP95Ms = percentile(values, 0.95);
  const violations = warmP95Ms <= targetMs ? [] : [{ code: `${id}-warm-p95-exceeded`, warmP95Ms, targetMs }];
  return Object.freeze({ id, status: violations.length === 0 ? "passed" : "failed", sampleCount: values.length, warmP95Ms, targetMs, violations });
}

function firstRunCase(values) {
  const id = "full-window-first-run";
  const targetMs = PERCEPTION_LATENCY_TARGETS.fullWindowFirstRunMs;
  if (values.length === 0) return failedMissingCase(id, "full-window-diagnostic-samples-missing", targetMs);
  const firstRunMs = values[0];
  const violations = firstRunMs <= targetMs ? [] : [{ code: "full-window-first-run-exceeded", firstRunMs, targetMs }];
  return Object.freeze({ id, status: violations.length === 0 ? "passed" : "failed", sampleCount: 1, firstRunMs, targetMs, violations });
}

function diagnosticCase(values) {
  return Object.freeze({
    id: "full-window-warm-diagnostic",
    status: "reported",
    sampleCount: values.length,
    warmP95Ms: percentile(values, 0.95),
    diagnosticOnly: true,
    violations: Object.freeze([]),
  });
}

function failedMissingCase(id, code, targetMs) {
  const violations = Object.freeze([Object.freeze({ code })]);
  return Object.freeze({ id, status: "failed", sampleCount: 0, warmP95Ms: null, targetMs, violations });
}

function measuredDurations(samples, latencyClass) {
  return samples.filter((sample) => sample?.kind === "ocr" && sample.latencyClass === latencyClass)
    .map((sample) => Number(sample.durationMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function addMinimumViolation(violations, actual, target, code) {
  if (actual < target) violations.push({ code, actual, target });
}

function validateBenchmarkIdentity(benchmark) {
  if (!isRecord(benchmark.corpus)
    || typeof benchmark.corpus.packId !== "string"
    || typeof benchmark.corpus.version !== "string"
    || !new Set(["quick", "full"]).has(benchmark.corpus.tier)
    || !Number.isSafeInteger(benchmark.corpus.samples)
    || !isRecord(benchmark.identities)
    || !isRecord(benchmark.identities.ocr)
    || !isRecord(benchmark.identities.visual)) {
    throw reportError("perception.benchmark_identity_invalid");
  }
}

function sanitizeIdentity(identity) {
  const output = {};
  for (const key of ["provider", "model", "modelPack", "modelFormat", "runtime", "executionProvider"]) {
    if (typeof identity[key] === "string" && identity[key].trim() !== "") output[key] = identity[key];
  }
  if (!output.provider) throw reportError("perception.benchmark_identity_invalid");
  return Object.freeze(output);
}

function finiteMetric(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
}

function finiteOrNull(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reportError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
