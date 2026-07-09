import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

test("agent-computer-use-mcp freezes the local MCP tool contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.name, "agent-computer-use-mcp");
  assert.equal(packageJson.bin["agent-computer-use-mcp"], "src/computer-use-mcp-server.mjs");
  assert.equal(packageJson.scripts["mcp"], "node src/computer-use-mcp-server.mjs");

  const toolNames = COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "computer.health",
    "computer.installation",
    "computer.request_access",
    "computer.capture",
    "computer.act",
    "computer.cancel",
    "computer.revoke",
    "computer.list_state",
    "computer.capture_window",
    "computer.ocr_region",
    "computer.observe_diff",
  ]);

  const health = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.health");
  assert.equal(health.annotations.phase, "0.9");
  assert.equal(health.inputSchema.type, "object");
  assert.equal(health.inputSchema.properties.prewarm.type, "boolean");

  const capture = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.capture_window");
  assert.equal(capture.annotations.phase, "1.0");
  assert.equal(capture.inputSchema.required.includes("titlePart"), true);

  const requestAccess = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.request_access");
  assert.equal(requestAccess.annotations.phase, "1.3");
  assert.equal(requestAccess.inputSchema.required.includes("titlePart"), true);

  const act = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.act");
  assert.equal(act.annotations.phase, "1.3");
  assert.deepEqual(act.inputSchema.required, ["action"]);

  const ocr = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.ocr_region");
  assert.equal(ocr.annotations.phase, "1.1");
  assert.equal(ocr.inputSchema.properties.crop.type, "object");

  const diff = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.observe_diff");
  assert.equal(diff.annotations.phase, "1.1");
  assert.deepEqual(diff.inputSchema.required, ["baselinePath", "changedPath"]);
});

test("agent-computer-use-mcp answers initialize, tools/list, and health over stdio", async () => {
  const client = createSdkClient("computer-use-mcp-test");

  try {
    await client.connect();
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "computer.health",
      "computer.installation",
      "computer.request_access",
      "computer.capture",
      "computer.act",
      "computer.cancel",
      "computer.revoke",
      "computer.list_state",
      "computer.capture_window",
      "computer.ocr_region",
      "computer.observe_diff",
    ]);

    const health = await client.callTool({
      name: "computer.health",
      arguments: { fast: true },
    });
    assert.equal(health.structuredContent.module, "agent-computer-use-mcp");
    assert.equal(health.structuredContent.status, "ready");
    assert.equal(health.structuredContent.phases["0.9"], "contract-freeze");
    assert.equal(health.structuredContent.phases["1.0"], "stdio-mcp-server");
    assert.equal(health.structuredContent.phases["1.1"], "provider-router");
    assert.equal(health.structuredContent.phases["1.2"], "packaging-health-contract");
    assert.equal(health.structuredContent.phases["1.5"], "safety-diagnostics");
    assert.equal(health.structuredContent.phases["1.6"], "install-config-contract");
    assert.deepEqual(health.structuredContent.actionPolicy.deliveryModes, ["background"]);

    const missingController = await client.callTool({
      name: "computer.capture",
      arguments: { mode: "semantic" },
    });
    assert.equal(missingController.isError, true);
    assert.equal(missingController.structuredContent.error.code, "controller.required");
    assert.equal(missingController.structuredContent.includeUserOverlay, false);
  } finally {
    await client.close();
  }
});

test("provider router prewarms OCR buckets during non-fast health", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    ocrSession: {
      async start() {
        calls.push({ method: "start" });
      },
      async doctor() {
        calls.push({ method: "doctor" });
        return { status: "healthy", runtime: "fake-ort" };
      },
      async recognize(request) {
        calls.push({ method: "recognize", request });
        return {
          status: "ok",
          items: [{ text: "Status", bounds: { x: 0, y: 0, width: 60, height: 24 }, confidence: 1 }],
          timings: { totalMs: 1 },
        };
      },
      async close() {
        calls.push({ method: "close" });
      },
    },
  });

  const health = await router.health({ fast: false, prewarm: true });

  assert.equal(health.prewarm.status, "completed");
  assert.deepEqual(health.prewarm.buckets.map((bucket) => bucket.size), ["128x96", "288x96", "704x320"]);
  assert.equal(calls.filter((call) => call.method === "recognize").length, 3);
  assert.equal(calls.find((call) => call.method === "recognize").request.fixture, "canvas-lab");
  await router.close();
});

