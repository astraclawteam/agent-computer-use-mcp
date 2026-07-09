import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DISPLAYS = [
  { id: "primary", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: "secondary", bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
];

test("overlay target tracker emits show, update, and move-display actions for moved windows", async () => {
  const { createOverlayTargetTracker } = await import("../src/overlay-target-tracker.mjs");
  const tracker = createOverlayTargetTracker({ displays: DISPLAYS, minMovementPx: 4, debounceMs: 80 });

  const show = tracker.update({
    nowMs: 1000,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: true,
    },
  });
  assert.equal(show.action, "show");
  assert.equal(show.status, "visible");
  assert.equal(show.display.id, "primary");
  assert.equal(show.targetChanged, true);
  assert.equal(show.updateTargetRect, true);
  assert.deepEqual(show.targetFrame, { x: 100, y: 120, width: 800, height: 600 });

  const jitter = tracker.update({
    nowMs: 1030,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 102, y: 121, width: 800, height: 600 },
      visible: true,
    },
  });
  assert.equal(jitter.action, "noop");
  assert.equal(jitter.reason, "target-frame-stable-within-threshold");
  assert.equal(jitter.updateTargetRect, false);

  const moved = tracker.update({
    nowMs: 1120,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 160, y: 180, width: 800, height: 600 },
      visible: true,
    },
  });
  assert.equal(moved.action, "update");
  assert.equal(moved.reason, "target-frame-moved");
  assert.equal(moved.updateTargetRect, true);
  assert.deepEqual(moved.targetFrame, { x: 160, y: 180, width: 800, height: 600 });

  const movedDisplay = tracker.update({
    nowMs: 1250,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 2100, y: 200, width: 800, height: 600 },
      visible: true,
    },
  });
  assert.equal(movedDisplay.action, "move-display");
  assert.equal(movedDisplay.reason, "target-display-changed");
  assert.equal(movedDisplay.display.id, "secondary");
  assert.deepEqual(movedDisplay.targetFrame, { x: 180, y: 200, width: 800, height: 600 });
});

test("overlay target tracker hides or degrades for unavailable target windows", async () => {
  const { createOverlayTargetTracker } = await import("../src/overlay-target-tracker.mjs");
  const tracker = createOverlayTargetTracker({ displays: DISPLAYS });

  tracker.update({
    nowMs: 1000,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: true,
    },
  });

  const hidden = tracker.update({
    nowMs: 1100,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: false,
    },
  });
  assert.equal(hidden.action, "hide");
  assert.equal(hidden.status, "suspended");
  assert.equal(hidden.reason, "target-window-hidden");
  assert.equal(hidden.targetFrame, null);
  assert.equal(hidden.updateTargetRect, true);

  const restored = tracker.update({
    nowMs: 1200,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: true,
    },
  });
  assert.equal(restored.action, "show");
  assert.equal(restored.status, "visible");

  const occluded = tracker.update({
    nowMs: 1300,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: true,
      occluded: true,
    },
  });
  assert.equal(occluded.action, "degrade");
  assert.equal(occluded.status, "degraded");
  assert.equal(occluded.reason, "target-window-occluded");
  assert.equal(occluded.targetFrame, null);
});

test("overlay target tracker reset clears state without starting desktop control", async () => {
  const { createOverlayTargetTracker } = await import("../src/overlay-target-tracker.mjs");
  const tracker = createOverlayTargetTracker({ displays: DISPLAYS });

  tracker.update({
    nowMs: 1000,
    targetWindow: {
      id: "editor",
      title: "Editor",
      bounds: { x: 100, y: 120, width: 800, height: 600 },
      visible: true,
    },
  });
  const reset = tracker.reset({ reason: "controller-revoked" });

  assert.equal(reset.action, "hide");
  assert.equal(reset.reason, "controller-revoked");
  assert.equal(reset.updateTargetRect, true);
  assert.equal(reset.includeUserOverlay, false);
  assert.equal(reset.startsDesktopControl, false);
  assert.equal(tracker.state().lastPlan, null);
});

test("Phase 4.2 has an executable overlay target tracker smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:4.2"], "node src/phase-4-2-overlay-target-tracker.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["4.2"], "overlay-target-tracker");

  const result = await runNode(["src/phase-4-2-overlay-target-tracker.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "4.2");
  assert.equal(report.benchmark, "overlay-target-tracker");
  assert.deepEqual(report.actions, ["show", "noop", "update", "move-display", "hide", "show", "degrade"]);
  assert.equal(report.updateTargetRectCount, 6);
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
