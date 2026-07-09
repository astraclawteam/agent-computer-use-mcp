import {
  PERCEPTION_STRATEGY_ORDER,
  selectPerceptionStrategy,
} from "./perception-strategy-selector.mjs";

const semanticPlan = selectPerceptionStrategy({
  mode: "action-loop",
  window: { id: "win-semantic", title: "Semantic App" },
  semanticObservation: {
    elements: [
      { role: "button", name: "Save", bounds: { x: 12, y: 10, width: 72, height: 28 }, actions: ["click"] },
    ],
  },
  image: { width: 800, height: 500 },
});
const dirtyRegionPlan = selectPerceptionStrategy({
  mode: "action-loop",
  window: { id: "win-canvas", title: "Canvas App" },
  semanticObservation: { elements: [] },
  imagePath: "C:\\captures\\canvas.png",
  dirtyRegion: {
    x: 13,
    y: 101,
    width: 210,
    height: 38,
    changedPixels: 1210,
    image: { width: 900, height: 600 },
  },
  capabilities: { ocr: true, template: true, somProposal: true, vlm: true },
});
const templatePlan = selectPerceptionStrategy({
  mode: "action-loop",
  window: { id: "win-qt", title: "Qt App" },
  semanticObservation: { elements: [] },
  image: { width: 640, height: 480 },
  imagePath: "C:\\captures\\qt.png",
  surface: "qt",
  capabilities: { ocr: false, template: true, somProposal: true },
  templates: [{ id: "save-icon", path: "templates/save.png" }],
});
const somPlan = selectPerceptionStrategy({
  mode: "action-loop",
  window: { id: "win-industrial", title: "Industrial App" },
  semanticObservation: { elements: [] },
  image: { width: 640, height: 480 },
  imagePath: "C:\\captures\\industrial.png",
  surface: "self-drawn",
  capabilities: { ocr: false, template: false, somProposal: true },
});
const defaultPlan = selectPerceptionStrategy({
  mode: "action-loop",
  window: { id: "win-unknown", title: "Unknown App" },
  semanticObservation: { elements: [] },
  image: { width: 640, height: 480 },
  imagePath: "C:\\captures\\unknown.png",
  capabilities: { ocr: false, template: false, somProposal: false, vlm: true },
});
const vlmPlan = selectPerceptionStrategy({
  mode: "diagnostic",
  allowVlm: true,
  window: { id: "win-unknown", title: "Unknown App" },
  semanticObservation: { elements: [] },
  image: { width: 640, height: 480 },
  imagePath: "C:\\captures\\unknown.png",
  capabilities: { ocr: false, template: false, somProposal: false, vlm: true },
});

const passed = semanticPlan.strategy === "uia-som-semantic"
  && dirtyRegionPlan.strategy === "dirty-region-ocr"
  && templatePlan.strategy === "template-cv"
  && somPlan.strategy === "som-proposal"
  && defaultPlan.status === "insufficient"
  && defaultPlan.uploadsImage === false
  && vlmPlan.strategy === "optional-vlm"
  && dirtyRegionPlan.fullWindowOcr === false
  && [semanticPlan, dirtyRegionPlan, templatePlan, somPlan, defaultPlan, vlmPlan]
    .every((plan) => plan.includeUserOverlay === false && plan.startsDesktopControl === false);

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "3.4",
  benchmark: "per-region-strategy-selector",
  strategyOrder: PERCEPTION_STRATEGY_ORDER,
  selectedStrategies: [
    semanticPlan.strategy,
    dirtyRegionPlan.strategy,
    templatePlan.strategy,
    somPlan.strategy,
    vlmPlan.strategy,
  ],
  actionLoopFullWindowOcr: dirtyRegionPlan.fullWindowOcr,
  defaultUploadsImage: defaultPlan.uploadsImage,
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
