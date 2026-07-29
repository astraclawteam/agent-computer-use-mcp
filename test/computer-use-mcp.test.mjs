import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";
import {
  createPlatformOcrSession,
  main,
  runComputerUseMcpServer,
  shouldAutoStartComputerUseMcpServer,
} from "../src/computer-use-mcp-server.mjs";

test("source and SEA entrypoints share one MCP composition", () => {
  assert.equal(typeof main, "function");
  assert.equal(main, runComputerUseMcpServer);
});

test("protected imports never auto-start a second stdio server", () => {
  assert.equal(shouldAutoStartComputerUseMcpServer({
    argv: [process.execPath, "D:\\package\\dist\\launcher.mjs"],
    moduleUrl: "file:///D:/package/dist/computer-use-mcp-server.mjs",
    environment: { AGENT_COMPUTER_USE_RELEASE_INTEGRITY_VERIFIED: "1" },
  }), false);
  assert.equal(shouldAutoStartComputerUseMcpServer({
    argv: [process.execPath, "D:\\package\\dist\\computer-use-mcp-server.mjs"],
    moduleUrl: "file:///D:/package/dist/computer-use-mcp-server.mjs",
    environment: {},
  }), true);
});

test("verified platform OCR paths are wired into the sidecar session", () => {
  class FakeSession {
    constructor(options) {
      this.options = options;
    }
  }
  const session = createPlatformOcrSession({
    paths: {
      ocrModelRoot: "D:\\platform\\models\\pp-ocr-v6",
      ocrRuntimeRoot: "D:\\platform\\ocr-runtime",
    },
  }, {
    Session: FakeSession,
    baseEnvironment: { PATH: "C:\\Windows\\System32" },
    platform: "win32",
  });

  assert.equal(session.options.environment.AGENT_COMPUTER_USE_OCR_MODEL_DIR, "D:\\platform\\models\\pp-ocr-v6");
  assert.equal(session.options.environment.AGENT_COMPUTER_USE_OCR_RUNTIME_DIR, "D:\\platform\\ocr-runtime");
  assert.equal(session.options.environment.AGENT_COMPUTER_USE_NETWORK_DISABLED, "1");
});

test("SEA runtime re-enters its embedded OCR sidecar without system Node", () => {
  class FakeSession {
    constructor(options) {
      this.options = options;
    }
  }
  const session = createPlatformOcrSession({
    paths: {
      ocrModelRoot: "D:\\artifact\\ocr\\models",
      ocrRuntimeRoot: "D:\\artifact\\ocr\\runtime",
    },
    ocrProcess: {
      command: "D:\\artifact\\bin\\agent-computer-use-mcp.exe",
      args: [],
      sidecarPath: "--ocr-sidecar",
    },
  }, { Session: FakeSession, platform: "win32" });

  assert.deepEqual(session.options.node, {
    command: "D:\\artifact\\bin\\agent-computer-use-mcp.exe",
    args: [],
    label: "sea",
  });
  assert.equal(session.options.sidecarPath, "--ocr-sidecar");
});

