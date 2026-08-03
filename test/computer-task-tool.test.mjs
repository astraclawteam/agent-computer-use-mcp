import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv from "ajv";

import { callTool, runGenericTaskTool } from "../src/computer-use-mcp-server.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

const APP = "Example Desktop";
const GOAL = "Open settings and show usage";

test("computer.task advances a generic GUI goal through opaque Host candidates and releases every step", async () => {
  const router = fixtureRouter();
  const context = { ownerId: "owner", agentId: "agent", projectId: "project", sessionId: "session-task" };

  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  assert.equal(first.outcome, "not-applied");
  assert.equal(first.phase, "decision-required");
  assert.equal(first.released, true);
  assert.deepEqual(first.executionControl, {
    status: "blocked",
    scope: "interaction-step",
    retryable: false,
    allowedNextTools: ["computer.task"],
    reason: "generic-desktop-task-next-step-host-owned",
    nextAction: "Continue only through computer.task with the returned opaque task state. If the goal is not directly visible, choose one reversible navigation candidate such as an account/profile/menu/navigation control that is semantically likely to reveal it; do not report merely because the final target is not yet exposed. When a named surface is hosted by a differently labelled desktop product, select that semantically related owning-window candidate. Shell, raw-targeting, lifecycle, and alternate GUI tools are not authorized fallbacks.",
  });
  assert.equal(router.cancelCalls, 1);
  assert.equal(router.actions.length, 0);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");
  assert.ok(settings);
  assert.equal(settings.inputRequired, false);
  assert.equal(JSON.stringify(first).includes("elementId"), false);
  assert.equal(JSON.stringify(first).includes("coordinate"), false);
  assert.equal(JSON.stringify(first).includes("observationId"), false);

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);
  assert.equal(second.outcome, "committed");
  assert.equal(second.phase, "decision-required");
  assert.equal(second.released, true);
  assert.equal(router.cancelCalls, 2);
  assert.equal(router.actions.length, 1);
  assert.equal(router.actions[0].kind, "click");
  assert.equal(router.actions[0].captureAfter, true);
  assert.equal(router.actions[0].elementId.endsWith(":settings"), true);
  const usage = second.candidates.find((candidate) => candidate.label === "Usage" && candidate.action === "select");
  assert.ok(usage);

  const third = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: usage.candidateId,
  }, context);
  assert.equal(third.outcome, "committed");
  assert.equal(third.released, true);
  assert.equal(router.cancelCalls, 3);
  assert.equal(router.actions.length, 2);
  assert.ok(third.facts.some((fact) => fact.label === "12,345 tokens" && fact.parentRole === "usage-page"));

  const complete = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    decision: "complete",
  }, context);
  assert.equal(complete.outcome, "committed");
  assert.equal(complete.phase, "complete");
  assert.equal(complete.released, true);
  assert.equal(router.cancelCalls, 3);
});

test("computer.task revalidates a candidate against a fresh Scene before acting", async () => {
  const router = fixtureRouter({ staleSettingsAfterFirstObservation: true });
  const context = { agentId: "agent", sessionId: "session-stale" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");
  assert.ok(settings);

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);
  assert.equal(second.outcome, "not-applied");
  assert.equal(second.error.code, "task.candidate_stale");
  assert.equal(second.released, true);
  assert.equal(router.actions.length, 0);
  assert.equal(router.cancelCalls, 2);
  assert.ok(second.candidates.some((candidate) => candidate.label === "Preferences"));
});

test("computer.task replaces a non-controllable application identity with fresh opaque window candidates", async () => {
  const router = fixtureRouter({ unavailableApplicationOnce: true });
  const context = { agentId: "agent", sessionId: "session-window-selection" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);

  assert.equal(first.outcome, "not-applied");
  assert.equal(first.phase, "application-selection");
  assert.equal(first.error.code, "task.target_selection_required");
  assert.equal(first.released, true);
  const visibleWindow = first.candidates.find((candidate) => candidate.role === "window");
  assert.ok(visibleWindow);
  assert.equal(visibleWindow.label, `${APP} — Main`);
  assert.equal(first.candidates.some((candidate) => candidate.role === "application" && candidate.label === APP), false);
  assert.equal(JSON.stringify(first).includes("windowId"), false);

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: visibleWindow.candidateId,
  }, context);
  assert.equal(second.phase, "decision-required");
  assert.equal(second.released, true);
  assert.equal(router.accessRequests[1].windowId, 4242);
});

