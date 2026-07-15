import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createEvidenceRun } from "../src/commercial-evidence.mjs";
import { importVerifiedEvidence } from "../src/commercial-evidence-import.mjs";

test("release-candidate importer verifies copies and atomically imports exact evidence", async () => {
  const fixture = await evidenceFixture({ runId: "rc-valid" });
  const store = await mkdtemp(join(tmpdir(), "commercial-import-store-"));

  const imported = await importVerifiedEvidence({
    source: fixture.source,
    store,
    expected: fixture.expected,
  });

  assert.equal(imported.status, "imported");
  assert.equal(imported.runId, "rc-valid");
  assert.equal(imported.gitCommit, fixture.manifest.gitCommit);
  assert.equal(imported.durationMs, 28_800_000);
  assert.equal(imported.checkpointCount, 48);
  assert.equal(imported.path, join(store, fixture.manifest.gitCommit, "rc-valid"));
});

test("release-candidate importer rejects short dirty mismatched corrupt and incomplete evidence", async () => {
  const short = await evidenceFixture({ runId: "rc-short", durationMs: 28_799_999 });
  await assert.rejects(
    () => importVerifiedEvidence({ source: short.source, store: short.store, expected: short.expected }),
    /commercial.evidence_rc_duration_invalid/,
  );

  const dirty = await evidenceFixture({ runId: "rc-dirty", dirtyWorktree: true });
  await assert.rejects(
    () => importVerifiedEvidence({ source: dirty.source, store: dirty.store, expected: dirty.expected }),
    /commercial.evidence_dirty_worktree/,
  );

  const mismatched = await evidenceFixture({ runId: "rc-mismatch" });
  await assert.rejects(
    () => importVerifiedEvidence({
      source: mismatched.source,
      store: mismatched.store,
      expected: { ...mismatched.expected, gitCommit: "f".repeat(40) },
    }),
    /commercial.evidence_identity_invalid/,
  );
  await assert.rejects(
    () => importVerifiedEvidence({
      source: mismatched.source,
      store: mismatched.store,
      expected: {
        ...mismatched.expected,
        modelPack: { ...mismatched.expected.modelPack, sha256: "e".repeat(64) },
      },
    }),
    /commercial.evidence_identity_invalid/,
  );

  const corrupt = await evidenceFixture({ runId: "rc-corrupt" });
  await appendFile(join(corrupt.source, "events.jsonl"), "tampered\n", "utf8");
  await assert.rejects(
    () => importVerifiedEvidence({ source: corrupt.source, store: corrupt.store, expected: corrupt.expected }),
    /commercial.evidence_source_invalid/,
  );

  const noCleanup = await evidenceFixture({ runId: "rc-no-cleanup", includeCleanup: false });
  await assert.rejects(
    () => importVerifiedEvidence({ source: noCleanup.source, store: noCleanup.store, expected: noCleanup.expected }),
    /commercial.evidence_cleanup_missing/,
  );

  const tooFewCheckpoints = await evidenceFixture({ runId: "rc-few-checkpoints", checkpointCount: 47 });
  await assert.rejects(
    () => importVerifiedEvidence({ source: tooFewCheckpoints.source, store: tooFewCheckpoints.store, expected: tooFewCheckpoints.expected }),
    /commercial.evidence_checkpoints_missing/,
  );

  const weakened = await evidenceFixture({ runId: "rc-weakened", clientCount: 1 });
  await assert.rejects(
    () => importVerifiedEvidence({ source: weakened.source, store: weakened.store, expected: weakened.expected }),
    /commercial.evidence_gate_policy_invalid/,
  );
});

test("release-candidate importer never overwrites a run and preserves distinct retries", async () => {
  const first = await evidenceFixture({ runId: "rc-attempt-1" });
  const store = await mkdtemp(join(tmpdir(), "commercial-import-store-"));
  await importVerifiedEvidence({ source: first.source, store, expected: first.expected });
  await assert.rejects(
    () => importVerifiedEvidence({ source: first.source, store, expected: first.expected }),
    /commercial.evidence_destination_exists/,
  );

  const second = await evidenceFixture({ runId: "rc-attempt-2", gitCommit: first.manifest.gitCommit });
  const imported = await importVerifiedEvidence({ source: second.source, store, expected: second.expected });
  assert.equal(imported.path, join(store, first.manifest.gitCommit, "rc-attempt-2"));
});

