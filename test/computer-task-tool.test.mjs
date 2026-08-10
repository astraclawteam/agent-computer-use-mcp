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
  assert.equal(first.terminalControllerState, "idle");
  assert.equal(first.toolErrorCount, 0);
  assert.equal(first.wrongSendCount, 0);
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
  assert.equal(settings.relevance, "target");
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
  assert.equal(router.actions[0].hostDeliveryIntent, "navigation");
  assert.equal(router.actions[0].elementId.endsWith(":settings"), true);
  assert.deepEqual(second.action.receipt, {
    providerOutcome: "committed",
    outcome: "committed",
    postconditionVerified: true,
    verificationMethod: "host-scene-navigation-transition",
    evidence: ["target-labelled-destination-added"],
    beforeObservationVersion: 2,
    afterObservationVersion: 3,
  });
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
  assert.equal(third.action.receipt.postconditionVerified, true);
  assert.deepEqual(third.action.receipt.evidence, ["target-labelled-destination-added"]);
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

test("computer.task confirms an indeterminate navigation receipt from a fresh owned destination Scene", async () => {
  const router = fixtureRouter({ actionOutcome: "indeterminate", indeterminateActionApplies: true });
  const context = { agentId: "agent", sessionId: "session-navigation-postcondition" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.equal(second.phase, "decision-required");
  assert.equal(second.action.receipt.providerOutcome, "indeterminate");
  assert.equal(second.action.receipt.postconditionVerified, true);
  assert.deepEqual(second.action.receipt.evidence, ["target-labelled-destination-added"]);
  assert.ok(second.candidates.some((candidate) => candidate.label === "Usage"));
  assert.equal(router.actions.length, 1);
  assert.equal(router.cancelCalls, 2);
});

test("computer.task proves a page navigation from owned actionable topology", async () => {
  const router = fixtureRouter({ actionablePageTransition: true });
  const context = { agentId: "agent", sessionId: "session-actionable-page-transition" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings");

  const selected = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(selected.outcome, "committed");
  assert.equal(selected.action.receipt.postconditionVerified, true);
  assert.deepEqual(selected.action.receipt.evidence, ["owned-actionable-page-transition"]);
  assert.ok(selected.candidates.some((candidate) => candidate.label === "Draft"));
});

test("computer.task proves a page replacement when the selected navigation control persists", async () => {
  const router = fixtureRouter({
    initialPage: "settings",
    persistentBackTransition: true,
    valuePatternEditor: true,
  });
  const context = { agentId: "agent", sessionId: "session-persistent-back-transition" };
  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "Type an exact draft in the chat editor without sending it",
  }, context);
  const back = first.candidates.find((candidate) => candidate.label === "Back");

  const selected = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: back.candidateId,
  }, context);

  assert.equal(selected.outcome, "committed");
  assert.deepEqual(selected.action.receipt.evidence, ["owned-actionable-page-transition"]);
  assert.ok(selected.candidates.some((candidate) => candidate.label === "Type something"));
});

test("computer.task confirms an indeterminate edit from a fresh exact-value Scene", async () => {
  const router = fixtureRouter({
    actionOutcome: "indeterminate",
    indeterminateActionApplies: true,
    valuePatternEditor: true,
  });
  const context = { agentId: "agent", sessionId: "session-edit-postcondition" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const input = first.candidates.find((candidate) => candidate.label === "Type something");

  const typed = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: input.candidateId,
    text: "draft only",
  }, context);

  assert.equal(typed.outcome, "committed");
  assert.equal(typed.action.receipt.providerOutcome, "indeterminate");
  assert.equal(typed.action.receipt.postconditionVerified, true);
  assert.deepEqual(typed.action.receipt.evidence, ["fresh-scene-exact-value-readback"]);
  assert.equal(router.actions.filter((action) => action.kind === "type_text").length, 1);
});

test("computer.task treats an already exact editable value as a committed idempotent edit", async () => {
  const router = fixtureRouter({ valuePatternEditor: true, initialDraftValue: "already exact" });
  const context = { agentId: "agent", sessionId: "session-idempotent-edit" };
  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "Type already exact in the chat editor without sending",
  }, context);
  const editor = first.candidates.find((candidate) => candidate.label === "already exact");

  const edited = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: editor.candidateId,
    text: "already exact",
  }, context);

  assert.equal(edited.outcome, "committed");
  assert.equal(router.actions.length, 0);
  assert.deepEqual(edited.action.receipt, {
    providerOutcome: "not-applied",
    outcome: "committed",
    postconditionVerified: true,
    verificationMethod: "host-exact-edit-readback",
    evidence: ["current-scene-exact-value-readback"],
    beforeObservationVersion: 2,
    afterObservationVersion: 2,
  });
});

