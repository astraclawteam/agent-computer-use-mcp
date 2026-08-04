import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  PHASE_6_ACCEPTANCE_LEVELS,
  Phase6StagedAcceptanceCampaign,
} from "./phase-6-staged-acceptance.mjs";

const EVIDENCE_KIND = "real-windows-phase6";
const SCHEMA_VERSION = 1;
const PRODUCTION_ROOTS = Object.freeze([
  "gateway-overlay",
  "ocr-sidecar",
  "src",
]);
const PRODUCTION_FILES = Object.freeze(["package-lock.json", "package.json"]);
const RECEIPT_KEYS = new Set([
  "toolName",
  "outcome",
  "released",
  "elapsedMs",
  "toolErrorCount",
  "wrongSendCount",
  "terminalControllerState",
  "stepStatuses",
]);
const ENVIRONMENT_KEYS = new Set([
  "appKind",
  "launchState",
  "contactMatch",
  "hostSceneDriven",
  "realWindowsExecution",
  "expectedOutcomeVerified",
  "uncertainActionReplayCount",
  "auxiliaryWindowCount",
  "consecutiveSessionCount",
  "stopVerified",
  "postStopActionCount",
  "faultInjectionVerified",
  "newSessionAcquireVerified",
  "connectorRestartClean",
]);
const STEP_NAMES = new Set([
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
  "navigate",
  "edit",
  "verify",
  "stop",
  "fault-injection",
  "restart",
]);

export function createPhase6AttemptEvidence({ runId, levelId, receipt, environment }) {
  assertIdentifier(runId, "phase6.evidence_run_id_invalid");
  if (!PHASE_6_ACCEPTANCE_LEVELS.some((level) => level.id === levelId)) {
    throw evidenceError("phase6.evidence_level_invalid");
  }
  assertExactKeys(receipt, RECEIPT_KEYS, "phase6.evidence_receipt_invalid");
  assertExactKeys(environment, ENVIRONMENT_KEYS, "phase6.evidence_environment_invalid");
  if (!["computer.message", "computer.task"].includes(receipt.toolName)
    || !["committed", "not-applied", "indeterminate"].includes(receipt.outcome)
    || receipt.released !== true
    || !Number.isFinite(receipt.elapsedMs)
    || receipt.elapsedMs < 0
    || !Number.isInteger(receipt.toolErrorCount)
    || !Number.isInteger(receipt.wrongSendCount)
    || receipt.terminalControllerState !== "idle"
    || !Array.isArray(receipt.stepStatuses)
    || receipt.stepStatuses.length === 0) {
    throw evidenceError("phase6.evidence_receipt_invalid");
  }
  for (const step of receipt.stepStatuses) {
    assertExactKeys(step, new Set(["step", "status"]), "phase6.evidence_step_invalid");
    if (!STEP_NAMES.has(step.step)
      || !["committed", "not-applied", "indeterminate"].includes(step.status)) {
      throw evidenceError("phase6.evidence_step_invalid");
    }
  }
  assertEnvironment(environment);
  const normalizedReceipt = structuredClone(receipt);
  const normalizedEnvironment = structuredClone(environment);
  const attempt = {
    runId,
    levelId,
    receipt: normalizedReceipt,
    environment: normalizedEnvironment,
  };
  return deepFreeze({
    ...attempt,
    receiptSha256: sha256(stableStringify(attempt)),
  });
}

export function sealPhase6ReleaseEvidence({ sourceIdentity, attempts, sealedAt }) {
  assertSourceIdentity(sourceIdentity);
  if (!Array.isArray(attempts) || attempts.length !== 70) {
    throw evidenceError("phase6.evidence_attempt_count_invalid");
  }
  const normalizedAttempts = attempts.map((attempt) => validateAttemptEvidence(attempt));
  const body = {
    schemaVersion: SCHEMA_VERSION,
    evidenceKind: EVIDENCE_KIND,
    sourceIdentity: structuredClone(sourceIdentity),
    sealedAt: normalizeTimestamp(sealedAt),
    attempts: normalizedAttempts,
  };
  const gate = evaluateAttemptGate(normalizedAttempts);
  if (!gate.passed) throw evidenceError("phase6.evidence_gate_failed", gate.violation);
  return deepFreeze({ ...body, sealSha256: sha256(stableStringify(body)) });
}