test("release-candidate importer rejects overlapping source and store roots", async () => {
  const fixture = await evidenceFixture({ runId: "rc-overlap" });
  await assert.rejects(
    () => importVerifiedEvidence({
      source: fixture.source,
      store: join(fixture.source, "imported"),
      expected: fixture.expected,
    }),
    /commercial.evidence_path_overlap/,
  );
  await assert.rejects(
    () => importVerifiedEvidence({
      source: fixture.source,
      store: join(fixture.source, ".."),
      expected: fixture.expected,
    }),
    /commercial.evidence_path_overlap/,
  );
});

test("release-candidate commands pin the exact gate and use the protected importer", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const verifier = await readFile("scripts/verify-release-candidate-evidence.mjs", "utf8");
  assert.equal(
    packageJson.scripts["soak:rc"],
    "node src/phase-8-0-runtime-soak.mjs --gate release-candidate --duration-ms 28800000 --evidence-root evidence/release-candidate --seed 20260713",
  );
  assert.equal(packageJson.scripts["soak:rc:verify"], "node scripts/verify-release-candidate-evidence.mjs");
  assert.match(verifier, /importVerifiedEvidence/u);
  assert.doesNotMatch(verifier, /copyFile|rename|writeFile/u);
});

async function evidenceFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "commercial-import-source-"));
  const store = await mkdtemp(join(tmpdir(), "commercial-import-store-"));
  const runId = options.runId ?? "rc-run";
  const manifest = manifestFixture(options);
  const run = await createEvidenceRun({
    root,
    runId,
    manifest,
    now: () => "2026-07-13T00:00:00.000Z",
  });
  for (let index = 0; index < (options.checkpointCount ?? 48); index += 1) {
    await run.checkpoint({ index, elapsedMs: index * 600_000 });
  }
  if (options.includeCleanup !== false) {
    await run.append("runtime.cleanup.completed", {
      orphanProcessCount: 0,
      residualPortCount: 0,
      overlayLeakCount: 0,
      cursorLeakCount: 0,
      completed: true,
    });
  }
  await run.seal({
    schemaVersion: 2,
    status: "passed",
    gate: "release-candidate",
    requestedDurationMs: 28_800_000,
    durationMs: options.durationMs ?? 28_800_000,
    metrics: { cleanup: { completed: true } },
    violations: [],
    includeUserOverlay: false,
  });
  return {
    source: run.path,
    store,
    manifest,
    expected: expectedIdentity(manifest),
  };
}

function manifestFixture(options = {}) {
  return {
    schemaVersion: 1,
    runId: options.runId ?? "rc-run",
    gitCommit: options.gitCommit ?? "a".repeat(40),
    dirtyWorktree: options.dirtyWorktree ?? false,
    corePackage: { name: "agent-computer-use-mcp", version: "0.0.1", sha256: "1".repeat(64) },
    platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "0.0.1", sha256: "2".repeat(64) },
    driver: { id: "cua-driver-windows-x64", version: "0.7.1", sha256: "3".repeat(64) },
    overlay: { id: "gateway-overlay", sha256: "4".repeat(64) },
    ocrRuntime: { id: "onnxruntime-node", version: "1.27.0", sha256: "5".repeat(64) },
    modelPack: { id: "pp-ocr-v6-small", sha256: "6".repeat(64) },
    machine: { platform: "win32", arch: "x64", nodeVersion: "24.12.0" },
    gate: "release-candidate",
    requestedDurationMs: 28_800_000,
    scenarioSeed: 20260713,
    clientCount: options.clientCount ?? 4,
    concurrency: options.concurrency ?? 3,
    faultEveryRounds: options.faultEveryRounds ?? 100,
    sampleIntervalMs: options.sampleIntervalMs ?? 10_000,
    checkpointIntervalMs: options.checkpointIntervalMs ?? 600_000,
    minimumCheckpointCount: options.minimumCheckpointCount ?? 48,
    retainCallDetails: false,
    startedAt: "2026-07-13T00:00:00.000Z",
    privacyPolicyVersion: 1,
  };
}

function expectedIdentity(manifest) {
  return {
    gitCommit: manifest.gitCommit,
    dirtyWorktree: false,
    corePackage: manifest.corePackage,
    platformPackage: manifest.platformPackage,
    driver: manifest.driver,
    overlay: manifest.overlay,
    ocrRuntime: manifest.ocrRuntime,
    modelPack: manifest.modelPack,
  };
}