test("agent-computer-use-mcp freezes the local MCP tool contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.name, "agent-computer-use-mcp");
  assert.equal(packageJson.bin["agent-computer-use-mcp"], "src/computer-use-mcp-server.mjs");
  assert.equal(packageJson.scripts["mcp"], "node src/computer-use-mcp-server.mjs");

  const toolNames = COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "computer.acquire",
    "computer.observe",
    "computer.act",
    "computer.release",
    "computer.health",
    "computer.doctor",
    "computer.installation",
    "computer.repair",
  ]);
  assert.deepEqual(
    COMPUTER_USE_MCP_TOOLS.filter((tool) => tool._meta?.["xiaozhiclaw/visibility"] === "host").map((tool) => tool.name),
    ["computer.health", "computer.doctor", "computer.installation", "computer.repair"],
  );

  const health = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.health");
  assert.equal(health.annotations.phase, "0.9");
  assert.equal(health.inputSchema.type, "object");
  assert.equal(health.inputSchema.properties.prewarm.type, "boolean");

  const doctor = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.doctor");
  assert.equal(doctor.annotations.phase, "2.0");
  assert.equal(doctor.annotations.readOnlyHint, true);
  assert.equal(doctor.inputSchema.properties.fast.type, "boolean");
  assert.equal(doctor.inputSchema.properties.includeInstallCache.type, "boolean");

  const repair = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.repair");
  assert.equal(repair.annotations.phase, "2.1");
  assert.equal(repair.annotations.destructiveHint, true);
  assert.equal(repair.inputSchema.properties.dryRun.type, "boolean");
  assert.equal(repair.inputSchema.properties.approved.type, "boolean");

  const acquire = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.acquire");
  assert.equal(acquire.annotations.phase, "1.3");
  assert.equal(acquire.inputSchema.required, undefined);
  assert.deepEqual(acquire.inputSchema.oneOf, [
    { required: ["titlePart"] },
    { required: ["windowId"] },
    { required: ["target"] },
  ]);
  assert.deepEqual(acquire.inputSchema.properties.target.enum, ["foreground"]);

  const observe = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.observe");
  assert.equal(observe.annotations.readOnlyHint, true);
  assert.deepEqual(observe.inputSchema.properties.mode.enum, ["state", "semantic", "screenshot", "capture-window", "ocr-region", "diff"]);
  assert.ok(observe.outputSchema.properties.foregroundWindow);
  assert.ok(observe.outputSchema.properties.windows);
  assert.ok(observe.outputSchema.properties.windowDiscovery);
  assert.deepEqual(observe.outputSchema.properties.window, {
    type: "object",
    additionalProperties: true,
  });
  assert.deepEqual(observe.outputSchema.properties.text, { type: "string" });

  const act = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.act");
  assert.equal(act.annotations.phase, "1.3");
  assert.deepEqual(act.inputSchema.required, ["action"]);
  assert.deepEqual(act.outputSchema.allOf[0].else.required, ["status", "provider", "action", "result", "pixelLimitedAction"]);
  assert.deepEqual(act.outputSchema.allOf[0].then.required, ["status", "error"]);
  assert.deepEqual(act.inputSchema.properties.action.properties.kind.enum, ["set_value", "type_text", "click", "press_key"]);
  assert.equal(act.inputSchema.properties.action.properties.observationId.type, "string");
  assert.equal(act.inputSchema.properties.action.properties.x.type, "number");
  assert.equal(act.inputSchema.properties.action.properties.y.type, "number");
  assert.equal(act.inputSchema.properties.action.properties.key.type, "string");
  assert.deepEqual(observe.outputSchema.properties.expiresAt, {
    anyOf: [{ type: "number" }, { type: "null" }],
  });

  for (const field of ["elements", "controllerId", "expiresAt", "dirtyRegion", "observation"]) {
    assert.ok(observe.outputSchema.properties[field], `computer.observe declares ${field}`);
  }

  for (const tool of COMPUTER_USE_MCP_TOOLS.slice(0, 4)) {
    const capability = tool._meta?.["xiaozhiclaw/semanticCapability"];
    assert.equal(capability?.schemaVersion, 1, `${tool.name} declares a versioned semantic capability`);
    assert.equal(typeof capability?.summary, "string", `${tool.name} declares a semantic summary`);
    assert.ok(capability.summary.length > 0, `${tool.name} semantic summary is non-empty`);
    assert.ok(Array.isArray(capability.modalities), `${tool.name} declares supported modalities`);
  }
});

