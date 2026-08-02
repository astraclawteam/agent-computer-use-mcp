import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv from "ajv";

import { callTool, runDeterministicMessagingTool } from "../src/computer-use-mcp-server.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

const APP = "微信";
const QUERY = "Y-大风";
const MESSAGE = "这是一条测试消息";

test("computer.message owns the exact messaging sequence and controller lifecycle", async () => {
  const router = fixtureRouter();
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  }, { agentId: "fixture-agent", sessionId: "fixture-session" });

  assert.equal(result.outcome, "committed");
  assert.equal(result.released, true);
  assert.equal(router.requestAccessCalls.length, 1);
  assert.equal(router.requestAccessCalls[0].activationPolicy, "foreground-only");
  assert.deepEqual(result.history.map((entry) => entry.step), [
    "restore-main-window",
    "focus-search",
    "enter-query",
    "wait-results-stable",
    "select-result",
    "verify-conversation-title",
    "focus-message-editor",
    "enter-message",
    "send",
    "verify-new-bubble",
    "release",
  ]);
  assert.equal(router.cancelCalls, 1);
  assert.equal(router.actions.length, 6);
  assert.equal(router.actions.every((action) => action.captureAfter === true), true);
  assert.equal(router.actions.every((action) => typeof action.elementId === "string"), true);
  assert.equal(router.actions.every((action) => action.x === undefined && action.y === undefined), true);
  assert.equal(router.captureCalls, 8);
  assert.deepEqual(router.actions.filter((action) => action.kind === "type_text").map((action) => action.value), [
    QUERY,
    MESSAGE,
  ]);
});

test("computer.message fails closed before actions when foreground is required", async () => {
  const router = fixtureRouter({ initialForeground: false });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "not-applied");
  assert.equal(result.phase, "preflight");
  assert.equal(result.error.code, "workflow.initial_foreground_required");
  assert.equal(result.released, true);
  assert.equal(router.actions.length, 0);
  assert.equal(router.cancelCalls, 1);

  const envelope = await callTool(fixtureRouter({ initialForeground: false }), "computer.message", {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });
  const schema = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.message").outputSchema;
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate(envelope.structuredContent), true, JSON.stringify(validate.errors));
});

test("computer.message rejects a non-foreground application before capture or control", async () => {
  let captureCalls = 0;
  let cancelCalls = 0;
  let requestAccessArgs;
  const result = await runDeterministicMessagingTool({
    async listState() {
      return {
        foregroundWindow: null,
        windows: [],
        applications: [{ applicationToken: "application:fixture", name: APP }],
      };
    },
    async requestAccess(args) {
      requestAccessArgs = args;
      throw Object.assign(new Error("The application is not foreground."), {
        code: "window.application_not_foreground",
      });
    },
    async capture() {
      captureCalls += 1;
      throw new Error("capture must not run before foreground preflight passes");
    },
    async cancel() {
      cancelCalls += 1;
      return { status: "cancelled" };
    },
  }, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(requestAccessArgs.activationPolicy, "foreground-only");
  assert.equal(result.outcome, "not-applied");
  assert.equal(result.phase, "preflight");
  assert.equal(result.error.code, "workflow.initial_foreground_required");
  assert.equal(result.released, true);
  assert.equal(captureCalls, 0);
  assert.equal(cancelCalls, 0);
});

test("computer.message exposes semantic goal slots but no lifecycle policy input", () => {
  const schema = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.message").inputSchema;
  assert.deepEqual(schema.required, ["applicationName", "query", "message"]);
  assert.equal(schema.properties.requireForeground, undefined);
});

test("computer.message binds MCP cancellation to Stop and releases without later actions", async () => {
  const controller = new AbortController();
  let actionStarted;
  const started = new Promise((resolve) => { actionStarted = resolve; });
  const router = fixtureRouter({ hangFirstAction: true, onAction: actionStarted });
  const running = runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  }, undefined, { signal: controller.signal });

  await started;
  controller.abort("operator-stop");
  const result = await running;
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.error.code, "workflow.cancelled");
  assert.equal(result.released, true);
  assert.equal(router.cancelCalls, 1);
  assert.equal(router.actions.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(router.actions.length, 1);
});