test("computer.task binds a differently labelled foreground window only from consistent root semantic evidence", async () => {
  const router = fixtureRouter({ unavailableApplicationOnce: true, foregroundSemanticOwner: true });
  const context = { agentId: "agent", sessionId: "session-semantic-owner" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);

  assert.equal(first.outcome, "not-applied");
  assert.equal(first.phase, "decision-required");
  assert.equal(first.error, undefined);
  assert.equal(first.released, true);
  assert.equal(router.accessRequests.length, 2);
  assert.equal(router.accessRequests[1].windowId, 4242);
  assert.equal(router.cancelCalls, 1);
  assert.ok(first.facts.some((fact) => fact.role === "main-window" && fact.label === APP));
  assert.ok(first.candidates.some((candidate) => candidate.label === "Settings"));
});

test("computer.task never replays an indeterminate action and closes the task", async () => {
  const router = fixtureRouter({ actionOutcome: "indeterminate" });
  const context = { agentId: "agent", sessionId: "session-indeterminate" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);
  assert.equal(second.outcome, "indeterminate");
  assert.equal(second.error.code, "task.action_indeterminate");
  assert.equal(second.error.replayAllowed, false);
  assert.equal(second.released, true);
  assert.equal(router.actions.length, 1);

  const replay = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);
  assert.equal(replay.outcome, "not-applied");
  assert.equal(replay.error.code, "task.token_invalid");
  assert.equal(router.actions.length, 1);
});

test("computer.task binds Stop to the in-flight action and returns a released canonical envelope", async () => {
  const controller = new AbortController();
  let signalActionStarted;
  const actionStarted = new Promise((resolve) => { signalActionStarted = resolve; });
  const router = fixtureRouter({ hangAction: true, onAction: signalActionStarted });
  const context = { agentId: "agent", sessionId: "session-stop" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");
  const running = runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context, { signal: controller.signal });

  await actionStarted;
  controller.abort("operator-stop");
  const stopped = await running;
  assert.equal(stopped.outcome, "indeterminate");
  assert.equal(stopped.phase, "cancelled");
  assert.equal(stopped.error.code, "task.cancelled");
  assert.equal(stopped.error.replayAllowed, false);
  assert.equal(stopped.released, true);
  assert.equal(router.actions.length, 1);
  assert.equal(router.cancelCalls, 2);
});

test("computer.task is Agent-visible, keeps lifecycle tools Host-only, and validates its public result", async () => {
  assert.deepEqual(
    COMPUTER_USE_MCP_TOOLS
      .filter((tool) => tool._meta?.["xiaozhiclaw/visibility"] !== "host")
      .map((tool) => tool.name),
    ["computer.task", "computer.message"],
  );
  const task = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.task");
  assert.match(task.description, /opaque semantic candidates/u);
  assert.match(task.description, /Never use shell commands/u);
  assert.deepEqual(task.inputSchema.required, ["applicationName", "goal"]);
  assert.equal(task.inputSchema.properties.windowId, undefined);
  assert.equal(task.inputSchema.properties.coordinate, undefined);
  assert.equal(task.inputSchema.properties.elementId, undefined);

  const envelope = await callTool(fixtureRouter(), "computer.task", {
    applicationName: APP,
    goal: GOAL,
  }, { agentId: "agent", sessionId: "schema-session" });
  const validate = new Ajv({ strict: false }).compile(task.outputSchema);
  assert.equal(validate(envelope.structuredContent), true, JSON.stringify(validate.errors));
  assert.equal(envelope.isError, false);
});

