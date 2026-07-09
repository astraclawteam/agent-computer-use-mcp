export function shouldIncludeOverlayInObservation() {
  return false;
}

export function createObservationCapturePlan() {
  return {
    primaryObservation: "ax-som",
    includeUserOverlay: false,
    hideSelectorsBeforeCapture: ["[data-computer-use-frame]"],
    restoreSelectorsAfterCapture: ["[data-computer-use-frame]"],
  };
}
