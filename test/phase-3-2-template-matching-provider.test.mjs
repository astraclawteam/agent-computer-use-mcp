import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCanvas } from "ppu-ocv";

test("template matching provider finds repeated static UI controls from local PNGs", async () => {
  const { matchTemplateFile } = await import("../src/template-matching-provider.mjs");
  const { screenshotPath, templatePath } = await createTemplateFixture();

  const result = await matchTemplateFile({
    imagePath: screenshotPath,
    templates: [
      {
        id: "save-icon",
        label: "Save",
        role: "button",
        path: templatePath,
        threshold: 0.99,
      },
    ],
  });

  assert.equal(result.status, "matched");
  assert.equal(result.provider, "template");
  assert.equal(result.includeUserOverlay, false);
  assert.equal(result.startsDesktopControl, false);
  assert.deepEqual(result.matches.map((match) => match.bounds), [
    { x: 12, y: 10, width: 8, height: 8 },
    { x: 52, y: 28, width: 8, height: 8 },
  ]);
  assert.ok(result.matches.every((match) => match.score >= 0.99));
});

test("template matches normalize into pixel-limited observation elements", async () => {
  const {
    matchTemplateFile,
    normalizeTemplateMatches,
  } = await import("../src/template-matching-provider.mjs");
  const { screenshotPath, templatePath } = await createTemplateFixture();

  const result = await matchTemplateFile({
    imagePath: screenshotPath,
    templates: [
      {
        id: "save-icon",
        label: "Save",
        role: "button",
        path: templatePath,
      },
    ],
  });
  const observation = normalizeTemplateMatches(result, {
    observationId: "template-obs",
    window: { title: "Template Fixture" },
  });

  assert.equal(observation.source, "template");
  assert.equal(observation.mode, "template");
  assert.equal(observation.includeUserOverlay, false);
  assert.equal(observation.elements.length, 2);
  assert.deepEqual(observation.elements.map((element) => element.name), ["Save", "Save"]);
  assert.deepEqual(observation.elements[0].actions, ["click"]);
  assert.equal(observation.elements[0].pixelLimitedAction, true);
  assert.deepEqual(observation.elements[0].bounds, { x: 12, y: 10, width: 8, height: 8 });
});

test("template matching provider returns observation.insufficient for unsafe confidence", async () => {
  const { matchTemplateFile } = await import("../src/template-matching-provider.mjs");
  const { screenshotPath, templatePath } = await createTemplateFixture();

  const result = await matchTemplateFile({
    imagePath: screenshotPath,
    templates: [
      {
        id: "save-icon",
        label: "Save",
        role: "button",
        path: templatePath,
        threshold: 1.01,
      },
    ],
  });

  assert.equal(result.status, "insufficient");
  assert.equal(result.reason, "observation.insufficient: no template matches above threshold");
  assert.deepEqual(result.matches, []);
  assert.equal(result.includeUserOverlay, false);
});

test("Phase 3.2 has an executable template matching provider smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.2"], "node src/phase-3-2-template-matching-provider.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.2"], "template-matching-provider");

  const result = await runNode(["src/phase-3-2-template-matching-provider.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.2");
  assert.equal(report.benchmark, "template-matching-provider");
  assert.equal(report.matchCount, 2);
  assert.equal(report.observationElements, 2);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

async function createTemplateFixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-template-test-"));
  const screenshotPath = join(dir, "screenshot.png");
  const templatePath = join(dir, "save-template.png");

  const screenshot = createCanvas(80, 48);
  const ctx = screenshot.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 80, 48);
  drawSaveIcon(ctx, 12, 10);
  drawSaveIcon(ctx, 52, 28);
  await writeFile(screenshotPath, screenshot.toBuffer("image/png"));

  const template = createCanvas(8, 8);
  drawSaveIcon(template.getContext("2d"), 0, 0);
  await writeFile(templatePath, template.toBuffer("image/png"));

  return { screenshotPath, templatePath };
}

function drawSaveIcon(ctx, x, y) {
  ctx.fillStyle = "#ef6b4a";
  ctx.fillRect(x, y, 8, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 2, y + 1, 4, 2);
  ctx.fillStyle = "#7a2d20";
  ctx.fillRect(x + 2, y + 5, 4, 2);
}

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