function fixtureRouter({ initialForeground = true, hangFirstAction = false, onAction = () => {} } = {}) {
  let version = 0;
  let foreground = initialForeground;
  let focusedRole = null;
  let query = "";
  let resultsVisible = false;
  let conversationVisible = false;
  let editorValue = "";
  let sent = false;
  let cancelCalls = 0;
  let captureCalls = 0;
  const requestAccessCalls = [];
  const actions = [];

  return {
    actions,
    get cancelCalls() { return cancelCalls; },
    get captureCalls() { return captureCalls; },
    requestAccessCalls,
    async listState() {
      return {
        foregroundWindow: { id: "window:fixture", title: APP },
        windows: [{ id: "window:fixture", title: APP }],
        applications: [{ applicationToken: "application:fixture", name: APP }],
      };
    },
    async requestAccess(args) {
      requestAccessCalls.push(structuredClone(args));
      return { status: "granted", controller: { id: "controller:fixture" } };
    },
    async capture() {
      captureCalls += 1;
      version += 1;
      return { scene: scene({
        version,
        foreground,
        focusedRole,
        query,
        resultsVisible,
        conversationVisible,
        editorValue,
        sent,
      }) };
    },
    async act({ action }) {
      actions.push(structuredClone(action));
      onAction();
      if (hangFirstAction && actions.length === 1) return new Promise(() => {});
      if (action.kind === "activate_window") foreground = true;
      else if (action.kind === "click" && action.elementId.endsWith(":search")) focusedRole = "search";
      else if (action.kind === "type_text" && focusedRole === "search") {
        query = action.value;
        resultsVisible = true;
      } else if (action.kind === "click" && action.elementId.endsWith(":candidate")) {
        resultsVisible = false;
        conversationVisible = true;
        focusedRole = null;
      } else if (action.kind === "click" && action.elementId.endsWith(":editor")) focusedRole = "message-editor";
      else if (action.kind === "type_text" && focusedRole === "message-editor") editorValue = action.value;
      else if (action.kind === "click" && action.elementId.endsWith(":send")) {
        editorValue = "";
        sent = true;
      }
      return {
        status: "committed",
        outcome: "committed",
        ...(action.captureAfter ? { capture: await this.capture() } : {}),
      };
    },
    async cancel() {
      cancelCalls += 1;
      return { status: "cancelled" };
    },
  };
}

function scene({ version, foreground, focusedRole, query, resultsVisible, conversationVisible, editorValue, sent }) {
  const elements = [];
  const add = ({ key, parentKey = null, ...element }) => elements.push({
    id: `scene:${version}:${key}`,
    parentId: parentKey ? `scene:${version}:${parentKey}` : null,
    observationVersion: version,
    evidenceConsistency: "consistent",
    evidence: [{ source: "structure" }, { source: "visual" }],
    actions: [],
    actionable: false,
    state: {},
    ...element,
  });
  add({ key: "main", type: "Window", role: "main-window", actions: ["activate_window"], actionable: true, state: { foreground } });
  add({ key: "shell", type: "Container", role: "application", parentKey: "main" });
  add({
    key: "search", type: "Editable", role: "search", parentKey: "main",
    actions: ["click", "type_text"], actionable: true, value: query,
    state: { focused: focusedRole === "search" },
  });
  if (resultsVisible) {
    add({ key: "results", type: "TransientSurface", role: "search-results", parentKey: "main" });
    add({
      key: "candidate", type: "ActionableItem", role: "search-result", parentKey: "results",
      actions: ["click"], actionable: true, name: QUERY, semanticKey: "contact:fixture",
    });
  }
  if (conversationVisible) {
    add({ key: "conversation", type: "Container", role: "conversation", parentKey: "main" });
    add({
      key: "title", type: "ActionableItem", role: "conversation-title", parentKey: "conversation",
      name: QUERY, semanticKey: "contact:fixture",
    });
    add({ key: "transcript", type: "Container", role: "transcript", parentKey: "conversation" });
    add({
      key: "editor", type: "Editable", role: "message-editor", parentKey: "conversation",
      actions: ["click", "type_text"], actionable: true, value: editorValue,
      state: { focused: focusedRole === "message-editor" },
    });
    add({
      key: "send", type: "ActionableItem", role: "send", parentKey: "conversation",
      actions: ["click"], actionable: true,
    });
    if (sent) add({
      key: "new-bubble", type: "ActionableItem", role: "message-bubble", parentKey: "transcript",
      value: MESSAGE, state: { authoredBySelf: true },
    });
  }
  return {
    id: `scene:${version}`,
    observationId: `observation:${version}`,
    observationVersion: version,
    windowId: "window:fixture",
    rootId: `scene:${version}:main`,
    elements,
  };
}
