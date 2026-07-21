import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

test("computer.doctor output schema allows runtime cleanup diagnostics", () => {
  const doctor = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.doctor");

  assert.equal(doctor.outputSchema.properties.runtimeCleanup.anyOf.length, 2);
  assert.equal(doctor.outputSchema.allOf[0].else.required.includes("runtimeCleanup"), true);
});

test("doctor exposes runtime cleanup repair actions without desktop control", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const runtimeCleanup = createRuntimeCleanupDouble();
  const router = new ComputerUseProviderRouter({ runtimeCleanup });

  const report = await router.doctor({ fast: true, includeInstallCache: false });

  assert.equal(report.status, "degraded");
  assert.equal(report.runtimeCleanup.status, "degraded");
  assert.equal(report.runtime.phases["2.13"], "runtime-cleanup-doctor-repair");
  assert.deepEqual(report.repairPlan.actions, [
    {
      id: "cleanup-runtime-state",
      kind: "runtime-cleanup",
      reason: "stale-daemon-locks-or-expired-runtime-files",
      staleLockCount: 1,
      expiredFileCount: 1,
      source: "runtime-cleanup",
      executesImmediately: false,
    },
  ]);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

test("repair executes runtime cleanup only after explicit approval", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const runtimeCleanup = createRuntimeCleanupDouble();
  const router = new ComputerUseProviderRouter({ runtimeCleanup });

  const planned = await router.repair({
    approved: false,
    dryRun: false,
    actionIds: ["cleanup-runtime-state"],
    includeInstallCache: false,
  });
  assert.equal(planned.status, "approval_required");
  assert.equal(planned.execution.status, "not_started");
  assert.equal(runtimeCleanup.cleanupCalls.length, 0);

  const executed = await router.repair({
    approved: true,
    dryRun: false,
    actionIds: ["cleanup-runtime-state"],
    includeInstallCache: false,
  });

  assert.equal(executed.status, "repaired");
  assert.equal(executed.executesImmediately, true);
  assert.deepEqual(runtimeCleanup.cleanupCalls, [
    { dryRun: false },
  ]);
  assert.deepEqual(executed.execution.results, [
    {
      status: "completed",
      phase: "2.12",
      deletedCount: 2,
      dryRun: false,
      includeUserOverlay: false,
      startsDesktopControl: false,
    },
  ]);
  assert.equal(executed.includeUserOverlay, false);
  assert.equal(executed.startsDesktopControl, false);
});

test("Phase 2.13 has an executable runtime cleanup doctor repair smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.13"], "node src/phase-2-13-runtime-cleanup-repair.mjs");

  const result = await runNode(["src/phase-2-13-runtime-cleanup-repair.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.13");
  assert.equal(report.benchmark, "runtime-cleanup-doctor-repair");
  assert.equal(report.runtimeCleanupReported, true);
  assert.equal(report.repairActionPlanned, true);
  assert.equal(report.approvedRepairCleaned, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

function createRuntimeCleanupDouble() {
  return {
    cleanupCalls: [],
    async inspect() {
      return {
        status: "degraded",
        phase: "2.12",
        staleLocks: [{ path: "runtime/daemon.lock.json", reason: "stale-daemon-lock" }],
        activeLocks: [],
        expired: [{ path: "runtime/overlay/target-rect.json", reason: "expired-runtime-file" }],
        deleted: [],
        deletedCount: 0,
        dryRun: true,
        includeUserOverlay: false,
        startsDesktopControl: false,
      };
    },
    async cleanup(args) {
      this.cleanupCalls.push({ dryRun: args.dryRun });
      return {
        status: "completed",
        phase: "2.12",
        deletedCount: 2,
        dryRun: args.dryRun,
        includeUserOverlay: false,
        startsDesktopControl: false,
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
