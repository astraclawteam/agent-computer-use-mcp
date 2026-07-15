import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FAILURE_CLASSES,
  INFRASTRUCTURE_RETRY_LIMIT,
  QUALIFICATION_LANES,
  REQUIRED_SUCCESSES,
  canonicalPrompt,
  validateQualificationTask,
} from "../src/agent-e2e/qualification-contract.mjs";

test("qualification contract freezes the four required lanes and 3/3 rule", () => {
  assert.deepEqual(QUALIFICATION_LANES, [
    "codex",
    "claude-desktop",
    "xiaozhi-deepseek-v4-flash",
    "xiaozhi-claude-sonnet-5",
  ]);
  assert.equal(Object.isFrozen(QUALIFICATION_LANES), true);
  assert.equal(REQUIRED_SUCCESSES, 3);
  assert.equal(INFRASTRUCTURE_RETRY_LIMIT, 1);
});

test("qualification contract defines one retryable and six terminal failure classes", () => {
  assert.deepEqual(FAILURE_CLASSES, [
    "infrastructure-failure",
    "agent-decision-failure",
    "perception-failure",
    "action-failure",
    "verification-failure",
    "policy-blocked",
    "cleanup-failure",
  ]);
});

test("task normalization preserves canonical prompt bytes and binds their sha256", () => {
  const task = validateQualificationTask(validTask());
  const expectedBytes = Buffer.from("Create the requested synthetic document.\n", "utf8");

  assert.deepEqual(canonicalPrompt(task), expectedBytes);
  assert.equal(task.promptSha256, createHash("sha256").update(expectedBytes).digest("hex"));
  assert.equal(Object.isFrozen(task), true);
  assert.equal(Object.isFrozen(task.scope), true);
});

test("task rejects unknown top-level fields", () => {
  assert.throws(
    () => validateQualificationTask({ ...validTask(), hostPromptSuffix: "Click Save" }),
    /agent_e2e\.task_field_forbidden: hostPromptSuffix/u,
  );
});

test("task recursively rejects target action guidance", () => {
  for (const forbidden of [
    { coordinates: [10, 20] },
    { elementName: "Save" },
    { menuPath: ["File", "Save"] },
    { dialogInstructions: "Close the welcome page" },
    { actionSequence: ["click", "type"] },
  ]) {
    assert.throws(
      () => validateQualificationTask({ ...validTask(), expectedInvariant: { ...validTask().expectedInvariant, ...forbidden } }),
      /agent_e2e\.task_field_forbidden/u,
    );
  }
});

test("task requires a bounded timeout and synthetic privacy policy", () => {
  assert.throws(
    () => validateQualificationTask({ ...validTask(), timeoutMs: 0 }),
    /agent_e2e\.task_timeout_invalid/u,
  );
  assert.throws(
    () => validateQualificationTask({ ...validTask(), privacyPolicy: { syntheticDataOnly: false } }),
    /agent_e2e\.task_privacy_invalid/u,
  );
});

function validTask() {
  return {
    schemaVersion: 1,
    taskId: "text-save-001",
    goal: "Create the requested synthetic document.\n",
    environmentAdapterId: "temporary-text-document",
    scope: {
      applicationIds: ["libreoffice-writer"],
      temporaryWorkspaceOnly: true,
      windowScope: "owned-processes",
    },
    verifierId: "exact-file-bytes",
    expectedInvariant: {
      kind: "file-bytes",
      relativePath: "result.txt",
      sha256: "a".repeat(64),
    },
    timeoutMs: 120_000,
    privacyPolicy: {
      syntheticDataOnly: true,
      sealScreenshots: false,
      sealRawOcr: false,
    },
    approvalPolicy: {
      mode: "task-defined",
    },
    initialStateSeed: "welcome-or-empty-001",
  };
}
