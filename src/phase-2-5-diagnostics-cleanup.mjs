import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupDiagnosticsRetention } from "./diagnostics-cleanup.mjs";

const nowMs = Date.parse("2026-07-09T00:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;
const root = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-5-"));
const traceRoot = join(root, "traces");
const logRoot = join(root, "logs");
const artifactRoot = join(root, "artifacts");
await Promise.all([mkdir(traceRoot), mkdir(logRoot), mkdir(artifactRoot)]);

const expiredTrace = await createFile(traceRoot, "old-trace.jsonl", nowMs - 15 * dayMs);
const freshTrace = await createFile(traceRoot, "fresh-trace.jsonl", nowMs - 2 * dayMs);
const expiredLog = await createFile(logRoot, "old-log.jsonl", nowMs - 31 * dayMs);
const expiredArtifact = await createFile(artifactRoot, "old-artifact.png", nowMs - 8 * dayMs);

const policy = {
  roots: { traceRoot, logRoot, artifactRoot },
  retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
};

const cleanup = await cleanupDiagnosticsRetention({
  policy,
  nowMs,
  dryRun: false,
});

const dryRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-5-dry-"));
const dryTraceRoot = join(dryRoot, "traces");
const dryLogRoot = join(dryRoot, "logs");
const dryArtifactRoot = join(dryRoot, "artifacts");
await Promise.all([mkdir(dryTraceRoot), mkdir(dryLogRoot), mkdir(dryArtifactRoot)]);
const dryExpiredTrace = await createFile(dryTraceRoot, "old-trace.jsonl", nowMs - 15 * dayMs);
const dryRun = await cleanupDiagnosticsRetention({
  policy: {
    roots: {
      traceRoot: dryTraceRoot,
      logRoot: dryLogRoot,
      artifactRoot: dryArtifactRoot,
    },
    retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
  },
  nowMs,
  dryRun: true,
});

let outsideRootRejected = false;
try {
  await cleanupDiagnosticsRetention({
    policy: {
      roots: {
        traceRoot,
        logRoot,
        artifactRoot: tmpdir(),
      },
      retention: { traceDays: 14, logDays: 30, artifactDays: 7 },
    },
    nowMs,
  });
} catch (error) {
  outsideRootRejected = String(error instanceof Error ? error.message : error)
    .includes("diagnostics_root_outside_policy_family");
}

const deletedExpiredFiles = !(await exists(expiredTrace))
  && !(await exists(expiredLog))
  && !(await exists(expiredArtifact));
const freshFilePreserved = await exists(freshTrace);
const dryRunPreservedExpiredFile = dryRun.status === "planned"
  && dryRun.expired.length === 1
  && await exists(dryExpiredTrace);

const passed = cleanup.deletedCount === 3
  && deletedExpiredFiles
  && freshFilePreserved
  && dryRunPreservedExpiredFile
  && outsideRootRejected
  && cleanup.includeUserOverlay === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.5",
  benchmark: "diagnostics-retention-cleanup",
  deletedCount: cleanup.deletedCount,
  freshFilePreserved,
  dryRunPreservedExpiredFile,
  outsideRootRejected,
  includeUserOverlay: cleanup.includeUserOverlay,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;

async function createFile(rootPath, name, mtimeMs) {
  const path = join(rootPath, name);
  await writeFile(path, "diagnostic", "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
