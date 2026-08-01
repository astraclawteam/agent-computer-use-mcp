import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import {
  DETERMINISTIC_MESSAGING_STEPS,
  DeterministicMessagingStateMachine,
} from "../src/deterministic-messaging-state-machine.mjs";

const QUERY = "林舟";
const MESSAGE = "今晚七点见";

test("the Host-driven workflow commits the fixed role-based sequence and releases", async () => {
  const host = createFixtureHost();
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
  });

  const result = await machine.run();

  assert.equal(result.status, "committed");
  assert.deepEqual(
    result.history.map((entry) => entry.step),
    DETERMINISTIC_MESSAGING_STEPS.map((step) => step.id),
  );
  assert.equal(result.history.every((entry) => entry.status === "committed"), true);
  assert.equal(host.releaseCalls, 1);
  assert.deepEqual(
    host.actions.map(({ step, action }) => ({ step, kind: action.kind })),
    [
      { step: "restore-main-window", kind: "activate_window" },
      { step: "focus-search", kind: "click" },
      { step: "enter-query", kind: "type_text" },
      { step: "select-result", kind: "click" },
      { step: "focus-message-editor", kind: "click" },
      { step: "enter-message", kind: "type_text" },
      { step: "send", kind: "click" },
    ],
  );
  const textActions = host.actions.filter(({ action }) => action.kind === "type_text");
  assert.deepEqual(textActions.map(({ action }) => action.textMode), ["replace-all", "replace-all"]);
  assert.deepEqual(textActions.map(({ action }) => action.inputBehavior), ["incremental", "incremental"]);
  assert.equal(host.actions.every(({ action }) => action.x === undefined && action.y === undefined), true);
});

test("every step publishes explicit conditions, timeout, and only one allowed successor", () => {
  assert.deepEqual(
    DETERMINISTIC_MESSAGING_STEPS.map((step) => step.id),
    [
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
    ],
  );
  for (const [index, step] of DETERMINISTIC_MESSAGING_STEPS.entries()) {
    assert.ok(step.preconditions.length > 0, `${step.id} preconditions`);
    assert.ok(step.postconditions.length > 0, `${step.id} postconditions`);
    assert.ok(step.timeoutMs > 0, `${step.id} timeout`);
    assert.deepEqual(
      step.allowedNext,
      index === DETERMINISTIC_MESSAGING_STEPS.length - 1
        ? []
        : [DETERMINISTIC_MESSAGING_STEPS[index + 1].id],
    );
  }
});

test("an unmet precondition fails at its owning step without clicking ahead", async () => {
  const host = createFixtureHost({ omitSearch: true });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
  });

  await assert.rejects(machine.run(), (error) => {
    assert.equal(error.code, "workflow.precondition_failed");
    assert.equal(error.step, "focus-search");
    assert.equal(error.outcome, "not-applied");
    return true;
  });
  assert.deepEqual(host.actions.map(({ step }) => step), ["restore-main-window"]);
  assert.equal(host.releaseCalls, 1);
});

test("conversation title verification never accepts matching chat-body text", async () => {
  const host = createFixtureHost({ wrongTitleWithMatchingBody: true });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
    stepTimeouts: { "verify-conversation-title": 20 },
  });

  await assert.rejects(machine.run(), (error) => {
    assert.equal(error.code, "workflow.step_timeout");
    assert.equal(error.step, "verify-conversation-title");
    assert.equal(error.outcome, "not-applied");
    return true;
  });
  assert.equal(host.actions.some(({ step }) => step === "focus-message-editor"), false);
  assert.equal(host.releaseCalls, 1);
});

for (const outcome of ["not-applied", "indeterminate"]) {
  test(`${outcome} mutation is terminal and is never replayed`, async () => {
    const host = createFixtureHost({ failStep: "select-result", failOutcome: outcome });
    const machine = new DeterministicMessagingStateMachine({
      host,
      goal: { query: QUERY, message: MESSAGE },
      pollIntervalMs: 1,
    });

    await assert.rejects(machine.run(), (error) => {
      assert.equal(error.code, `workflow.action_${outcome}`);
      assert.equal(error.step, "select-result");
      assert.equal(error.outcome, outcome);
      assert.equal(error.replayAllowed, false);
      return true;
    });
    assert.equal(host.actions.filter(({ step }) => step === "select-result").length, 1);
    assert.equal(host.actions.some(({ step }) => step === "verify-conversation-title"), false);
    assert.equal(host.releaseCalls, 1);
  });
}

