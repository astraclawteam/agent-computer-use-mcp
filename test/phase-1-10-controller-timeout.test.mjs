import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("controller lease timeout revokes stale control and stops overlay before actions", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let now = 1_000;
  const calls = [];
  const overlayCalls = [];
  const visualCalls = [];
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: {
      async findWindow() {
        calls.push({ method: "findWindow" });
        return {
          windowId: "lab",
          title: "Computer Use Lab",
          pid: 123,
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
      async capture() {
        calls.push({ method: "capture" });
        return {
          observationId: "obs-before-expiry",
          elements: [{ elementToken: "save", role: "Button", name: "Save", actions: ["click"] }],
          includeUserOverlay: false,
        };
      },
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok" };
      },
      async startCursor() {
        visualCalls.push("cursor.start");
      },
      async stopCursor() {
        visualCalls.push("cursor.stop");
      },
    },
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

  const access = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    agentId: "agent-1",
    leaseTtlMs: 50,
  });
  assert.equal(access.controller.expiresAt, new Date(1_050).toISOString());
  assert.equal(access.controller.leaseTtlMs, 50);

  const observation = await router.capture({ mode: "semantic" });
  assert.equal(observation.observationId, "obs-before-expiry");

  now = 1_051;
  await assert.rejects(
    () => router.act({ action: { kind: "click", elementToken: "save" } }),
    /controller.expired/,
  );

  const state = await router.listState();
  assert.equal(state.status, "idle");
  assert.equal(state.activeController, null);
  assert.equal(state.lastCapture, null);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start", "stop"]);
  assert.deepEqual(visualCalls, ["cursor.start", "overlay.start", "overlay.stop", "cursor.stop"]);
  assert.equal(calls.some((call) => call.method === "click"), false);
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.controller.expired"), true);
});

test("controller lease timeout is exposed in MCP schema and Phase 1.10 smoke", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.10"], "node src/phase-1-10-controller-timeout.mjs");

  const { COMPUTER_USE_MCP_TOOLS } = await import("../src/computer-use-mcp-tools.mjs");
  const requestAccess = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.request_access");
  assert.equal(requestAccess.inputSchema.properties.leaseTtlMs.type, "number");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["1.10"], "controller-lease-timeout");

  const result = await runNode(["src/phase-1-10-controller-timeout.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "1.10");
  assert.equal(report.benchmark, "controller-lease-timeout");
  assert.equal(report.expiredActionDenied, true);
  assert.equal(report.overlayStopped, true);
  assert.equal(report.staleControllerCleared, true);
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
