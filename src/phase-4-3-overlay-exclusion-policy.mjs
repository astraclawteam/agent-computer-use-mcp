import {
  assertOverlayExcludedFromArtifact,
  assertOverlayExcludedFromObservation,
  createOverlayExclusionPolicy,
} from "./overlay-exclusion-policy.mjs";
import { createObservationCapturePlan } from "./observation-policy.mjs";

const policy = createOverlayExclusionPolicy();
const capturePlan = createObservationCapturePlan();

let rejectedOverlayObservation = false;
let rejectedOverlayArtifact = false;

try {
  assertOverlayExcludedFromObservation({
    includeUserOverlay: false,
    elements: [{ name: "Frame", source: "gateway-overlay" }],
  });
} catch (error) {
  rejectedOverlayObservation = String(error instanceof Error ? error.message : error)
    .includes("overlay_forbidden");
}

try {
  assertOverlayExcludedFromArtifact({
    kind: "ocr-region",
    includeUserOverlay: false,
    metadata: { overlayPixels: "abc" },
  });
} catch (error) {
  rejectedOverlayArtifact = String(error instanceof Error ? error.message : error)
    .includes("overlay_forbidden");
}

const passed = policy.includeUserOverlay === false
  && policy.capture.includeUserOverlay === false
  && policy.ocr.includeUserOverlay === false
  && policy.trace.includeUserOverlay === false
  && policy.artifact.includeUserOverlay === false
  && capturePlan.includeUserOverlay === false
  && capturePlan.ocrInput.includeUserOverlay === false
  && capturePlan.artifactPolicy.includeUserOverlay === false
  && rejectedOverlayObservation
  && rejectedOverlayArtifact;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "4.3",
  benchmark: "overlay-exclusion-policy",
  protectedPaths: policy.protectedPaths,
  rejectedOverlayObservation,
  rejectedOverlayArtifact,
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
