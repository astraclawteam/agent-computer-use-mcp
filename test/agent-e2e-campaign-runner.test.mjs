import assert from "node:assert/strict";
import test from "node:test";

import { QUALIFICATION_LANES } from "../src/agent-e2e/qualification-contract.mjs";
import { runQualificationCampaign } from "../src/agent-e2e/campaign-runner.mjs";

test("campaign schedules three fresh successful attempts in all four lanes", async () => {
  const seen = [];
  const report = await runQualificationCampaign({
    campaignId: "campaign-1",
    tasks: [task()],
    executeAttempt: async (attempt) => {
      seen.push(attempt);
      return pass(attempt);
    },
    idFactory: sequentialIds(),
  });

  assert.equal(report.status, "passed");
  assert.equal(report.attempts.length, 12);
  assert.deepEqual([...new Set(report.attempts.map((entry) => entry.lane))], QUALIFICATION_LANES);
  assert.equal(new Set(report.attempts.map((entry) => entry.sessionId)).size, 12);
  assert.equal(new Set(report.attempts.map((entry) => entry.workspaceId)).size, 12);
  assert.equal(new Set(report.attempts.map((entry) => entry.profileId)).size, 12);
  for (const lane of QUALIFICATION_LANES) {
    assert.deepEqual(report.attempts.filter((entry) => entry.lane === lane).map((entry) => entry.repetition), [1, 2, 3]);
  }
});

test("campaign retries one infrastructure failure and retains both records", async () => {
  let first = true;
  const report = await runQualificationCampaign({
    campaignId: "campaign-1",
    tasks: [task()],
    executeAttempt: async (attempt) => {
      if (first) {
        first = false;
        return fail(attempt, "infrastructure-failure");
      }
      return pass(attempt);
    },
    idFactory: sequentialIds(),
  });

  assert.equal(report.status, "passed");
  assert.equal(report.attempts.length, 13);
  assert.deepEqual(report.attempts.slice(0, 2).map((entry) => [entry.repetition, entry.retry, entry.status]), [
    [1, 0, "failed"],
    [1, 1, "passed"],
  ]);
  assert.notEqual(report.attempts[0].runId, report.attempts[1].runId);
});

test("campaign never retries a product qualification failure", async () => {
  for (const failureClass of [
    "agent-decision-failure",
    "perception-failure",
    "action-failure",
    "verification-failure",
    "policy-blocked",
    "cleanup-failure",
  ]) {
    const report = await runQualificationCampaign({
      campaignId: `campaign-${failureClass}`,
      tasks: [task()],
      executeAttempt: async (attempt) => fail(attempt, failureClass),
      idFactory: sequentialIds(),
    });
    assert.equal(report.status, "failed");
    assert.equal(report.attempts.length, 1);
    assert.equal(report.attempts[0].retry, 0);
  }
});

test("campaign stops after the single infrastructure retry fails", async () => {
  const report = await runQualificationCampaign({
    campaignId: "campaign-1",
    tasks: [task()],
    executeAttempt: async (attempt) => fail(attempt, "infrastructure-failure"),
    idFactory: sequentialIds(),
  });
  assert.equal(report.status, "failed");
  assert.equal(report.attempts.length, 2);
  assert.deepEqual(report.attempts.map((entry) => entry.retry), [0, 1]);
});

function task() {
  return {
    taskId: "text-save-001",
    promptSha256: "c".repeat(64),
    initialStateSeed: "seed",
  };
}

function pass(attempt) {
  return { ...attempt, status: "passed", failureClass: null, evidenceKind: "real-agent-e2e" };
}

function fail(attempt, failureClass) {
  return { ...attempt, status: "failed", failureClass, evidenceKind: "real-agent-e2e" };
}

function sequentialIds() {
  let value = 0;
  return (kind) => `${kind}-${++value}`;
}
