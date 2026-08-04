import assert from "node:assert/strict";
import test from "node:test";

import {
  createPhase6AttemptEvidence,
  sealPhase6ReleaseEvidence,
  verifyPhase6ReleaseEvidence,
} from "../src/phase-6-release-evidence.mjs";
import { PHASE_6_ACCEPTANCE_LEVELS } from "../src/phase-6-staged-acceptance.mjs";

const SOURCE = Object.freeze({
  algorithm: "sha256",
  productionFileCount: 10,
  productionContentSha256: "a".repeat(64),
});

test("Phase 6 release evidence unlocks only a sealed ordered 70-attempt real campaign", () => {
  const attempts = validAttempts();
  const manifest = sealPhase6ReleaseEvidence({
    sourceIdentity: SOURCE,
    attempts,
    sealedAt: "2026-08-04T00:00:00.000Z",
  });

  const result = verifyPhase6ReleaseEvidence(manifest, { sourceIdentity: SOURCE });

  assert.equal(result.status, "passed");
  assert.equal(result.candidateArtifactAllowed, true);
  assert.equal(result.attemptCount, 70);
});

test("Phase 6 release evidence fails closed on tampering, source drift, missing attempts, or private fields", () => {
  const manifest = sealPhase6ReleaseEvidence({
    sourceIdentity: SOURCE,
    attempts: validAttempts(),
    sealedAt: "2026-08-04T00:00:00.000Z",
  });
  const tampered = structuredClone(manifest);
  tampered.attempts[0].receipt.elapsedMs = 61_000;
  assert.equal(verifyPhase6ReleaseEvidence(tampered, { sourceIdentity: SOURCE }).candidateArtifactAllowed, false);

  const drifted = { ...SOURCE, productionContentSha256: "b".repeat(64) };
  assert.equal(verifyPhase6ReleaseEvidence(manifest, { sourceIdentity: drifted }).violation, "phase6.evidence_source_mismatch");
  assert.throws(
    () => sealPhase6ReleaseEvidence({
      sourceIdentity: SOURCE,
      attempts: validAttempts().slice(0, 69),
      sealedAt: "2026-08-04T00:00:00.000Z",
    }),
    (error) => error.code === "phase6.evidence_attempt_count_invalid",
  );
  assert.throws(
    () => createPhase6AttemptEvidence({
      ...attemptInput(PHASE_6_ACCEPTANCE_LEVELS[0], 1),
      receipt: { ...attemptInput(PHASE_6_ACCEPTANCE_LEVELS[0], 1).receipt, message: "private" },
    }),
    (error) => error.code === "phase6.evidence_receipt_invalid",
  );
});

test("Phase 6 release evidence derives pass criteria from Host receipts", () => {
  const attempts = validAttempts();
  const broken = structuredClone(attempts[0]);
  broken.receipt.toolErrorCount = 1;
  assert.throws(
    () => sealPhase6ReleaseEvidence({
      sourceIdentity: SOURCE,
      attempts: [broken, ...attempts.slice(1)],
      sealedAt: "2026-08-04T00:00:00.000Z",
    }),
    (error) => [
      "phase6.evidence_receipt_hash_mismatch",
      "phase6.evidence_gate_failed",
    ].includes(error.code),
  );
});

function validAttempts() {
  const attempts = [];
  let run = 0;
  for (const level of PHASE_6_ACCEPTANCE_LEVELS) {
    for (let repetition = 1; repetition <= 10; repetition += 1) {
      run += 1;
      attempts.push(createPhase6AttemptEvidence(attemptInput(level, run)));
    }
  }
  return attempts;
}

function attemptInput(level, run) {
  const messaging = level.appKind === "wechat" && level.ordinal !== 6;
  return {
    runId: `phase6.${String(run).padStart(2, "0")}`,
    levelId: level.id,
    receipt: {
      toolName: messaging ? "computer.message" : "computer.task",
      outcome: "committed",
      released: true,
      elapsedMs: 1_000,
      toolErrorCount: 0,
      wrongSendCount: 0,
      terminalControllerState: "idle",
      stepStatuses: messaging
        ? [
            "restore-main-window", "focus-search", "enter-query", "wait-results-stable",
            "select-result", "verify-conversation-title", "focus-message-editor",
            "enter-message", "send", "verify-new-bubble", "release",
          ].map((step) => ({ step, status: "committed" }))
        : [
            { step: level.ordinal === 6 ? "stop" : "edit", status: "committed" },
            { step: "verify", status: "committed" },
            { step: "release", status: "committed" },
          ],
    },
    environment: {
      appKind: level.appKind,
      launchState: level.launchState === "any" ? "foreground" : level.launchState,
      contactMatch: level.contactMatch === "any" ? "fuzzy" : level.contactMatch,
      hostSceneDriven: true,
      realWindowsExecution: true,
      expectedOutcomeVerified: true,
      uncertainActionReplayCount: 0,
      auxiliaryWindowCount: level.ordinal === 4 ? 1 : 0,
      consecutiveSessionCount: level.ordinal === 5 ? 2 : 1,
      stopVerified: level.ordinal === 6,
      postStopActionCount: 0,
      faultInjectionVerified: level.ordinal === 6,
      newSessionAcquireVerified: level.ordinal === 6,
      connectorRestartClean: level.ordinal === 6,
    },
  };
}