function fixtureRouter({
  staleSettingsAfterFirstObservation = false,
  actionOutcome = "committed",
  hangAction = false,
  onAction = () => {},
  unavailableApplicationOnce = false,
  foregroundSemanticOwner = false,
} = {}) {
  let version = 0;
  let page = "main";
  let captureCalls = 0;
  let cancelCalls = 0;
  const actions = [];
  const accessRequests = [];
  return {
    actions,
    accessRequests,
    get cancelCalls() { return cancelCalls; },
    async listState() {
      return {
        applications: [{ applicationToken: "application:example", name: APP }],
        windows: [{ windowId: 4242, title: `${APP} — Main`, bounds: { x: 10, y: 10, width: 800, height: 600 } }],
        ...(foregroundSemanticOwner ? { foregroundWindow: { windowId: 4242 } } : {}),
      };
    },
    async requestAccess(args) {
      accessRequests.push(structuredClone(args));
      if (unavailableApplicationOnce && accessRequests.length === 1 && args.applicationToken) {
        const error = new Error("No visible window matched the requested selector.");
        error.code = "window.not_found";
        throw error;
      }
      return { status: "granted", controller: { id: "controller:example" } };
    },
    async capture() {
      captureCalls += 1;
      version += 1;
      const settingsLabel = staleSettingsAfterFirstObservation && captureCalls > 1 ? "Preferences" : "Settings";
      return { scene: taskScene({ version, page, settingsLabel }) };
    },
    async act({ action }) {
      actions.push(structuredClone(action));
      onAction();
      if (hangAction) return new Promise(() => {});
      if (actionOutcome === "indeterminate") return { status: "indeterminate", outcome: "indeterminate" };
      if (action.elementId.endsWith(":settings")) page = "settings";
      if (action.elementId.endsWith(":usage")) page = "usage";
      return {
        status: actionOutcome,
        outcome: actionOutcome,
        capture: await this.capture(),
      };
    },
    async cancel() {
      cancelCalls += 1;
      return { status: "cancelled" };
    },
  };
}

function taskScene({ version, page, settingsLabel }) {
  const elements = [];
  const add = ({ key, parentKey = null, ...element }) => elements.push({
    id: `scene:${version}:${key}`,
    parentId: parentKey ? `scene:${version}:${parentKey}` : null,
    observationVersion: version,
    evidenceConsistency: "consistent",
    evidence: [{ source: "structure" }],
    actions: [],
    actionable: false,
    state: {},
    ...element,
  });
  add({ key: "window", type: "Window", role: "main-window", name: APP });
  add({ key: "shell", type: "Container", role: "application", parentKey: "window" });
  if (page === "main") {
    add({
      key: "settings",
      type: "ActionableItem",
      role: "button",
      parentKey: "shell",
      name: settingsLabel,
      semanticKey: "command:settings",
      actions: ["click"],
      actionable: true,
    });
  } else {
    add({ key: "settings-page", type: "Container", role: "settings-page", parentKey: "shell", name: "Settings" });
    add({
      key: "general",
      type: "ActionableItem",
      role: "tab-item",
      parentKey: "settings-page",
      name: "General",
      semanticKey: "settings:general",
      actions: ["click"],
      actionable: true,
    });
    add({
      key: "usage",
      type: "ActionableItem",
      role: "tab-item",
      parentKey: "settings-page",
      name: "Usage",
      semanticKey: "settings:usage",
      actions: ["click"],
      actionable: true,
    });
    if (page === "usage") {
      add({ key: "usage-page", type: "Container", role: "usage-page", parentKey: "settings-page", name: "Usage" });
      add({
        key: "token-count",
        type: "ActionableItem",
        role: "usage-value",
        parentKey: "usage-page",
        name: "12,345 tokens",
      });
    }
  }
  return {
    id: `scene:${version}`,
    observationId: `observation:${version}`,
    observationVersion: version,
    screenshotId: `screenshot:${version}`,
    windowId: "window:example",
    rootId: `scene:${version}:window`,
    elements,
  };
}