test("a timed-out in-flight action is cancelled, never followed by another action, and released", async () => {
  const host = createFixtureHost({ hangStep: "focus-search" });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
    stepTimeouts: { "focus-search": 20 },
  });

  await assert.rejects(machine.run(), (error) => {
    assert.equal(error.code, "workflow.step_timeout");
    assert.equal(error.step, "focus-search");
    assert.equal(error.outcome, "indeterminate");
    return true;
  });
  await delay(10);
  assert.deepEqual(host.actions.map(({ step }) => step), ["restore-main-window", "focus-search"]);
  assert.equal(host.abortedActions, 1);
  assert.equal(host.releaseCalls, 1);
});

test("Stop aborts an in-flight action and prevents all later clicks and input", async () => {
  let actionStarted;
  const started = new Promise((resolve) => { actionStarted = resolve; });
  const host = createFixtureHost({
    hangStep: "focus-search",
    onAction: ({ step }) => {
      if (step === "focus-search") actionStarted();
    },
  });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
  });

  const running = machine.run();
  await started;
  machine.stop("operator-stop");

  await assert.rejects(running, (error) => {
    assert.equal(error.code, "workflow.cancelled");
    assert.equal(error.step, "focus-search");
    assert.equal(error.outcome, "indeterminate");
    return true;
  });
  await delay(10);
  assert.deepEqual(host.actions.map(({ step }) => step), ["restore-main-window", "focus-search"]);
  assert.equal(host.releaseCalls, 1);
});

test("new-bubble verification requires a fresh self-authored bubble under the transcript", async () => {
  const host = createFixtureHost({ placeNewBubbleOutsideTranscript: true });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
    stepTimeouts: { "verify-new-bubble": 20 },
  });

  await assert.rejects(machine.run(), (error) => {
    assert.equal(error.code, "workflow.step_timeout");
    assert.equal(error.step, "verify-new-bubble");
    return true;
  });
  assert.equal(host.actions.filter(({ step }) => step === "send").length, 1);
  assert.equal(host.releaseCalls, 1);
});

test("a failed release is reported and never compensated by a second release call", async () => {
  const host = createFixtureHost({ failRelease: true });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal: { query: QUERY, message: MESSAGE },
    pollIntervalMs: 1,
  });

  await assert.rejects(machine.run(), (error) => {
    assert.equal(error.code, "workflow.release_failed");
    assert.equal(error.step, "release");
    assert.equal(error.outcome, "indeterminate");
    return true;
  });
  assert.equal(host.releaseCalls, 1);
});

