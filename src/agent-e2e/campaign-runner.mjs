import { randomUUID } from "node:crypto";

import {
  INFRASTRUCTURE_RETRY_LIMIT,
  QUALIFICATION_LANES,
  REQUIRED_SUCCESSES,
} from "./qualification-contract.mjs";

export async function runQualificationCampaign(options = {}) {
  const campaignId = requiredString(options.campaignId, "agent_e2e.campaign_id_required");
  if (!Array.isArray(options.tasks) || options.tasks.length === 0) throw campaignError("agent_e2e.tasks_required");
  if (typeof options.executeAttempt !== "function") throw campaignError("agent_e2e.attempt_executor_required");
  const idFactory = options.idFactory ?? ((kind) => `${kind}-${randomUUID()}`);
  const attempts = [];

  for (const task of options.tasks) {
    requiredString(task?.taskId, "agent_e2e.task_id_required");
    for (const lane of QUALIFICATION_LANES) {
      for (let repetition = 1; repetition <= REQUIRED_SUCCESSES; repetition += 1) {
        let completed = false;
        for (let retry = 0; retry <= INFRASTRUCTURE_RETRY_LIMIT; retry += 1) {
          const identity = createAttemptIdentity({ campaignId, task, lane, repetition, retry, idFactory });
          const record = await execute(options.executeAttempt, identity);
          attempts.push(record);
          if (record.status === "passed") {
            completed = true;
            break;
          }
          if (record.failureClass !== "infrastructure-failure") {
            return campaignReport("failed", campaignId, options.tasks, attempts);
          }
        }
        if (!completed) return campaignReport("failed", campaignId, options.tasks, attempts);
      }
    }
  }
  return campaignReport("passed", campaignId, options.tasks, attempts);
}

function createAttemptIdentity({ campaignId, task, lane, repetition, retry, idFactory }) {
  return Object.freeze({
    campaignId,
    taskId: task.taskId,
    lane,
    repetition,
    retry,
    runId: idFactory("run"),
    sessionId: idFactory("session"),
    workspaceId: idFactory("workspace"),
    profileId: idFactory("profile"),
    initialStateSeed: `${task.initialStateSeed}:${repetition}`,
    promptSha256: task.promptSha256,
  });
}

async function execute(executeAttempt, identity) {
  try {
    const result = await executeAttempt(identity);
    if (result?.status !== "passed" && result?.status !== "failed") {
      return Object.freeze({ ...identity, status: "failed", failureClass: "infrastructure-failure", reason: "agent_e2e.attempt_result_invalid" });
    }
    return deepFreeze({ ...identity, ...result });
  } catch (error) {
    return Object.freeze({
      ...identity,
      status: "failed",
      failureClass: "infrastructure-failure",
      reason: typeof error?.code === "string" ? error.code : "agent_e2e.attempt_executor_failed",
    });
  }
}

function campaignReport(status, campaignId, tasks, attempts) {
  return deepFreeze({
    schemaVersion: 1,
    status,
    campaignId,
    tasks: structuredClone(tasks),
    attempts: structuredClone(attempts),
  });
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw campaignError(code);
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function campaignError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
