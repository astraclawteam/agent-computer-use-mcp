import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("overlay placement planner follows the target window onto the dominant display", async () => {
  const { planOverlayPlacement } = await import("../src/overlay-placement-planner.mjs");

  const plan = planOverlayPlacement({
    targetWindow: {
      id: "win-secondary",
      title: "Editor",
      bounds: { x: 2060, y: 120, width: 720, height: 480 },
      state: "normal",
      visible: true,
    },
    displays: [
      { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 },
      { id: "secondary", bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1.5 },
    ],
  });

  assert.equal(plan.status, "visible");
  assert.equal(plan.display.id, "secondary");
  assert.deepEqual(plan.overlayBounds, { x: 1920, y: 0, width: 2560, height: 1440 });
  assert.deepEqual(plan.targetFrame, { x: 140, y: 120, width: 720, height: 480 });
  assert.equal(plan.windowMode, "normal");
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.startsDesktopControl, false);
});

test("overlay placement planner keeps logical wave thickness 8-16px across high DPI displays", async () => {
  const { planOverlayPlacement } = await import("../src/overlay-placement-planner.mjs");

  const plan = planOverlayPlacement({
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

  assert.equal(plan.display.id, "left-4k");
  assert.deepEqual(plan.logicalWaveThickness, { min: 8, rest: 12, max: 16 });
  assert.deepEqual(plan.physicalWaveThickness, { min: 16, rest: 24, max: 32 });
  assert.equal(plan.devicePixelRatio, 2);
  assert.equal(plan.capturePolicy.includeUserOverlay, false);
  assert.equal(plan.capturePolicy.excludeOverlayBeforeCapture, true);
});

test("overlay placement planner handles fullscreen and borderless windows without losing the frame", async () => {
  const { planOverlayPlacement } = await import("../src/overlay-placement-planner.mjs");

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

  assert.equal(fullscreenPlan.status, "visible");
  assert.equal(fullscreenPlan.windowMode, "fullscreen-borderless");
  assert.deepEqual(fullscreenPlan.overlayBounds, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(fullscreenPlan.targetFrame, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(fullscreenPlan.topMostPolicy.noActivate, true);
  assert.equal(fullscreenPlan.topMostPolicy.clickThrough, true);
});

test("overlay placement planner suspends or degrades target frame for unavailable windows", async () => {
  const { planOverlayPlacement } = await import("../src/overlay-placement-planner.mjs");
  const displays = [
    { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ];

  const minimized = planOverlayPlacement({
    targetWindow: {
      id: "minimized",
      title: "Minimized",
      bounds: { x: 120, y: 80, width: 640, height: 480 },
      state: "minimized",
      visible: true,
    },
    displays,
  });
  assert.equal(minimized.status, "suspended");
  assert.equal(minimized.reason, "target-window-minimized");
  assert.equal(minimized.targetFrame, null);
  assert.equal(minimized.visible, false);

  const hidden = planOverlayPlacement({
    targetWindow: {
      id: "hidden",
      title: "Hidden",
      bounds: { x: 120, y: 80, width: 640, height: 480 },
      visible: false,
    },
    displays,
  });
  assert.equal(hidden.status, "suspended");
  assert.equal(hidden.reason, "target-window-hidden");
  assert.equal(hidden.targetFrame, null);

  const occluded = planOverlayPlacement({
    targetWindow: {
      id: "covered",
      title: "Covered",
      bounds: { x: 120, y: 80, width: 640, height: 480 },
      visible: true,
      occluded: true,
    },
    displays,
  });
  assert.equal(occluded.status, "degraded");
  assert.equal(occluded.reason, "target-window-occluded");
  assert.equal(occluded.visible, true);
  assert.equal(occluded.targetFrame, null);
});

test("Phase 4.0 has an executable overlay placement planner smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:4.0"], "node src/phase-4-0-overlay-placement-planner.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["4.0"], "overlay-placement-planner");

  const result = await runNode(["src/phase-4-0-overlay-placement-planner.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "4.0");
  assert.equal(report.benchmark, "overlay-placement-planner");
  assert.equal(report.multiDisplay, true);
  assert.equal(report.highDpi, true);
  assert.equal(report.fullscreenBorderless, true);
  assert.equal(report.unavailableWindowHandling, true);
  assert.equal(report.minVisibleThickness, 8);
  assert.equal(report.maxVisibleThickness, 16);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
