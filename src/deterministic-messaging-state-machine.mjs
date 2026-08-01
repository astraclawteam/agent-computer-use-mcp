import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_TIMEOUT_MS = 5_000;
const RELEASE_TIMEOUT_MS = 2_000;
const ACTION_OUTCOMES = new Set(["committed", "not-applied", "indeterminate"]);
const MUTATING_STEPS = new Set([
  "restore-main-window",
  "focus-search",
  "enter-query",
  "select-result",
  "focus-message-editor",
  "enter-message",
  "send",
]);

const STEP_DEFINITIONS = [
  {
    id: "restore-main-window",
    preconditions: ["one consistent main Window is present and can be activated"],
    postconditions: ["that Window is the foreground window in a newer Scene"],
  },
  {
    id: "focus-search",
    preconditions: ["one actionable search Editable belongs to the main Window"],
    postconditions: ["that Editable owns the current focus in a newer Scene"],
  },
  {
    id: "enter-query",
    preconditions: ["the search Editable is focused and accepts type_text"],
    postconditions: ["the search Editable value exactly equals the requested query"],
  },
  {
    id: "wait-results-stable",
    preconditions: ["a search-results TransientSurface belongs to the main Window"],
    postconditions: ["the same owned candidate identities appear in two consecutive Scenes"],
  },
  {
    id: "select-result",
    preconditions: ["exactly one stable actionable result semantically matches the query"],
    postconditions: ["a conversation Container is visible in a newer Scene"],
  },
  {
    id: "verify-conversation-title",
    preconditions: ["one conversation-title element belongs to the conversation Container"],
    postconditions: ["the title identity matches the selected result identity"],
  },
  {
    id: "focus-message-editor",
    preconditions: ["one actionable message-editor Editable belongs to the conversation Container"],
    postconditions: ["that Editable owns the current focus in a newer Scene"],
  },
  {
    id: "enter-message",
    preconditions: ["the message-editor Editable is focused and accepts type_text"],
    postconditions: ["the message-editor value exactly equals the requested message"],
  },
  {
    id: "send",
    preconditions: ["one actionable send item belongs to the conversation Container"],
    postconditions: ["the send action commits and the editor is cleared in a newer Scene"],
  },
  {
    id: "verify-new-bubble",
    preconditions: ["one transcript Container belongs to the conversation Container"],
    postconditions: ["a fresh self-authored bubble with the exact message appears under the transcript"],
  },
  {
    id: "release",
    preconditions: ["the Host control lease is held or terminal cleanup is required"],
    postconditions: ["the Host confirms that control is released"],
    timeoutMs: RELEASE_TIMEOUT_MS,
  },
];

export const DETERMINISTIC_MESSAGING_STEPS = Object.freeze(
  STEP_DEFINITIONS.map((step, index) => Object.freeze({
    id: step.id,
    preconditions: Object.freeze([...step.preconditions]),
    postconditions: Object.freeze([...step.postconditions]),
    timeoutMs: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowedNext: Object.freeze(
      index + 1 < STEP_DEFINITIONS.length ? [STEP_DEFINITIONS[index + 1].id] : [],
    ),
  })),
);

const STEP_BY_ID = new Map(DETERMINISTIC_MESSAGING_STEPS.map((step) => [step.id, step]));

export class DeterministicMessagingStateMachine {
  #host;
  #goal;
  #pollIntervalMs;
  #stepTimeouts;
  #runController = new AbortController();
  #externalSignal;
  #externalAbortListener;
  #history = [];
  #status = "idle";
  #currentStep = null;
  #released = false;
  #releaseAttempted = false;
  #inFlightMutation = false;
  #selectedIdentity = null;
  #selectedLabel = null;
  #stableCandidateKeys = [];
  #baselineMatchingBubbleCount = 0;
  #sendObservationVersion = null;

