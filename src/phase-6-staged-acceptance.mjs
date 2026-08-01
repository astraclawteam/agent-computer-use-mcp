const REQUIRED_CONSECUTIVE_PASSES = 10;
const MAX_ATTEMPT_DURATION_MS = 60_000;

export const PHASE_6_ACCEPTANCE_LEVELS = Object.freeze([
  Object.freeze({
    id: "wechat-foreground-full-contact",
    ordinal: 1,
    appKind: "wechat",
    launchState: "foreground",
    contactMatch: "full",
  }),
  Object.freeze({
    id: "wechat-foreground-fuzzy-contact",
    ordinal: 2,
    appKind: "wechat",
    launchState: "foreground",
    contactMatch: "fuzzy",
  }),
  Object.freeze({
    id: "wechat-tray-fuzzy-contact",
    ordinal: 3,
    appKind: "wechat",
    launchState: "tray",
    contactMatch: "fuzzy",
  }),
  Object.freeze({
    id: "wechat-multi-window-fuzzy-contact",
    ordinal: 4,
    appKind: "wechat",
    launchState: "multi-window",
    contactMatch: "fuzzy",
  }),
  Object.freeze({
    id: "wechat-consecutive-sessions",
    ordinal: 5,
    appKind: "wechat",
    launchState: "any",
    contactMatch: "any",
  }),
  Object.freeze({
    id: "stop-and-fault-injection",
    ordinal: 6,
    appKind: "wechat",
    launchState: "any",
    contactMatch: "any",
  }),
  Object.freeze({
    id: "other-windows-app",
    ordinal: 7,
    appKind: "other-windows",
    launchState: "any",
    contactMatch: "none",
  }),
]);

const LEVEL_BY_ID = new Map(PHASE_6_ACCEPTANCE_LEVELS.map((level) => [level.id, level]));
const ALLOWED_ATTEMPT_KEYS = new Set([
  "runId",
  "levelId",
  "realWindowsExecution",
  "hostSceneDriven",
  "appKind",
  "launchState",
  "contactMatch",
  "durationMs",
  "toolErrorCount",
  "misSendCount",
  "terminalReleased",
  "terminalControllerState",
  "stepOrderValid",
  "uncertainActionReplayCount",
  "expectedOutcomeVerified",
  "privatePayloadRetained",
  "candidateArtifactGenerated",
  "auxiliaryWindowCount",
  "consecutiveSessionCount",
  "stopVerified",
  "postStopActionCount",
  "faultInjectionVerified",
  "newSessionAcquireVerified",
  "connectorRestartClean",
]);

export class Phase6StagedAcceptanceCampaign {
  #attempts = [];
  #qualifiedLevels = [];
  #runIds = new Set();
  #streak = 0;

