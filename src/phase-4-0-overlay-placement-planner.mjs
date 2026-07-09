import { planOverlayPlacement } from "./overlay-placement-planner.mjs";

const multiDisplayPlan = planOverlayPlacement({
  targetWindow: {
    id: "win-secondary",
    title: "Editor",
    bounds: { x: 2060, y: 120, width: 720, height: 480 },
    state: "normal",
    visible: true,
  },
  displays: [
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: "secondary", bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
  ],
});
const highDpiPlan = planOverlayPlacement({
  targetWindow: {
    id: "win-hidpi",
    title: "Designer",
    bounds: { x: -1280, y: 90, width: 800, height: 600 },
    visible: true,
  },
  displays: [
    { id: "left-4k", bounds: { x: -1600, y: 0, width: 1600, height: 900 }, scaleFactor: 2 },
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ],
});
const fullscreenPlan = planOverlayPlacement({
  targetWindow: {
    id: "game",
    title: "Fullscreen Surface",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    state: "fullscreen",
    visible: true,
    borderless: true,
  },
  displays: [
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ],
});
const minimizedPlan = planOverlayPlacement({
  targetWindow: {
    id: "minimized",
    title: "Minimized",
    bounds: { x: 120, y: 80, width: 640, height: 480 },
    state: "minimized",
    visible: true,
  },
  displays: [
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ],
});
const occludedPlan = planOverlayPlacement({
  targetWindow: {
    id: "covered",
    title: "Covered",
    bounds: { x: 120, y: 80, width: 640, height: 480 },
    visible: true,
    occluded: true,
  },
  displays: [
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ],
});

const passed = multiDisplayPlan.display.id === "secondary"
  && highDpiPlan.devicePixelRatio === 2
  && highDpiPlan.logicalWaveThickness.min === 8
  && highDpiPlan.logicalWaveThickness.max === 16
  && fullscreenPlan.windowMode === "fullscreen-borderless"
  && minimizedPlan.status === "suspended"
  && occludedPlan.status === "degraded"
  && [multiDisplayPlan, highDpiPlan, fullscreenPlan, minimizedPlan, occludedPlan]
    .every((plan) => plan.includeUserOverlay === false && plan.startsDesktopControl === false);

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "4.0",
  benchmark: "overlay-placement-planner",
  multiDisplay: multiDisplayPlan.display.id === "secondary",
  highDpi: highDpiPlan.devicePixelRatio === 2,
  fullscreenBorderless: fullscreenPlan.windowMode === "fullscreen-borderless",
  unavailableWindowHandling: minimizedPlan.status === "suspended" && occludedPlan.status === "degraded",
  minVisibleThickness: highDpiPlan.logicalWaveThickness.min,
  maxVisibleThickness: highDpiPlan.logicalWaveThickness.max,
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