  constructor({ host, goal, stepTimeouts = {}, pollIntervalMs = 25, signal } = {}) {
    if (!host || typeof host.observe !== "function" || typeof host.act !== "function"
      || typeof host.release !== "function") {
      throw workflowError({
        code: "workflow.invalid_host",
        message: "The deterministic workflow requires Host observe, act, and release functions.",
        outcome: "not-applied",
      });
    }
    if (typeof goal?.query !== "string" || goal.query.length === 0
      || typeof goal?.message !== "string" || goal.message.length === 0) {
      throw workflowError({
        code: "workflow.invalid_goal",
        message: "The deterministic workflow requires non-empty query and message strings.",
        outcome: "not-applied",
      });
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw workflowError({
        code: "workflow.invalid_poll_interval",
        message: "pollIntervalMs must be a non-negative finite number.",
        outcome: "not-applied",
      });
    }
    for (const [step, timeoutMs] of Object.entries(stepTimeouts)) {
      if (!STEP_BY_ID.has(step) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw workflowError({
          code: "workflow.invalid_step_timeout",
          message: `Invalid timeout for deterministic workflow step ${step}.`,
          outcome: "not-applied",
        });
      }
    }

    this.#host = host;
    this.#goal = Object.freeze({ query: goal.query, message: goal.message });
    this.#pollIntervalMs = pollIntervalMs;
    this.#stepTimeouts = Object.freeze({ ...stepTimeouts });
    this.#externalSignal = signal;
    if (signal) {
      this.#externalAbortListener = () => this.stop("external-cancel");
      if (signal.aborted) this.#externalAbortListener();
      else signal.addEventListener("abort", this.#externalAbortListener, { once: true });
    }
  }

  get snapshot() {
    return Object.freeze({
      status: this.#status,
      currentStep: this.#currentStep,
      released: this.#released,
      history: Object.freeze(this.#history.map((entry) => Object.freeze({ ...entry }))),
    });
  }

  stop(reason = "operator-stop") {
    if (this.#runController.signal.aborted || this.#released) return false;
    this.#runController.abort(reason);
    return true;
  }

  async run() {
    if (this.#status !== "idle") {
      throw workflowError({
        code: "workflow.already_started",
        message: "A deterministic workflow instance can run only once.",
        outcome: "not-applied",
      });
    }
    this.#status = "running";

    try {
      for (const step of DETERMINISTIC_MESSAGING_STEPS.slice(0, -1)) {
        await this.#runStep(step);
      }
      await this.#release({ cleanup: false, reason: "completed" });
      this.#status = "committed";
      return Object.freeze({
        status: "committed",
        history: Object.freeze(this.#history.map((entry) => Object.freeze({ ...entry }))),
        released: true,
      });
    } catch (caught) {
      const error = asWorkflowError(caught, {
        step: this.#currentStep,
        outcome: this.#inFlightMutation ? "indeterminate" : "not-applied",
      });
      this.#status = error.code === "workflow.cancelled" ? "cancelled" : "failed";
      try {
        await this.#release({ cleanup: true, reason: error.code });
      } catch (releaseError) {
        error.releaseError = serializableError(releaseError);
      }
      error.history = this.#history.map((entry) => ({ ...entry }));
      throw error;
    } finally {
      if (this.#externalSignal && this.#externalAbortListener) {
        this.#externalSignal.removeEventListener("abort", this.#externalAbortListener);
      }
      this.#currentStep = null;
      this.#inFlightMutation = false;
    }
  }

  async #runStep(step) {
    this.#currentStep = step.id;
    try {
      await this.#withStepTimeout(step, (signal) => this.#dispatch(step.id, signal));
      this.#history.push({ step: step.id, status: "committed" });
      this.#inFlightMutation = false;
    } catch (caught) {
      const error = asWorkflowError(caught, {
        step: step.id,
        outcome: this.#inFlightMutation ? "indeterminate" : "not-applied",
      });
      this.#history.push({
        step: step.id,
        status: error.outcome,
        code: error.code,
        replayAllowed: false,
      });
      throw error;
    }
  }

  async #dispatch(step, signal) {
    if (step === "restore-main-window") return this.#restoreMainWindow(signal);
    if (step === "focus-search") return this.#focusSearch(signal);
    if (step === "enter-query") return this.#enterQuery(signal);
    if (step === "wait-results-stable") return this.#waitResultsStable(signal);
    if (step === "select-result") return this.#selectResult(signal);
    if (step === "verify-conversation-title") return this.#verifyConversationTitle(signal);
    if (step === "focus-message-editor") return this.#focusMessageEditor(signal);
    if (step === "enter-message") return this.#enterMessage(signal);
    if (step === "send") return this.#send(signal);
    if (step === "verify-new-bubble") return this.#verifyNewBubble(signal);
    throw workflowError({
      code: "workflow.invalid_transition",
      message: `No deterministic transition exists for ${step}.`,
      step,
      outcome: "not-applied",
    });
  }

