const OVERLAY_SOURCES = new Set(["gateway-overlay", "cursor-overlay", "computer-use-overlay"]);
const OVERLAY_PAYLOAD_KEYS = new Set([
  "overlay",
  "overlayPixels",
  "overlayImage",
  "overlayScreenshot",
  "cursorOverlay",
  "userOverlay",
]);

export function createOverlayExclusionPolicy() {
  const excludedSources = [...OVERLAY_SOURCES].filter((source) => source !== "computer-use-overlay");
  return {
    includeUserOverlay: false,
    protectedPaths: ["capture", "ocr", "trace", "artifact"],
    capture: {
      includeUserOverlay: false,
      excludeOverlayBefore: excludedSources,
      restoreOverlayAfter: excludedSources,
      screenshotMode: "overlay-hidden",
    },
    ocr: {
      includeUserOverlay: false,
      excludeSources: excludedSources,
      inputMode: "target-window-only",
    },
    trace: {
      includeUserOverlay: false,
      persistOverlayPayloads: false,
    },
    artifact: {
      includeUserOverlay: false,
      persistOverlayPayloads: false,
    },
    startsDesktopControl: false,
  };
}

export function assertOverlayExcludedFromObservation(observation) {
  assertOverlayExcluded(observation, []);
}

export function assertOverlayExcludedFromArtifact(artifact) {
  assertOverlayExcluded(artifact, []);
}

export function createOverlaySafeArtifactMetadata(metadata = {}) {
  assertOverlayExcludedFromArtifact(metadata);
  return {
    ...metadata,
    includeUserOverlay: false,
  };
}

function assertOverlayExcluded(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOverlayExcluded(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === "includeUserOverlay" && child === true) {
      throw new Error(`overlay_forbidden: ${childPath.join(".")}`);
    }
    if (OVERLAY_PAYLOAD_KEYS.has(key)) {
      throw new Error(`overlay_forbidden: ${childPath.join(".")}`);
    }
    if ((key === "source" || key === "provider" || key === "kind") && OVERLAY_SOURCES.has(String(child))) {
      throw new Error(`overlay_forbidden: ${childPath.join(".")}`);
    }
    assertOverlayExcluded(child, childPath);
  }
}
