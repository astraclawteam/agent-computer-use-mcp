import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  QUALIFICATION_EVIDENCE_FILES,
  createQualificationEvidenceRun,
  verifyQualificationEvidence,
} from "../src/agent-e2e/qualification-evidence.mjs";

test("qualification evidence seals the exact seven-file inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-e2e-evidence-"));
  const run = await createQualificationEvidenceRun({
    root,
    runId: "campaign-task-codex-1",
    manifest: validManifest(),
    now: timestamps(),
  });
  await run.appendTranscript({ role: "assistant", status: "completed", contentSha256: "c".repeat(64) });
  await run.appendMcpEvent({ sequence: 1, toolName: "computer.capture", argumentClasses: ["window-token"], resultStatus: "passed" });
  await run.appendObservation({ observationId: "observation-1", strategy: "uia", status: "sufficient" });
  await run.seal({
    verification: { status: "passed", invariantKind: "file-bytes", verifierId: "exact-file-bytes" },
    cleanup: { status: "passed", ownedProcessesRemaining: 0, temporaryPathsRemaining: 0 },
  });

  const verified = await verifyQualificationEvidence(run.path, {
    taskId: "text-save-001",
    lane: "codex",
  });
  assert.equal(verified.status, "passed");
  assert.deepEqual(verified.files.map((entry) => entry.path).sort(), [...QUALIFICATION_EVIDENCE_FILES].sort());
  assert.equal(verified.counts.transcript, 1);
  assert.equal(verified.counts.mcpEvents, 1);
  assert.equal(verified.counts.observations, 1);
});

test("qualification evidence becomes immutable after seal", async () => {
  const run = await newRun();
  await run.seal({
    verification: { status: "failed", failureClass: "verification-failure", verifierId: "exact-file-bytes" },
    cleanup: { status: "passed", ownedProcessesRemaining: 0, temporaryPathsRemaining: 0 },
  });

  await assert.rejects(
    run.appendTranscript({ role: "assistant", status: "completed", contentSha256: "d".repeat(64) }),
    /agent_e2e\.evidence_sealed/u,
  );
  await assert.rejects(run.seal({}), /agent_e2e\.evidence_sealed/u);
});

test("qualification evidence rejects raw OCR screenshots secrets and local user paths", async () => {
  const run = await newRun();
  await assert.rejects(run.appendObservation({ rawOcr: "secret" }), /agent_e2e\.evidence_forbidden/u);
  await assert.rejects(run.appendObservation({ screenshot: "base64" }), /agent_e2e\.evidence_forbidden/u);
  await assert.rejects(run.appendMcpEvent({ token: "github_pat_secret" }), /agent_e2e\.evidence_forbidden/u);
  await assert.rejects(
    run.appendTranscript({ text: "C:\\Users\\someone\\private.txt" }),
    /agent_e2e\.evidence_forbidden/u,
  );
});

test("qualification evidence verification fails on tampering and extra files", async () => {
  const run = await newRun();
  await run.seal({
    verification: { status: "passed", invariantKind: "file-bytes", verifierId: "exact-file-bytes" },
    cleanup: { status: "passed", ownedProcessesRemaining: 0, temporaryPathsRemaining: 0 },
  });
  await writeFile(join(run.path, "verification.json"), "{}\n", "utf8");
  await writeFile(join(run.path, "screenshot.png"), "forbidden", "utf8");

  const verified = await verifyQualificationEvidence(run.path);
  assert.equal(verified.status, "failed");
  assert.equal(verified.violations.some((entry) => entry.code === "agent_e2e.evidence_hash_mismatch"), true);
  assert.equal(verified.violations.some((entry) => entry.code === "agent_e2e.evidence_inventory_invalid"), true);
});

test("qualification evidence does not seal unrestricted payload keys", async () => {
  const run = await newRun();
  await assert.rejects(
    run.appendMcpEvent({
      sequence: 1,
      toolName: "computer.action",
      arguments: { text: "private payload" },
      resultStatus: "passed",
    }),
    /agent_e2e\.evidence_forbidden/u,
  );
  await run.appendMcpEvent({
    sequence: 1,
    toolName: "computer.action",
    argumentClasses: ["synthetic-text", "element-token"],
    resultStatus: "passed",
  });
  const line = await readFile(join(run.path, "mcp-tool-events.jsonl"), "utf8");
  assert.doesNotMatch(line, /private payload/u);
});

test("qualification evidence rejects invalid lane repetition retry and prompt identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-e2e-evidence-"));
  for (const overrides of [
    { lane: "claude-code" },
    { repetition: 4 },
    { retry: 2 },
    { promptSha256: "not-a-hash" },
  ]) {
    await assert.rejects(
      createQualificationEvidenceRun({
        root,
        runId: `invalid-${Object.keys(overrides)[0]}`,
        manifest: { ...validManifest(), ...overrides },
      }),
      /agent_e2e\.evidence_manifest_invalid/u,
    );
  }
});

async function newRun() {
  const root = await mkdtemp(join(tmpdir(), "agent-e2e-evidence-"));
  return createQualificationEvidenceRun({
    root,
    runId: "campaign-task-codex-1",
    manifest: validManifest(),
    now: timestamps(),
  });
}

function validManifest() {
  return {
    schemaVersion: 1,
    evidenceKind: "real-agent-e2e",
    campaignId: "campaign-1",
    taskId: "text-save-001",
    lane: "codex",
    repetition: 1,
    initialStateSeed: "seed-1",
    promptSha256: "c".repeat(64),
    candidateIdentity: {
      core: { version: "0.0.1", sha256: "a".repeat(64) },
      platform: { version: "0.0.1", sha256: "b".repeat(64) },
    },
    hostIdentity: { hostId: "codex", version: "26.707.3748.0" },
    modelIdentity: { provider: "openai", modelId: "codex-desktop-default" },
  };
}

function timestamps() {
  let second = 0;
  return () => `2026-07-13T00:00:${String(second++).padStart(2, "0")}.000Z`;
}