function createFixtureHost(options = {}) {
  let version = 0;
  let foreground = false;
  let focusedRole = null;
  let query = "";
  let resultsVisible = false;
  let conversationVisible = false;
  let editorValue = "";
  let sent = false;
  let released = false;
  const actions = [];
  let releaseCalls = 0;
  let abortedActions = 0;

  return {
    actions,
    get releaseCalls() { return releaseCalls; },
    get abortedActions() { return abortedActions; },

    async observe() {
      version += 1;
      return fixtureScene({
        version,
        foreground,
        focusedRole,
        query,
        resultsVisible,
        conversationVisible,
        editorValue,
        sent,
        omitSearch: options.omitSearch === true,
        wrongTitleWithMatchingBody: options.wrongTitleWithMatchingBody === true,
        placeNewBubbleOutsideTranscript: options.placeNewBubbleOutsideTranscript === true,
      });
    },

    async act({ step, action, signal }) {
      actions.push({ step, action: structuredClone(action) });
      options.onAction?.({ step, action });
      if (options.hangStep === step) {
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            abortedActions += 1;
            const error = new Error("fixture action aborted");
            error.name = "AbortError";
            reject(error);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
      if (options.failStep === step) {
        return { outcome: options.failOutcome, status: options.failOutcome };
      }
      if (step === "restore-main-window") foreground = true;
      if (step === "focus-search") focusedRole = "search";
      if (step === "enter-query") {
        query = action.value;
        resultsVisible = true;
      }
      if (step === "select-result") {
        resultsVisible = false;
        conversationVisible = true;
        focusedRole = null;
      }
      if (step === "focus-message-editor") focusedRole = "message-editor";
      if (step === "enter-message") editorValue = action.value;
      if (step === "send") {
        editorValue = "";
        sent = true;
      }
      return { outcome: "committed", status: "committed" };
    },

    async release() {
      releaseCalls += 1;
      if (options.failRelease === true) {
        return { outcome: "indeterminate", status: "indeterminate" };
      }
      released = true;
      return { outcome: "committed", status: "committed", released };
    },
  };
}

function fixtureScene({
  version,
  foreground,
  focusedRole,
  query,
  resultsVisible,
  conversationVisible,
  editorValue,
  sent,
  omitSearch,
  wrongTitleWithMatchingBody,
  placeNewBubbleOutsideTranscript,
}) {
  const elements = [];
  const add = (element) => {
    const id = `scene:${version}:${element.key}`;
    elements.push({
      id,
      type: element.type,
      role: element.role,
      parentId: element.parentKey ? `scene:${version}:${element.parentKey}` : null,
      observationVersion: version,
      evidenceConsistency: "consistent",
      actions: element.actions ?? [],
      actionable: (element.actions?.length ?? 0) > 0,
      state: element.state ?? {},
      ...(element.name === undefined ? {} : { name: element.name }),
      ...(element.value === undefined ? {} : { value: element.value }),
      ...(element.semanticKey === undefined ? {} : { semanticKey: element.semanticKey }),
    });
    return id;
  };

  add({
    key: "main",
    type: "Window",
    role: "main-window",
    actions: ["activate_window"],
    state: { foreground },
  });
  add({ key: "shell", type: "Container", role: "application", parentKey: "main" });
  if (!omitSearch) {
    add({
      key: "search",
      type: "Editable",
      role: "search",
      parentKey: "shell",
      actions: ["click", "type_text"],
      value: query,
      state: { focused: focusedRole === "search" },
    });
  }
  if (resultsVisible) {
    add({ key: "results", type: "TransientSurface", role: "search-results", parentKey: "shell" });
    add({
      key: "candidate",
      type: "ActionableItem",
      role: "search-result",
      parentKey: "results",
      actions: ["click"],
      name: QUERY,
      semanticKey: "contact:fixture",
    });
  }
  if (conversationVisible) {
    add({ key: "conversation", type: "Container", role: "conversation", parentKey: "shell" });
    add({
      key: "title",
      type: "ActionableItem",
      role: "conversation-title",
      parentKey: "conversation",
      name: wrongTitleWithMatchingBody ? "其他会话" : QUERY,
      semanticKey: wrongTitleWithMatchingBody ? "contact:other" : "contact:fixture",
    });
    add({ key: "transcript", type: "Container", role: "transcript", parentKey: "conversation" });
    add({
      key: "old-body",
      type: "ActionableItem",
      role: "message-bubble",
      parentKey: "transcript",
      value: wrongTitleWithMatchingBody ? QUERY : "历史消息",
      state: { authoredBySelf: false },
    });
    add({
      key: "editor",
      type: "Editable",
      role: "message-editor",
      parentKey: "conversation",
      actions: ["click", "type_text"],
      value: editorValue,
      state: { focused: focusedRole === "message-editor" },
    });
    add({
      key: "send",
      type: "ActionableItem",
      role: "send",
      parentKey: "conversation",
      actions: ["click"],
    });
    if (sent) {
      add({
        key: "new-bubble",
        type: "ActionableItem",
        role: "message-bubble",
        parentKey: placeNewBubbleOutsideTranscript ? "shell" : "transcript",
        value: MESSAGE,
        state: { authoredBySelf: true },
      });
    }
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
