import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

test("overlay exclusion policy marks every agent observation path as overlay-free", async () => {
  const {
    createOverlayExclusionPolicy,
    assertOverlayExcludedFromObservation,
    assertOverlayExcludedFromArtifact,
  } = await import("../src/overlay-exclusion-policy.mjs");

  const policy = createOverlayExclusionPolicy();
  assert.equal(policy.includeUserOverlay, false);
  assert.equal(policy.capture.includeUserOverlay, false);
  assert.equal(policy.ocr.includeUserOverlay, false);
  assert.equal(policy.trace.includeUserOverlay, false);
  assert.equal(policy.artifact.includeUserOverlay, false);
  assert.deepEqual(policy.capture.excludeOverlayBefore, ["gateway-overlay", "cursor-overlay"]);
  assert.deepEqual(policy.ocr.excludeSources, ["gateway-overlay", "cursor-overlay"]);

  assert.doesNotThrow(() => assertOverlayExcludedFromObservation({
    includeUserOverlay: false,
    elements: [{ name: "Save", source: "uia-som" }],
  }));
  assert.throws(
    () => assertOverlayExcludedFromObservation({
      includeUserOverlay: false,
      elements: [{ name: "Computer Use", source: "gateway-overlay" }],
    }),
    /overlay_forbidden: elements\.0\.source/,
  );
  assert.throws(
    () => assertOverlayExcludedFromObservation({ includeUserOverlay: true, elements: [] }),
    /overlay_forbidden: includeUserOverlay/,
  );

  assert.doesNotThrow(() => assertOverlayExcludedFromArtifact({
    kind: "ocr-region",
    includeUserOverlay: false,
    metadata: { source: "ocr-sidecar" },
  }));
  assert.throws(
    () => assertOverlayExcludedFromArtifact({
      kind: "screenshot",
      includeUserOverlay: false,
      metadata: { overlayPixels: "abc" },
    }),
    /overlay_forbidden: metadata\.overlayPixels/,
  );
});

test("observation capture plan and trace writer reuse overlay exclusion policy", async () => {
  const { createObservationCapturePlan } = await import("../src/observation-policy.mjs");
  const { createTraceWriter } = await import("../src/trace-writer.mjs");

  const plan = createObservationCapturePlan();
  assert.equal(plan.includeUserOverlay, false);
  assert.deepEqual(plan.excludeOverlayBefore, ["gateway-overlay", "cursor-overlay"]);
  assert.equal(plan.ocrInput.includeUserOverlay, false);
  assert.equal(plan.artifactPolicy.includeUserOverlay, false);

  const traceRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-4-3-"));
  const writer = createTraceWriter({
    traceRoot,
    clock: { iso: () => "2026-07-09T18:45:00.000Z" },
  });
  await writer.writeEvent("computer.capture.created", {
    observation: {
      includeUserOverlay: false,
      elements: [{ name: "Status", source: "uia-som" }],
    },
  });
  const line = await readFile(join(traceRoot, "trace-2026-07-09.jsonl"), "utf8");
  const event = JSON.parse(line.trim());
  assert.equal(event.includeUserOverlay, false);
  assert.equal(event.payload.observation.includeUserOverlay, false);

  await assert.rejects(
    () => writer.writeEvent("computer.capture.created", {
      observation: {
        includeUserOverlay: false,
        elements: [{ name: "Frame", source: "cursor-overlay" }],
      },
    }),
    /overlay_forbidden: observation\.elements\.0\.source/,
  );
});

test("Phase 4.3 has an executable overlay exclusion smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:4.3"], "node src/phase-4-3-overlay-exclusion-policy.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["4.3"], "overlay-exclusion-policy");

  const result = await runNode(["src/phase-4-3-overlay-exclusion-policy.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "4.3");
  assert.deepEqual(report.protectedPaths, ["capture", "ocr", "trace", "artifact"]);
  assert.equal(report.rejectedOverlayObservation, true);
  assert.equal(report.rejectedOverlayArtifact, true);
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
