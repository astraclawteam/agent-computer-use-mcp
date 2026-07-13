import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("OCR region scheduler buckets dirty regions and requires pixels for cache keys", async () => {
  const {
    buildOcrRegionCacheKey,
    scheduleOcrRegion,
  } = await import("../src/ocr-region-scheduler.mjs");

  const plan = scheduleOcrRegion({
    imagePath: "C:\\captures\\window-after.png",
    window: { id: "win-42", title: "Canvas Lab" },
    dirtyRegion: {
      x: 8,
      y: 197,
      width: 260,
      height: 85,
      changedPixels: 432,
      image: { width: 720, height: 420 },
    },
    modelPackId: "ocr-model-pp-ocrv6-small",
  });

  assert.equal(plan.status, "scheduled");
  assert.equal(plan.mode, "action-loop");
  assert.equal(plan.strategy, "dirty-region-ocr");
  assert.equal(plan.fullWindowOcr, false);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.startsDesktopControl, false);
  assert.deepEqual(plan.request.crop, {
    x: 0,
    y: 192,
    width: 288,
    height: 96,
  });
  assert.equal(plan.cache.key, null);
  assert.equal(plan.cache.contentAddressed, true);
  assert.throws(() => buildOcrRegionCacheKey(plan), /ocr_region_scheduler\.pixel_sha256_required/u);
  assert.equal(
    buildOcrRegionCacheKey(plan, "a".repeat(64)),
    `ocr-region:v2:ocr-model-pp-ocrv6-small:win-42:720x420:0,192,288,96:${"a".repeat(64)}`,
  );
});

test("OCR region scheduler refuses full-window OCR in normal action loops", async () => {
  const { scheduleOcrRegion } = await import("../src/ocr-region-scheduler.mjs");

  const plan = scheduleOcrRegion({
    imagePath: "C:\\captures\\window-after.png",
    window: { id: "win-42", title: "Canvas Lab" },
    image: { width: 720, height: 420 },
  });

  assert.equal(plan.status, "skipped");
  assert.equal(plan.reason, "full-window-ocr-disabled-in-action-loop");
  assert.equal(plan.fullWindowOcr, false);
  assert.equal(plan.request, null);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.startsDesktopControl, false);
});

test("OCR region scheduler allows explicit diagnostic full-window OCR only", async () => {
  const { scheduleOcrRegion } = await import("../src/ocr-region-scheduler.mjs");

  const plan = scheduleOcrRegion({
    imagePath: "C:\\captures\\window-after.png",
    window: { id: "win-42", title: "Canvas Lab" },
    image: { width: 720, height: 420 },
    mode: "diagnostic",
    allowFullWindow: true,
  });

  assert.equal(plan.status, "scheduled");
  assert.equal(plan.strategy, "diagnostic-full-window-ocr");
  assert.equal(plan.fullWindowOcr, true);
  assert.equal(plan.request.crop, null);
  assert.equal(plan.cache.policy, "diagnostic-no-action-loop");
  assert.equal(plan.includeUserOverlay, false);
});

test("Phase 3.1 has an executable OCR region scheduler smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.1"], "node src/phase-3-1-ocr-region-scheduler.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.1"], "ocr-region-diff-scheduler");

  const result = await runNode(["src/phase-3-1-ocr-region-scheduler.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.1");
  assert.equal(report.benchmark, "ocr-region-diff-scheduler");
  assert.equal(report.actionLoopFullWindowOcr, false);
  assert.equal(report.dirtyRegionPlan.strategy, "dirty-region-ocr");
  assert.equal(report.noDirtyRegionPlan.reason, "full-window-ocr-disabled-in-action-loop");
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
