import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  executeRuntimeSoakPhase,
  parseRuntimeSoakArgs,
  validateRuntimeSoakOptions,
} from "../src/runtime-soak-evidence.mjs";
import { verifyEvidenceDirectory } from "../src/commercial-evidence.mjs";

test("pull-request gate requires the exact approved duration and evidence root", () => {
  assert.throws(
    () => validateRuntimeSoakOptions({ gate: "pull-request", durationMs: 60_000, evidenceRoot: "evidence/pr" }),
    /runtime.soak_duration_mismatch/,
  );
  assert.throws(
    () => validateRuntimeSoakOptions({ gate: "pull-request", durationMs: 900_000 }),
    /runtime.soak_evidence_root_required/,
  );
  assert.equal(validateRuntimeSoakOptions({
    gate: "pull-request",
    durationMs: 900_000,
    evidenceRoot: "evidence/pr",
    clientCount: 2,
    concurrency: 2,
    faultEveryRounds: 20,
    seed: 20260713,
  }).gate, "pull-request");
});

test("developer soak remains short and cannot claim commercial evidence", () => {
  const parsed = parseRuntimeSoakArgs(["--duration-ms", "1000", "--clients", "1"]);
  assert.equal(parsed.gate, null);
  assert.equal(parsed.durationMs, 1000);
  assert.equal(parsed.evidenceRoot, null);
});

test("pull-request phase seals verified evidence bound to the candidate identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-soak-phase-"));
  const identity = validIdentity();
  const result = await executeRuntimeSoakPhase({
    gate: "pull-request",
    durationMs: 900_000,
    evidenceRoot: root,
    runId: "pr-run-1",
    seed: 20260713,
    clientCount: 2,
    concurrency: 2,
    faultEveryRounds: 20,
  }, {
    resolveIdentity: async () => identity,
    runRuntimeSoak: async (options) => {
      await options.eventSink.append("runtime.sample", { elapsedMs: 0, rssBytes: 1, handles: 1 });
      return passingReport(900_001);
    },
    now: () => "2026-07-13T00:00:00.000Z",
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.evidence, { runId: "pr-run-1", verified: true });
  const verified = await verifyEvidenceDirectory(join(root, "pr-run-1"), {
    gitCommit: identity.gitCommit,
    corePackage: identity.corePackage,
  });
  assert.equal(verified.status, "passed");
  assert.equal(verified.report.durationMs, 900_001);
});

test("phase fails closed when the measured workload is shorter or the worktree is dirty", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-soak-phase-"));
  await assert.rejects(
    () => executeRuntimeSoakPhase({
      gate: "pull-request", durationMs: 900_000, evidenceRoot: root, runId: "dirty-run",
    }, {
      resolveIdentity: async () => ({ ...validIdentity(), dirtyWorktree: true }),
      runRuntimeSoak: async () => passingReport(900_000),
    }),
    /runtime.soak_dirty_worktree/,
  );

  const short = await executeRuntimeSoakPhase({
    gate: "pull-request", durationMs: 900_000, evidenceRoot: root, runId: "short-run",
  }, {
    resolveIdentity: async () => validIdentity(),
    runRuntimeSoak: async () => passingReport(899_999),
    now: () => "2026-07-13T00:00:00.000Z",
  });
  assert.equal(short.status, "failed");
  assert.ok(short.violations.some((item) => item.code === "runtime.soak_duration_short"));
});

test("release-candidate phase writes periodic checkpoints that satisfy its immutable gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "commercial-soak-phase-"));
  await executeRuntimeSoakPhase({
    gate: "release-candidate",
    durationMs: 28_800_000,
    evidenceRoot: root,
    runId: "rc-checkpoints",
  }, {
    resolveIdentity: async () => validIdentity(),
    runRuntimeSoak: async (options) => {
      for (let elapsedMs = 600_000; elapsedMs <= 28_800_000; elapsedMs += 600_000) {
        await options.eventSink.append("runtime.sample", { elapsedMs, rssBytes: 1, handles: 1 });
      }
      return passingReport(28_800_000);
    },
    now: () => "2026-07-13T00:00:00.000Z",
  });

  const lines = (await readFile(join(root, "rc-checkpoints", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const checkpoints = lines.filter((event) => event.type === "evidence.checkpoint");
  assert.ok(checkpoints.length >= 48);
  assert.equal(checkpoints.some((event) => event.payload.stage === "periodic"), true);
});

function validIdentity() {
  return {
    gitCommit: "a".repeat(40),
    dirtyWorktree: false,
    corePackage: { name: "agent-computer-use-mcp", version: "0.0.1", sha256: "1".repeat(64) },
    platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "0.0.1", sha256: "2".repeat(64) },
    driver: { id: "cua-driver-windows-x64", version: "0.7.1", sha256: "3".repeat(64) },
    overlay: { id: "gateway-overlay", sha256: "4".repeat(64) },
    modelPack: { id: "pp-ocr-v6-small", sha256: "5".repeat(64) },
    machine: { platform: "win32", arch: "x64", nodeVersion: "24.12.0" },
  };
}

function passingReport(durationMs) {
  return {
    schemaVersion: 2,
    status: "passed",
    phase: "8.0",
    benchmark: "runtime-soak",
    durationMs,
    calls: [{ tool: "computer.health", status: "passed", durationMs: 1 }],
    metrics: { cleanup: { completed: true } },
    violations: [],
    includeUserOverlay: false,
  };
}
