import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("first-enable safety plan prevents indefinite downloads and requires repair approval", async () => {
  const {
    buildFirstEnableSafetyPlan,
    validateFirstEnableSafetyPlan,
  } = await import("../src/first-enable-safety.mjs");

  const plan = buildFirstEnableSafetyPlan({
    doctor: degradedDoctor(),
    maxFirstEnableWaitMs: 15000,
  });
  const validation = validateFirstEnableSafetyPlan(plan);

  assert.equal(plan.phase, "7.5");
  assert.equal(plan.status, "blocked");
  assert.equal(plan.maxFirstEnableWaitMs, 15000);
  assert.equal(plan.downloadOnFirstEnable, false);
  assert.equal(plan.executesRepairsImmediately, false);
  assert.equal(plan.requiresUserApproval, true);
  assert.equal(plan.networkAllowedBeforeApproval, false);
  assert.equal(plan.repairProgress.phase, "7.2");
  assert.equal(plan.repairProgress.policy.requiresApprovalBeforeNetwork, true);
  assert.equal(plan.repairProgress.policy.cancellable, true);
  assert.equal(plan.repairProgress.policy.timeoutMs > 15000, true);
  assert.equal(plan.userVisibleProgressRequired, true);
  assert.equal(plan.startsDesktopControl, false);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("first-enable safety plan fails closed when enable waits on network without approval", async () => {
  const {
    buildFirstEnableSafetyPlan,
    validateFirstEnableSafetyPlan,
  } = await import("../src/first-enable-safety.mjs");

  const plan = buildFirstEnableSafetyPlan({
    doctor: degradedDoctor(),
    maxFirstEnableWaitMs: 15000,
  });
  plan.downloadOnFirstEnable = true;
  plan.networkAllowedBeforeApproval = true;

  const validation = validateFirstEnableSafetyPlan(plan);

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "download-on-first-enable",
    "network-before-approval",
  ]);
});

test("Phase 7.5 has an executable first-enable safety smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.5"], "node src/phase-7-5-first-enable-safety.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.5"], "first-enable-safety");

  const result = await runNode(["src/phase-7-5-first-enable-safety.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.5");
  assert.equal(report.benchmark, "first-enable-safety");
  assert.equal(report.firstEnableStatus, "blocked");
  assert.equal(report.maxFirstEnableWaitMs, 15000);
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.networkAllowedBeforeApproval, false);
  assert.equal(report.requiresUserApproval, true);
  assert.equal(report.userVisibleProgressRequired, true);
  assert.equal(report.repairProgressPhase, "7.2");
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function degradedDoctor() {
  return {
    status: "degraded",
    repairPlan: {
      mode: "plan-only",
      requiresApproval: true,
      actions: [
        { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
        { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
      ],
    },
  };
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
