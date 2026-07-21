import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

test("computer.doctor output schema allows daemon session diagnostics", () => {
  const doctor = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.doctor");

  assert.equal(doctor.outputSchema.properties.daemonSession.anyOf.length, 2);
  assert.equal(doctor.outputSchema.allOf[0].else.required.includes("daemonSession"), true);
});

test("doctor includes daemon session degraded state and repair actions", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const daemonSession = createDaemonSessionDouble();
  const router = new ComputerUseProviderRouter({ daemonSession });

  const report = await router.doctor({ fast: true, includeInstallCache: false });

  assert.equal(report.status, "degraded");
  assert.equal(report.daemonSession.status, "degraded");
  assert.equal(report.runtime.phases["2.11"], "daemon-session-doctor-repair");
  assert.deepEqual(report.repairPlan.actions, [
    {
      id: "restart-ocr-sidecar",
      kind: "process-restart",
      child: "ocr-sidecar",
      reason: "crashed",
      source: "daemon-session",
      executesImmediately: false,
    },
  ]);
  assert.equal(report.repairPlan.requiresApproval, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

test("repair executes approved daemon session restart actions", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const daemonSession = createDaemonSessionDouble();
  const router = new ComputerUseProviderRouter({ daemonSession });

  const planned = await router.repair({
    approved: false,
    dryRun: false,
    actionIds: ["restart-ocr-sidecar"],
    includeInstallCache: false,
  });
  assert.equal(planned.status, "approval_required");
  assert.equal(planned.execution.status, "not_started");
  assert.equal(daemonSession.recoverCalls.length, 0);

  const executed = await router.repair({
    approved: true,
    dryRun: false,
    actionIds: ["restart-ocr-sidecar"],
    includeInstallCache: false,
  });

  assert.equal(executed.status, "repaired");
  assert.equal(executed.executesImmediately, true);
  assert.deepEqual(daemonSession.recoverCalls, [
    { actionId: "restart-ocr-sidecar", options: { approved: true } },
  ]);
  assert.deepEqual(executed.execution.results, [
    {
      status: "restarted",
      actionId: "restart-ocr-sidecar",
      child: "ocr-sidecar",
      source: "daemon-session",
      executesImmediately: true,
      includeUserOverlay: false,
    },
  ]);
  assert.equal(executed.includeUserOverlay, false);
  assert.equal(executed.startsDesktopControl, false);
});

test("Phase 2.11 has an executable daemon session doctor repair smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.11"], "node src/phase-2-11-daemon-session-doctor-repair.mjs");

  const result = await runNode(["src/phase-2-11-daemon-session-doctor-repair.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.11");
  assert.equal(report.benchmark, "daemon-session-doctor-repair");
  assert.equal(report.daemonSessionReported, true);
  assert.equal(report.repairActionPlanned, true);
  assert.equal(report.approvedRepairRecovered, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

function createDaemonSessionDouble() {
  return {
    recoverCalls: [],
    health() {
      return {
        status: "degraded",
        lock: { status: "held", role: "mcp-daemon" },
        children: [
          {
            name: "ocr-sidecar",
            status: "crashed",
            pid: 1001,
            includeUserOverlay: false,
          },
        ],
        recoverActions: [
          {
            id: "restart-ocr-sidecar",
            kind: "process-restart",
            child: "ocr-sidecar",
            reason: "crashed",
            source: "daemon-session",
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
        source: "daemon-session",
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