test("computer.task continuation is owned by the opaque token and does not require repeated goal text", async () => {
  const router = fixtureRouter();
  const context = { agentId: "agent", sessionId: "session-token-owned-continuation" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.ok(second.candidates.some((candidate) => candidate.label === "Usage"));

  const usage = second.candidates.find((candidate) => candidate.label === "Usage" && candidate.action === "select");
  const third = await runGenericTaskTool(router, {
    applicationName: `${APP} paraphrased by a legacy client`,
    goal: `${GOAL} paraphrased by a legacy client`,
    taskToken: first.taskToken,
    candidateId: usage.candidateId,
  }, context);

  assert.equal(third.outcome, "committed");
  assert.equal(third.phase, "decision-required");
  assert.ok(third.facts.some((fact) => fact.label === "12,345 tokens"));
});

test("computer.task rebinds one unique candidate when its consistent evidence source changes", async () => {
  const router = fixtureRouter({ settingsEvidenceChanges: true });
  const context = { agentId: "agent", sessionId: "session-evidence-rebind" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings");

  const selected = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(selected.outcome, "committed");
  assert.equal(router.actions.length, 1);
});

test("computer.task can aim at a chat box that only exposes ValuePattern", async () => {
  // Windows describes many chat inputs - Electron ones especially - as editable
  // with ValuePattern and no keyboard verb. Requiring the driver to advertise
  // type_text left those boxes visible in the facts with nothing to select,
  // so the app was observable but unusable.
  const router = fixtureRouter({ valuePatternEditor: true });
  const context = { agentId: "agent", sessionId: "session-value-pattern-editor" };

  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "Type text into the chat editor without sending",
  }, context);
  const input = first.candidates.find((candidate) => candidate.label === "Type something");
  assert.ok(input, "an editable chat box must be offered as a candidate, not just reported as a fact");
  assert.equal(input.action, "edit");
  assert.equal(input.inputRequired, true);
  assert.equal(input.relevance, "target");

  const typed = await runGenericTaskTool(
    router,
    { taskToken: first.taskToken, candidateId: input.candidateId, text: "hello" },
    context,
  );
  assert.equal(typed.outcome, "committed");
  // The Host types by focusing and delivering real keystrokes; it never reaches
  // for ValuePattern, which many Electron apps ignore.
  const action = router.actions.at(-1);
  assert.equal(action.kind, "type_text");
  assert.equal(action.value, "hello");
  assert.equal(action.textMode, "replace-all");
  assert.equal(action.inputBehavior, "commit");
  // Replacing everything in a control is refused without proof of which control
  // that is, so the Host grounds the box in pixels before asking.
  assert.equal(action.x, 190);
  assert.equal(action.y, 620);
  assert.equal(action.coordinateSpace, "window-local");
  assert.equal(typeof action.observationId, "string");
  assert.equal(
    router.captureRequests.some((request) => request.forceScreenshotSurfaceCapture === true),
    false,
    "the edit step must reuse the lease's already-grounded Scene instead of capturing again",
  );
  assert.equal(typed.action.receipt.postconditionVerified, true);
  assert.equal(typed.action.receipt.verificationMethod, "host-exact-edit-readback");
  assert.ok(typed.facts.some((fact) => fact.label === "hello" && fact.role === "edit"));
});

test("computer.task ranks a reversible return route above unrelated controls when an edit target is not visible", async () => {
  const router = fixtureRouter({ initialPage: "settings", settingsExitControls: true });
  const context = { agentId: "agent", sessionId: "session-edit-route-ranking" };

  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "Type an exact draft in the chat editor without sending it",
  }, context);
  const returnToApp = first.candidates.find((candidate) => candidate.label === "Return to application");
  const shortcuts = first.candidates.find((candidate) => candidate.label === "Keyboard shortcuts");
  const settingsSearch = first.candidates.find((candidate) => candidate.label === "Search settings");

  assert.ok(returnToApp);
  assert.ok(shortcuts);
  assert.ok(settingsSearch);
  assert.equal(returnToApp.relevance, "route");
  assert.equal(shortcuts.relevance, "context");
  assert.equal(settingsSearch.relevance, "context");
  assert.ok(first.candidates.indexOf(returnToApp) < first.candidates.indexOf(shortcuts));
});

test("computer.task treats a conversation entry as a route to a missing chat editor", async () => {
  const router = fixtureRouter({ conversationEntry: true });
  const context = { agentId: "agent", sessionId: "session-conversation-route" };

  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "在聊天输入框输入草稿但不要发送",
  }, context);
  const conversation = first.candidates.find((candidate) => candidate.label === "新对话");

  assert.ok(conversation);
  assert.equal(conversation.relevance, "route");
});

test("computer.task does not treat the owning application name as the task target", async () => {
  const router = fixtureRouter({ ownerModeControl: true, conversationEntry: true });
  const context = { agentId: "agent", sessionId: "session-owner-name-relevance" };
  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: `In ${APP}, type an exact draft in the chat editor without sending it`,
  }, context);
  const ownerMode = first.candidates.find((candidate) => candidate.label === APP);
  const conversation = first.candidates.find((candidate) => candidate.label === "新对话");

  assert.equal(ownerMode.relevance, "context");
  assert.equal(conversation.relevance, "route");
  assert.ok(first.candidates.indexOf(conversation) < first.candidates.indexOf(ownerMode));
});

