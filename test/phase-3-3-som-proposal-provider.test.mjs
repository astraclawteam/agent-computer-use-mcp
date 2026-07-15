import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCanvas } from "ppu-ocv";

test("SOM proposal provider finds self-drawn control candidates without image upload", async () => {
  const { proposeSomFromImageFile } = await import("../src/som-proposal-provider.mjs");
  const imagePath = await createSelfDrawnFixture();

  const result = await proposeSomFromImageFile({
    imagePath,
    surface: "canvas",
    minArea: 120,
  });

  assert.equal(result.status, "proposed");
  assert.equal(result.provider, "som-proposal");
  assert.equal(result.surface, "canvas");
  assert.equal(result.uploadsImage, false);
  assert.equal(result.includeUserOverlay, false);
  assert.equal(result.startsDesktopControl, false);
  assert.deepEqual(result.proposals.map((proposal) => proposal.bounds), [
    { x: 14, y: 12, width: 34, height: 18 },
    { x: 12, y: 48, width: 70, height: 8 },
  ]);
  assert.ok(result.proposals.every((proposal) => proposal.confidence >= 0.7));
});

test("SOM proposal provider normalizes candidates into pixel-limited observation elements", async () => {
  const {
    normalizeSomProposals,
    proposeSomFromImageFile,
  } = await import("../src/som-proposal-provider.mjs");
  const imagePath = await createSelfDrawnFixture();

  const result = await proposeSomFromImageFile({ imagePath, surface: "self-drawn" });
  const observation = normalizeSomProposals(result, {
    observationId: "som-proposal-obs",
    window: { title: "Self Drawn Fixture" },
  });

  assert.equal(observation.source, "som-proposal");
  assert.equal(observation.mode, "som-proposal");
  assert.equal(observation.includeUserOverlay, false);
  assert.equal(observation.elements.length, 2);
  assert.deepEqual(observation.elements.map((element) => element.role), ["button", "region"]);
  assert.deepEqual(observation.elements[0].actions, ["click"]);
  assert.equal(observation.elements[0].pixelLimitedAction, true);
  assert.deepEqual(observation.elements[0].bounds, { x: 14, y: 12, width: 34, height: 18 });
});

test("SOM proposal provider returns observation.insufficient for blank or unsafe surfaces", async () => {
  const { proposeSomFromImageFile } = await import("../src/som-proposal-provider.mjs");
  const imagePath = await createBlankFixture();

  const result = await proposeSomFromImageFile({ imagePath, minArea: 120 });

  assert.equal(result.status, "insufficient");
  assert.equal(result.reason, "observation.insufficient: no safe SOM proposals");
  assert.deepEqual(result.proposals, []);
  assert.equal(result.uploadsImage, false);
  assert.equal(result.includeUserOverlay, false);
});

test("Phase 3.3 has an executable SOM proposal provider smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.3"], "node src/phase-3-3-som-proposal-provider.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.3"], "som-proposal-provider");

  const result = await runNode(["src/phase-3-3-som-proposal-provider.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.3");
  assert.equal(report.benchmark, "som-proposal-provider");
  assert.equal(report.proposalCount, 2);
  assert.equal(report.observationElements, 2);
  assert.equal(report.uploadsImage, false);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

async function createSelfDrawnFixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-som-test-"));
  const imagePath = join(dir, "self-drawn.png");
  const canvas = createCanvas(96, 72);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 96, 72);
  ctx.fillStyle = "#262626";
  ctx.fillRect(14, 12, 34, 18);
  ctx.fillRect(12, 48, 70, 8);
  await writeFile(imagePath, canvas.toBuffer("image/png"));
  return imagePath;
}

async function createBlankFixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-som-blank-"));
  const imagePath = join(dir, "blank.png");
  const canvas = createCanvas(96, 72);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 96, 72);
  await writeFile(imagePath, canvas.toBuffer("image/png"));
  return imagePath;
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