  async #restoreMainWindow(signal) {
    const before = await this.#observe("restore-main-window", signal);
    const window = requireUniqueElement(before, {
      type: "Window",
      role: "main-window",
      step: "restore-main-window",
    });
    if (window.state?.foreground === true) return;
    if (!window.actions?.includes("activate_window")) {
      throw preconditionError(
        "restore-main-window",
        "The main Window is not foreground and does not authorize activate_window.",
      );
    }
    await this.#act("restore-main-window", { kind: "activate_window", elementId: window.id }, signal);
    await this.#observeUntil({
      step: "restore-main-window",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Window", role: "main-window" })
        .some((element) => element.state?.foreground === true),
    });
    this.#inFlightMutation = false;
  }

  async #focusSearch(signal) {
    const before = await this.#observe("focus-search", signal);
    const main = requireUniqueElement(before, { type: "Window", role: "main-window", step: "focus-search" });
    const search = requireUniqueElement(before, {
      type: "Editable",
      role: "search",
      action: "click",
      ownerId: main.id,
      step: "focus-search",
    });
    await this.#act("focus-search", {
      kind: "click",
      elementId: search.id,
      interactionIntent: "focus-editable",
    }, signal);
    await this.#observeUntil({
      step: "focus-search",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Editable", role: "search" })
        .some((element) => element.state?.focused === true),
    });
    this.#inFlightMutation = false;
  }

  async #enterQuery(signal) {
    const before = await this.#observe("enter-query", signal);
    const search = requireUniqueElement(before, {
      type: "Editable",
      role: "search",
      action: "type_text",
      state: { focused: true },
      step: "enter-query",
    });
    await this.#act("enter-query", textAction(search.id, this.#goal.query), signal);
    await this.#observeUntil({
      step: "enter-query",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Editable", role: "search" })
        .some((element) => element.value === this.#goal.query),
    });
    this.#inFlightMutation = false;
  }

  async #waitResultsStable(signal) {
    let previousFingerprint = null;
    while (true) {
      const scene = await this.#observe("wait-results-stable", signal);
      const main = findUniqueElement(scene, { type: "Window", role: "main-window" });
      const surface = main && findUniqueElement(scene, {
        type: "TransientSurface",
        role: "search-results",
        ownerId: main.id,
      });
      const candidates = surface
        ? findElements(scene, {
          type: "ActionableItem",
          role: "search-result",
          action: "click",
          ownerId: surface.id,
        })
        : [];
      const fingerprint = candidateFingerprint(candidates);
      if (fingerprint !== null && fingerprint === previousFingerprint) {
        this.#stableCandidateKeys = candidates.map(candidateIdentity);
        return;
      }
      previousFingerprint = fingerprint;
      await abortableDelay(this.#pollIntervalMs, signal);
    }
  }

  async #selectResult(signal) {
    const before = await this.#observe("select-result", signal);
    const main = requireUniqueElement(before, { type: "Window", role: "main-window", step: "select-result" });
    const surface = requireUniqueElement(before, {
      type: "TransientSurface",
      role: "search-results",
      ownerId: main.id,
      step: "select-result",
    });
    const candidates = findElements(before, {
      type: "ActionableItem",
      role: "search-result",
      action: "click",
      ownerId: surface.id,
    });
    const stable = candidates.filter((candidate) => this.#stableCandidateKeys.includes(candidateIdentity(candidate)));
    const matching = stable.filter((candidate) => normalizeText(elementText(candidate)) === normalizeText(this.#goal.query));
    if (matching.length !== 1) {
      throw preconditionError(
        "select-result",
        `Expected one stable exact semantic result, observed ${matching.length}.`,
      );
    }
    const selected = matching[0];
    this.#selectedIdentity = typeof selected.semanticKey === "string" ? selected.semanticKey : null;
    this.#selectedLabel = elementText(selected);
    await this.#act("select-result", {
      kind: "click",
      elementId: selected.id,
      interactionIntent: "select-item",
    }, signal);
    await this.#observeUntil({
      step: "select-result",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Container", role: "conversation" }).length === 1,
    });
    this.#inFlightMutation = false;
  }

  async #verifyConversationTitle(signal) {
    await this.#observeUntil({
      step: "verify-conversation-title",
      signal,
      predicate: (scene) => {
        const conversation = findUniqueElement(scene, { type: "Container", role: "conversation" });
        if (!conversation) return false;
        const title = findUniqueElement(scene, { role: "conversation-title", ownerId: conversation.id });
        if (!title) return false;
        if (this.#selectedIdentity !== null) return title.semanticKey === this.#selectedIdentity;
        return normalizeText(elementText(title)) === normalizeText(this.#selectedLabel);
      },
    });
  }

  async #focusMessageEditor(signal) {
    const before = await this.#observe("focus-message-editor", signal);
    const conversation = requireUniqueElement(before, {
      type: "Container",
      role: "conversation",
      step: "focus-message-editor",
    });
    const editor = requireUniqueElement(before, {
      type: "Editable",
      role: "message-editor",
      action: "click",
      ownerId: conversation.id,
      step: "focus-message-editor",
    });
    await this.#act("focus-message-editor", {
      kind: "click",
      elementId: editor.id,
      interactionIntent: "focus-editable",
    }, signal);
    await this.#observeUntil({
      step: "focus-message-editor",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Editable", role: "message-editor" })
        .some((element) => element.state?.focused === true),
    });
    this.#inFlightMutation = false;
  }

  async #enterMessage(signal) {
    const before = await this.#observe("enter-message", signal);
    const editor = requireUniqueElement(before, {
      type: "Editable",
      role: "message-editor",
      action: "type_text",
      state: { focused: true },
      step: "enter-message",
    });
    await this.#act("enter-message", textAction(editor.id, this.#goal.message), signal);
    await this.#observeUntil({
      step: "enter-message",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Editable", role: "message-editor" })
        .some((element) => element.value === this.#goal.message),
    });
    this.#inFlightMutation = false;
  }

  async #send(signal) {
    const before = await this.#observe("send", signal);
    const conversation = requireUniqueElement(before, { type: "Container", role: "conversation", step: "send" });
    const transcript = requireUniqueElement(before, {
      type: "Container",
      role: "transcript",
      ownerId: conversation.id,
      step: "send",
    });
    const editor = requireUniqueElement(before, {
      type: "Editable",
      role: "message-editor",
      ownerId: conversation.id,
      step: "send",
    });
    if (editor.value !== this.#goal.message) {
      throw preconditionError("send", "The message editor no longer contains the exact requested message.");
    }
    const send = requireUniqueElement(before, {
      type: "ActionableItem",
      role: "send",
      action: "click",
      ownerId: conversation.id,
      step: "send",
    });
    this.#baselineMatchingBubbleCount = matchingSelfBubbleCount(before, transcript.id, this.#goal.message);
    this.#sendObservationVersion = before.observationVersion;
    await this.#act("send", {
      kind: "click",
      elementId: send.id,
      interactionIntent: "activate-control",
    }, signal);
    await this.#observeUntil({
      step: "send",
      signal,
      afterVersion: before.observationVersion,
      predicate: (scene) => findElements(scene, { type: "Editable", role: "message-editor" })
        .some((element) => element.value === ""),
    });
    this.#inFlightMutation = false;
  }

  async #verifyNewBubble(signal) {
    await this.#observeUntil({
      step: "verify-new-bubble",
      signal,
      afterVersion: this.#sendObservationVersion,
      predicate: (scene) => {
        const conversation = findUniqueElement(scene, { type: "Container", role: "conversation" });
        if (!conversation) return false;
        const transcript = findUniqueElement(scene, {
          type: "Container",
          role: "transcript",
          ownerId: conversation.id,
        });
        if (!transcript) return false;
        return matchingSelfBubbleCount(scene, transcript.id, this.#goal.message)
          > this.#baselineMatchingBubbleCount;
      },
    });
  }

  async #observe(step, signal) {
    assertNotAborted(signal, step, this.#inFlightMutation);
    const scene = await this.#host.observe({ step, signal });
    validateScene(scene, step);
    return scene;
  }

  async #observeUntil({ step, signal, afterVersion = null, predicate }) {
    while (true) {
      const scene = await this.#observe(step, signal);
      const fresh = afterVersion === null || scene.observationVersion > afterVersion;
      if (fresh && predicate(scene)) return scene;
      await abortableDelay(this.#pollIntervalMs, signal);
    }
  }

  async #act(step, action, signal) {
    assertNotAborted(signal, step, false);
    this.#inFlightMutation = true;
    const receipt = await this.#host.act({ step, action: Object.freeze({ ...action }), signal });
    const outcome = receipt?.outcome ?? receipt?.status;
    if (!ACTION_OUTCOMES.has(outcome)) {
      throw workflowError({
        code: "workflow.invalid_action_receipt",
        message: `Host action ${step} returned a non-canonical receipt.`,
        step,
        outcome: "indeterminate",
      });
    }
    if (outcome !== "committed") {
      this.#inFlightMutation = outcome === "indeterminate";
      throw workflowError({
        code: `workflow.action_${outcome}`,
        message: `Host action ${step} returned ${outcome}.`,
        step,
        outcome,
      });
    }
    return receipt;
  }

  async #withStepTimeout(step, operation) {
    const timeoutMs = this.#stepTimeouts[step.id] ?? step.timeoutMs;
    const controller = new AbortController();
    const onRunAbort = () => controller.abort(this.#runController.signal.reason);
    if (this.#runController.signal.aborted) onRunAbort();
    else this.#runController.signal.addEventListener("abort", onRunAbort, { once: true });

    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = workflowError({
          code: "workflow.step_timeout",
          message: `Deterministic workflow step ${step.id} timed out after ${timeoutMs} ms.`,
          step: step.id,
          outcome: this.#inFlightMutation ? "indeterminate" : "not-applied",
        });
        reject(error);
        controller.abort(error);
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } catch (caught) {
      if (this.#runController.signal.aborted && caught?.code !== "workflow.step_timeout") {
        throw workflowError({
          code: "workflow.cancelled",
          message: `Deterministic workflow was cancelled during ${step.id}.`,
          step: step.id,
          outcome: this.#inFlightMutation ? "indeterminate" : "not-applied",
        });
      }
      throw caught;
    } finally {
      clearTimeout(timer);
      this.#runController.signal.removeEventListener("abort", onRunAbort);
    }
  }

  async #release({ cleanup, reason }) {
    if (this.#released || this.#releaseAttempted) return;
    this.#releaseAttempted = true;
    this.#currentStep = "release";
    const release = STEP_BY_ID.get("release");
    const receipt = await standaloneTimeout(
      () => this.#host.release({ reason, cleanup }),
      this.#stepTimeouts.release ?? release.timeoutMs,
      () => workflowError({
        code: "workflow.release_timeout",
        message: "The Host did not confirm deterministic workflow release before timeout.",
        step: "release",
        outcome: "indeterminate",
      }),
    );
    const outcome = receipt?.outcome ?? receipt?.status;
    if (!ACTION_OUTCOMES.has(outcome) || outcome !== "committed") {
      throw workflowError({
        code: "workflow.release_failed",
        message: "The Host did not return a committed release receipt.",
        step: "release",
        outcome: ACTION_OUTCOMES.has(outcome) ? outcome : "indeterminate",
      });
    }
    this.#released = true;
    this.#history.push({ step: "release", status: "committed", ...(cleanup ? { cleanup: true } : {}) });
  }
}

