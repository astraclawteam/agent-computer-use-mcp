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
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
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
  assert.deepEqual(calls, [
    "findWindow",
    "cursor.start",
    "overlay.start",
    "capture",
    "overlay.stop",
    "cursor.stop",
    "driver.close",
  ]);
  assert.ok(state.auditEvents.some((event) => event.type === "computer.controller.closed"));
});

test("router close attempts cursor and driver cleanup when overlay shutdown fails", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const overlayError = new Error("overlay shutdown failed");
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        return {
          windowId: "lab",
          title: "Computer Use Lab",
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
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
        throw overlayError;
      },
    },
  });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await assert.rejects(
    () => router.close({ reason: "client-disconnect" }),
    (error) => error === overlayError,
  );

  assert.deepEqual(calls, [
    "cursor.start",
    "overlay.start",
    "overlay.stop",
    "cursor.stop",
    "driver.close",
  ]);
});

test("server shutdown coalesces stdin and process triggers without skipping cleanup", async () => {
  const serverSource = readFileSync("src/computer-use-mcp-server.mjs", "utf8");
  assert.doesNotMatch(serverSource, /process\.exit\(/u);
  const serverUrl = new URL("../src/computer-use-mcp-server.mjs", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { EventEmitter } from "node:events";
    import {
      createServerShutdown,
      registerServerShutdownHandlers,
    } from ${JSON.stringify(serverUrl)};

    const calls = [];
    let releaseRouter;
    const routerGate = new Promise((resolve) => {
      releaseRouter = resolve;
    });
    let unregister = () => {};
    const shutdown = createServerShutdown({
      router: {
        async close() {
          calls.push("router.close");
          await routerGate;
        },
      },
      server: {
        async close() {
          calls.push("server.close");
        },
      },
      setExitCode(code) {
        calls.push(\`exit.\${code}\`);
      },
      cleanup() {
        unregister();
      },
    });
    const stdin = new EventEmitter();
    const processTarget = new EventEmitter();
    processTarget.stderr = { write() {} };
    unregister = registerServerShutdownHandlers({ shutdown, stdin, processTarget });

    assert.equal(stdin.listenerCount("end"), 1);
    assert.equal(stdin.listenerCount("close"), 1);
    assert.equal(processTarget.listenerCount("SIGINT"), 1);
    assert.equal(processTarget.listenerCount("SIGTERM"), 1);
    assert.equal(processTarget.listenerCount("uncaughtException"), 1);

    stdin.emit("end");
    stdin.emit("close");
    processTarget.emit("SIGTERM");
    releaseRouter();
    await shutdown(0);
    assert.deepEqual(calls, ["router.close", "server.close", "exit.0"]);
    assert.equal(stdin.listenerCount("end"), 0);
    assert.equal(stdin.listenerCount("close"), 0);
    assert.equal(processTarget.listenerCount("SIGINT"), 0);
    assert.equal(processTarget.listenerCount("SIGTERM"), 0);
    assert.equal(processTarget.listenerCount("uncaughtException"), 0);

    const failureCalls = [];
    const failedShutdown = createServerShutdown({
      router: {
        async close() {
          failureCalls.push("router.close");
          throw new Error("router cleanup failed");
        },
      },
      server: {
        async close() {
          failureCalls.push("server.close");
          throw new Error("server cleanup failed");
        },
      },
      setExitCode(code) {
        failureCalls.push(\`exit.\${code}\`);
      },
    });
    await failedShutdown(1);
    assert.deepEqual(failureCalls, ["router.close", "server.close", "exit.1"]);

    const lateExitCodes = [];
    const completedShutdown = createServerShutdown({
      router: { async close() {} },
      server: { async close() {} },
      setExitCode(code) {
        lateExitCodes.push(code);
      },
    });
    await completedShutdown(0);
    await completedShutdown(1);
    assert.deepEqual(lateExitCodes, [0, 1]);
  `;

  const result = await runNode(["--input-type=module", "--eval", script]);
  assert.equal(result.exitCode, 0, result.stderr);
});

test("server exits cleanly when an actual stdio client closes stdin", async () => {
  const child = spawn(process.execPath, ["src/computer-use-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.stdin.end();
  const exitCode = await waitForChildClose(child, 3_000);

  assert.equal(exitCode, 0, stderr);
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

function waitForChildClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("server did not exit after stdin EOF"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}
