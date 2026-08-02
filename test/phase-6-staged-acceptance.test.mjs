import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE_6_ACCEPTANCE_LEVELS,
  Phase6StagedAcceptanceCampaign,
  evaluatePhase6Attempt,
} from "../src/phase-6-staged-acceptance.mjs";

test("Phase 6 freezes the seven acceptance levels in the required order", () => {
  assert.deepEqual(PHASE_6_ACCEPTANCE_LEVELS.map((level) => level.id), [
    "wechat-foreground-full-contact",
    "wechat-foreground-fuzzy-contact",
    "wechat-tray-fuzzy-contact",
    "wechat-multi-window-fuzzy-contact",
    "wechat-consecutive-sessions",
    "stop-and-fault-injection",
    "other-windows-app",
  ]);
});

test("a level advances only after ten consecutive qualifying real attempts", () => {
  const campaign = new Phase6StagedAcceptanceCampaign();
  const levelId = PHASE_6_ACCEPTANCE_LEVELS[0].id;
  for (let index = 1; index <= 9; index += 1) {
    const result = campaign.record(validAttempt(levelId, index));
    assert.equal(result.levelQualified, false);
    assert.equal(campaign.snapshot.activeLevelId, levelId);
    assert.equal(campaign.snapshot.candidateArtifactAllowed, false);
  }
  const tenth = campaign.record(validAttempt(levelId, 10));
  assert.equal(tenth.levelQualified, true);
  assert.equal(campaign.snapshot.activeLevelId, PHASE_6_ACCEPTANCE_LEVELS[1].id);
});

test("a failed attempt resets the current level streak and cannot be hidden", () => {
  const campaign = new Phase6StagedAcceptanceCampaign();
  const levelId = PHASE_6_ACCEPTANCE_LEVELS[0].id;
  for (let index = 1; index <= 6; index += 1) campaign.record(validAttempt(levelId, index));

  const failed = campaign.record(validAttempt(levelId, 7, { toolErrorCount: 1 }));
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.violations, ["tool-error"]);
  assert.equal(campaign.snapshot.currentStreak, 0);
  assert.equal(campaign.snapshot.totalRecordedAttempts, 7);
});

test("the campaign rejects skipped levels and duplicate run identities", () => {
  const campaign = new Phase6StagedAcceptanceCampaign();
  assert.throws(
    () => campaign.record(validAttempt(PHASE_6_ACCEPTANCE_LEVELS[1].id, 1)),
    (error) => error.code === "phase6.level_out_of_order",
  );
  const first = validAttempt(PHASE_6_ACCEPTANCE_LEVELS[0].id, 1);
  campaign.record(first);
  assert.throws(
    () => campaign.record(first),
    (error) => error.code === "phase6.duplicate_run_id",
  );
});

test("global gates reject slow, unsafe, replayed, simulated, or unreleased attempts", () => {
  const level = PHASE_6_ACCEPTANCE_LEVELS[0];
  const evaluation = evaluatePhase6Attempt(validAttempt(level.id, 1, {
    realWindowsExecution: false,
    hostSceneDriven: false,
    durationMs: 60_001,
    misSendCount: 1,
    terminalReleased: false,
    terminalControllerState: "active",
    stepOrderValid: false,
    uncertainActionReplayCount: 1,
    expectedOutcomeVerified: false,
    candidateArtifactGenerated: true,
  }), level);

  assert.equal(evaluation.passed, false);
  assert.deepEqual(evaluation.violations, [
    "not-real-windows-execution",
    "not-host-scene-driven",
    "duration-exceeded",
    "mis-send",
    "terminal-not-released",
    "controller-not-idle",
    "invalid-step-order",
    "uncertain-action-replayed",
    "outcome-not-verified",
    "candidate-generated-before-gate",
  ]);
});

test("multi-window, consecutive-session, and cancellation/fault levels require their own proof", () => {
  const multiWindow = PHASE_6_ACCEPTANCE_LEVELS[3];
  assert.deepEqual(
    evaluatePhase6Attempt(validAttempt(multiWindow.id, 1, { auxiliaryWindowCount: 0 }), multiWindow).violations,
    ["auxiliary-window-not-proven"],
  );

  const sessions = PHASE_6_ACCEPTANCE_LEVELS[4];
  assert.deepEqual(
    evaluatePhase6Attempt(validAttempt(sessions.id, 1, { consecutiveSessionCount: 1 }), sessions).violations,
    ["consecutive-sessions-not-proven"],
  );

  const faults = PHASE_6_ACCEPTANCE_LEVELS[5];
  assert.deepEqual(
    evaluatePhase6Attempt(validAttempt(faults.id, 1, {
      stopVerified: false,
      postStopActionCount: 1,
      faultInjectionVerified: false,
      newSessionAcquireVerified: false,
      connectorRestartClean: false,
    }), faults).violations,
    [
      "stop-not-proven",
      "post-stop-action",
      "fault-injection-not-proven",
      "new-session-acquire-not-proven",
      "connector-restart-not-clean",
    ],
  );
});

test("evidence cannot retain contact, message, OCR, screenshot, or other unknown payloads", () => {
  const attempt = validAttempt(PHASE_6_ACCEPTANCE_LEVELS[0].id, 1);
  assert.throws(
    () => evaluatePhase6Attempt({ ...attempt, contactName: "private" }),
    (error) => error.code === "phase6.private_or_unknown_evidence",
  );
  assert.throws(
    () => evaluatePhase6Attempt({ ...attempt, screenshot: "bytes" }),
    (error) => error.code === "phase6.private_or_unknown_evidence",
  );
});

test("candidate generation remains locked until all seven levels are 10/10", () => {
  const campaign = new Phase6StagedAcceptanceCampaign();
  let run = 0;
  for (const level of PHASE_6_ACCEPTANCE_LEVELS) {
    for (let index = 1; index <= 10; index += 1) {
      run += 1;
      campaign.record(validAttempt(level.id, run));
    }
    assert.equal(
      campaign.snapshot.candidateArtifactAllowed,
      level.ordinal === PHASE_6_ACCEPTANCE_LEVELS.length,
    );
  }
  assert.equal(campaign.snapshot.status, "passed");
  assert.equal(campaign.snapshot.totalRecordedAttempts, 70);
});

function validAttempt(levelId, run, overrides = {}) {
  const level = PHASE_6_ACCEPTANCE_LEVELS.find((entry) => entry.id === levelId);
  return {
    runId: `run:${run}`,
    levelId,
    realWindowsExecution: true,
    hostSceneDriven: true,
    appKind: level.appKind,
    launchState: level.launchState === "any" ? "foreground" : level.launchState,
    contactMatch: level.contactMatch === "any" ? "fuzzy" : level.contactMatch,
    durationMs: 1_000,
    toolErrorCount: 0,
    misSendCount: 0,
    terminalReleased: true,
    terminalControllerState: "idle",
    stepOrderValid: true,
    uncertainActionReplayCount: 0,
    expectedOutcomeVerified: true,
    privatePayloadRetained: false,
    candidateArtifactGenerated: false,
    auxiliaryWindowCount: level.ordinal === 4 ? 1 : 0,
    consecutiveSessionCount: level.ordinal === 5 ? 2 : 1,
    stopVerified: level.ordinal === 6,
    postStopActionCount: 0,
    faultInjectionVerified: level.ordinal === 6,
    newSessionAcquireVerified: level.ordinal === 6,
    connectorRestartClean: level.ordinal === 6,
    ...overrides,
  };
}