test("computer.task rebinds one of duplicate semantic navigation candidates by stable ownership ordinal", async () => {
  const router = fixtureRouter({ duplicateConversationEntries: true });
  const context = { agentId: "agent", sessionId: "session-duplicate-conversation-route" };
  const first = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: "Type an exact draft in the chat editor without sending it",
  }, context);
  const conversations = first.candidates.filter((candidate) => candidate.label === "New conversation");

  assert.equal(conversations.length, 2);
  const selected = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: conversations[0].candidateId,
  }, context);

  assert.equal(selected.outcome, "committed");
  assert.equal(router.actions.length, 1);
  assert.ok(selected.candidates.some((candidate) => candidate.label === "Draft"));
});

test("computer.task excludes controls owned by a nested foreign document", async () => {
  const router = fixtureRouter({ nestedForeignDocument: true });
  const context = { agentId: "agent", sessionId: "session-semantic-owner" };

  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);

  assert.ok(first.candidates.some((candidate) => candidate.label === "Settings"));
  assert.equal(first.candidates.some((candidate) => candidate.label === "Foreign input"), false);
  assert.equal(first.facts.some((fact) => fact.label === "Foreign control panel"), false);
  assert.equal(first.facts.some((fact) => fact.label === "Foreign input"), false);
});

test("computer.task never reports or replays an edit without exact-value proof", async () => {
  const router = fixtureRouter({
    valuePatternEditor: true,
    textActionVerified: false,
    suppressActionEffect: true,
  });
  const context = { agentId: "agent", sessionId: "session-unverified-edit" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const input = first.candidates.find((candidate) => candidate.label === "Type something");

  const typed = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: input.candidateId,
    text: "hello",
  }, context);

  assert.equal(typed.outcome, "indeterminate");
  assert.equal(typed.phase, "failed");
  assert.equal(typed.error.code, "task.edit_postcondition_unverified");
  assert.equal(typed.error.replayAllowed, false);
  assert.equal(typed.action.receipt.postconditionVerified, false);
  assert.equal(router.actions.filter((action) => action.kind === "type_text").length, 1);
});

test("a semantic Editable without pixel geometry uses ValuePattern before mutation", async () => {
  // The control is a proven semantic Editable but has no screenshot point. The
  // Host chooses ValuePattern before mutation instead of guessing coordinates
  // or trying a pixel action and falling back after an uncertain receipt.
  const router = fixtureRouter({ valuePatternEditor: true, valuePatternEditorLocated: false });
  const context = { agentId: "agent", sessionId: "session-ungrounded-editor" };

  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const input = first.candidates.find((candidate) => candidate.label === "Type something");
  const edited = await runGenericTaskTool(
    router,
    { taskToken: first.taskToken, candidateId: input.candidateId, text: "hello" },
    context,
  );

  const action = router.actions.at(-1);
  assert.equal(edited.outcome, "committed");
  assert.equal(edited.action.receipt.postconditionVerified, true);
  assert.equal(action.kind, "set_value");
  assert.equal(action.x, undefined, "an unlocated control must carry no pixel target");
  assert.equal(action.y, undefined);
  assert.equal(action.observationId, undefined);
});

test("computer.task keeps generic navigation available in a messaging-shaped desktop shell", async () => {
  const router = fixtureRouter({ messagingLikeMain: true });
  const context = { agentId: "agent", sessionId: "session-messaging-shaped-shell" };

  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);

  assert.equal(first.phase, "decision-required");
  assert.equal(first.error, undefined);
  assert.ok(first.candidates.some((candidate) => candidate.label === "Settings"));
  const editor = first.candidates.find((candidate) => (
    candidate.label === "Message editor" && candidate.action === "edit"
  ));
  assert.ok(editor, "a non-submitting edit remains available even in a messaging-shaped shell");
  assert.equal(first.candidates.some((candidate) => (
    candidate.label === "Message editor" && candidate.action === "select"
  )), false);
  assert.equal(first.candidates.some((candidate) => candidate.label === "Send"), false);
  assert.equal(first.candidates.some((candidate) => candidate.label === "Conversation target"), false);
  assert.equal(first.facts.some((fact) => fact.label === "Chat body text"), false);

  const typed = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: editor.candidateId,
    text: "draft only",
  }, context);
  assert.equal(typed.outcome, "committed");
  assert.equal(typed.action.receipt.postconditionVerified, true);
  assert.equal(typed.action.receipt.verificationMethod, "host-exact-edit-readback");
  assert.deepEqual(typed.action.receipt.evidence, ["provider-exact-value-readback"]);
  assert.ok(typed.facts.some((fact) => fact.label === "draft only" && fact.role === "message-editor"));
  assert.deepEqual(router.actions.map((action) => action.kind), ["type_text"]);
});

