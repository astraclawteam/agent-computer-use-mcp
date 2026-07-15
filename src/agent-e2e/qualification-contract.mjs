import { createHash } from "node:crypto";

export const QUALIFICATION_LANES = Object.freeze([
  "codex",
  "claude-desktop",
  "xiaozhi-deepseek-v4-flash",
  "xiaozhi-claude-sonnet-5",
]);

export const FAILURE_CLASSES = Object.freeze([
  "infrastructure-failure",
  "agent-decision-failure",
  "perception-failure",
  "action-failure",
  "verification-failure",
  "policy-blocked",
  "cleanup-failure",
]);

export const REQUIRED_SUCCESSES = 3;
export const INFRASTRUCTURE_RETRY_LIMIT = 1;

const TASK_FIELDS = new Set([
  "schemaVersion",
  "taskId",
  "goal",
  "environmentAdapterId",
  "scope",
  "verifierId",
  "expectedInvariant",
  "timeoutMs",
  "privacyPolicy",
  "approvalPolicy",
  "initialStateSeed",
]);

const FORBIDDEN_GUIDANCE_FIELDS = new Set([
  "actionsequence",
  "coordinates",
  "dialoginstructions",
  "elementid",
  "elementname",
  "hostpromptsuffix",
  "menupath",
  "selector",
  "targetlabel",
  "toolsequence",
]);

export function validateQualificationTask(value) {
  assertRecord(value, "agent_e2e.task_invalid");
  for (const key of Object.keys(value)) {
    if (!TASK_FIELDS.has(key)) throw contractError("agent_e2e.task_field_forbidden", key);
  }
  rejectActionGuidance(value);
  if (value.schemaVersion !== 1) throw contractError("agent_e2e.task_schema_invalid");
  assertIdentifier(value.taskId, "agent_e2e.task_id_invalid");
  assertText(value.goal, "agent_e2e.task_goal_invalid");
  assertIdentifier(value.environmentAdapterId, "agent_e2e.task_adapter_invalid");
  assertRecord(value.scope, "agent_e2e.task_scope_invalid");
  if (value.scope.temporaryWorkspaceOnly !== true) throw contractError("agent_e2e.task_scope_invalid");
  assertIdentifier(value.verifierId, "agent_e2e.task_verifier_invalid");
  assertRecord(value.expectedInvariant, "agent_e2e.task_invariant_invalid");
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000) {
    throw contractError("agent_e2e.task_timeout_invalid");
  }
  assertRecord(value.privacyPolicy, "agent_e2e.task_privacy_invalid");
  if (value.privacyPolicy.syntheticDataOnly !== true
    || value.privacyPolicy.sealScreenshots !== false
    || value.privacyPolicy.sealRawOcr !== false) {
    throw contractError("agent_e2e.task_privacy_invalid");
  }
  assertRecord(value.approvalPolicy, "agent_e2e.task_approval_invalid");
  assertIdentifier(value.initialStateSeed, "agent_e2e.task_seed_invalid");

  const normalized = structuredClone(value);
  normalized.promptSha256 = sha256(canonicalPrompt(normalized));
  return deepFreeze(normalized);
}

export function canonicalPrompt(task) {
  assertText(task?.goal, "agent_e2e.task_goal_invalid");
  return Buffer.from(task.goal, "utf8");
}

function rejectActionGuidance(value, path = "task") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectActionGuidance(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_GUIDANCE_FIELDS.has(normalized)) {
      throw contractError("agent_e2e.task_field_forbidden", `${path}.${key}`);
    }
    rejectActionGuidance(child, `${path}.${key}`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertRecord(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw contractError(code);
}

function assertIdentifier(value, code) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) throw contractError(code);
}

function assertText(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw contractError(code);
}

function contractError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
