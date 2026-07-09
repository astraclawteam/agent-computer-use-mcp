import { createOverlayTargetTracker } from "./overlay-target-tracker.mjs";

const displays = [
  { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: "secondary", bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
];
const tracker = createOverlayTargetTracker({ displays, minMovementPx: 4, debounceMs: 80 });
const steps = [
  {
    nowMs: 1000,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 100, y: 120, width: 800, height: 600 }, visible: true },
  },
  {
    nowMs: 1030,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 102, y: 121, width: 800, height: 600 }, visible: true },
  },
  {
    nowMs: 1120,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 160, y: 180, width: 800, height: 600 }, visible: true },
  },
  {
    nowMs: 1250,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 2100, y: 200, width: 800, height: 600 }, visible: true },
  },
  {
    nowMs: 1350,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 2100, y: 200, width: 800, height: 600 }, visible: false },
  },
  {
    nowMs: 1450,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 2100, y: 200, width: 800, height: 600 }, visible: true },
  },
  {
    nowMs: 1550,
    targetWindow: { id: "editor", title: "Editor", bounds: { x: 2100, y: 200, width: 800, height: 600 }, visible: true, occluded: true },
  },
];
const results = steps.map((step) => tracker.update(step));
const actions = results.map((result) => result.action);
const passed = actions.join(",") === "show,noop,update,move-display,hide,show,degrade"
  && results.filter((result) => result.updateTargetRect).length === 6
  && results.every((result) => result.includeUserOverlay === false && result.startsDesktopControl === false);

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "4.2",
  benchmark: "overlay-target-tracker",
  actions,
  updateTargetRectCount: results.filter((result) => result.updateTargetRect).length,
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
