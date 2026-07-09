import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("perception latency report passes warm OCR latency budgets", async () => {
  const { buildPerceptionLatencyReport } = await import("../src/perception-latency-report.mjs");

  const report = buildPerceptionLatencyReport({
    samples: {
      smallUiCrop: [58, 72, 88, 121, 164],
      ordinaryWindowRegion: [142, 180, 214, 255, 286],
      fullWindowFirstRun: [812],
      fullWindowWarmDiagnostic: [420, 510, 620],
    },
    actionLoopFullWindowOcr: false,
    fullWindowProgressAware: true,
    cacheVerified: true,
  });

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.5");
  assert.equal(report.benchmark, "perception-latency-budget");
  assert.equal(report.targets.smallUiCropWarmP95Ms, 200);
  assert.equal(report.targets.ordinaryWindowRegionWarmP95Ms, 300);
  assert.equal(report.targets.fullWindowFirstRunMs, 1000);
  assert.equal(report.cases.smallUiCrop.warmP95Ms, 164);
  assert.equal(report.cases.ordinaryWindowRegion.warmP95Ms, 286);
  assert.equal(report.cases.fullWindowFirstRun.firstRunMs, 812);
  assert.equal(report.fullWindow.actionLoopAllowed, false);
  assert.equal(report.fullWindow.progressAware, true);
  assert.equal(report.fullWindow.cacheVerified, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

test("perception latency report fails closed for slow regions or action-loop full-window OCR", async () => {
  const { buildPerceptionLatencyReport } = await import("../src/perception-latency-report.mjs");

  const report = buildPerceptionLatencyReport({
    samples: {
      smallUiCrop: [80, 120, 205, 240],
      ordinaryWindowRegion: [180, 330, 360],
      fullWindowFirstRun: [1210],
      fullWindowWarmDiagnostic: [700],
    },
    actionLoopFullWindowOcr: true,
    fullWindowProgressAware: false,
    cacheVerified: false,
  });

  assert.equal(report.status, "failed");
  assert.deepEqual(report.violations.map((violation) => violation.code), [
    "small-ui-crop-warm-p95-exceeded",
    "ordinary-window-region-warm-p95-exceeded",
    "full-window-first-run-exceeded",
    "full-window-ocr-in-action-loop",
    "full-window-progress-missing",
    "full-window-cache-missing",
  ]);
});

test("Phase 3.5 has an executable perception latency report smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.5"], "node src/phase-3-5-perception-latency-report.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.5"], "perception-latency-budget");

  const result = await runNode(["src/phase-3-5-perception-latency-report.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.5");
  assert.equal(report.benchmark, "perception-latency-budget");
  assert.equal(report.cases.smallUiCrop.status, "passed");
  assert.equal(report.cases.ordinaryWindowRegion.status, "passed");
  assert.equal(report.fullWindow.actionLoopAllowed, false);
  assert.equal(report.fullWindow.progressAware, true);
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
