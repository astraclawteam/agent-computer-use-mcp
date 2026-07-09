import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 2.1 repair is approval-gated and does not execute by default", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const overlayCalls = [];
  const router = new ComputerUseProviderRouter({
    overlayRuntime: {
      async start(args) {
        overlayCalls.push({ method: "start", args });
        return { visible: true };
      },
    },
  });

  const result = await router.repair({ approved: false, dryRun: false });

  assert.equal(result.status, "approval_required");
  assert.equal(result.mode, "plan-only");
  assert.equal(result.executesImmediately, false);
  assert.equal(result.includeUserOverlay, false);
  assert.equal(result.startsDesktopControl, false);
  assert.equal(result.repairPlan.mode, "plan-only");
  assert.equal(result.repairPlan.actions.every((action) => action.executesImmediately === false), true);
  assert.deepEqual(overlayCalls, []);

  await router.close();
});

test("repair approval tokens expire and fail closed", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let nowMs = 1_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => nowMs,
      iso: () => new Date(nowMs).toISOString(),
    },
  });

  const requested = await router.repair({
    approved: false,
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 100,
  });
  assert.equal(requested.status, "approval_required");
  assert.equal(requested.approval.status, "pending");
  assert.equal(typeof requested.approval.token, "string");
  assert.equal(requested.approval.expiresAt, new Date(1_100).toISOString());

  nowMs = 1_101;
  const expired = await router.repair({
    approved: true,
    approvalToken: requested.approval.token,
    dryRun: false,
  });
  assert.equal(expired.status, "approval_expired");
  assert.equal(expired.executesImmediately, false);
  assert.equal(expired.execution.status, "not_started");
  assert.equal(expired.includeUserOverlay, false);

  const state = await router.listState();
  assert.equal(state.pendingRepairApproval, null);
});

test("revoke clears pending repair approval state", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter();

  const requested = await router.repair({
    approved: false,
    dryRun: false,
    requestApproval: true,
  });
  assert.equal(requested.approval.status, "pending");
  assert.equal((await router.listState()).pendingRepairApproval.token, requested.approval.token);

  await router.revoke({ reason: "test-cleanup" });

  assert.equal((await router.listState()).pendingRepairApproval, null);
});

test("Phase 2.1 has an executable repair smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.1"], "node src/phase-2-1-repair.mjs");

  const result = await runNode(["src/phase-2-1-repair.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.1");
  assert.equal(report.benchmark, "mcp-repair-approval-gate");
  assert.equal(report.repairStatus, "approval_required");
  assert.equal(report.executesImmediately, false);
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
