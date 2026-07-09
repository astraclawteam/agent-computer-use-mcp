import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("repair approval can be explicitly denied and clears pending state", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter();

  const pending = await router.repair({
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 5000,
  });
  assert.equal(pending.status, "approval_required");
  assert.equal(pending.approval.status, "pending");

  const denied = await router.repair({
    denied: true,
    approvalToken: pending.approval.token,
    dryRun: false,
  });

  assert.equal(denied.status, "approval_denied");
  assert.equal(denied.approved, false);
  assert.equal(denied.denied, true);
  assert.equal(denied.approval.status, "denied");
  assert.equal(denied.executesImmediately, false);
  assert.deepEqual(denied.execution, {
    status: "not_started",
    reason: "approval-denied",
  });
  assert.equal(denied.includeUserOverlay, false);
  assert.equal(denied.startsDesktopControl, false);
  assert.equal((await router.listState()).pendingRepairApproval, null);
});

test("denied approval token cannot later approve the same repair", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const supervisor = {
    recoverCalls: [],
    health() {
      return {
        status: "degraded",
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
      return { status: "restarted", actionId };
    },
  };
  const router = new ComputerUseProviderRouter({ processSupervisor: supervisor });

  const pending = await router.repair({
    dryRun: false,
    requestApproval: true,
    includeInstallCache: false,
    actionIds: ["restart-ocr-sidecar"],
  });
  await router.repair({
    denied: true,
    approvalToken: pending.approval.token,
    dryRun: false,
    includeInstallCache: false,
    actionIds: ["restart-ocr-sidecar"],
  });
  const laterApprove = await router.repair({
    approved: true,
    approvalToken: pending.approval.token,
    dryRun: false,
    includeInstallCache: false,
    actionIds: ["restart-ocr-sidecar"],
  });

  assert.equal(laterApprove.status, "approval_invalid");
  assert.equal(laterApprove.executesImmediately, false);
  assert.equal(laterApprove.execution.reason, "approval-invalid");
  assert.deepEqual(supervisor.recoverCalls, []);
});

test("Phase 2.9 has an executable repair denial smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.9"], "node src/phase-2-9-repair-deny.mjs");

  const { COMPUTER_USE_MCP_TOOLS } = await import("../src/computer-use-mcp-tools.mjs");
  const repair = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.repair");
  assert.equal(repair.inputSchema.properties.denied.type, "boolean");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["2.9"], "repair-deny-state");

  const result = await runNode(["src/phase-2-9-repair-deny.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.9");
  assert.equal(report.benchmark, "repair-deny-state");
  assert.equal(report.pendingStatus, "pending");
  assert.equal(report.deniedStatus, "approval_denied");
  assert.equal(report.pendingAfterDeny, null);
  assert.equal(report.executesImmediately, false);
  assert.equal(report.includeUserOverlay, false);
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
