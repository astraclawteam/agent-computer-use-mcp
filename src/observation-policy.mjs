import { createOverlayExclusionPolicy } from "./overlay-exclusion-policy.mjs";

export function shouldIncludeOverlayInObservation() {
  return false;
}

export function createObservationCapturePlan() {
  const policy = createOverlayExclusionPolicy();
  return {
    primaryObservation: "ax-som",
    includeUserOverlay: false,
    excludeOverlayBefore: policy.capture.excludeOverlayBefore,
    hideSelectorsBeforeCapture: ["[data-computer-use-frame]"],
    restoreSelectorsAfterCapture: ["[data-computer-use-frame]"],
    ocrInput: policy.ocr,
    tracePolicy: policy.trace,
    artifactPolicy: policy.artifact,
  };
}