function textAction(elementId, value) {
  return {
    kind: "type_text",
    elementId,
    value,
    textMode: "replace-all",
    inputBehavior: "incremental",
  };
}

function validateScene(scene, step) {
  if (!scene || !Number.isInteger(scene.observationVersion) || scene.observationVersion < 0
    || !Array.isArray(scene.elements)) {
    throw workflowError({
      code: "workflow.invalid_scene",
      message: `Host observe returned an invalid Scene during ${step}.`,
      step,
      outcome: "not-applied",
    });
  }
  const ids = new Set();
  for (const element of scene.elements) {
    if (!element || typeof element.id !== "string" || ids.has(element.id)
      || element.observationVersion !== scene.observationVersion) {
      throw workflowError({
        code: "workflow.invalid_scene",
        message: `Host Scene identities are invalid during ${step}.`,
        step,
        outcome: "not-applied",
      });
    }
    ids.add(element.id);
  }
  if (scene.elements.some((element) => element.parentId !== null
    && element.parentId !== undefined && !ids.has(element.parentId))) {
    throw workflowError({
      code: "workflow.invalid_scene_parent",
      message: `Host Scene contains an unknown parent during ${step}.`,
      step,
      outcome: "not-applied",
    });
  }
}

function requireUniqueElement(scene, query) {
  const element = findUniqueElement(scene, query);
  if (!element) {
    throw preconditionError(
      query.step,
      `Expected exactly one consistent ${query.type ?? "element"} with role ${query.role}.`,
    );
  }
  return element;
}

