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
  assert.equal(result.toolErrorCount, 0);
  assert.equal(result.wrongSendCount, 0);
  assert.equal(router.requestAccessCalls.length, 1);
  assert.equal(router.requestAccessCalls[0].applicationToken, "application:fixture");
  assert.equal(router.requestAccessCalls[0].activationPolicy, undefined);
  assert.equal(router.captureArgs[0].mode, "screenshot");
  assert.deepEqual(result.history.map((entry) => entry.step), [
    "restore-main-window",
    "resolve-target",
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

test("computer.message requests one Host-owned send-role refresh when the post-entry Scene lacks send", async () => {
  const router = fixtureRouter({ sendRequiresIntent: true });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(router.captureCalls, 8);
  assert.equal(router.refineCalls, 1);
  assert.equal(router.refineArgs.filter((args) => args.messagingSceneIntent === "send").length, 1);
  assert.equal(router.actions.filter((action) => action.elementId.endsWith(":send")).length, 1);
});

test("computer.message selects one exact visible target among sibling candidates before search", async () => {
  const router = fixtureRouter({ visibleTargets: ["其他会话", QUERY] });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(result.released, true);
  assert.equal(router.actions.filter((action) => action.elementId?.endsWith(":target-1")).length, 1);
  assert.equal(router.actions.some((action) => action.elementId?.endsWith(":search")), false);
  assert.equal(router.actions.some((action) => action.elementId?.endsWith(":candidate")), false);
  assert.equal(result.history.some((entry) => entry.step === "select-visible-target"), true);
});

test("computer.message refreshes a non-actionable initial Scene before focus-search", async () => {
  const router = fixtureRouter({ initialSceneMissingSearch: true });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(result.released, true);
  assert.equal(router.refineCalls, 0);
  assert.equal(router.captureArgs.some((args) => args.mode === "screenshot"), true);
  assert.equal(router.actions[0].elementId.endsWith(":search"), true);
});

test("computer.message takes a fresh screenshot when the query receipt omitted related results", async () => {
  const router = fixtureRouter({ omitResultsFromQueryReceipt: true });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(result.released, true);
  assert.equal(router.refineCalls, 0);
  assert.equal(router.captureArgs.filter((args) => args.mode === "screenshot").length >= 2, true);
  assert.equal(router.actions.filter((action) => action.elementId.endsWith(":candidate")).length, 1);
});

test("computer.message refreshes a partial title from its Host-owned header crop", async () => {
  const router = fixtureRouter({ partialTitleInSelectionReceipt: true });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(result.released, true);
  assert.equal(router.captureArgs.some((args) => args.crop?.height === 80), true);
  assert.equal(router.actions.filter((action) => action.elementId.endsWith(":send")).length, 1);
});

test("computer.message restores a non-foreground main window inside the deterministic workflow", async () => {
  const router = fixtureRouter({ initialForeground: false });
  const result = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(result.outcome, "committed");
  assert.equal(result.phase, "complete");
  assert.equal(result.released, true);
  assert.equal(result.toolErrorCount, 0);
  assert.equal(result.wrongSendCount, 0);
  assert.equal(router.actions[0].kind, "activate_window");
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

test("computer.message returns Host application candidates and accepts one opaque semantic selection", async () => {
  const router = fixtureRouter({ discoveredApplicationName: "Weixin", initialForeground: false });
  const first = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
  });

  assert.equal(first.outcome, "not-applied");
  assert.equal(first.phase, "selection-required");
  assert.equal(first.error.code, "llm.application_selection_required");
  assert.equal(first.released, true);
  assert.deepEqual(first.candidates, [{
    candidateId: "application:1",
    label: "Weixin",
    role: "application",
    parentRole: "desktop",
    evidenceSources: ["host.application-inventory"],
  }]);
  assert.equal(router.requestAccessCalls.length, 0);

  const second = await runDeterministicMessagingTool(router, {
    applicationName: APP,
    query: QUERY,
    message: MESSAGE,
    selectionToken: first.selectionToken,
    candidateId: first.candidates[0].candidateId,
  });

  assert.equal(second.outcome, "committed");
  assert.equal(second.released, true);
  assert.equal(router.requestAccessCalls.length, 1);
  assert.equal(router.requestAccessCalls[0].applicationToken, "application:fixture");
  assert.equal(router.requestAccessCalls[0].activationPolicy, undefined);
  assert.equal(router.actions[0].kind, "activate_window");
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

function fixtureRouter({
  initialForeground = true,
  hangFirstAction = false,
  onAction = () => {},
  sendRequiresIntent = false,
  initialSceneMissingSearch = false,
  omitResultsFromQueryReceipt = false,
  partialTitleInSelectionReceipt = false,
  discoveredApplicationName = APP,
  visibleTargets = [],
} = {}) {
  let version = 0;
  let foreground = initialForeground;
  let focusedRole = null;
  let query = "";
  let resultsVisible = false;
  let conversationVisible = false;
  let editorValue = "";
  let sent = false;
  let omitResultsOnce = false;
  let partialTitleOnce = false;
  let cancelCalls = 0;
  let captureCalls = 0;
  let refineCalls = 0;
  const captureArgs = [];
  const refineArgs = [];
  const requestAccessCalls = [];
  const actions = [];

  return {
    actions,
    get cancelCalls() { return cancelCalls; },
    get captureCalls() { return captureCalls; },
    get refineCalls() { return refineCalls; },
    captureArgs,
    refineArgs,
    requestAccessCalls,
    async listState() {
      return {
        foregroundWindow: { id: "window:fixture", title: APP },
        windows: [{ id: "window:fixture", title: APP }],
        applications: [{ applicationToken: "application:fixture", name: discoveredApplicationName }],
      };
    },
    async requestAccess(args) {
      requestAccessCalls.push(structuredClone(args));
      return { status: "granted", controller: { id: "controller:fixture" } };
    },
    async capture(args = {}) {
      captureCalls += 1;
      captureArgs.push(structuredClone(args));
      version += 1;
      const visibleResults = resultsVisible && !omitResultsOnce;
      const partialTitle = partialTitleOnce;
      omitResultsOnce = false;
      partialTitleOnce = false;
      return { scene: scene({
        version,
        foreground,
        focusedRole,
        query,
        resultsVisible: visibleResults,
        conversationVisible,
        conversationTitle: partialTitle ? "Y" : QUERY,
        conversationTitleSemanticKey: partialTitle ? "contact:partial" : "contact:fixture",
        editorValue,
        sent,
        includeSearch: !(initialSceneMissingSearch && captureCalls === 1),
        includeSend: !sendRequiresIntent || args.messagingSceneIntent === "send",
        visibleTargets,
      }) };
    },
    async refineLatestScreenshotScene(args = {}) {
      refineCalls += 1;
      refineArgs.push(structuredClone(args));
      if (initialSceneMissingSearch && refineCalls === 1) return null;
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
        includeSend: args.messagingSceneIntent === "send",
        visibleTargets,
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
        omitResultsOnce = omitResultsFromQueryReceipt;
      } else if (action.kind === "click" && action.elementId.endsWith(":candidate")) {
        resultsVisible = false;
        conversationVisible = true;
        focusedRole = null;
        partialTitleOnce = partialTitleInSelectionReceipt;
      } else if (action.kind === "click" && /:target-\d+$/u.test(action.elementId)) {
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

function scene({
  version,
  foreground,
  focusedRole,
  query,
  resultsVisible,
  conversationVisible,
  conversationTitle = QUERY,
  conversationTitleSemanticKey = "contact:fixture",
  editorValue,
  sent,
  includeSearch = true,
  includeSend = true,
  visibleTargets = [],
}) {
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
  if (includeSearch) add({
    key: "search", type: "Editable", role: "search", parentKey: "main",
    actions: ["click", "type_text"], actionable: true, value: query,
    state: { focused: focusedRole === "search" },
  });
  if (!conversationVisible && visibleTargets.length > 0) {
    add({ key: "target-list", type: "Container", role: "target-list", parentKey: "main" });
    visibleTargets.forEach((name, index) => add({
      key: `target-${index}`,
      type: "ActionableItem",
      role: "target-candidate",
      parentKey: "target-list",
      actions: ["click"],
      actionable: true,
      name,
      semanticKey: name === QUERY ? "contact:fixture" : `contact:other-${index}`,
    }));
  }
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
      key: "conversation-header", type: "Container", role: "conversation-header",
      parentKey: "conversation",
      coordinate: { bounds: { x: 300, y: 0, width: 660, height: 80 } },
    });
    add({
      key: "title", type: "ActionableItem", role: "conversation-title", parentKey: "conversation-header",
      name: conversationTitle, semanticKey: conversationTitleSemanticKey,
    });
    add({ key: "transcript", type: "Container", role: "transcript", parentKey: "conversation" });
    add({
      key: "editor", type: "Editable", role: "message-editor", parentKey: "conversation",
      actions: ["click", "type_text"], actionable: true, value: editorValue,
      state: { focused: focusedRole === "message-editor" },
    });
    if (includeSend) add({
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
