import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("repair progress plan keeps long setup operations approval-gated and cancellable", async () => {
  const { createRepairProgressPlan, cancelRepairProgressPlan } = await import("../src/repair-progress-plan.mjs");

  const plan = createRepairProgressPlan({
    repairPlan: sampleRepairPlan(),
    approval: { status: "pending", token: "tok_1", expiresAt: "2026-07-10T00:05:00.000Z" },
    approved: false,
    dryRun: false,
    operationId: "repair-op-1",
  });

  assert.equal(plan.phase, "7.2");
  assert.equal(plan.status, "waiting_for_approval");
  assert.equal(plan.operationId, "repair-op-1");
  assert.equal(plan.downloadOnFirstEnable, false);
  assert.equal(plan.startsDesktopControl, false);
  assert.equal(plan.includeUserOverlay, false);
  assert.equal(plan.policy.requiresApprovalBeforeNetwork, true);
  assert.equal(plan.policy.cancellable, true);
  assert.equal(plan.actions.length, 4);
  assert.deepEqual(plan.actions.map((action) => [action.id, action.progressKind, action.status]), [
    ["install-cua-driver-windows-x64", "install-cache", "waiting_for_approval"],
    ["build-or-install-gateway-overlay-windows", "install-cache", "waiting_for_approval"],
    ["cache-ocr-model-pp-ocrv6-small", "model-cache", "waiting_for_approval"],
    ["grant-accessibility-permission", "permission", "waiting_for_approval"],
  ]);
  assert.deepEqual(plan.events.map((event) => [event.seq, event.state, event.percent]), [
    [0, "queued", 0],
    [1, "waiting_for_approval", 5],
    [2, "blocked", 5],
  ]);

  const cancelled = cancelRepairProgressPlan(plan, { reason: "user-cancelled" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.events.at(-1).state, "cancelled");
  assert.equal(cancelled.events.at(-1).reason, "user-cancelled");
});

test("repair progress plan schedules approved actions without executing downloads implicitly", async () => {
  const { createRepairProgressPlan } = await import("../src/repair-progress-plan.mjs");

  const plan = createRepairProgressPlan({
    repairPlan: sampleRepairPlan(),
    approval: { status: "approved", token: "tok_1" },
    approved: true,
    dryRun: false,
    operationId: "repair-op-2",
  });

  assert.equal(plan.status, "ready_to_execute");
  assert.equal(plan.executesImmediately, false);
  assert.equal(plan.policy.downloadsRequireHostExecutor, true);
  assert.equal(plan.events.at(-1).state, "ready_to_execute");
  assert.deepEqual(plan.actions.map((action) => action.status), [
    "scheduled",
    "scheduled",
    "scheduled",
    "scheduled",
  ]);
});

test("computer.repair includes a Phase 7.2 progress plan", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter();

  const result = await router.repair({
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 300000,
  });

  assert.equal(result.status, "approval_required");
  assert.equal(result.progressPlan.phase, "7.2");
  assert.equal(result.progressPlan.status, "waiting_for_approval");
  assert.equal(result.progressPlan.downloadOnFirstEnable, false);
  assert.equal(result.progressPlan.startsDesktopControl, false);
  assert.equal(result.progressPlan.includeUserOverlay, false);
  assert.equal(result.progressPlan.events.at(-1).state, "blocked");
  await router.close();
});

test("Phase 7.2 has an executable repair progress smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.2"], "node src/phase-7-2-repair-progress-plan.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.2"], "repair-progress-plan");

  const result = await runNode(["src/phase-7-2-repair-progress-plan.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.2");
  assert.equal(report.waitingStatus, "waiting_for_approval");
  assert.equal(report.approvedStatus, "ready_to_execute");
  assert.equal(report.cancelledStatus, "cancelled");
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.startsDesktopControl, false);
});

function sampleRepairPlan() {
  return {
    mode: "plan-only",
    requiresApproval: true,
    actions: [
      { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
      { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
      { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
      { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
    ],
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