test("computer.task confirms a navigation click when a fresh owned actionable transient appears", async () => {
  const router = fixtureRouter({
    actionOutcome: "indeterminate",
    indeterminateActionApplies: true,
    transientNavigation: true,
    transientAuxiliaryWindow: true,
    settingsCoordinates: true,
  });
  const context = { agentId: "agent", sessionId: "session-navigation-transient" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.equal(second.action.receipt.providerOutcome, "indeterminate");
  assert.deepEqual(second.action.receipt.evidence, ["owned-actionable-transient-added"]);
  assert.ok(second.candidates.some((candidate) => candidate.label === "Preferences"));
  assert.deepEqual(second.candidates.map((candidate) => candidate.label), ["Preferences"]);
});

test("computer.task performs one forced owned-surface observation when the first post-click Scene is unproven", async () => {
  const router = fixtureRouter({
    actionOutcome: "indeterminate",
    indeterminateActionApplies: true,
    transientNavigation: true,
    forceCaptureRevealsTransient: true,
    settingsCoordinates: true,
  });
  const context = { agentId: "agent", sessionId: "session-navigation-forced-surface" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.deepEqual(second.action.receipt.evidence, ["owned-actionable-transient-added"]);
  assert.equal(router.captureRequests.at(-1).mode, "screenshot");
  assert.equal(router.captureRequests.at(-1).forceScreenshotSurfaceCapture, true);
  assert.equal(router.captureRequests.at(-1).includeRelatedSurfaces, true);
  assert.equal(router.actions.length, 1);
});

test("a bounded popup preflight may omit the semantic opener without making it stale", async () => {
  const router = fixtureRouter({
    transientNavigation: true,
    settingsCoordinates: true,
    forcedCaptureOmitsSemanticCandidate: true,
  });
  const context = { agentId: "agent", sessionId: "session-surface-only-preflight" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.equal(second.error?.code, undefined);
  assert.equal(router.actions.length, 1);
  assert.ok(second.candidates.some((candidate) => candidate.label === "Preferences"));
});

test("computer.task does not toggle an already-open navigation surface discovered by the pre-action screenshot", async () => {
  const router = fixtureRouter({
    settingsCoordinates: true,
    preflightRevealsTransient: true,
  });
  const context = { agentId: "agent", sessionId: "session-navigation-preflight" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "not-applied");
  assert.equal(second.phase, "decision-required");
  // Skipping the click must be reported. A silent decision-required leaves the
  // Agent unable to tell that its selection was deliberately not delivered, so
  // it reselects the same control indefinitely.
  assert.equal(second.error.code, "task.navigation_surface_already_open");
  assert.equal(second.error.replayAllowed, false);
  assert.match(second.error.message, /already open/u);
  assert.equal(second.action, undefined);
  assert.ok(second.candidates.some((candidate) => (
    candidate.label === "Preferences" && candidate.parentRole === "menu"
  )));
  assert.deepEqual(second.candidates.map((candidate) => candidate.label), ["Preferences"]);
  assert.equal(router.actions.length, 0);
  assert.equal(router.captureRequests.at(-1).forceScreenshotSurfaceCapture, true);
  assert.equal(router.captureRequests.at(-1).includeRelatedSurfaces, true);
  assert.equal(router.captureRequests.at(-1).preserveActionObservation, true);
  assert.deepEqual(router.captureRequests.at(-1).relatedSurfaceAnchor, {
    role: "button",
    bounds: { x: 8, y: 560, width: 220, height: 30 },
  });
  assert.equal(router.cancelCalls, 2);

  const preferences = second.candidates.find((candidate) => candidate.label === "Preferences");
  const third = await runGenericTaskTool(router, {
    taskToken: second.taskToken,
    candidateId: preferences.candidateId,
  }, context);
  assert.equal(third.outcome, "committed");
  assert.equal(router.actions.length, 1, "the menu item itself is clicked once");
  assert.equal(router.actions[0].elementId.endsWith(":preferences"), true);
  assert.ok(router.captureRequests.some((request) => (
    request.relatedSurfaceAnchor?.surfaceBounds?.x === 8
    && request.relatedSurfaceAnchor.surfaceBounds.y === 380
  )), "the proven surface identity is carried into the child revalidation capture");
});

// Regression: a capture can include an unrelated application's window. Its
// panels are flat and its rows OCR cleanly, so it looks exactly like a menu and
// its parent is the main window just like a real in-window popup. Geometry is
// the only thing that separates the two.
const FOREIGN_SURFACE_BOUNDS = { x: 627, y: 121, width: 291, height: 416 };

test("computer.task still clicks when the only new surface is nowhere near the selected control", async () => {
  const router = fixtureRouter({
    settingsCoordinates: true,
    preflightRevealsTransient: true,
    transientSurfaceBounds: FOREIGN_SURFACE_BOUNDS,
  });
  const context = { agentId: "agent", sessionId: "session-foreign-surface-preflight" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  // The distant surface must not be mistaken for this control's own popup, so
  // the requested click is delivered rather than skipped.
  assert.equal(router.actions.length, 1);
  assert.notEqual(second.error?.code, "task.navigation_surface_already_open");
});

test("computer.task preserves an already-open independently grounded popup absent from the semantic baseline", async () => {
  // A semantic baseline cannot see a custom-drawn popup. The action-time
  // screenshot can still prove that it is already open from anchor-local visual
  // structure plus OCR rows. Once the composed Scene owns that surface and its
  // actionable descendants, clicking the toggle would close the user's menu.
  const router = fixtureRouter({
    settingsCoordinates: true,
    preflightRevealsTransient: true,
    transientSurfaceEvidence: [{ source: "visual" }, { source: "ocr" }],
  });
  const context = { agentId: "agent", sessionId: "session-incomparable-baseline" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(router.actions.length, 0, "the already-open toggle is not clicked");
  assert.equal(second.error?.code, "task.navigation_surface_already_open");
  assert.ok(second.candidates.some((candidate) => candidate.label === "Preferences"));
});

test("an item offered from a surface the previous step opened survives to the next step", async () => {
  const router = fixtureRouter({
    transientNavigation: true,
    settingsCoordinates: true,
  });
  const context = { agentId: "agent", sessionId: "session-open-surface-continuation" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.equal(second.released, true, "control is released between steps as usual");
  const preferences = second.candidates.find((candidate) => candidate.label === "Preferences");
  assert.ok(preferences, "the opened menu's items are the candidates");

  // The continuation looks for the surface the way it was found, so the item
  // offered a moment ago still resolves.
  const third = await runGenericTaskTool(router, {
    taskToken: second.taskToken,
    candidateId: preferences.candidateId,
  }, context);
  assert.equal(third.outcome, "committed");
  assert.deepEqual(router.actions.map((action) => action.elementId.split(":").at(-1)), [
    "settings",
    "preferences",
  ], "the Host never replays the surface toggle while selecting its child");
  assert.deepEqual(router.accessRequests[2], {
    applicationToken: "application:example",
    activationPolicy: "foreground-only",
    tier: "full",
    agentId: "agent",
    reason: "Host-owned generic desktop task",
    requestContext: context,
  }, "continuing an open surface binds without reactivating the window that owns it");
  assert.notEqual(third.error?.code, "task.candidate_stale");
});

test("a refusal raised before delivery is not reported as an effect that may have landed", async () => {
  const router = fixtureRouter({ settingsCoordinates: true });
  router.act = async () => {
    // Shaped like an admission refusal: raised before the action reached any
    // provider, so nothing was delivered.
    const error = new Error("observation.insufficient");
    error.code = "observation.insufficient";
    error.detail = { allowed: false, delivered: false, reason: "The element does not offer a click action." };
    throw error;
  };
  const context = { agentId: "agent", sessionId: "session-predelivery-refusal" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  // Calling this indeterminate would claim a mutation might have landed when the
  // action never left the Host, and would forbid reconsidering the target.
  assert.equal(second.outcome, "not-applied");
  assert.notEqual(second.error.code, "task.action_failed_indeterminate");
  assert.equal(second.error.cause.code, "observation.insufficient");
  assert.match(second.error.cause.reason, /does not offer/u);
});

test("an action that may already be in flight stays indeterminate", async () => {
  const router = fixtureRouter({ settingsCoordinates: true });
  router.act = async () => { throw new Error("driver channel closed mid-write"); };
  const context = { agentId: "agent", sessionId: "session-inflight-failure" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  // No proof of non-delivery, so the conservative outcome must be preserved.
  assert.equal(second.outcome, "indeterminate");
  assert.equal(second.error.code, "task.action_failed_indeterminate");
  assert.equal(second.error.replayAllowed, false);
});

test("computer.task does not confirm a navigation click from a surface unrelated to the clicked control", async () => {
  const router = fixtureRouter({
    actionOutcome: "indeterminate",
    indeterminateActionApplies: true,
    transientNavigation: true,
    settingsCoordinates: true,
    transientSurfaceBounds: FOREIGN_SURFACE_BOUNDS,
  });
  const context = { agentId: "agent", sessionId: "session-foreign-surface-postcondition" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  // Confirming here would report a mutation that was never proven to reach the
  // control, which is worse than closing unproven.
  assert.notEqual(second.outcome, "committed");
  assert.equal(second.error.replayAllowed, false);
});

test("computer.task lets a proven navigation postcondition override a contradictory not-applied provider receipt", async () => {
  const router = fixtureRouter({ actionOutcome: "not-applied" });
  const context = { agentId: "agent", sessionId: "session-navigation-receipt-conflict" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "committed");
  assert.equal(second.action.receipt.providerOutcome, "not-applied");
  assert.equal(second.action.receipt.outcome, "committed");
  assert.equal(second.action.receipt.postconditionVerified, true);
  assert.ok(second.candidates.some((candidate) => candidate.label === "Usage"));
});

test("computer.task rejects a committed navigation receipt when only unrelated dynamic text changed", async () => {
  const router = fixtureRouter({ suppressActionEffect: true, includeVolatileFact: true });
  const context = { agentId: "agent", sessionId: "session-navigation-unproven" };
  const first = await runGenericTaskTool(router, { applicationName: APP, goal: GOAL }, context);
  const settings = first.candidates.find((candidate) => candidate.label === "Settings" && candidate.action === "select");

  const second = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);

  assert.equal(second.outcome, "indeterminate");
  assert.equal(second.phase, "failed");
  assert.equal(second.error.code, "task.navigation_postcondition_unverified");
  assert.equal(second.error.replayAllowed, false);
  assert.equal(second.action.receipt.providerOutcome, "committed");
  assert.equal(second.action.receipt.postconditionVerified, false);
  assert.deepEqual(second.action.receipt.evidence, []);
  assert.equal(router.actions.length, 1);

  const replay = await runGenericTaskTool(router, {
    applicationName: APP,
    goal: GOAL,
    taskToken: first.taskToken,
    candidateId: settings.candidateId,
  }, context);
  assert.equal(replay.error.code, "task.token_invalid");
  assert.equal(router.actions.length, 1);
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
  assert.match(task.description, /do not repeat or paraphrase applicationName or goal/u);
  assert.match(task.description, /Never use shell commands/u);
  assert.equal(task.inputSchema.required, undefined);
  assert.equal(task.inputSchema.properties.windowId, undefined);
  assert.equal(task.inputSchema.properties.coordinate, undefined);
  assert.equal(task.inputSchema.properties.elementId, undefined);
  const validateInput = new Ajv({ strict: false }).compile(task.inputSchema);
  assert.equal(validateInput({ applicationName: APP, goal: GOAL }), true);
  assert.equal(validateInput({ taskToken: "opaque", candidateId: "candidate:opaque" }), true);
  assert.equal(validateInput({ candidateId: "candidate:opaque" }), false);

  const envelope = await callTool(fixtureRouter(), "computer.task", {
    applicationName: APP,
    goal: GOAL,
  }, { agentId: "agent", sessionId: "schema-session" });
  const validate = new Ajv({ strict: false }).compile(task.outputSchema);
  assert.equal(validate(envelope.structuredContent), true, JSON.stringify(validate.errors));
  assert.equal(envelope.isError, false);
});

function fixtureRouter({
  initialPage = "main",
  settingsExitControls = false,
  persistentBackTransition = false,
  conversationEntry = false,
  duplicateConversationEntries = false,
  ownerModeControl = false,
  initialDraftValue = "",
  staleSettingsAfterFirstObservation = false,
  actionOutcome = "committed",
  indeterminateActionApplies = false,
  suppressActionEffect = false,
  includeVolatileFact = false,
  transientNavigation = false,
  transientAuxiliaryWindow = false,
  forceCaptureRevealsTransient = false,
  preflightRevealsTransient = false,
  forcedCaptureOmitsSemanticCandidate = false,
  settingsCoordinates = false,
  transientSurfaceBounds = null,
  transientSurfaceEvidence = null,
  hangAction = false,
  onAction = () => {},
  unavailableApplicationOnce = false,
  foregroundSemanticOwner = false,
  messagingLikeMain = false,
  valuePatternEditor = false,
  valuePatternEditorLocated = true,
  textActionVerified = true,
  nestedForeignDocument = false,
  settingsEvidenceChanges = false,
  actionablePageTransition = false,
} = {}) {
  let version = 0;
  let page = initialPage;
  let transientOpen = false;
  let draftValue = initialDraftValue;
  let actionScene = null;
  let captureCalls = 0;
  let cancelCalls = 0;
  const actions = [];
  const accessRequests = [];
  const captureRequests = [];
  return {
    actions,
    accessRequests,
    captureRequests,
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
    async capture(args = {}) {
      captureRequests.push(structuredClone(args));
      captureCalls += 1;
      version += 1;
      const settingsLabel = staleSettingsAfterFirstObservation && captureCalls > 1 ? "Preferences" : "Settings";
      const preflightTransient = preflightRevealsTransient && args.forceScreenshotSurfaceCapture === true;
      const scene = taskScene({
        version,
        page,
        settingsLabel,
        includeVolatileFact,
        transientOpen: preflightTransient || (transientOpen
          && (!forceCaptureRevealsTransient || args.forceScreenshotSurfaceCapture === true)),
        transientAuxiliaryWindow,
        settingsCoordinates,
        settingsEvidenceChanges,
        messagingLikeMain,
        valuePatternEditor,
        valuePatternEditorLocated,
        nestedForeignDocument,
        settingsExitControls,
        persistentBackTransition,
        conversationEntry,
        duplicateConversationEntries,
        ownerModeControl,
        draftValue,
        hideSettings: forcedCaptureOmitsSemanticCandidate
          && args.forceScreenshotSurfaceCapture === true,
        transientSurfaceBounds,
        transientSurfaceEvidence,
      });
      if (args.preserveActionObservation !== true) actionScene = scene;
      return { observationId: `observation:${version}`, scene };
    },
    async act({ action }) {
      if (typeof action?.elementId === "string"
        && !actionScene?.elements?.some((element) => element.id === action.elementId)) {
        const error = new Error("scene.element_invalid");
        error.code = "scene.element_invalid";
        throw error;
      }
      actions.push(structuredClone(action));
      onAction();
      if (hangAction) return new Promise(() => {});
      if (!suppressActionEffect && (actionOutcome !== "indeterminate" || indeterminateActionApplies)) {
        if (action.elementId.endsWith(":settings")) {
          if (transientNavigation) transientOpen = true;
          else page = actionablePageTransition ? "new-chat" : "settings";
        }
        if (action.elementId.endsWith(":usage")) page = "usage";
        if (action.elementId.endsWith(":preferences")) {
          page = "preferences";
          transientOpen = false;
        }
        if (action.elementId.endsWith(":back") && persistentBackTransition) page = "main";
        if (action.elementId.includes(":new-conversation-") && duplicateConversationEntries) page = "new-chat";
        if (action.kind === "type_text" || action.kind === "set_value") draftValue = action.value;
      }
      if (actionOutcome === "indeterminate") return { status: "indeterminate", outcome: "indeterminate" };
      return {
        status: actionOutcome,
        outcome: actionOutcome,
        ...(["type_text", "set_value"].includes(action.kind) && textActionVerified ? {
          result: {
            verified: true,
            verification: { method: "native-exact-value-read-back" },
          },
        } : {}),
        capture: await this.capture(),
      };
    },
    async cancel() {
      cancelCalls += 1;
      return { status: "cancelled" };
    },
  };
}

function taskScene({
  version,
  page,
  settingsLabel,
  includeVolatileFact = false,
  transientOpen = false,
  transientAuxiliaryWindow = false,
  settingsCoordinates = false,
  settingsEvidenceChanges = false,
  messagingLikeMain = false,
  valuePatternEditor = false,
  valuePatternEditorLocated = true,
  nestedForeignDocument = false,
  settingsExitControls = false,
  persistentBackTransition = false,
  conversationEntry = false,
  duplicateConversationEntries = false,
  ownerModeControl = false,
  draftValue = "",
  hideSettings = false,
  transientSurfaceBounds = null,
  transientSurfaceEvidence = null,
}) {
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
  if (nestedForeignDocument) {
    add({
      key: "foreign-document",
      type: "Container",
      role: "document",
      parentKey: "shell",
      name: "Foreign control panel",
    });
    add({
      key: "foreign-input",
      type: "Editable",
      role: "edit",
      parentKey: "foreign-document",
      name: "Foreign input",
      actions: ["set_value"],
      actionable: true,
    });
  }
  if (includeVolatileFact) {
    add({ key: "clock", type: "ActionableItem", role: "status", parentKey: "shell", name: `Clock ${version}` });
  }
  if (page === "main") {
    if (ownerModeControl) add({
      key: "owner-mode",
      type: "ActionableItem",
      role: "button",
      parentKey: "shell",
      name: APP,
      actions: ["click"],
      actionable: true,
    });
    if (persistentBackTransition) add({
      key: "back",
      type: "ActionableItem",
      role: "button",
      parentKey: "shell",
      name: "Back",
      actions: ["click"],
      actionable: true,
    });
    if (!hideSettings) add({
      key: "settings",
      type: "ActionableItem",
      role: "button",
      parentKey: "shell",
      name: settingsLabel,
      semanticKey: "command:settings",
      ...(settingsEvidenceChanges ? {
        evidence: [{ source: version === 1 ? "structure" : "visual" }],
      } : {}),
      actions: ["click"],
      actionable: true,
      ...(settingsCoordinates ? {
        coordinate: {
          screenshotId: `screenshot:${version}`,
          windowId: "window:example",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          bounds: { x: 8, y: 560, width: 220, height: 30 },
        },
      } : {}),
    });
    if (conversationEntry) add({
      key: "new-conversation",
      type: "ActionableItem",
      role: "button",
      parentKey: "shell",
      name: "新对话",
      actions: ["click"],
      actionable: true,
    });
    if (duplicateConversationEntries) {
      for (const suffix of ["first", "second"]) add({
        key: `new-conversation-${suffix}`,
        type: "ActionableItem",
        role: "button",
        parentKey: "shell",
        name: "New conversation",
        actions: ["click"],
        actionable: true,
      });
    }
    if (valuePatternEditor) {
      // How Windows actually describes a chat box in an Electron app: an
      // editable that exposes ValuePattern and nothing about keyboards.
      add({
        key: "chat-input",
        type: "Editable",
        role: "edit",
        parentKey: "shell",
        name: "Type something",
        value: draftValue,
        actions: ["set_value"],
        actionable: true,
        ...(valuePatternEditorLocated ? {
          coordinate: {
            screenshotId: `screenshot:${version}`,
            windowId: "window:example",
            space: "window-local",
            cropOffset: { x: 0, y: 0 },
            // What a real capture reports: the ratio between the screenshot and
            // the bounds, not a factor the bounds still need applying.
            scale: { x: 1.001453488372093, y: 1.0024449877750612 },
            bounds: { x: 40, y: 600, width: 300, height: 40 },
          },
        } : {}),
      });
    }
    if (messagingLikeMain) {
      add({ key: "conversation", type: "Container", role: "conversation", parentKey: "shell", name: "Chat body text" });
      add({
        key: "message-editor",
        type: "Editable",
        role: "message-editor",
        parentKey: "conversation",
        name: "Message editor",
        value: draftValue,
        actions: ["click", "type_text"],
        actionable: true,
        coordinate: {
          screenshotId: `screenshot:${version}`,
          windowId: "window:example",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          bounds: { x: 320, y: 520, width: 420, height: 64 },
        },
      });
      add({
        key: "send",
        type: "ActionableItem",
        role: "send",
        parentKey: "message-editor",
        name: "Send",
        actions: ["click"],
        actionable: true,
      });
      add({ key: "target-list", type: "Container", role: "target-list", parentKey: "shell", name: "Conversation list" });
      add({
        key: "target-candidate",
        type: "ActionableItem",
        role: "target-candidate",
        parentKey: "target-list",
        name: "Conversation target",
        actions: ["click"],
        actionable: true,
      });
    }
    if (transientOpen) {
      const menuBounds = transientSurfaceBounds ?? { x: 8, y: 380, width: 240, height: 180 };
      if (transientAuxiliaryWindow) {
        add({
          key: "settings-menu-window",
          type: "Window",
          role: "auxiliary-window",
          parentKey: "window",
          name: "Profile flyout",
        });
      }
      add({
        key: "settings-menu",
        type: "TransientSurface",
        role: "menu",
        parentKey: transientAuxiliaryWindow ? "settings-menu-window" : "window",
        name: "Application menu",
        ...(transientSurfaceEvidence ? { evidence: transientSurfaceEvidence } : {}),
        // A real popup renders against the control that opens it. Geometry is
        // what separates it from an unrelated window the capture happened to
        // include, whose parent is also the main window.
        coordinate: {
          screenshotId: `screenshot:${version}`,
          windowId: "window:example",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          bounds: menuBounds,
        },
      });
      add({
        key: "preferences",
        type: "ActionableItem",
        role: "menu-item",
        parentKey: "settings-menu",
        name: "Preferences",
        semanticKey: "command:preferences",
        actions: ["click"],
        actionable: true,
        coordinate: {
          screenshotId: `screenshot:${version}`,
          windowId: "window:example",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          bounds: {
            x: menuBounds.x + 16,
            y: menuBounds.y + 88,
            width: Math.max(40, menuBounds.width - 32),
            height: 44,
          },
        },
      });
    }
  } else if (page !== "new-chat") {
    add({
      key: "settings-page",
      type: "Container",
      role: "settings-page",
      parentKey: "shell",
      name: page === "preferences" ? "Preferences" : "Settings",
    });
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
    if (persistentBackTransition) {
      add({
        key: "back",
        type: "ActionableItem",
        role: "button",
        parentKey: "shell",
        name: "Back",
        actions: ["click"],
        actionable: true,
      });
      add({
        key: "settings-only-action",
        type: "ActionableItem",
        role: "button",
        parentKey: "settings-page",
        name: "Settings-only action",
        actions: ["click"],
        actionable: true,
      });
    }
    if (settingsExitControls) {
      add({
        key: "search-settings",
        type: "Editable",
        role: "edit",
        parentKey: "settings-page",
        name: "Search settings",
        actions: ["set_value"],
        actionable: true,
      });
      add({
        key: "keyboard-shortcuts",
        type: "ActionableItem",
        role: "button",
        parentKey: "settings-page",
        name: "Keyboard shortcuts",
        actions: ["click"],
        actionable: true,
      });
      add({
        key: "return-application",
        type: "ActionableItem",
        role: "hyperlink",
        parentKey: "settings-page",
        name: "Return to application",
        actions: ["click"],
        actionable: true,
      });
    }
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
  if (page === "new-chat") {
    add({
      key: "draft",
      type: "Editable",
      role: "edit",
      parentKey: "shell",
      name: "Draft",
      actions: ["set_value"],
      actionable: true,
      coordinate: {
        screenshotId: `screenshot:${version}`,
        windowId: "window:example",
        space: "window-local",
        cropOffset: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        bounds: { x: 40, y: 600, width: 300, height: 40 },
      },
    });
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
