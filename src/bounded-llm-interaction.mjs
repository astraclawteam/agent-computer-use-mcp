const DEFAULT_DECISION_TIMEOUT_MS = 5_000;

export const BOUNDED_LLM_DECISION_KINDS = Object.freeze([
  "understand-goal",
  "select-candidate",
  "resolve-visual-ambiguity",
  "decide-failure",
]);

const FAILURE_DECISIONS = new Set(["reobserve", "report"]);

export class BoundedLlmInteraction {
  #complete;
  #timeoutMs;

  constructor({ complete, timeoutMs = DEFAULT_DECISION_TIMEOUT_MS } = {}) {
    if (typeof complete !== "function") {
      throw llmBoundaryError(
        "llm.invalid_completion_port",
        "A Host-injected structured completion function is required.",
      );
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw llmBoundaryError("llm.invalid_timeout", "The LLM decision timeout must be positive.");
    }
    this.#complete = complete;
    this.#timeoutMs = timeoutMs;
  }

  async understandGoal({ userGoal, signal } = {}) {
    const normalizedGoal = requiredString(userGoal, "llm.invalid_user_goal");
    const output = await this.#request({
      kind: "understand-goal",
      input: { userGoal: normalizedGoal },
      outputSchema: objectSchema({
        query: nonEmptyStringSchema(),
        message: nonEmptyStringSchema(),
      }, ["query", "message"]),
      signal,
    });
    assertExactOutput(output, ["query", "message"]);
    return Object.freeze({
      query: requiredString(output.query, "llm.invalid_goal_output"),
      message: requiredString(output.message, "llm.invalid_goal_output", { trim: false }),
    });
  }

  async selectCandidate({ intent, sceneId, observationVersion, candidates, signal } = {}) {
    const normalizedCandidates = normalizeCandidates(candidates);
    const output = await this.#request({
      kind: "select-candidate",
      input: {
        intent: requiredString(intent, "llm.invalid_selection_input"),
        sceneId: requiredString(sceneId, "llm.invalid_selection_input"),
        observationVersion: nonNegativeInteger(observationVersion, "llm.invalid_selection_input"),
        candidates: normalizedCandidates,
      },
      outputSchema: objectSchema({
        candidateId: {
          type: "string",
          enum: normalizedCandidates.map((candidate) => candidate.candidateId),
        },
      }, ["candidateId"]),
      signal,
    });
    assertExactOutput(output, ["candidateId"]);
    const candidateId = requiredString(output.candidateId, "llm.output_contract_violation");
    if (!normalizedCandidates.some((candidate) => candidate.candidateId === candidateId)) {
      throw llmBoundaryError(
        "llm.selection_unknown_candidate",
        "The model selected an id outside the current Host candidate set.",
      );
    }
    return Object.freeze({ candidateId });
  }

  async resolveVisualAmbiguity({
    sceneId,
    observationVersion,
    visualEvidenceId,
    hostAssessment,
    question,
    options,
    signal,
  } = {}) {
    if (hostAssessment?.kind !== "layout"
      || hostAssessment?.requiresVisualUnderstanding !== true
      || hostAssessment?.evidenceConsistency !== "ambiguous") {
      throw llmBoundaryError(
        "llm.visual_not_required",
        "The Host did not declare a genuine unresolved layout ambiguity.",
      );
    }
    const normalizedOptions = normalizeVisualOptions(options);
    const output = await this.#request({
      kind: "resolve-visual-ambiguity",
      input: {
        sceneId: requiredString(sceneId, "llm.invalid_visual_input"),
        observationVersion: nonNegativeInteger(observationVersion, "llm.invalid_visual_input"),
        visualEvidenceId: requiredString(visualEvidenceId, "llm.invalid_visual_input"),
        question: requiredString(question, "llm.invalid_visual_input"),
        hostAssessment: Object.freeze({
          kind: "layout",
          requiresVisualUnderstanding: true,
          evidenceConsistency: "ambiguous",
        }),
        options: normalizedOptions,
      },
      outputSchema: objectSchema({
        optionId: {
          type: "string",
          enum: normalizedOptions.map((option) => option.optionId),
        },
      }, ["optionId"]),
      signal,
    });
    assertExactOutput(output, ["optionId"]);
    const optionId = requiredString(output.optionId, "llm.output_contract_violation");
    if (!normalizedOptions.some((option) => option.optionId === optionId)) {
      throw llmBoundaryError(
        "llm.visual_unknown_option",
        "The model selected an id outside the current Host layout options.",
      );
    }
    return Object.freeze({ optionId });
  }

  async decideFailure({ failure, canReobserve = false, signal } = {}) {
    const normalizedFailure = normalizeFailure(failure);
    const allowedDecisions = canReobserve === true ? ["reobserve", "report"] : ["report"];
    const output = await this.#request({
      kind: "decide-failure",
      input: {
        failure: normalizedFailure,
        canReobserve: canReobserve === true,
        allowedDecisions,
      },
      outputSchema: objectSchema({
        decision: { type: "string", enum: allowedDecisions },
      }, ["decision"]),
      signal,
    });
    assertExactOutput(output, ["decision"]);
    if (!FAILURE_DECISIONS.has(output.decision)) {
      throw llmBoundaryError(
        "llm.output_contract_violation",
        "The model returned a failure operation outside reobserve/report.",
      );
    }
    if (output.decision === "reobserve" && canReobserve !== true) {
      throw llmBoundaryError(
        "llm.reobserve_not_allowed",
        "The model requested another observation when the Host disallowed it.",
      );
    }
    return Object.freeze({ decision: output.decision });
  }

  async #request({ kind, input, outputSchema, signal }) {
    if (!BOUNDED_LLM_DECISION_KINDS.includes(kind)) {
      throw llmBoundaryError("llm.invalid_decision_kind", `Unsupported LLM decision kind: ${kind}`);
    }
    if (signal?.aborted) {
      throw llmBoundaryError("llm.decision_cancelled", `The ${kind} decision was cancelled.`);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.("abort", onAbort, { once: true });
    const request = Object.freeze({
      kind,
      authority: "semantic-decision-only",
      input: deepFreeze(input),
      outputSchema: deepFreeze(outputSchema),
    });

    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = llmBoundaryError(
          "llm.decision_timeout",
          `The ${kind} decision exceeded ${this.#timeoutMs} ms.`,
        );
        reject(error);
        controller.abort(error);
      }, this.#timeoutMs);
      timer.unref?.();
    });

    try {
      const output = await Promise.race([
        Promise.resolve().then(() => this.#complete({ ...request, signal: controller.signal })),
        timeout,
      ]);
      if (!isRecord(output)) {
        throw llmBoundaryError(
          "llm.output_contract_violation",
          "The model must return one structured decision object.",
        );
      }
      return output;
    } catch (error) {
      if (signal?.aborted && error?.code !== "llm.decision_timeout") {
        throw llmBoundaryError("llm.decision_cancelled", `The ${kind} decision was cancelled.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 50) {
    throw llmBoundaryError(
      "llm.invalid_selection_input",
      "Candidate selection requires one to fifty Host candidates.",
    );
  }
  const ids = new Set();
  return Object.freeze(candidates.map((candidate) => {
    const candidateId = requiredString(candidate?.candidateId, "llm.invalid_selection_input");
    if (ids.has(candidateId)) {
      throw llmBoundaryError("llm.invalid_selection_input", "Host candidate ids must be unique.");
    }
    ids.add(candidateId);
    const evidenceSources = uniqueStrings(candidate?.evidenceSources);
    if (evidenceSources.length === 0) {
      throw llmBoundaryError(
        "llm.invalid_selection_input",
        "Every Host candidate requires at least one evidence source.",
      );
    }
    return Object.freeze({
      candidateId,
      label: requiredString(candidate?.label, "llm.invalid_selection_input"),
      role: requiredString(candidate?.role, "llm.invalid_selection_input"),
      parentRole: requiredString(candidate?.parentRole, "llm.invalid_selection_input"),
      evidenceSources: Object.freeze(evidenceSources),
    });
  }));
}

function normalizeVisualOptions(options) {
  if (!Array.isArray(options) || options.length === 0 || options.length > 20) {
    throw llmBoundaryError(
      "llm.invalid_visual_input",
      "Visual ambiguity requires one to twenty Host-owned options.",
    );
  }
  const ids = new Set();
  return Object.freeze(options.map((option) => {
    const optionId = requiredString(option?.optionId, "llm.invalid_visual_input");
    if (ids.has(optionId)) {
      throw llmBoundaryError("llm.invalid_visual_input", "Visual option ids must be unique.");
    }
    ids.add(optionId);
    return Object.freeze({
      optionId,
      role: requiredString(option?.role, "llm.invalid_visual_input"),
      parentRole: requiredString(option?.parentRole, "llm.invalid_visual_input"),
      ...(typeof option?.label === "string" && option.label.trim()
        ? { label: option.label.trim() }
        : {}),
    });
  }));
}

function normalizeFailure(failure) {
  if (!isRecord(failure)) {
    throw llmBoundaryError("llm.invalid_failure_input", "A structured Host failure is required.");
  }
  const outcome = requiredString(failure.outcome, "llm.invalid_failure_input");
  if (!["committed", "not-applied", "indeterminate"].includes(outcome)) {
    throw llmBoundaryError("llm.invalid_failure_input", "The failure outcome is not canonical.");
  }
  return Object.freeze({
    code: requiredString(failure.code, "llm.invalid_failure_input"),
    step: requiredString(failure.step, "llm.invalid_failure_input"),
    outcome,
  });
}

function assertExactOutput(output, allowedKeys) {
  const allowed = new Set(allowedKeys);
  if (Object.keys(output).some((key) => !allowed.has(key))) {
    throw llmBoundaryError(
      "llm.output_contract_violation",
      "The model returned fields outside its bounded decision contract.",
    );
  }
}

function objectSchema(properties, required) {
  return {
    type: "object",
    required,
    properties,
    additionalProperties: false,
  };
}

function nonEmptyStringSchema() {
  return { type: "string", minLength: 1 };
}

function requiredString(value, code, { trim = true } = {}) {
  if (typeof value !== "string") throw llmBoundaryError(code, "A non-empty string is required.");
  const normalized = trim ? value.trim() : value;
  if (normalized.length === 0) throw llmBoundaryError(code, "A non-empty string is required.");
  return normalized;
}

function nonNegativeInteger(value, code) {
  if (!Number.isInteger(value) || value < 0) {
    throw llmBoundaryError(code, "A non-negative observation version is required.");
  }
  return value;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function llmBoundaryError(code, message) {
  const error = new Error(message);
  error.name = "BoundedLlmInteractionError";
  error.code = code;
  return error;
}
