import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createEvidenceRun,
  verifyEvidenceDirectory,
} from "../src/commercial-evidence.mjs";

const HASH = "a".repeat(64);

test("evidence survives checkpoints and seals an immutable inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-evidence-"));
  const run = await createEvidenceRun({
    root,
    runId: "run-1",
    now: monotonicClock(),
    manifest: validManifest(),
  });

  await Promise.all([
    run.append("runtime.sample", { rssBytes: 42 }),
    run.append("runtime.call", { tool: "computer.health", status: "passed" }),
  ]);
  await run.checkpoint({ round: 1 });
  const sealed = await run.seal({ status: "passed", gate: "pull-request" });

  assert.deepEqual(sealed.files.map((item) => item.path), [
    "events.jsonl",
    "report.json",
    "run-manifest.json",
  ]);
  assert.equal(sealed.files.every((item) => /^[a-f0-9]{64}$/u.test(item.sha256)), true);
  const verification = await verifyEvidenceDirectory(run.path);
  assert.equal(verification.status, "passed");
  assert.equal(verification.eventCount, 3);
  assert.deepEqual(verification.files, sealed.files);

  const events = (await readFile(join(run.path, "events.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.type), [
    "runtime.sample",
    "runtime.call",
    "evidence.checkpoint",
  ]);
  await assert.rejects(() => run.append("runtime.sample", {}), /evidence.run_sealed/);
  await assert.rejects(() => run.seal({ status: "passed" }), /evidence.run_sealed/);
});

test("evidence rejects secrets user paths and unsafe run identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-evidence-"));

  await assert.rejects(
    () => createEvidenceRun({
      root,
      runId: "run-secret",
      manifest: { ...validManifest(), token: "ghp_not-allowed" },
    }),
    /evidence.forbidden_metadata/,
  );
  await assert.rejects(
    () => createEvidenceRun({
      root,
      runId: "run-path",
      manifest: { ...validManifest(), source: "C:\\Users\\person\\fixture.png" },
    }),
    /evidence.forbidden_metadata/,
  );
  await assert.rejects(
    () => createEvidenceRun({ root, runId: "../escape", manifest: validManifest() }),
    /evidence.run_id_invalid/,
  );
});

test("evidence allows dotted application versions but rejects camel-case credential keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-evidence-"));
  const run = await createEvidenceRun({
    root,
    runId: "run-version",
    manifest: { ...validManifest(), applicationVersion: "150.0.4078.65" },
  });
  await run.seal({ status: "passed" });
  assert.equal((await verifyEvidenceDirectory(run.path)).status, "passed");

  await assert.rejects(
    () => createEvidenceRun({
      root,
      runId: "run-api-token",
      manifest: { ...validManifest(), apiToken: "not-even-a-real-token" },
    }),
    /evidence.forbidden_metadata/,
  );
});

test("verification fails closed on tampering and unreferenced files", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-evidence-"));
  const run = await createEvidenceRun({ root, runId: "run-tamper", manifest: validManifest() });
  await run.append("runtime.sample", { rssBytes: 42 });
  await run.seal({ status: "passed", gate: "pull-request" });

  await writeFile(join(run.path, "report.json"), "{}\n", "utf8");
  const tampered = await verifyEvidenceDirectory(run.path);
  assert.equal(tampered.status, "failed");
  assert.ok(tampered.violations.some((item) => item.code === "evidence.hash_mismatch"));

  const second = await createEvidenceRun({ root, runId: "run-extra", manifest: validManifest() });
  await second.seal({ status: "passed", gate: "pull-request" });
  await writeFile(join(second.path, "unreferenced.json"), "{}\n", "utf8");
  const extra = await verifyEvidenceDirectory(second.path);
  assert.equal(extra.status, "failed");
  assert.ok(extra.violations.some((item) => item.code === "evidence.unreferenced_file"));
});

test("verification checks the expected candidate identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-evidence-"));
  const run = await createEvidenceRun({ root, runId: "run-identity", manifest: validManifest() });
  await run.seal({ status: "passed", gate: "pull-request" });

  const verification = await verifyEvidenceDirectory(run.path, {
    gitCommit: "b".repeat(40),
    corePackage: { name: "agent-computer-use-mcp", version: "0.0.1" },
  });
  assert.equal(verification.status, "failed");
  assert.ok(verification.violations.some((item) => item.code === "evidence.identity_mismatch"));
});

test("verification streams JSONL events instead of retaining the complete long-run log", async () => {
  const source = await readFile("src/commercial-evidence.mjs", "utf8");
  assert.match(source, /createInterface/u);
  assert.doesNotMatch(source, /readFile\(join\(runPath, "events\.jsonl"\)/u);
});

function validManifest() {
  return {
    schemaVersion: 1,
    runId: "run-1",
    gitCommit: "a".repeat(40),
    dirtyWorktree: false,
    corePackage: { name: "agent-computer-use-mcp", version: "0.0.1" },
    platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "0.0.1", sha256: HASH },
    modelPack: { id: "pp-ocr-v6-small", sha256: HASH },
    gate: "pull-request",
    requestedDurationMs: 900_000,
    privacyPolicyVersion: 1,
  };
}

function monotonicClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 13, 0, 0, tick++)).toISOString();
}
