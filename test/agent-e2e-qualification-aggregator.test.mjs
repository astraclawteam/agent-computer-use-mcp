import assert from "node:assert/strict";
import test from "node:test";

import { QUALIFICATION_LANES } from "../src/agent-e2e/qualification-contract.mjs";
import { evaluateAgentE2eQualification } from "../src/agent-e2e/qualification-aggregator.mjs";

test("qualification passes only with 3/3 real attempts in every required lane", () => {
  const report = evaluateAgentE2eQualification(completeCampaign());
  assert.equal(report.status, "passed");
  assert.equal(report.agentE2eEligible, true);
  assert.equal(report.successCount, 12);
});

test("qualification rejects an eleven-of-twelve matrix", () => {
  const campaign = completeCampaign();
  campaign.attempts.pop();
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.agentE2eEligible, false);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.repetition_missing"), true);
});

test("qualification rejects contract-test evidence", () => {
  const campaign = completeCampaign();
  campaign.attempts[0].evidenceKind = "contract-test";
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.agentE2eEligible, false);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.evidence_kind_invalid"), true);
});

test("qualification rejects prompt and candidate identity drift", () => {
  const campaign = completeCampaign();
  campaign.attempts[0].promptSha256 = "f".repeat(64);
  campaign.attempts[1].candidateIdentity = identity("0.0.2");
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.prompt_identity_mismatch"), true);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.candidate_identity_mismatch"), true);
});

test("qualification permits a retained infrastructure failure only when its one retry passed", () => {
  const campaign = completeCampaign();
  const original = campaign.attempts[0];
  campaign.attempts.unshift({
    ...original,
    runId: "infra-original",
    status: "failed",
    failureClass: "infrastructure-failure",
    retry: 0,
  });
  original.retry = 1;
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.agentE2eEligible, true);
  assert.equal(report.attemptsRetained, 13);
});

test("qualification never hides an earlier product failure", () => {
  const campaign = completeCampaign();
  campaign.attempts.unshift({
    ...campaign.attempts[0],
    runId: "failed-original",
    status: "failed",
    failureClass: "perception-failure",
  });
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.agentE2eEligible, false);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.product_failure_present"), true);
});

test("qualification rejects unknown lanes duplicate run IDs and contradictory pass records", () => {
  const campaign = completeCampaign();
  campaign.attempts.push({ ...campaign.attempts[0], lane: "claude-code", runId: "unknown-lane" });
  campaign.attempts[1].runId = campaign.attempts[0].runId;
  campaign.attempts[2].failureClass = "action-failure";
  const report = evaluateAgentE2eQualification(campaign);
  assert.equal(report.agentE2eEligible, false);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.lane_invalid"), true);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.run_id_duplicate"), true);
  assert.equal(report.violations.some((entry) => entry.code === "agent_e2e.attempt_state_invalid"), true);
});

function completeCampaign() {
  const candidateIdentity = identity("0.0.1");
  const attempts = [];
  for (const lane of QUALIFICATION_LANES) {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      attempts.push({
        runId: `${lane}-${repetition}`,
        taskId: "text-save-001",
        lane,
        repetition,
        retry: 0,
        status: "passed",
        failureClass: null,
        evidenceKind: "real-agent-e2e",
        promptSha256: "c".repeat(64),
        candidateIdentity,
      });
    }
  }
  return {
    tasks: [{ taskId: "text-save-001", promptSha256: "c".repeat(64) }],
    candidateIdentity,
    attempts,
  };
}

function identity(version) {
  return {
    core: { name: "agent-computer-use-mcp", version, sha256: "a".repeat(64) },
    platform: { name: "agent-computer-use-mcp-win32-x64", version, sha256: "b".repeat(64) },
  };
}