function findUniqueElement(scene, query) {
  const matches = findElements(scene, query);
  return matches.length === 1 ? matches[0] : null;
}

function findElements(scene, { type, role, action, ownerId, state }) {
  return scene.elements.filter((element) => {
    if (type && element.type !== type) return false;
    if (role && element.role !== role) return false;
    if (element.evidenceConsistency !== "consistent") return false;
    if (action && !element.actions?.includes(action)) return false;
    if (ownerId && !isDescendantOf(scene, element, ownerId)) return false;
    if (state && Object.entries(state).some(([key, value]) => element.state?.[key] !== value)) return false;
    return true;
  });
}

function isDescendantOf(scene, element, ownerId) {
  const byId = new Map(scene.elements.map((candidate) => [candidate.id, candidate]));
  const visited = new Set();
  let parentId = element.parentId;
  while (typeof parentId === "string" && !visited.has(parentId)) {
    if (parentId === ownerId) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

function candidateFingerprint(candidates) {
  if (candidates.length === 0) return null;
  return JSON.stringify(candidates.map(candidateIdentity).sort());
}

function candidateIdentity(element) {
  return typeof element.semanticKey === "string" && element.semanticKey.length > 0
    ? `semantic:${element.semanticKey}`
    : `label:${normalizeText(elementText(element))}`;
}

function elementText(element) {
  if (typeof element.name === "string") return element.name;
  if (typeof element.value === "string") return element.value;
  return "";
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function matchingSelfBubbleCount(scene, transcriptId, message) {
  return findElements(scene, {
    type: "ActionableItem",
    role: "message-bubble",
    ownerId: transcriptId,
  }).filter((element) => (
    element.state?.authoredBySelf === true
    && element.value === message
  )).length;
}

function preconditionError(step, message) {
  return workflowError({
    code: "workflow.precondition_failed",
    message,
    step,
    outcome: "not-applied",
  });
}

function assertNotAborted(signal, step, mutationInFlight) {
  if (!signal?.aborted) return;
  throw workflowError({
    code: "workflow.cancelled",
    message: `Deterministic workflow was cancelled during ${step}.`,
    step,
    outcome: mutationInFlight ? "indeterminate" : "not-applied",
  });
}

async function abortableDelay(timeoutMs, signal) {
  if (timeoutMs === 0) {
    assertNotAborted(signal, "observation-wait", false);
    await Promise.resolve();
    return;
  }
  await delay(timeoutMs, undefined, { signal });
}

async function standaloneTimeout(operation, timeoutMs, errorFactory) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(errorFactory()), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function workflowError({ code, message, step = null, outcome }) {
  const error = new Error(message);
  error.name = "DeterministicWorkflowError";
  error.code = code;
  error.step = step;
  error.outcome = outcome;
  error.replayAllowed = false;
  return error;
}

function asWorkflowError(error, defaults) {
  if (error?.name === "DeterministicWorkflowError") return error;
  return workflowError({
    code: error?.name === "AbortError" ? "workflow.cancelled" : "workflow.host_failure",
    message: error instanceof Error ? error.message : "The deterministic Host workflow failed.",
    step: defaults.step,
    outcome: defaults.outcome,
  });
}

function serializableError(error) {
  return {
    code: error?.code ?? "workflow.release_failed",
    message: error instanceof Error ? error.message : String(error),
    outcome: error?.outcome ?? "indeterminate",
  };
}
