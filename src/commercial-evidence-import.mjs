import { randomUUID } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

import { verifyEvidenceDirectory } from "./commercial-evidence.mjs";
import { resolveSoakGate } from "./soak-gate-policy.mjs";

const IMPORT_FILES = Object.freeze([
  "events.jsonl",
  "report.json",
  "run-manifest.json",
  "checksums.txt",
]);

export async function importVerifiedEvidence(options = {}) {
  const source = requiredPath(options.source, "commercial.evidence_source_required");
  const store = requiredPath(options.store, "commercial.evidence_store_required");
  const expected = requiredObject(options.expected, "commercial.evidence_expected_identity_required");
  const manifest = parseJson(await readFile(join(source, "run-manifest.json"), "utf8"), "commercial.evidence_manifest_invalid");
  if (manifest.dirtyWorktree !== false) throw new Error("commercial.evidence_dirty_worktree");
  const verifiedSource = await verifyEvidenceDirectory(source, expected);
  if (verifiedSource.status !== "passed") throw verificationError(verifiedSource.violations);
  const gate = resolveSoakGate(manifest.gate, manifest.requestedDurationMs);
  validateGateManifest(manifest, gate);
  if (gate.id !== "release-candidate"
      || verifiedSource.report?.gate !== gate.id
      || verifiedSource.report?.requestedDurationMs !== gate.durationMs
      || verifiedSource.report?.durationMs < gate.durationMs) {
    throw new Error("commercial.evidence_rc_duration_invalid");
  }
  if (verifiedSource.report.status !== "passed" || verifiedSource.report.violations?.length !== 0) {
    throw new Error("commercial.evidence_absolute_gate_failed");
  }
  const sourceEvents = await inspectEvents(join(source, "events.jsonl"));
  validateEventRequirements(sourceEvents, gate);
  const runId = validateRunId(verifiedSource.runId);
  const gitCommit = validateCommit(manifest.gitCommit);
  const commitRoot = resolve(store, gitCommit);
  const destination = resolve(commitRoot, runId);
  assertInside(store, destination);
  if (await pathExists(destination)) throw new Error("commercial.evidence_destination_exists");
  await mkdir(commitRoot, { recursive: true });
  const staging = resolve(commitRoot, `.${runId}.import-${randomUUID()}`);
  assertInside(commitRoot, staging);
  await mkdir(staging);
  try {
    for (const name of IMPORT_FILES) {
      await copyFile(join(source, name), join(staging, name), fsConstants.COPYFILE_EXCL);
    }
    const verifiedCopy = await verifyEvidenceDirectory(staging, expected);
    if (verifiedCopy.status !== "passed") throw new Error("commercial.evidence_copy_invalid");
    if (!sameInventory(verifiedSource.files, verifiedCopy.files)) {
      throw new Error("commercial.evidence_copy_identity_mismatch");
    }
    const copiedEvents = await inspectEvents(join(staging, "events.jsonl"));
    validateEventRequirements(copiedEvents, gate);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (await pathExists(destination)) throw new Error("commercial.evidence_destination_exists");
      throw error;
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    schemaVersion: 1,
    status: "imported",
    path: destination,
    runId,
    gitCommit,
    durationMs: verifiedSource.report.durationMs,
    checkpointCount: sourceEvents.checkpointCount,
  };
}

function validateGateManifest(manifest, gate) {
  const expected = {
    clientCount: gate.clientCount,
    concurrency: gate.concurrency,
    faultEveryRounds: gate.faultEveryRounds,
    sampleIntervalMs: gate.sampleIntervalMs,
    checkpointIntervalMs: gate.checkpointIntervalMs,
    minimumCheckpointCount: gate.minimumCheckpointCount,
  };
  if (Object.entries(expected).some(([name, value]) => manifest[name] !== value)) {
    throw new Error("commercial.evidence_gate_policy_invalid");
  }
}

async function inspectEvents(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let checkpointCount = 0;
  let cleanupCount = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      const event = parseJson(line, "commercial.evidence_event_invalid");
      if (event.type === "evidence.checkpoint") checkpointCount += 1;
      if (event.type === "runtime.cleanup.completed" && event.payload?.completed === true) cleanupCount += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return { checkpointCount, cleanupCount };
}

function validateEventRequirements(events, gate) {
  if (events.cleanupCount !== 1) throw new Error("commercial.evidence_cleanup_missing");
  if (events.checkpointCount < gate.minimumCheckpointCount) {
    throw new Error("commercial.evidence_checkpoints_missing");
  }
}

function verificationError(violations) {
  const identityMismatch = violations.some((violation) => violation.code === "evidence.identity_mismatch");
  return new Error(identityMismatch ? "commercial.evidence_identity_invalid" : "commercial.evidence_source_invalid");
}

function sameInventory(left, right) {
  return JSON.stringify([...left].sort(compareFiles)) === JSON.stringify([...right].sort(compareFiles));
}

function compareFiles(left, right) {
  return left.path.localeCompare(right.path, "en");
}

function validateRunId(value) {
  const runId = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(runId)) throw new Error("commercial.evidence_run_id_invalid");
  return runId;
}

function validateCommit(value) {
  const commit = String(value ?? "");
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("commercial.evidence_commit_invalid");
  return commit;
}

function requiredPath(value, code) {
  const text = String(value ?? "");
  if (!text) throw new TypeError(code);
  return resolve(text);
}

function requiredObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  return value;
}

function parseJson(value, code) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
    return parsed;
  } catch {
    throw new Error(code);
  }
}

function assertInside(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  if (!path || path === ".." || path.startsWith(`..${sep}`)) throw new Error("commercial.evidence_path_escape");
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