test("provider router manages request/capture/action/cancel lifecycle", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const driver = {
    async findWindow(args) {
      calls.push({ method: "findWindow", args });
      return { windowId: "win-1", title: "Computer Use Lab", pid: 123, bounds: { x: 10, y: 20, width: 300, height: 180 } };
    },
    async capture(args) {
      calls.push({ method: "capture", args });
      return {
        observationId: "obs-1",
        provider: "gateway-managed",
        source: "cua-driver",
        mode: args.mode,
        elements: [
          { elementToken: "name", role: "Edit", name: "Name", actions: ["set_value"] },
          { elementToken: "save", role: "Button", name: "Save", actions: ["click"] },
        ],
        includeUserOverlay: false,
      };
    },
    async setValue(args) {
      calls.push({ method: "setValue", args });
      return { status: "ok", action: "set_value" };
    },
    async click(args) {
      calls.push({ method: "click", args });
      return { status: "ok", action: "click" };
    },
  };
  const overlayCalls = [];
  const router = new ComputerUseProviderRouter({
    driver,
    overlayRuntime: {
      async start(args) {
        overlayCalls.push({ method: "start", args });
        return { visible: true, processId: 99, targetRectFile: "target.json" };
      },
      async stop(handle) {
        overlayCalls.push({ method: "stop", handle });
      },
    },
  });

  const access = await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-1" });
  assert.equal(access.status, "granted");
  assert.equal(access.controller.provider, "gateway-managed");
  assert.equal(access.overlay.visible, true);

  const observation = await router.capture({ mode: "semantic" });
  assert.equal(observation.includeUserOverlay, false);
  assert.equal(observation.elements.length, 2);

  const action = await router.act({ action: { kind: "set_value", elementToken: "name", value: "xiaozhi" } });
  assert.equal(action.status, "ok");
  assert.equal(action.pixelLimitedAction, false);

  const state = await router.listState();
  assert.equal(state.activeController.window.title, "Computer Use Lab");
  assert.equal(state.lastCapture.observationId, "obs-1");
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.action.completed"), true);

  const cancelled = await router.cancel({ reason: "test" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await router.listState()).activeController, null);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start", "stop"]);
  assert.deepEqual(calls.map((call) => call.method), ["findWindow", "capture", "setValue"]);
});

test("provider router enforces action safety policy", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const driver = {
    async findWindow() {
      return { windowId: "win-1", title: "Computer Use Lab", pid: 123, bounds: { x: 10, y: 20, width: 300, height: 180 } };
    },
    async click(args) {
      calls.push({ method: "click", args });
      return { status: "ok" };
    },
  };
  const router = new ComputerUseProviderRouter({ driver });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "observe" });
  await assert.rejects(
    () => router.act({ action: { kind: "click", elementIndex: 1 } }),
    /observe-only access/,
  );
  assert.deepEqual(calls, []);

  await router.cancel({ reason: "switch-tier" });
  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await assert.rejects(
    () => router.act({ action: { kind: "click", deliveryMode: "foreground", elementIndex: 1 } }),
    /Unsupported delivery mode/,
  );
  await assert.rejects(
    () => router.act({ action: { kind: "set_value", elementIndex: 0 } }),
    /requires a string value/,
  );

  const state = await router.listState();
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.action.failed"), false);
});

function createSdkClient(name) {
  const client = new Client({ name, version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });
  return {
    connect: () => client.connect(transport),
    listTools: () => client.listTools(),
    callTool: (request) => client.callTool(request),
    close: () => client.close(),
  };
}
