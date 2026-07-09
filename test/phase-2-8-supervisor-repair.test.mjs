import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("doctor includes process supervisor degraded state and restart repair actions", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const supervisor = createSupervisorDouble();
  const router = new ComputerUseProviderRouter({ processSupervisor: supervisor });

  const report = await router.doctor({ fast: true, includeInstallCache: false });

  assert.equal(report.status, "degraded");
  assert.equal(report.runtimeSupervisor.status, "degraded");
  assert.equal(report.runtime.phases["2.8"], "supervisor-doctor-repair");
  assert.deepEqual(report.repairPlan.actions, [
    {
      id: "restart-ocr-sidecar",
      kind: "process-restart",
      child: "ocr-sidecar",
      reason: "crashed",
      executesImmediately: false,
    },
  ]);
  assert.equal(report.repairPlan.requiresApproval, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

test("repair executes approved process restart actions and leaves other actions plan-only", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const supervisor = createSupervisorDouble();
  const router = new ComputerUseProviderRouter({ processSupervisor: supervisor });

  const planned = await router.repair({
    approved: false,
    dryRun: false,
    actionIds: ["restart-ocr-sidecar"],
    includeInstallCache: false,
  });
  assert.equal(planned.status, "approval_required");
  assert.equal(planned.execution.status, "not_started");
  assert.equal(supervisor.recoverCalls.length, 0);

  const executed = await router.repair({
    approved: true,
    dryRun: false,
    actionIds: ["restart-ocr-sidecar"],
    includeInstallCache: false,
  });

  assert.equal(executed.status, "repaired");
  assert.equal(executed.executesImmediately, true);
  assert.deepEqual(supervisor.recoverCalls, [
    { actionId: "restart-ocr-sidecar", options: { approved: true } },
  ]);
  assert.deepEqual(executed.execution.results, [
    {
      status: "restarted",
      actionId: "restart-ocr-sidecar",
      child: "ocr-sidecar",
      executesImmediately: true,
      includeUserOverlay: false,
    },
  ]);
  assert.equal(executed.includeUserOverlay, false);
  assert.equal(executed.startsDesktopControl, false);
});

test("Phase 2.8 has an executable supervisor repair smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.8"], "node src/phase-2-8-supervisor-repair.mjs");

  const result = await runNode(["src/phase-2-8-supervisor-repair.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.8");
  assert.equal(report.benchmark, "supervisor-doctor-repair");
  assert.equal(report.doctorDegraded, true);
  assert.equal(report.recoverActionExposed, true);
  assert.equal(report.restartExecutedAfterApproval, true);
  assert.equal(report.includeUserOverlay, false);
});

function createSupervisorDouble() {
  return {
    recoverCalls: [],
    health() {
      return {
        status: "degraded",
        children: [
          {
            name: "ocr-sidecar",
            status: "crashed",
            pid: 1001,
            recoverAction: "restart-ocr-sidecar",
            includeUserOverlay: false,
          },
        ],
        recoverActions: [
          {
            id: "restart-ocr-sidecar",
            kind: "process-restart",
            child: "ocr-sidecar",
            reason: "crashed",
            executesImmediately: false,
          },
        ],
        includeUserOverlay: false,
      };
    },
    recover(actionId, options) {
      this.recoverCalls.push({ actionId, options });
      return {
        status: "restarted",
        actionId,
        child: "ocr-sidecar",
        executesImmediately: true,
        includeUserOverlay: false,
      };
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
