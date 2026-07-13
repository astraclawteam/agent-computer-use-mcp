#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createReleasedPerceptionProviders } from "./offline-perception-probe.mjs";
import { normalizeCommercialCandidateIdentity } from "./commercial-candidate-identity.mjs";
import { createEvidenceRun } from "./commercial-evidence.mjs";
import { runPerceptionBenchmark } from "./perception-benchmark-runner.mjs";
import { verifyPerceptionCorpus } from "./perception-corpus.mjs";
import { buildPerceptionLatencyReport } from "./perception-latency-report.mjs";
import { scanCorpusPrivacy } from "./perception-privacy-scanner.mjs";
import { resolveRuntimeSoakIdentity } from "./runtime-soak-evidence.mjs";

export async function runPhase35(options = {}) {
  const corpus = await loadCorpus(options);
  const privacy = await scanCorpusPrivacy({ manifest: corpus, root: options.corpusRoot });
  if (privacy.status !== "passed") throw phaseError("perception.corpus_privacy_rejected");
  const candidateIdentity = options.evidenceRoot ? await resolveEvidenceIdentity(options) : null;
  const evidence = options.evidenceRoot ? await createEvidenceRun({
    root: options.evidenceRoot,
    runId: options.runId ?? `perception-${corpus.tier}-${randomUUID()}`,
    manifest: {
      schemaVersion: 1,
      benchmark: "perception-corpus",
      sourceCommit: options.sourceCommit ?? process.env.GITHUB_SHA ?? "local-development",
      candidateIdentity,
      corpus: { packId: corpus.packId, version: corpus.version, tier: corpus.tier, samples: corpus.samples.length },
      includeUserOverlay: false,
    },
  }) : null;
  const eventSink = composeEventSinks(options.eventSink, evidence);
  try {
    const benchmark = await runPerceptionBenchmark({
      corpus,
      providers: options.providers ?? createReleasedPerceptionProviders(options.providerOptions),
      eventSink,
      visualConcurrency: options.visualConcurrency,
    });
    const report = buildPerceptionLatencyReport({ benchmark });
    if (evidence) await evidence.seal(report);
    return report;
  } catch (error) {
    if (evidence) {
      await evidence.seal({
        status: "failed",
        phase: "3.5",
        benchmark: "perception-corpus-gate",
        corpus: { packId: corpus.packId, version: corpus.version, tier: corpus.tier, samples: corpus.samples.length },
        error: safeErrorCode(error),
        includeUserOverlay: false,
        startsDesktopControl: false,
      });
    }
    throw error;
  }
}

async function resolveEvidenceIdentity(options) {
  const raw = options.candidateIdentity ?? await (options.resolveIdentity ?? resolveRuntimeSoakIdentity)();
  if (raw.dirtyWorktree === true) throw phaseError("perception.evidence_dirty_worktree");
  const candidate = normalizeCommercialCandidateIdentity(raw);
  const sourceCommit = options.sourceCommit ?? process.env.GITHUB_SHA;
  if (sourceCommit && sourceCommit !== candidate.gitCommit) throw phaseError("perception.evidence_identity_mismatch");
  return candidate;
}

async function loadCorpus(options) {
  const root = resolve(options.corpusRoot ?? "");
  if (!options.corpusRoot) throw phaseError("perception.corpus_argument_required");
  const tier = options.tier ?? "quick";
  let lock = options.lock;
  if (!lock && options.lockPath) lock = JSON.parse(await readFile(resolve(options.lockPath), "utf8"));
  if (!lock && tier === "quick") lock = await createGeneratedQuickLock(root);
  if (!lock) throw phaseError("perception.corpus_lock_required");
  return verifyPerceptionCorpus({ root, lock, tier });
}

async function createGeneratedQuickLock(root) {
  const target = "manifest.json";
  const bytes = await readFile(resolve(root, target)).catch(() => {
    throw phaseError("perception.corpus_pack_missing");
  });
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.tier !== "quick" || manifest.provenance !== "generated") {
    throw phaseError("perception.quick_corpus_untrusted");
  }
  return {
    schemaVersion: 1,
    packId: manifest.packId,
    version: manifest.version,
    identityStatus: "locked",
    manifest: {
      target,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const corpusRoot = readOption(args, "--corpus") ?? process.env.AGENT_COMPUTER_USE_PERCEPTION_CORPUS;
  if (!corpusRoot) throw phaseError("perception.corpus_argument_required");
  const report = await runPhase35({
    corpusRoot,
    tier: readOption(args, "--tier") ?? "quick",
    lockPath: readOption(args, "--lock"),
    evidenceRoot: readOption(args, "--evidence-root"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}

function composeEventSinks(external, evidence) {
  if (!external && !evidence) return undefined;
  return async (event) => {
    if (external) await external(event);
    if (evidence) {
      const { type, ...payload } = event;
      await evidence.append(type, payload);
    }
  };
}

function safeErrorCode(error) {
  const value = typeof error?.code === "string" ? error.code : "perception.phase_failed";
  return /^[a-z][a-z0-9._-]{1,100}$/u.test(value) ? value : "perception.phase_failed";
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw phaseError(`${name.slice(2)}.argument_required`);
  return value;
}

function phaseError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? "perception.phase_failed"}\n`);
    process.exitCode = 1;
  });
}
