import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { normalizeOcrSidecarResponse, OcrSidecarSession } from "./ocr-sidecar.mjs";

const OCR_REQUEST = {
  fixture: "canvas-lab",
  maxSidePx: 1280,
  languages: ["zh", "en"],
  timeoutMs: 15000,
};

const BENCHMARK_CASES = [
  {
    id: "full-window",
    targetMs: 300,
    firstRunTargetMs: 1000,
    enforceFirstRunTarget: false,
    enforceWarmTarget: false,
    expectedText: ["Name", "Save", "Status"],
    runs: 5,
  },
  {
    id: "small-ui-crop",
    targetMs: 200,
    crop: { x: 620, y: 210, width: 130, height: 80 },
    expectedText: ["Save"],
    runs: 5,
  },
  {
    id: "ordinary-window-region",
    targetMs: 300,
    crop: { x: 90, y: 170, width: 680, height: 230 },
    expectedText: ["Name", "Save", "Status"],
    runs: 5,
  },
];

const overlay = await startGatewayManagedOverlay();
const session = new OcrSidecarSession();

try {
  await session.start();
  const doctor = await session.doctor();
  const caseReports = [];

  for (const benchmarkCase of BENCHMARK_CASES) {
    caseReports.push(await runBenchmarkCase(session, benchmarkCase));
  }

  const cachePrime = await session.recognize(OCR_REQUEST);
  const cacheHit = await session.recognize(OCR_REQUEST);
  const failedCases = caseReports.filter((report) => report.status !== "passed");
  const status = failedCases.length === 0 && cacheHit.cacheHit ? "passed" : "failed";
  const result = {
    status,
    phase: "0.7",
    benchmark: "ocr-warm-region-crop",
    productTargets: {
      smallCropMs: "50-200",
      ordinaryWindowRegionMs: 300,
      fullWindowFirstRunMs: 1000,
      fullWindowRequiresCacheAndProgress: true,
    },
    gatewayManagedOverlay: {
      visible: overlay.visible,
      userOnly: true,
      includeUserOverlay: false,
      processId: overlay.processId,
    },
    provider: doctor.provider,
    engine: doctor.engine,
    modelFamily: doctor.modelFamily,
    modelPack: doctor.modelPack,
    modelFormat: doctor.modelFormat,
    sessionMode: doctor.sessionMode,
    runtime: doctor.runtime,
    executionProvider: doctor.executionProvider,
    acceleration: doctor.acceleration,
    progress: [
      { stage: "overlay-started", done: overlay.visible },
      { stage: "sidecar-initialized", done: doctor.status === "healthy", initMs: doctor.initMs },
      { stage: "warm-region-benchmark-complete", done: true },
      { stage: "cache-verification-complete", done: Boolean(cacheHit.cacheHit) },
    ],
    cases: caseReports,
    cacheVerification: {
      primeMs: cachePrime.timings.totalMs,
      hitMs: cacheHit.timings.totalMs,
      cacheHit: cacheHit.cacheHit,
    },
    includeUserOverlay: false,
  };

  console.log(JSON.stringify(result, null, 2));
  if (status !== "passed") {
    process.exitCode = 1;
  }
} finally {
  await session.close();
  overlay.stop();
  stopGatewayManagedOverlay();
}

async function runBenchmarkCase(session, benchmarkCase) {
  const responses = [];
  for (let index = 0; index < benchmarkCase.runs; index += 1) {
    responses.push(await session.recognize({
      ...OCR_REQUEST,
      noCache: true,
      crop: benchmarkCase.crop,
    }));
  }

  const firstResponse = responses[0];
  const warmResponses = responses.slice(1);
  const warmRuns = warmResponses.map((response, index) => ({
    run: index + 2,
    totalMs: response.timings.totalMs,
    cacheHit: response.cacheHit,
    count: response.items.length,
  }));
  const observation = normalizeOcrSidecarResponse(responses[responses.length - 1], {
    observationId: `phase-0-7-benchmark-${benchmarkCase.id}`,
    window: { title: "Canvas Computer Use Lab" },
  });
  const recognizedText = observation.elements.map((element) => element.name);
  const missing = benchmarkCase.expectedText.filter((text) => !recognizedText.includes(text));
  const warmP95Ms = percentile(warmRuns.map((run) => run.totalMs), 0.95);
  const firstRunOk = benchmarkCase.firstRunTargetMs === undefined
    || firstResponse.timings.totalMs <= benchmarkCase.firstRunTargetMs;
  const warmOk = warmP95Ms <= benchmarkCase.targetMs;
  const firstRunTargetEnforced = benchmarkCase.enforceFirstRunTarget !== false;
  const warmTargetEnforced = benchmarkCase.enforceWarmTarget !== false;
  const status = missing.length === 0
    && (!firstRunTargetEnforced || firstRunOk)
    && (!warmTargetEnforced || warmOk)
    ? "passed"
    : "failed";

  return {
    id: benchmarkCase.id,
    status,
    crop: benchmarkCase.crop ?? null,
    targetMs: benchmarkCase.targetMs,
    firstRunTargetMs: benchmarkCase.firstRunTargetMs,
    shapeWarmupMs: firstResponse.timings.totalMs,
    warmP95Ms,
    warmRuns,
    firstRunTargetEnforced,
    warmTargetEnforced,
    firstRunOk,
    warmOk,
    recognizedText,
    missing,
    includeUserOverlay: false,
  };
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}
