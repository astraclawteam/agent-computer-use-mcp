import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("pending access approval is visible before disconnect and terminally inaccessible after close", async () => {
  const { COMPUTER_USE_MCP_TOOLS } = await import("../src/computer-use-mcp-tools.mjs");
  const listState = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.list_state");
  assert.equal(listState.outputSchema.properties.pendingAccessApproval.anyOf.length, 2);
  assert.equal(listState.outputSchema.allOf[0].else.required.includes("pendingAccessApproval"), true);

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter({
    driver: createDriver(),
    overlayRuntime: {
      async start() {
        throw new Error("overlay must not start while approval is pending");
      },
    },
  });

  const pending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
    agentId: "client-a",
  });
  const stateWithPending = await router.listState();

  assert.equal(stateWithPending.status, "idle");
  assert.equal(stateWithPending.activeController, null);
  assert.equal(stateWithPending.pendingAccessApproval.token, pending.approval.token);
  assert.equal(stateWithPending.pendingAccessApproval.agentId, "client-a");
  assert.equal(stateWithPending.includeUserOverlay, false);

  await assert.rejects(
    () => router.requestAccess({
      titlePart: "Computer Use Lab",
      tier: "full",
      approvalRequired: true,
      agentId: "client-b",
    }),
    { code: "controller.approval_pending" },
  );

  await router.close({ reason: "client-disconnect" });
  assert.equal(router.pendingAccessApproval, null);
  assert.ok(router.auditEvents.some((event) => event.type === "computer.access.approval_closed"));
  await assert.rejects(() => router.listState(), { code: "lifecycle.closed" });
  await assert.rejects(
    () => router.approveAccess({
      approvalToken: pending.approval.token,
      approved: true,
    }),
    { code: "lifecycle.closed" },
  );
});

test("Phase 5.5 has an executable approval compatibility smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.5"], "node src/phase-5-5-approval-compatibility.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.5"], "approval-compatibility");

  const result = await runNode(["src/phase-5-5-approval-compatibility.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.5");
  assert.equal(report.benchmark, "approval-compatibility");
  assert.equal(report.schemaDeclaresPendingAccessApproval, true);
  assert.equal(report.pendingVisibleInState, true);
  assert.equal(report.duplicatePendingRejected, true);
  assert.equal(report.pendingClearedOnClose, true);
  assert.equal(report.closedOperationsRejected, true);
  assert.equal(report.startsDesktopControlBeforeApproval, false);
  assert.equal(report.includeUserOverlay, false);
});

function createDriver() {
  return {
    async findWindow() {
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        processName: "lab.exe",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
    async close() {},
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
