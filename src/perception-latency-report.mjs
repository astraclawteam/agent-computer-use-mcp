export const PERCEPTION_LATENCY_TARGETS = {
  smallUiCropWarmP95Ms: 200,
  ordinaryWindowRegionWarmP95Ms: 300,
  fullWindowFirstRunMs: 1000,
};

export function buildPerceptionLatencyReport(options = {}) {
  const samples = normalizeSamples(options.samples);
  const cases = {
    smallUiCrop: buildWarmCase({
      id: "small-ui-crop",
      samples: samples.smallUiCrop,
      targetMs: PERCEPTION_LATENCY_TARGETS.smallUiCropWarmP95Ms,
      violationCode: "small-ui-crop-warm-p95-exceeded",
    }),
    ordinaryWindowRegion: buildWarmCase({
      id: "ordinary-window-region",
      samples: samples.ordinaryWindowRegion,
      targetMs: PERCEPTION_LATENCY_TARGETS.ordinaryWindowRegionWarmP95Ms,
      violationCode: "ordinary-window-region-warm-p95-exceeded",
    }),
    fullWindowFirstRun: buildFirstRunCase(samples.fullWindowFirstRun),
    fullWindowWarmDiagnostic: buildDiagnosticWarmCase(samples.fullWindowWarmDiagnostic),
  };

  const fullWindow = {
    actionLoopAllowed: options.actionLoopFullWindowOcr === true,
    diagnosticOnly: options.actionLoopFullWindowOcr !== true,
    progressAware: options.fullWindowProgressAware === true,
    cacheVerified: options.cacheVerified === true,
  };
  const violations = [
    ...cases.smallUiCrop.violations,
    ...cases.ordinaryWindowRegion.violations,
    ...cases.fullWindowFirstRun.violations,
  ];
  if (fullWindow.actionLoopAllowed) {
    violations.push({
      code: "full-window-ocr-in-action-loop",
      message: "Full-window OCR must not run in normal action loops.",
    });
  }
  if (!fullWindow.progressAware) {
    violations.push({
      code: "full-window-progress-missing",
      message: "Full-window OCR must expose progress when used diagnostically.",
    });
  }
  if (!fullWindow.cacheVerified) {
    violations.push({
      code: "full-window-cache-missing",
      message: "Full-window OCR must have cache verification before release.",
    });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "3.5",
    benchmark: "perception-latency-budget",
    targets: PERCEPTION_LATENCY_TARGETS,
    cases,
    fullWindow,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function buildWarmCase({ id, samples, targetMs, violationCode }) {
  const warmP95Ms = percentile(samples, 0.95);
  const violations = warmP95Ms <= targetMs ? [] : [
    {
      code: violationCode,
      id,
      warmP95Ms,
      targetMs,
    },
  ];
  return {
    id,
    status: violations.length === 0 ? "passed" : "failed",
    samples,
    warmP95Ms,
    targetMs,
    violations,
    includeUserOverlay: false,
  };
}

function buildFirstRunCase(samples) {
  const firstRunMs = samples[0] ?? 0;
  const targetMs = PERCEPTION_LATENCY_TARGETS.fullWindowFirstRunMs;
  const violations = firstRunMs <= targetMs ? [] : [
    {
      code: "full-window-first-run-exceeded",
      firstRunMs,
      targetMs,
    },
  ];
  return {
    id: "full-window-first-run",
    status: violations.length === 0 ? "passed" : "failed",
    samples,
    firstRunMs,
    targetMs,
    violations,
    includeUserOverlay: false,
  };
}

function buildDiagnosticWarmCase(samples) {
  return {
    id: "full-window-warm-diagnostic",
    status: "reported",
    samples,
    warmP95Ms: percentile(samples, 0.95),
    diagnosticOnly: true,
    includeUserOverlay: false,
  };
}

function normalizeSamples(samples = {}) {
  return {
    smallUiCrop: normalizeNumberArray(samples.smallUiCrop),
    ordinaryWindowRegion: normalizeNumberArray(samples.ordinaryWindowRegion),
    fullWindowFirstRun: normalizeNumberArray(samples.fullWindowFirstRun),
    fullWindowWarmDiagnostic: normalizeNumberArray(samples.fullWindowWarmDiagnostic),
  };
}

function normalizeNumberArray(values = []) {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}