export function verifyPhase6ReleaseEvidence(manifest, { sourceIdentity } = {}) {
  try {
    assertExactKeys(manifest, new Set([
      "schemaVersion",
      "evidenceKind",
      "sourceIdentity",
      "sealedAt",
      "attempts",
      "sealSha256",
    ]), "phase6.evidence_manifest_invalid");
    if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.evidenceKind !== EVIDENCE_KIND) {
      throw evidenceError("phase6.evidence_manifest_invalid");
    }
    assertSourceIdentity(manifest.sourceIdentity);
    normalizeTimestamp(manifest.sealedAt);
    if (!Array.isArray(manifest.attempts) || manifest.attempts.length !== 70) {
      throw evidenceError("phase6.evidence_attempt_count_invalid");
    }
    const attempts = manifest.attempts.map((attempt) => validateAttemptEvidence(attempt));
    const body = {
      schemaVersion: manifest.schemaVersion,
      evidenceKind: manifest.evidenceKind,
      sourceIdentity: manifest.sourceIdentity,
      sealedAt: manifest.sealedAt,
      attempts,
    };
    if (manifest.sealSha256 !== sha256(stableStringify(body))) {
      throw evidenceError("phase6.evidence_seal_mismatch");
    }
    if (sourceIdentity && stableStringify(sourceIdentity) !== stableStringify(manifest.sourceIdentity)) {
      throw evidenceError("phase6.evidence_source_mismatch");
    }
    const gate = evaluateAttemptGate(attempts);
    if (!gate.passed) throw evidenceError("phase6.evidence_gate_failed", gate.violation);
    return deepFreeze({
      status: "passed",
      candidateArtifactAllowed: true,
      sourceIdentity: structuredClone(manifest.sourceIdentity),
      attemptCount: attempts.length,
      qualifiedLevelIds: PHASE_6_ACCEPTANCE_LEVELS.map((level) => level.id),
      sealSha256: manifest.sealSha256,
    });
  } catch (error) {
    return deepFreeze({
      status: "failed",
      candidateArtifactAllowed: false,
      violation: error?.code ?? "phase6.evidence_invalid",
    });
  }
}

export async function computePhase6SourceIdentity(root = ".") {
  const absoluteRoot = resolve(root);
  const paths = [];
  for (const directory of PRODUCTION_ROOTS) {
    paths.push(...await listFiles(resolve(absoluteRoot, directory), absoluteRoot));
  }
  for (const file of PRODUCTION_FILES) paths.push(file);
  paths.sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const path of paths) {
    const bytes = await readFile(resolve(absoluteRoot, path));
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return deepFreeze({
    algorithm: "sha256",
    productionFileCount: paths.length,
    productionContentSha256: hash.digest("hex"),
  });
}

function validateAttemptEvidence(attempt) {
  assertExactKeys(attempt, new Set([
    "runId", "levelId", "receipt", "environment", "receiptSha256",
  ]), "phase6.evidence_attempt_invalid");
  const normalized = createPhase6AttemptEvidence(attempt);
  if (attempt.receiptSha256 !== normalized.receiptSha256) {
    throw evidenceError("phase6.evidence_receipt_hash_mismatch");
  }
  return structuredClone(normalized);
}

function evaluateAttemptGate(attempts) {
  const campaign = new Phase6StagedAcceptanceCampaign();
  try {
    for (const attempt of attempts) campaign.record(toCampaignAttempt(attempt));
  } catch (error) {
    return { passed: false, violation: error?.code ?? "phase6.evidence_attempt_invalid" };
  }
  const snapshot = campaign.snapshot;
  return {
    passed: snapshot.status === "passed"
      && snapshot.candidateArtifactAllowed === true
      && snapshot.totalRecordedAttempts === 70,
    violation: snapshot.status === "passed" ? null : "phase6.evidence_campaign_incomplete",
  };
}

