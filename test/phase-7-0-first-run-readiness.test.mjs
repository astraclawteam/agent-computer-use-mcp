import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("first-run readiness plan turns missing local assets into explicit repair entry points", async () => {
  const { createFirstRunReadinessPlan } = await import("../src/first-run-readiness.mjs");

  const plan = createFirstRunReadinessPlan({
    doctor: {
      status: "degraded",
      repairPlan: {
        mode: "plan-only",
        requiresApproval: true,
        actions: [
          { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
          { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
          { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec,cls", executesImmediately: false },
          { id: "install-webview2-runtime", kind: "system-runtime", reason: "not-installed", executesImmediately: false },
          { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
        ],
      },
    },
  });

  assert.equal(plan.status, "needs_setup");
  assert.equal(plan.phase, "7.0");
  assert.equal(plan.mode, "first-run");
  assert.equal(plan.executesImmediately, false);
  assert.equal(plan.startsDesktopControl, false);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.networkPolicy.downloadOnFirstEnable, false);
  assert.equal(plan.offlinePolicy.canRunOfflineHealth, true);
  assert.deepEqual(plan.repairEntryPoints.map((entry) => entry.id), [
    "install-cua-driver-windows-x64",
    "build-or-install-gateway-overlay-windows",
    "cache-ocr-model-pp-ocrv6-small",
    "install-webview2-runtime",
    "grant-accessibility-permission",
  ]);
  assert.deepEqual(plan.progress.map((step) => [step.id, step.state]), [
    ["doctor", "complete"],
    ["install-cua-driver-windows-x64", "waiting-for-approval"],
    ["build-or-install-gateway-overlay-windows", "waiting-for-approval"],
    ["cache-ocr-model-pp-ocrv6-small", "waiting-for-approval"],
    ["install-webview2-runtime", "waiting-for-approval"],
    ["grant-accessibility-permission", "waiting-for-approval"],
    ["ready", "blocked"],
  ]);
  assert.equal(plan.nextAction, "request user approval for listed repair entry points");
});

test("first-run readiness plan reports ready without repair actions", async () => {
  const { createFirstRunReadinessPlan } = await import("../src/first-run-readiness.mjs");

  const plan = createFirstRunReadinessPlan({
    doctor: {
      status: "healthy",
      repairPlan: { mode: "plan-only", requiresApproval: false, actions: [] },
    },
  });

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.repairEntryPoints, []);
  assert.deepEqual(plan.progress.map((step) => [step.id, step.state]), [
    ["doctor", "complete"],
    ["ready", "complete"],
  ]);
});

test("Phase 7.0 has an executable first-run readiness smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.0"], "node src/phase-7-0-first-run-readiness.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.0"], "first-run-readiness");

  const result = await runNode(["src/phase-7-0-first-run-readiness.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.0");
  assert.equal(report.benchmark, "first-run-readiness");
  assert.equal(report.firstRunStatus, "needs_setup");
  assert.equal(report.readyStatus, "ready");
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.repairEntryPointCount, 5);
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
