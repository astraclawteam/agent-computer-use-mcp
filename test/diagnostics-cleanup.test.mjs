import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  cleanupDiagnosticsRetention,
} from "../src/diagnostics-cleanup.mjs";

const NOW = Date.parse("2026-07-09T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("diagnostics cleanup deletes only expired files inside policy roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-cleanup-"));
  const traceRoot = join(root, "traces");
  const logRoot = join(root, "logs");
  const artifactRoot = join(root, "artifacts");
  await Promise.all([mkdir(traceRoot), mkdir(logRoot), mkdir(artifactRoot)]);

  const expiredTrace = await createFile(traceRoot, "old-trace.jsonl", NOW - 15 * DAY);
  const freshTrace = await createFile(traceRoot, "fresh-trace.jsonl", NOW - 2 * DAY);
  const expiredLog = await createFile(logRoot, "old-log.jsonl", NOW - 31 * DAY);
  const expiredArtifact = await createFile(artifactRoot, "old-artifact.png", NOW - 8 * DAY);

  const report = await cleanupDiagnosticsRetention({
    policy: {
      roots: { traceRoot, logRoot, artifactRoot },
      retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
    },
    nowMs: NOW,
    dryRun: false,
  });

  assert.equal(report.status, "completed");
  assert.equal(report.phase, "2.5");
  assert.equal(report.dryRun, false);
  assert.deepEqual(report.deleted.map((entry) => entry.kind).sort(), ["artifact", "log", "trace"]);
  await assertMissing(expiredTrace);
  await assertMissing(expiredLog);
  await assertMissing(expiredArtifact);
  await assertExists(freshTrace);
});

test("diagnostics cleanup dry run reports expired files without deleting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-cleanup-dry-"));
  const traceRoot = join(root, "traces");
  const logRoot = join(root, "logs");
  const artifactRoot = join(root, "artifacts");
  await Promise.all([mkdir(traceRoot), mkdir(logRoot), mkdir(artifactRoot)]);
  const expiredTrace = await createFile(traceRoot, "old-trace.jsonl", NOW - 20 * DAY);

  const report = await cleanupDiagnosticsRetention({
    policy: {
      roots: { traceRoot, logRoot, artifactRoot },
      retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
    },
    nowMs: NOW,
    dryRun: true,
  });

  assert.equal(report.status, "planned");
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.deleted, []);
  assert.equal(report.expired.length, 1);
  await assertExists(expiredTrace);
});

test("diagnostics cleanup rejects roots outside the diagnostics policy root family", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-cleanup-guard-"));
  const traceRoot = join(root, "traces");
  const logRoot = join(root, "logs");
  await Promise.all([mkdir(traceRoot), mkdir(logRoot)]);

  await assert.rejects(
    cleanupDiagnosticsRetention({
      policy: {
        roots: {
          traceRoot,
          logRoot,
          artifactRoot: tmpdir(),
        },
        retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
      },
      nowMs: NOW,
    }),
    /diagnostics_root_outside_policy_family/,
  );
});

test("diagnostics cleanup rejects roots mapped to the wrong diagnostics kind", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-cleanup-kind-"));
  const traceRoot = join(root, "traces");
  const logRoot = join(root, "logs");
  const artifactRoot = join(root, "artifacts");
  await Promise.all([mkdir(traceRoot), mkdir(logRoot), mkdir(artifactRoot)]);

  await assert.rejects(
    cleanupDiagnosticsRetention({
      policy: {
        roots: {
          traceRoot: logRoot,
          logRoot: traceRoot,
          artifactRoot,
        },
        retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
      },
      nowMs: NOW,
    }),
    /diagnostics_root_kind_mismatch/,
  );
});

test("Phase 2.5 has an executable diagnostics cleanup smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.5"], "node src/phase-2-5-diagnostics-cleanup.mjs");

  const result = await runNode(["src/phase-2-5-diagnostics-cleanup.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.5");
  assert.equal(report.benchmark, "diagnostics-retention-cleanup");
  assert.equal(report.deletedCount, 3);
  assert.equal(report.freshFilePreserved, true);
  assert.equal(report.dryRunPreservedExpiredFile, true);
  assert.equal(report.outsideRootRejected, true);
  assert.equal(report.includeUserOverlay, false);
});

async function createFile(root, name, mtimeMs) {
  const path = join(root, name);
  await writeFile(path, "diagnostic", "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function assertExists(path) {
  await stat(path);
}

async function assertMissing(path) {
  await assert.rejects(stat(path), /ENOENT/);
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