test("agent-computer-use-mcp answers initialize, tools/list, and health over stdio", async () => {
  const client = createSdkClient("computer-use-mcp-test");

  try {
    await client.connect();
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "computer.acquire",
      "computer.observe",
      "computer.act",
      "computer.release",
      "computer.health",
      "computer.doctor",
      "computer.installation",
      "computer.repair",
    ]);
    for (const tool of listed.tools.slice(0, 4)) {
      assert.equal(
        tool._meta?.["xiaozhiclaw/semanticCapability"]?.schemaVersion,
        1,
        `${tool.name} publishes semantic capability metadata over standard MCP`,
      );
    }

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
    assert.deepEqual(health.structuredContent.actionPolicy.deliveryModes, ["background", "foreground"]);

    const doctor = await client.callTool({
      name: "computer.doctor",
      arguments: { fast: true, includeInstallCache: true },
    });
    assert.equal(doctor.structuredContent.module, "agent-computer-use-mcp");
    assert.equal(["healthy", "degraded", "unavailable"].includes(doctor.structuredContent.status), true);
    assert.equal(doctor.structuredContent.includeUserOverlay, false);
    assert.equal(doctor.structuredContent.startsDesktopControl, false);
    assert.equal(Array.isArray(doctor.structuredContent.repairPlan.actions), true);
    assert.equal(doctor.structuredContent.installCache.includeUserOverlay, false);
    assert.equal(doctor.structuredContent.installCache.startsDesktopControl, false);

    const repair = await client.callTool({
      name: "computer.repair",
      arguments: { dryRun: false, approved: false },
    });
    assert.equal(repair.isError, false);
    assert.equal(repair.structuredContent.status, "approval_required");
    assert.equal(repair.structuredContent.mode, "plan-only");
    assert.equal(repair.structuredContent.executesImmediately, false);
    assert.equal(repair.structuredContent.includeUserOverlay, false);
    assert.equal(repair.structuredContent.startsDesktopControl, false);
    assert.equal(Array.isArray(repair.structuredContent.repairPlan.actions), true);

    const missingController = await client.callTool({
      name: "computer.observe",
      arguments: { mode: "semantic" },
    });
    assert.equal(missingController.isError, true);
    assert.equal(missingController.structuredContent.error.code, "controller.required");
    assert.equal(missingController.structuredContent.includeUserOverlay, false);

    const stateAfterFailure = await client.callTool({
      name: "computer.observe",
      arguments: { mode: "state" },
    });
    assert.equal(stateAfterFailure.isError, false);
    assert.equal(stateAfterFailure.structuredContent.status, "idle");
    assert.equal(stateAfterFailure.structuredContent.startsDesktopControl, false);
    assert.equal(
      stateAfterFailure.structuredContent.auditEvents.some(
        (event) => event.type === "computer.cancelled",
      ),
      false,
    );
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
          { elementToken: "document", role: "Document", name: "Text editor", actions: ["type_text"] },
          { elementToken: "save", role: "Button", name: "Save", actions: ["click"] },
        ],
        includeUserOverlay: false,
      };
    },
    async setValue(args) {
      calls.push({ method: "setValue", args });
      return { status: "ok", action: "set_value" };
    },
    async typeText(args) {
      calls.push({ method: "typeText", args });
      return { status: "ok", action: "type_text", verify: "confirmed" };
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
  assert.equal(observation.elements.length, 3);

  const action = await router.act({ action: { kind: "set_value", elementToken: "name", value: "xiaozhi" } });
  assert.equal(action.status, "ok");
  assert.equal(action.pixelLimitedAction, false);
  const typed = await router.act({ action: { kind: "type_text", elementToken: "document", value: "Notepad text" } });
  assert.equal(typed.result.verify, "confirmed");

  const state = await router.listState();
  assert.equal(state.activeController.window.title, "Computer Use Lab");
  assert.equal(state.lastCapture.observationId, "obs-1");
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.action.completed"), true);

  const cancelled = await router.cancel({ reason: "test" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await router.listState()).activeController, null);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start", "stop"]);
  assert.deepEqual(calls.map((call) => call.method), ["findWindow", "capture", "setValue", "typeText"]);
});

test("provider router exposes foreground discovery without acquiring or cancelling control", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const windows = [
    {
      windowId: 11,
      title: "Frontmost Editor",
      appName: "editor.exe",
      pid: 101,
      zIndex: 9,
      isOnScreen: true,
      isForeground: true,
      bounds: { x: 10, y: 20, width: 900, height: 700 },
    },
    {
      windowId: 12,
      title: "Background Notes",
      appName: "notes.exe",
      pid: 102,
      zIndex: 3,
      isOnScreen: true,
      isForeground: false,
      bounds: { x: 30, y: 40, width: 600, height: 500 },
    },
  ];
  const router = new ComputerUseProviderRouter({
    driver: {
      async listWindows(args) {
        calls.push({ method: "listWindows", args });
        return windows;
      },
      async findWindow(args) {
        calls.push({ method: "findWindow", args });
        return windows[0];
      },
    },
  });

  const state = await router.listState();
  assert.equal(state.status, "idle");
  assert.deepEqual(state.foregroundWindow, windows[0]);
  assert.deepEqual(state.windows, windows);
  assert.deepEqual(state.windowDiscovery, { status: "ready", source: "cua-driver" });
  assert.equal(state.startsDesktopControl, false);
  assert.equal(state.auditEvents.some((event) => event.type === "computer.cancelled"), false);

  const access = await router.requestAccess({ target: "foreground", tier: "observe" });
  assert.equal(access.status, "granted");
  assert.deepEqual(calls, [
    { method: "listWindows", args: { onScreenOnly: true } },
    { method: "findWindow", args: { target: "foreground", windowId: undefined, titlePart: undefined } },
  ]);
});

test("failed window resolution remains a tool failure and never cancels the controller lifecycle", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter({
    driver: {
      async listWindows() {
        return [];
      },
      async findWindow() {
        const error = new Error("window.not_found: Missing App");
        error.code = "window.not_found";
        throw error;
      },
    },
  });

  await assert.rejects(
    () => router.requestAccess({ titlePart: "Missing App", tier: "observe" }),
    { code: "window.not_found" },
  );
  const state = await router.listState();
  assert.equal(state.status, "idle");
  assert.equal(state.activeController, null);
  assert.equal(state.auditEvents.some((event) => event.type === "computer.cancelled"), false);
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
    () => router.act({ action: { kind: "click", deliveryMode: "teleport", elementIndex: 1 } }),
    /Unsupported delivery mode/,
  );
  await assert.rejects(
    () => router.act({ action: { kind: "set_value", elementIndex: 0 } }),
    /require.*string value/,
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