function toCampaignAttempt(attempt) {
  const { receipt, environment } = attempt;
  return {
    runId: attempt.runId,
    levelId: attempt.levelId,
    realWindowsExecution: environment.realWindowsExecution,
    hostSceneDriven: environment.hostSceneDriven,
    appKind: environment.appKind,
    launchState: environment.launchState,
    contactMatch: environment.contactMatch,
    durationMs: receipt.elapsedMs,
    toolErrorCount: receipt.toolErrorCount,
    misSendCount: receipt.wrongSendCount,
    terminalReleased: receipt.released,
    terminalControllerState: receipt.terminalControllerState,
    stepOrderValid: stepOrderValid(receipt.stepStatuses),
    uncertainActionReplayCount: environment.uncertainActionReplayCount,
    expectedOutcomeVerified: environment.expectedOutcomeVerified,
    privatePayloadRetained: false,
    candidateArtifactGenerated: false,
    auxiliaryWindowCount: environment.auxiliaryWindowCount,
    consecutiveSessionCount: environment.consecutiveSessionCount,
    stopVerified: environment.stopVerified,
    postStopActionCount: environment.postStopActionCount,
    faultInjectionVerified: environment.faultInjectionVerified,
    newSessionAcquireVerified: environment.newSessionAcquireVerified,
    connectorRestartClean: environment.connectorRestartClean,
  };
}

function stepOrderValid(steps) {
  const names = steps.map((entry) => entry.step);
  if (steps.some((entry) => entry.status === "indeterminate")) return false;
  const messaging = [
    "restore-main-window", "focus-search", "enter-query", "wait-results-stable",
    "select-result", "verify-conversation-title", "focus-message-editor",
    "enter-message", "send", "verify-new-bubble", "release",
  ];
  const observedMessaging = names.filter((name) => messaging.includes(name));
  return observedMessaging.length === 0
    ? names.at(-1) === "release" || names.includes("verify")
    : observedMessaging.every((name, index) => messaging.indexOf(name)
      > (index === 0 ? -1 : messaging.indexOf(observedMessaging[index - 1])))
      && observedMessaging.at(-1) === "release";
}

function assertEnvironment(environment) {
  if (!["wechat", "other-windows"].includes(environment.appKind)
    || !["foreground", "tray", "multi-window"].includes(environment.launchState)
    || !["full", "fuzzy", "none"].includes(environment.contactMatch)
    || environment.hostSceneDriven !== true
    || environment.realWindowsExecution !== true
    || environment.expectedOutcomeVerified !== true
    || !nonNegativeInteger(environment.uncertainActionReplayCount)
    || !nonNegativeInteger(environment.auxiliaryWindowCount)
    || !positiveInteger(environment.consecutiveSessionCount)
    || typeof environment.stopVerified !== "boolean"
    || !nonNegativeInteger(environment.postStopActionCount)
    || typeof environment.faultInjectionVerified !== "boolean"
    || typeof environment.newSessionAcquireVerified !== "boolean"
    || typeof environment.connectorRestartClean !== "boolean") {
    throw evidenceError("phase6.evidence_environment_invalid");
  }
}

function assertSourceIdentity(identity) {
  assertExactKeys(identity, new Set([
    "algorithm", "productionFileCount", "productionContentSha256",
  ]), "phase6.evidence_source_invalid");
  if (identity.algorithm !== "sha256"
    || !positiveInteger(identity.productionFileCount)
    || !/^[a-f0-9]{64}$/u.test(identity.productionContentSha256 ?? "")) {
    throw evidenceError("phase6.evidence_source_invalid");
  }
}

async function listFiles(directory, root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listFiles(path, root));
    else if (entry.isFile()) paths.push(relative(root, path));
    else throw evidenceError("phase6.evidence_source_file_type_invalid");
  }
  return paths;
}

function assertExactKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw evidenceError(code);
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) throw evidenceError(code);
}

function assertIdentifier(value, code) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) {
    throw evidenceError(code);
  }
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
    throw evidenceError("phase6.evidence_timestamp_invalid");
  }
  return new Date(timestamp).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function evidenceError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

export const PHASE_6_RELEASE_EVIDENCE_PATH = "release-evidence/phase-6.json";