  get snapshot() {
    const activeLevel = PHASE_6_ACCEPTANCE_LEVELS[this.#qualifiedLevels.length] ?? null;
    return Object.freeze({
      status: activeLevel ? "running" : "passed",
      activeLevelId: activeLevel?.id ?? null,
      activeLevelOrdinal: activeLevel?.ordinal ?? null,
      currentStreak: activeLevel ? this.#streak : REQUIRED_CONSECUTIVE_PASSES,
      requiredConsecutivePasses: REQUIRED_CONSECUTIVE_PASSES,
      qualifiedLevelIds: Object.freeze([...this.#qualifiedLevels]),
      totalRecordedAttempts: this.#attempts.length,
      candidateArtifactAllowed: activeLevel === null,
      attempts: Object.freeze(this.#attempts.map((attempt) => Object.freeze({ ...attempt }))),
    });
  }

  record(attempt) {
    const activeLevel = PHASE_6_ACCEPTANCE_LEVELS[this.#qualifiedLevels.length];
    if (!activeLevel) {
      throw phase6Error("phase6.campaign_complete", "The Phase 6 campaign is already complete.");
    }
    validateAttemptEnvelope(attempt);
    if (attempt.levelId !== activeLevel.id) {
      throw phase6Error(
        "phase6.level_out_of_order",
        `Expected ${activeLevel.id}; received ${String(attempt.levelId)}.`,
      );
    }
    if (this.#runIds.has(attempt.runId)) {
      throw phase6Error("phase6.duplicate_run_id", `Duplicate Phase 6 run id: ${attempt.runId}.`);
    }

    const evaluation = evaluatePhase6Attempt(attempt, activeLevel);
    const retained = Object.freeze({
      runId: attempt.runId,
      levelId: attempt.levelId,
      passed: evaluation.passed,
      violations: Object.freeze([...evaluation.violations]),
      durationMs: attempt.durationMs,
      toolErrorCount: attempt.toolErrorCount,
      misSendCount: attempt.misSendCount,
      terminalReleased: attempt.terminalReleased,
    });
    this.#runIds.add(attempt.runId);
    this.#attempts.push(retained);

    if (!evaluation.passed) {
      this.#streak = 0;
      return Object.freeze({ ...retained, currentStreak: 0, levelQualified: false });
    }

    this.#streak += 1;
    const levelQualified = this.#streak === REQUIRED_CONSECUTIVE_PASSES;
    if (levelQualified) {
      this.#qualifiedLevels.push(activeLevel.id);
      this.#streak = 0;
    }
    return Object.freeze({
      ...retained,
      currentStreak: levelQualified ? REQUIRED_CONSECUTIVE_PASSES : this.#streak,
      levelQualified,
    });
  }
}

export function evaluatePhase6Attempt(attempt, expectedLevel = LEVEL_BY_ID.get(attempt?.levelId)) {
  validateAttemptEnvelope(attempt);
  if (!expectedLevel || expectedLevel.id !== attempt.levelId) {
    throw phase6Error("phase6.unknown_level", `Unknown Phase 6 level: ${String(attempt.levelId)}.`);
  }

  const violations = [];
  requireTrue(violations, attempt.realWindowsExecution, "not-real-windows-execution");
  requireTrue(violations, attempt.hostSceneDriven, "not-host-scene-driven");
  requireEqual(violations, attempt.appKind, expectedLevel.appKind, "wrong-app-kind");
  if (expectedLevel.launchState !== "any") {
    requireEqual(violations, attempt.launchState, expectedLevel.launchState, "wrong-launch-state");
  }
  if (expectedLevel.contactMatch !== "any") {
    requireEqual(violations, attempt.contactMatch, expectedLevel.contactMatch, "wrong-contact-match");
  }
  if (!Number.isFinite(attempt.durationMs) || attempt.durationMs < 0
    || attempt.durationMs > MAX_ATTEMPT_DURATION_MS) {
    violations.push("duration-exceeded");
  }
  requireEqual(violations, attempt.toolErrorCount, 0, "tool-error");
  requireEqual(violations, attempt.misSendCount, 0, "mis-send");
  requireTrue(violations, attempt.terminalReleased, "terminal-not-released");
  requireEqual(violations, attempt.terminalControllerState, "idle", "controller-not-idle");
  requireTrue(violations, attempt.stepOrderValid, "invalid-step-order");
  requireEqual(violations, attempt.uncertainActionReplayCount, 0, "uncertain-action-replayed");
  requireTrue(violations, attempt.expectedOutcomeVerified, "outcome-not-verified");
  requireEqual(violations, attempt.privatePayloadRetained, false, "private-payload-retained");
  requireEqual(violations, attempt.candidateArtifactGenerated, false, "candidate-generated-before-gate");

  if (expectedLevel.ordinal === 4 && !(attempt.auxiliaryWindowCount >= 1)) {
    violations.push("auxiliary-window-not-proven");
  }
  if (expectedLevel.ordinal === 5 && !(attempt.consecutiveSessionCount >= 2)) {
    violations.push("consecutive-sessions-not-proven");
  }
  if (expectedLevel.ordinal === 6) {
    requireTrue(violations, attempt.stopVerified, "stop-not-proven");
    requireEqual(violations, attempt.postStopActionCount, 0, "post-stop-action");
    requireTrue(violations, attempt.faultInjectionVerified, "fault-injection-not-proven");
    requireTrue(violations, attempt.newSessionAcquireVerified, "new-session-acquire-not-proven");
    requireTrue(violations, attempt.connectorRestartClean, "connector-restart-not-clean");
  }

  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze(violations) });
}

function validateAttemptEnvelope(attempt) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
    throw phase6Error("phase6.invalid_attempt", "A Phase 6 attempt must be an object.");
  }
  const extraKeys = Object.keys(attempt).filter((key) => !ALLOWED_ATTEMPT_KEYS.has(key));
  if (extraKeys.length > 0) {
    throw phase6Error(
      "phase6.private_or_unknown_evidence",
      `Phase 6 evidence contains unsupported fields: ${extraKeys.sort().join(", ")}.`,
    );
  }
  if (typeof attempt.runId !== "string" || attempt.runId.length === 0) {
    throw phase6Error("phase6.invalid_run_id", "A Phase 6 attempt requires a non-empty run id.");
  }
  if (!LEVEL_BY_ID.has(attempt.levelId)) {
    throw phase6Error("phase6.unknown_level", `Unknown Phase 6 level: ${String(attempt.levelId)}.`);
  }
}

function requireTrue(violations, value, code) {
  if (value !== true) violations.push(code);
}

function requireEqual(violations, value, expected, code) {
  if (value !== expected) violations.push(code);
}

function phase6Error(code, message) {
  return Object.assign(new Error(message), { code });
}

export const PHASE_6_REQUIRED_CONSECUTIVE_PASSES = REQUIRED_CONSECUTIVE_PASSES;
export const PHASE_6_MAX_ATTEMPT_DURATION_MS = MAX_ATTEMPT_DURATION_MS;
