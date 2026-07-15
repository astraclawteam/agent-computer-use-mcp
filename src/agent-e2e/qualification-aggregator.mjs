import { FAILURE_CLASSES, QUALIFICATION_LANES, REQUIRED_SUCCESSES } from "./qualification-contract.mjs";

export function evaluateAgentE2eQualification(campaign = {}) {
  const violations = [];
  const tasks = Array.isArray(campaign.tasks) ? campaign.tasks : [];
  const attempts = Array.isArray(campaign.attempts) ? campaign.attempts : [];
  if (tasks.length === 0) violations.push({ code: "agent_e2e.tasks_missing" });

  const runIds = new Set();

  for (const attempt of attempts) {
    if (runIds.has(attempt.runId)) violations.push({ code: "agent_e2e.run_id_duplicate", runId: attempt.runId });
    else runIds.add(attempt.runId);
    if (!QUALIFICATION_LANES.includes(attempt.lane)) {
      violations.push({ code: "agent_e2e.lane_invalid", runId: attempt.runId, lane: attempt.lane });
    }
    if ((attempt.status === "passed" && attempt.failureClass !== null)
      || (attempt.status === "failed" && !FAILURE_CLASSES.includes(attempt.failureClass))
      || !["passed", "failed"].includes(attempt.status)) {
      violations.push({ code: "agent_e2e.attempt_state_invalid", runId: attempt.runId });
    }
    if (attempt.evidenceKind !== "real-agent-e2e") {
      violations.push({ code: "agent_e2e.evidence_kind_invalid", runId: attempt.runId });
    }
    if (!sameIdentity(attempt.candidateIdentity, campaign.candidateIdentity)) {
      violations.push({ code: "agent_e2e.candidate_identity_mismatch", runId: attempt.runId });
    }
    const task = tasks.find((entry) => entry.taskId === attempt.taskId);
    if (!task || attempt.promptSha256 !== task.promptSha256) {
      violations.push({ code: "agent_e2e.prompt_identity_mismatch", runId: attempt.runId });
    }
    if (attempt.status === "failed" && attempt.failureClass !== "infrastructure-failure") {
      violations.push({ code: "agent_e2e.product_failure_present", runId: attempt.runId, failureClass: attempt.failureClass });
    }
  }

  let successCount = 0;
  for (const task of tasks) {
    for (const lane of QUALIFICATION_LANES) {
      for (let repetition = 1; repetition <= REQUIRED_SUCCESSES; repetition += 1) {
        const group = attempts.filter((entry) => entry.taskId === task.taskId
          && entry.lane === lane && entry.repetition === repetition);
        const passed = group.filter((entry) => entry.status === "passed");
        if (passed.length !== 1) {
          violations.push({ code: "agent_e2e.repetition_missing", taskId: task.taskId, lane, repetition });
        } else {
          successCount += 1;
        }
        for (const failure of group.filter((entry) => entry.failureClass === "infrastructure-failure")) {
          const replacement = passed.find((entry) => entry.retry === failure.retry + 1);
          if (!replacement || failure.retry !== 0 || group.filter((entry) => entry.failureClass === "infrastructure-failure").length > 1) {
            violations.push({ code: "agent_e2e.infrastructure_retry_invalid", runId: failure.runId });
          }
        }
      }
    }
  }

  const unique = deduplicateViolations(violations);
  const agentE2eEligible = unique.length === 0;
  return deepFreeze({
    schemaVersion: 1,
    status: agentE2eEligible ? "passed" : "failed",
    benchmark: "agent-e2e-qualification",
    agentE2eEligible,
    successCount,
    attemptsRetained: attempts.length,
    violations: unique,
  });
}

function deduplicateViolations(violations) {
  const seen = new Set();
  return violations.filter((entry) => {
    const key = stableStringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameIdentity(actual, expected) {
  return stableStringify(actual) === stableStringify(expected);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
