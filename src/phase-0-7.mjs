import { createPhase07Report } from "./phase-0-7-report.mjs";
import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import {
  normalizeOcrSidecarResponse,
  OcrSidecarSession,
} from "./ocr-sidecar.mjs";

const REQUIRED_TEXT = ["Name", "Save", "Status"];
const OCR_REQUEST = {
  fixture: "canvas-lab",
  maxSidePx: 1280,
  languages: ["zh", "en"],
  timeoutMs: 15000,
};

const overlay = await startGatewayManagedOverlay();
const session = new OcrSidecarSession();

try {
  await session.start();
  const doctor = await session.doctor();
  const report = createPhase07Report({ doctor });

  if (report.status !== "ready") {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    const warmResponses = [];
    for (let index = 0; index < 3; index += 1) {
      warmResponses.push(await session.recognize({ ...OCR_REQUEST, noCache: true }));
    }
    const cachePrimeResponse = await session.recognize(OCR_REQUEST);
    const cacheHitResponse = await session.recognize(OCR_REQUEST);
    const cropResponse = await session.recognize({
      ...OCR_REQUEST,
      noCache: true,
      crop: { x: 90, y: 170, width: 680, height: 230 },
    });

    const sidecarResponse = warmResponses[warmResponses.length - 1];
    const observation = normalizeOcrSidecarResponse(sidecarResponse, {
      observationId: "phase-0-7-ocr-observation",
      window: { title: "Canvas Computer Use Lab" },
    });
    const cropObservation = normalizeOcrSidecarResponse(cropResponse, {
      observationId: "phase-0-7-crop-ocr-observation",
      window: { title: "Canvas Computer Use Lab" },
    });

    const missing = REQUIRED_TEXT.filter((text) => !observation.elements.some((element) => element.name === text));
    const cropMissing = REQUIRED_TEXT.filter((text) => !cropObservation.elements.some((element) => element.name === text));
    const status = missing.length === 0 && cropMissing.length === 0 && cacheHitResponse.cacheHit
      ? "passed"
      : "failed";

    const result = {
      status,
      phase: "0.7",
      gatewayManagedOverlay: {
        visible: overlay.visible,
        userOnly: true,
        includeUserOverlay: false,
        processId: overlay.processId,
      },
      provider: sidecarResponse.provider,
      engine: sidecarResponse.engine,
      modelFamily: sidecarResponse.modelFamily,
      modelPack: sidecarResponse.modelPack,
      modelFormat: sidecarResponse.modelFormat,
      sessionMode: sidecarResponse.sessionMode,
      runtime: sidecarResponse.runtime,
      executionProvider: sidecarResponse.executionProvider,
      acceleration: sidecarResponse.acceleration,
      availableProviders: sidecarResponse.availableProviders,
      fixture: sidecarResponse.fixture,
      recognizedText: observation.elements.map((element) => element.name),
      missing,
      daemonVerification: {
        warmUncachedRuns: warmResponses.map((response, index) => ({
          run: index + 1,
          totalMs: response.timings.totalMs,
          cacheHit: response.cacheHit,
          count: response.items.length,
        })),
        cacheRuns: [
          {
            totalMs: cachePrimeResponse.timings.totalMs,
            cacheHit: cachePrimeResponse.cacheHit,
            count: cachePrimeResponse.items.length,
          },
          {
            totalMs: cacheHitResponse.timings.totalMs,
            cacheHit: cacheHitResponse.cacheHit,
            count: cacheHitResponse.items.length,
          },
        ],
        cropRun: {
          totalMs: cropResponse.timings.totalMs,
          cacheHit: cropResponse.cacheHit,
          crop: cropResponse.crop,
          recognizedText: cropObservation.elements.map((element) => element.name),
          missing: cropMissing,
        },
      },
      observation,
      cropObservation,
    };

    console.log(JSON.stringify(result, null, 2));
    if (status !== "passed") {
      process.exitCode = 1;
    }
  }
} finally {
  await session.close();
  overlay.stop();
  stopGatewayManagedOverlay();
}
