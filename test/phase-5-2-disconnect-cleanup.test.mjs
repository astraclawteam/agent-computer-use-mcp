import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("router close revokes active control state after abnormal disconnect", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        calls.push("findWindow");
        return {
          windowId: "lab",
          title: "Computer Use Lab",
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
      async capture() {
        calls.push("capture");
        return {
          observationId: "obs-close-cleanup",
          elements: [{ token: "save", role: "button", name: "Save" }],
        };
      },
      async close() {
        calls.push("driver.close");
      },
    },
    overlayRuntime: {
      async start() {
        calls.push("overlay.start");
        return { visible: true, processId: 42 };
      },
      async stop() {
        calls.push("overlay.stop");
      },
    },
    processSupervisor: {
      health() {
        return {
          status: "degraded",
          recoverActions: [
            { id: "restart-overlay", kind: "process-restart", reason: "test" },
          ],
        };
      },
    },
  });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-a" });
  await router.capture({ mode: "semantic" });
  const repair = await router.repair({
    includeInstallCache: false,
    requestApproval: true,
    approvalTtlMs: 300000,
  });
  assert.equal(repair.approval.status, "pending");
  assert.equal((await router.listState()).status, "active");

  await router.close({ reason: "client-disconnect" });
  const state = await router.listState();

  assert.equal(state.status, "idle");
  assert.equal(state.activeController, null);
  assert.equal(state.lastCapture, null);
  assert.equal(state.pendingRepairApproval, null);
  assert.deepEqual(calls, ["findWindow", "overlay.start", "capture", "overlay.stop", "driver.close"]);
  assert.ok(state.auditEvents.some((event) => event.type === "computer.controller.closed"));
});

test("Phase 5.2 has an executable disconnect cleanup smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.2"], "node src/phase-5-2-disconnect-cleanup.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.2"], "disconnect-cleanup");

  const result = await runNode(["src/phase-5-2-disconnect-cleanup.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.2");
  assert.equal(report.benchmark, "disconnect-cleanup");
  assert.equal(report.activeBeforeClose, true);
  assert.equal(report.idleAfterClose, true);
  assert.equal(report.lastCaptureCleared, true);
  assert.equal(report.pendingApprovalCleared, true);
  assert.equal(report.overlayStopped, true);
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
