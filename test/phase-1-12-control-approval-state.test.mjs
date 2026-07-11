import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("control approval state requires explicit approve before desktop control starts", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let now = 1_000;
  const overlayCalls = [];
  const visualCalls = [];
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: createDriver(visualCalls),
    overlayRuntime: {
      async start(args) {
        visualCalls.push("overlay.start");
        overlayCalls.push({ method: "start", args });
        return { visible: true, processId: 99 };
      },
      async stop(handle) {
        visualCalls.push("overlay.stop");
        overlayCalls.push({ method: "stop", handle });
      },
    },
  });

  const pending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    agentId: "agent-approval",
    approvalRequired: true,
    approvalTtlMs: 50,
  });

  assert.equal(pending.status, "approval_required");
  assert.equal(pending.controller, null);
  assert.equal(pending.approval.status, "pending");
  assert.equal(pending.approval.action, "computer.request_access");
  assert.equal(pending.startsDesktopControl, false);
  assert.equal(pending.includeUserOverlay, false);
  assert.deepEqual(overlayCalls, []);
  assert.deepEqual(visualCalls, []);
  assert.equal((await router.listState()).pendingAccessApproval.token, pending.approval.token);

  await assert.rejects(
    () => router.capture({ mode: "semantic" }),
    { code: "controller.required" },
  );

  const approved = await router.approveAccess({
    approvalToken: pending.approval.token,
    approved: true,
    leaseTtlMs: 100,
  });
  assert.equal(approved.status, "granted");
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.controller.status, "active");
  assert.equal(approved.controller.agentId, "agent-approval");
  assert.equal(approved.overlay.visible, true);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start"]);
  assert.deepEqual(visualCalls, ["cursor.start", "overlay.start"]);

  now = 1_101;
  await assert.rejects(
    () => router.act({ action: { kind: "click", elementToken: "save" } }),
    /controller.expired/,
  );
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start", "stop"]);
  assert.deepEqual(visualCalls, ["cursor.start", "overlay.start", "overlay.stop", "cursor.stop"]);
});

test("control cancellation and revocation stop overlay before cursor", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: createDriver(calls),
    overlayRuntime: {
      async start() {
        calls.push("overlay.start");
        return { visible: true, processId: 99 };
      },
      async stop() {
        calls.push("overlay.stop");
      },
    },
  });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await router.cancel({ reason: "operator-cancelled" });
  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await router.revoke({ reason: "operator-revoked" });

  assert.deepEqual(calls, [
    "cursor.start",
    "overlay.start",
    "overlay.stop",
    "cursor.stop",
    "cursor.start",
    "overlay.start",
    "overlay.stop",
    "cursor.stop",
  ]);
});

test("overlay startup failure rolls back cursor and preserves the startup error", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const startupError = new Error("overlay startup failed");
  const cleanupError = new Error("cursor cleanup failed");
  const router = new ComputerUseProviderRouter({
    driver: {
      ...createDriver(),
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
        throw cleanupError;
      },
    },
    overlayRuntime: {
      async start() {
        calls.push("overlay.start");
        throw startupError;
      },
    },
  });

  await assert.rejects(
    () => router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" }),
    (error) => error === startupError,
  );

  assert.equal((await router.listState()).activeController, null);
  assert.deepEqual(calls, ["cursor.start", "overlay.start", "cursor.stop"]);
});

test("control approval state denies cancels revokes and expires fail closed", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let now = 10_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: createDriver(),
    overlayRuntime: {
      async start() {
        throw new Error("overlay must not start for denied approval paths");
      },
    },
  });

  const deniedPending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
  });
  await assert.rejects(
    () => router.requestAccess({
      titlePart: "Computer Use Lab",
      tier: "full",
      approvalRequired: true,
    }),
    { code: "controller.approval_pending" },
  );
  const denied = await router.approveAccess({
    approvalToken: deniedPending.approval.token,
    denied: true,
    reason: "operator-denied",
  });
  assert.equal(denied.status, "approval_denied");
  assert.equal(denied.startsDesktopControl, false);
  assert.equal((await router.listState()).pendingAccessApproval, null);

  const cancelledPending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
  });
  const cancelled = await router.cancel({ reason: "operator-cancelled" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.previousApproval.token, cancelledPending.approval.token);
  assert.equal((await router.listState()).pendingAccessApproval, null);

  const revokedPending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
  });
  const revoked = await router.revoke({ reason: "operator-revoked" });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.previousApproval.token, revokedPending.approval.token);
  assert.equal((await router.listState()).pendingAccessApproval, null);

  const expiredPending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
    approvalTtlMs: 10,
  });
  now += 11;
  const expired = await router.approveAccess({
    approvalToken: expiredPending.approval.token,
    approved: true,
  });
  assert.equal(expired.status, "approval_expired");
  assert.equal(expired.startsDesktopControl, false);
  assert.equal((await router.listState()).pendingAccessApproval, null);

  await assert.rejects(
    () => router.act({ action: { kind: "click", elementToken: "save" } }),
    { code: "controller.required" },
  );
});

test("Phase 1.12 exposes control approval through MCP schema and smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.12"], "node src/phase-1-12-control-approval-state.mjs");

  const { COMPUTER_USE_MCP_TOOLS } = await import("../src/computer-use-mcp-tools.mjs");
  const requestAccess = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.request_access");
  assert.equal(requestAccess.inputSchema.properties.approvalRequired.type, "boolean");
  assert.equal(requestAccess.inputSchema.properties.approvalTtlMs.type, "number");
  const approve = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.approve");
  assert.equal(approve.annotations.phase, "1.12");
  assert.equal(approve.inputSchema.required.includes("approvalToken"), true);
  assert.equal(approve.inputSchema.properties.approved.type, "boolean");
  assert.equal(approve.inputSchema.properties.denied.type, "boolean");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["1.12"], "control-approval-state");

  const result = await runNode(["src/phase-1-12-control-approval-state.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "1.12");
  assert.equal(report.benchmark, "control-approval-state");
  assert.equal(report.approveGrantsControl, true);
  assert.equal(report.denyBlocksControl, true);
  assert.equal(report.duplicatePendingBlocked, true);
  assert.equal(report.cancelClearsPending, true);
  assert.equal(report.revokeClearsPending, true);
  assert.equal(report.timeoutBlocksControl, true);
  assert.equal(report.startsDesktopControlBeforeApproval, false);
  assert.equal(report.includeUserOverlay, false);
});

function createDriver(lifecycleCalls = []) {
  return {
    async findWindow() {
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        pid: 123,
        processName: "lab.exe",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
    async capture() {
      return {
        observationId: "obs-approval",
        elements: [{ elementToken: "save", role: "Button", name: "Save", actions: ["click"] }],
        includeUserOverlay: false,
      };
    },
    async click() {
      return { status: "ok" };
    },
    async startCursor() {
      lifecycleCalls.push("cursor.start");
    },
    async stopCursor() {
      lifecycleCalls.push("cursor.stop");
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
