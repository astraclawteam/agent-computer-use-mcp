import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("perception strategy selector prefers semantic UIA/SOM observations before pixels", async () => {
  const { selectPerceptionStrategy } = await import("../src/perception-strategy-selector.mjs");

  const plan = selectPerceptionStrategy({
    mode: "action-loop",
    window: { id: "win-1", title: "Settings" },
    semanticObservation: {
      elements: [
        { role: "button", name: "Save", bounds: { x: 20, y: 20, width: 80, height: 28 }, actions: ["click"] },
      ],
    },
    image: { width: 800, height: 500 },
    imagePath: "C:\\captures\\settings.png",
  });

  assert.equal(plan.status, "selected");
  assert.equal(plan.strategy, "uia-som-semantic");
  assert.equal(plan.reason, "semantic-elements-actionable");
  assert.equal(plan.fullWindowOcr, false);
  assert.equal(plan.uploadsImage, false);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.startsDesktopControl, false);
  assert.deepEqual(plan.providers, ["uia-som"]);
  assert.equal(plan.request, null);
});

test("perception strategy selector schedules dirty-region OCR before CV providers", async () => {
  const { selectPerceptionStrategy } = await import("../src/perception-strategy-selector.mjs");

  const plan = selectPerceptionStrategy({
    mode: "action-loop",
    window: { id: "canvas-1", title: "Canvas Editor" },
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
    capabilities: {
      ocr: true,
      template: true,
      somProposal: true,
      vlm: true,
    },
  });

  assert.equal(plan.status, "selected");
  assert.equal(plan.strategy, "dirty-region-ocr");
  assert.equal(plan.reason, "dirty-region-detected");
  assert.equal(plan.fullWindowOcr, false);
  assert.deepEqual(plan.providers, ["ocr", "template", "som-proposal"]);
  assert.deepEqual(plan.request.crop, { x: 6, y: 72, width: 224, height: 96 });
  assert.equal(plan.cache.policy, "region-bucket");
  assert.equal(plan.vlm.allowed, false);
  assert.equal(plan.uploadsImage, false);
});

test("perception strategy selector uses local template/CV or SOM proposals for self-drawn surfaces", async () => {
  const { selectPerceptionStrategy } = await import("../src/perception-strategy-selector.mjs");

  const templatePlan = selectPerceptionStrategy({
    mode: "action-loop",
    window: { id: "qt-1", title: "Qt Tool" },
    semanticObservation: { elements: [] },
    image: { width: 640, height: 480 },
    imagePath: "C:\\captures\\qt.png",
    surface: "qt",
    capabilities: { ocr: false, template: true, somProposal: true },
    templates: [{ id: "save-icon", path: "templates/save.png" }],
  });

  assert.equal(templatePlan.status, "selected");
  assert.equal(templatePlan.strategy, "template-cv");
  assert.equal(templatePlan.reason, "local-templates-available");
  assert.deepEqual(templatePlan.providers, ["template", "som-proposal"]);
  assert.equal(templatePlan.pixelLimitedAction, true);
  assert.equal(templatePlan.fullWindowOcr, false);

  const somPlan = selectPerceptionStrategy({
    mode: "action-loop",
    window: { id: "industrial-1", title: "Industrial Panel" },
    semanticObservation: { elements: [] },
    image: { width: 640, height: 480 },
    imagePath: "C:\\captures\\industrial.png",
    surface: "self-drawn",
    capabilities: { ocr: false, template: false, somProposal: true },
  });

  assert.equal(somPlan.status, "selected");
  assert.equal(somPlan.strategy, "som-proposal");
  assert.equal(somPlan.reason, "self-drawn-surface-local-proposals");
  assert.deepEqual(somPlan.providers, ["som-proposal"]);
  assert.equal(somPlan.pixelLimitedAction, true);
});

test("perception strategy selector fails closed before optional VLM unless explicitly enabled", async () => {
  const { selectPerceptionStrategy } = await import("../src/perception-strategy-selector.mjs");

  const defaultPlan = selectPerceptionStrategy({
    mode: "action-loop",
    window: { id: "unknown-1", title: "Unknown Surface" },
    semanticObservation: { elements: [] },
    image: { width: 640, height: 480 },
    imagePath: "C:\\captures\\unknown.png",
    capabilities: { ocr: false, template: false, somProposal: false, vlm: true },
  });

  assert.equal(defaultPlan.status, "insufficient");
  assert.equal(defaultPlan.reason, "observation.insufficient: no local perception strategy available");
  assert.equal(defaultPlan.vlm.allowed, false);
  assert.equal(defaultPlan.uploadsImage, false);

  const vlmPlan = selectPerceptionStrategy({
    mode: "diagnostic",
    allowVlm: true,
    window: { id: "unknown-1", title: "Unknown Surface" },
    semanticObservation: { elements: [] },
    image: { width: 640, height: 480 },
    imagePath: "C:\\captures\\unknown.png",
    capabilities: { ocr: false, template: false, somProposal: false, vlm: true },
  });

  assert.equal(vlmPlan.status, "selected");
  assert.equal(vlmPlan.strategy, "optional-vlm");
  assert.equal(vlmPlan.reason, "explicit-vlm-fallback-enabled");
  assert.deepEqual(vlmPlan.providers, ["vlm"]);
  assert.equal(vlmPlan.vlm.allowed, true);
  assert.equal(vlmPlan.vlm.requiresApproval, true);
  assert.equal(vlmPlan.uploadsImage, true);
  assert.equal(vlmPlan.includeUserOverlay, false);
});

test("Phase 3.4 has an executable perception strategy selector smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.4"], "node src/phase-3-4-perception-strategy-selector.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.4"], "per-region-strategy-selector");

  const result = await runNode(["src/phase-3-4-perception-strategy-selector.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.4");
  assert.equal(report.benchmark, "per-region-strategy-selector");
  assert.deepEqual(report.strategyOrder, [
    "uia-som-semantic",
    "dirty-region-ocr",
    "template-cv",
    "som-proposal",
    "optional-vlm",
  ]);
  assert.equal(report.actionLoopFullWindowOcr, false);
  assert.equal(report.defaultUploadsImage, false);
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
