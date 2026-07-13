import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  createEvidenceRun,
  verifyEvidenceDirectory,
} from "./commercial-evidence.mjs";
import { runRuntimeSoak } from "./runtime-soak-runner.mjs";
import { resolveSoakGate } from "./soak-gate-policy.mjs";

const execFileAsync = promisify(execFile);

export function parseRuntimeSoakArgs(args, environment = process.env) {
  const values = {
    gate: environment.AGENT_COMPUTER_USE_SOAK_GATE ?? null,
    durationMs: optionalNumber(environment.AGENT_COMPUTER_USE_SOAK_DURATION_MS),
    clientCount: optionalNumber(environment.AGENT_COMPUTER_USE_SOAK_CLIENTS),
    concurrency: optionalNumber(environment.AGENT_COMPUTER_USE_SOAK_CONCURRENCY),
    faultEveryRounds: optionalNumber(environment.AGENT_COMPUTER_USE_SOAK_FAULT_EVERY_ROUNDS),
    evidenceRoot: environment.AGENT_COMPUTER_USE_SOAK_EVIDENCE_ROOT ?? null,
    seed: Number(environment.AGENT_COMPUTER_USE_SOAK_SEED ?? 20260713),
  };
  const names = new Map([
    ["--gate", "gate"],
    ["--duration-ms", "durationMs"],
    ["--clients", "clientCount"],
    ["--concurrency", "concurrency"],
    ["--fault-every-rounds", "faultEveryRounds"],
    ["--evidence-root", "evidenceRoot"],
    ["--seed", "seed"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = names.get(args[index]);
    if (!key || args[index + 1] === undefined) throw new Error(`runtime.soak_argument_invalid: ${args[index]}`);
    values[key] = ["gate", "evidenceRoot"].includes(key) ? args[index + 1] : Number(args[index + 1]);
  }
  return validateRuntimeSoakOptions(values);
}

export function validateRuntimeSoakOptions(options = {}) {
  const gate = options.gate == null || options.gate === "" ? null : String(options.gate);
  if (gate) return validateNamedGateOptions(gate, options);
  const values = {
    gate: null,
    durationMs: positiveInteger(options.durationMs ?? 60_000, "runtime.soak_duration_invalid"),
    clientCount: positiveInteger(options.clientCount ?? 2, "runtime.soak_clients_invalid"),
    concurrency: positiveInteger(options.concurrency ?? 2, "runtime.soak_concurrency_invalid"),
    faultEveryRounds: nonNegativeInteger(options.faultEveryRounds ?? 20, "runtime.soak_fault_cadence_invalid"),
    evidenceRoot: options.evidenceRoot == null || options.evidenceRoot === "" ? null : String(options.evidenceRoot),
    seed: nonNegativeInteger(options.seed ?? 20260713, "runtime.soak_seed_invalid"),
    ...(options.runId ? { runId: String(options.runId) } : {}),
  };
  if (values.evidenceRoot) throw new Error("runtime.soak_gate_required_for_evidence");
  return values;
}

function validateNamedGateOptions(gateName, options) {
  const durationMs = positiveInteger(options.durationMs, "runtime.soak_duration_invalid");
  const policy = resolveSoakGate(gateName, durationMs);
  const evidenceRoot = options.evidenceRoot == null || options.evidenceRoot === ""
    ? null
    : String(options.evidenceRoot);
  if (!evidenceRoot) throw new Error("runtime.soak_evidence_root_required");
  assertGateParameter(options, "clientCount", policy.clientCount, positiveInteger, "runtime.soak_clients_invalid");
  assertGateParameter(options, "concurrency", policy.concurrency, positiveInteger, "runtime.soak_concurrency_invalid");
  assertGateParameter(options, "faultEveryRounds", policy.faultEveryRounds, nonNegativeInteger, "runtime.soak_fault_cadence_invalid");
  assertGateParameter(options, "sampleIntervalMs", policy.sampleIntervalMs, positiveInteger, "runtime.soak_sample_interval_invalid");
  assertGateParameter(options, "checkpointIntervalMs", policy.checkpointIntervalMs, positiveInteger, "runtime.soak_checkpoint_interval_invalid");
  assertGateParameter(options, "minimumCheckpointCount", policy.minimumCheckpointCount, positiveInteger, "runtime.soak_checkpoint_count_invalid");
  for (const [name, expected] of Object.entries(policy.thresholds)) {
    assertGateParameter(options, name, expected, nonNegativeNumber, `runtime.soak_${name}_invalid`);
  }
  return {
    gate: policy.id,
    durationMs: policy.durationMs,
    evidenceRoot,
    seed: nonNegativeInteger(options.seed ?? 20260713, "runtime.soak_seed_invalid"),
    clientCount: policy.clientCount,
    concurrency: policy.concurrency,
    faultEveryRounds: policy.faultEveryRounds,
    sampleIntervalMs: policy.sampleIntervalMs,
    checkpointIntervalMs: policy.checkpointIntervalMs,
    minimumCheckpointCount: policy.minimumCheckpointCount,
    maxRssGrowthBytes: policy.thresholds.maxRssGrowthBytes,
    maxHandleGrowth: policy.thresholds.maxHandleGrowth,
    maxFailureRate: policy.thresholds.maxFailureRate,
    ...(options.runId ? { runId: String(options.runId) } : {}),
  };
}

function assertGateParameter(options, name, expected, normalize, errorCode) {
  if (options[name] === undefined) return;
  const actual = normalize(options[name], errorCode);
  if (actual !== expected) {
    throw new Error(`runtime.soak_gate_parameter_mismatch: ${name}`);
  }
}

export async function executeRuntimeSoakPhase(rawOptions = {}, dependencies = {}) {
  const options = validateRuntimeSoakOptions(rawOptions);
  const runner = dependencies.runRuntimeSoak ?? runRuntimeSoak;
  if (!options.gate) return runner(options);
  const resolveIdentity = dependencies.resolveIdentity ?? resolveRuntimeSoakIdentity;
  const identity = await resolveIdentity();
  if (identity.dirtyWorktree !== false) throw new Error("runtime.soak_dirty_worktree");
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = normalizeIso(now());
  const runId = options.runId ?? buildRunId(options.gate, identity.gitCommit, startedAt);
  const manifest = {
    schemaVersion: 1,
    runId,
    gitCommit: identity.gitCommit,
    dirtyWorktree: identity.dirtyWorktree,
    corePackage: identity.corePackage,
    platformPackage: identity.platformPackage,
    driver: identity.driver,
    overlay: identity.overlay,
    modelPack: identity.modelPack,
    machine: identity.machine,
    gate: options.gate,
    requestedDurationMs: options.durationMs,
    scenarioSeed: options.seed,
    clientCount: options.clientCount,
    concurrency: options.concurrency,
    faultEveryRounds: options.faultEveryRounds,
    sampleIntervalMs: options.sampleIntervalMs,
    checkpointIntervalMs: options.checkpointIntervalMs,
    minimumCheckpointCount: options.minimumCheckpointCount,
    startedAt,
    privacyPolicyVersion: 1,
  };
  const evidence = await createEvidenceRun({
    root: options.evidenceRoot,
    runId,
    manifest,
    now,
  });
  let report;
  try {
    report = await runner({
      ...options,
      eventSink: createCheckpointingEventSink(evidence, options),
    });
  } catch (error) {
    report = {
      schemaVersion: 2,
      status: "failed",
      phase: "8.0",
      benchmark: "runtime-soak",
      durationMs: 0,
      violations: [{ code: "runtime.soak_execution_failed", message: safeErrorCode(error) }],
      includeUserOverlay: false,
    };
  }
  const violations = [...(report.violations ?? [])];
  if (report.durationMs < options.durationMs) {
    violations.push({
      code: "runtime.soak_duration_short",
      actual: report.durationMs,
      minimum: options.durationMs,
    });
  }
  const sealedReport = {
    ...report,
    status: report.status === "passed" && violations.length === 0 ? "passed" : "failed",
    gate: options.gate,
    requestedDurationMs: options.durationMs,
    scenarioSeed: options.seed,
    violations,
  };
  await evidence.checkpoint({ stage: "soak-complete", status: sealedReport.status, durationMs: sealedReport.durationMs });
  await evidence.seal(sealedReport);
  const verification = await verifyEvidenceDirectory(evidence.path, expectedIdentity(identity));
  if (verification.status !== "passed") {
    throw new Error(`runtime.soak_evidence_invalid: ${verification.violations.map((item) => item.code).join(",")}`);
  }
  return {
    ...sealedReport,
    evidence: { runId, verified: true },
  };
}

function createCheckpointingEventSink(evidence, options) {
  let nextCheckpointAt = options.checkpointIntervalMs;
  return {
    async append(type, payload) {
      const event = await evidence.append(type, payload);
      if (type !== "runtime.sample" || !Number.isFinite(payload?.elapsedMs)) return event;
      while (payload.elapsedMs >= nextCheckpointAt) {
        await evidence.checkpoint({ stage: "periodic", elapsedMs: nextCheckpointAt });
        nextCheckpointAt += options.checkpointIntervalMs;
      }
      return event;
    },
  };
}

export async function resolveRuntimeSoakIdentity() {
  const [packageBytes, lockBytes, gitCommitResult, gitStatusResult] = await Promise.all([
    readFile("package.json"),
    readFile("release/windows-x64-assets.lock.json"),
    runGit(["rev-parse", "HEAD"]),
    runGit(["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const driver = requiredAsset(lock, "cua-driver-windows-x64");
  const modelAssets = [
    requiredAsset(lock, "ocr-model-pp-ocrv6-small-det"),
    requiredAsset(lock, "ocr-model-pp-ocrv6-small-rec"),
    requiredAsset(lock, "ocr-model-pp-ocrv6-small-rec-metadata"),
  ];
  const gitCommit = gitCommitResult.trim();
  if (!/^[a-f0-9]{40}$/u.test(gitCommit)) throw new Error("runtime.soak_git_identity_invalid");
  return {
    gitCommit,
    dirtyWorktree: gitStatusResult.trim() !== "",
    corePackage: { name: packageJson.name, version: packageJson.version, sha256: sha256(packageBytes) },
    platformPackage: {
      name: "@xiaozhiclaw/agent-computer-use-win32-x64",
      version: packageJson.version,
      sha256: sha256(lockBytes),
    },
    driver: { id: driver.id, version: driver.version, sha256: driver.source.sha256 },
    overlay: { id: "gateway-overlay", sha256: sha256(Buffer.from(gitCommit, "utf8")) },
    modelPack: {
      id: "pp-ocr-v6-small",
      sha256: sha256(Buffer.from(JSON.stringify(modelAssets.map((asset) => ({
        id: asset.id,
        version: asset.version,
        sizeBytes: asset.source.sizeBytes,
        sha256: asset.source.sha256,
      }))), "utf8")),
    },
    machine: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
    },
  };
}

function expectedIdentity(identity) {
  return {
    gitCommit: identity.gitCommit,
    dirtyWorktree: false,
    corePackage: identity.corePackage,
    platformPackage: identity.platformPackage,
    driver: identity.driver,
    overlay: identity.overlay,
    modelPack: identity.modelPack,
  };
}

function requiredAsset(lock, id) {
  const asset = lock.assets?.find((item) => item.id === id);
  if (!asset || !/^[a-f0-9]{64}$/u.test(asset.source?.sha256 ?? "")) {
    throw new Error(`runtime.soak_asset_identity_missing: ${id}`);
  }
  return asset;
}

async function runGit(args) {
  try {
    const result = await execFileAsync("git", args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return result.stdout;
  } catch {
    throw new Error("runtime.soak_git_probe_failed");
  }
}

function buildRunId(gate, commit, timestamp) {
  return `${gate}-${commit.slice(0, 12)}-${timestamp.replaceAll(/[^0-9]/gu, "").slice(0, 17)}`;
}

function normalizeIso(value) {
  const timestamp = value instanceof Date ? value.toISOString() : String(value);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("runtime.soak_timestamp_invalid");
  return timestamp;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(code);
  return number;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(code);
  return number;
}

function nonNegativeNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(code);
  return number;
}

function optionalNumber(value) {
  return value === undefined ? undefined : Number(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^[a-z][a-z0-9_.-]{2,80}/iu.exec(message)?.[0] ?? "runtime.soak_failed";
}
