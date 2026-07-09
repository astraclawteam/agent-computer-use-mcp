import { scheduleOcrRegion } from "./ocr-region-scheduler.mjs";

const dirtyRegionPlan = scheduleOcrRegion({
  imagePath: "phase-3-1-window-after.png",
  window: { id: "phase-3-1-window", title: "Canvas Lab" },
  dirtyRegion: {
    x: 8,
    y: 197,
    width: 260,
    height: 85,
    changedPixels: 432,
    image: { width: 720, height: 420 },
  },
});
const noDirtyRegionPlan = scheduleOcrRegion({
  imagePath: "phase-3-1-window-after.png",
  window: { id: "phase-3-1-window", title: "Canvas Lab" },
  image: { width: 720, height: 420 },
});
const diagnosticPlan = scheduleOcrRegion({
  imagePath: "phase-3-1-window-after.png",
  window: { id: "phase-3-1-window", title: "Canvas Lab" },
  image: { width: 720, height: 420 },
  mode: "diagnostic",
  allowFullWindow: true,
});

const passed = dirtyRegionPlan.status === "scheduled"
  && dirtyRegionPlan.strategy === "dirty-region-ocr"
  && dirtyRegionPlan.fullWindowOcr === false
  && Boolean(dirtyRegionPlan.cache.key)
  && noDirtyRegionPlan.status === "skipped"
  && noDirtyRegionPlan.reason === "full-window-ocr-disabled-in-action-loop"
  && diagnosticPlan.fullWindowOcr === true
  && diagnosticPlan.cache.policy === "diagnostic-no-action-loop"
  && dirtyRegionPlan.includeUserOverlay === false
  && dirtyRegionPlan.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "3.1",
  benchmark: "ocr-region-diff-scheduler",
  actionLoopFullWindowOcr: false,
  dirtyRegionPlan: summarizePlan(dirtyRegionPlan),
  noDirtyRegionPlan: summarizePlan(noDirtyRegionPlan),
  diagnosticPlan: summarizePlan(diagnosticPlan),
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

function summarizePlan(plan) {
  return {
    status: plan.status,
    mode: plan.mode,
    strategy: plan.strategy,
    reason: plan.reason,
    crop: plan.request?.crop ?? null,
    fullWindowOcr: plan.fullWindowOcr,
    cache: plan.cache,
    includeUserOverlay: plan.includeUserOverlay,
    startsDesktopControl: plan.startsDesktopControl,
  };
}
