import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { scanCorpusPrivacy } from "../src/perception-privacy-scanner.mjs";

export async function extractRegressions({ report, corpus, outputRoot } = {}) {
  validateInputs({ report, corpus, outputRoot });
  const regressionIds = report.regressions.map((entry) => entry.sampleId);
  if (new Set(regressionIds).size !== regressionIds.length) throw regressionError("perception.regression_sample_duplicate");

  const samplesById = new Map(corpus.samples.map((sample) => [sample.id, sample]));
  const samples = regressionIds.map((sampleId) => {
    const sample = samplesById.get(sampleId);
    if (!sample) throw regressionError("perception.regression_sample_unknown");
    return sample;
  }).sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (samples.length === 0) throw regressionError("perception.regression_samples_required");

  const destination = resolve(outputRoot);
  await assertEmptyDestination(destination);
  const staging = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  const sourceRoot = deriveSourceRoot(corpus, samplesById);
  const manifest = {
    schemaVersion: 1,
    packId: `${corpus.packId}-regressions`,
    version: corpus.version,
    tier: "quick",
    provenance: corpus.provenance,
    licenses: corpus.licenses.map(cloneJson),
    samples: samples.map(cloneJson),
    regressions: report.regressions
      .map(cloneJson)
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId, "en")),
  };

  try {
    await mkdir(staging, { recursive: false });
    for (const license of manifest.licenses) await copyTarget(sourceRoot, staging, license.target);
    for (const sample of manifest.samples) await copyTarget(sourceRoot, staging, sample.image.target);
    const privacy = await scanCorpusPrivacy({ manifest, root: staging });
    if (privacy.status !== "passed") throw regressionError("perception.regression_privacy_rejected");
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validateInputs({ report, corpus, outputRoot }) {
  if (corpus?.status !== "verified" || typeof corpus.resolveImagePath !== "function" || !Array.isArray(corpus.samples)) {
    throw regressionError("perception.regression_corpus_unverified");
  }
  if (!new Set(["perception-corpus", "perception-corpus-gate"]).has(report?.benchmark) || !Array.isArray(report.regressions)
    || report.corpus?.packId !== corpus.packId || report.corpus?.version !== corpus.version || report.corpus?.tier !== corpus.tier) {
    throw regressionError("perception.regression_report_invalid");
  }
  if (typeof outputRoot !== "string" || outputRoot.trim() === "") throw regressionError("perception.regression_output_required");
}

async function assertEmptyDestination(path) {
  const stat = await lstat(path).catch(() => null);
  if (!stat) return;
  if (!stat.isDirectory() || (await readdir(path)).length !== 0) throw regressionError("perception.regression_output_not_empty");
}

function deriveSourceRoot(corpus, samplesById) {
  const sample = samplesById.values().next().value;
  let root = resolve(corpus.resolveImagePath(sample.id));
  for (const _segment of sample.image.target.split("/")) root = dirname(root);
  return root;
}

async function copyTarget(sourceRoot, destinationRoot, target) {
  const destination = join(destinationRoot, ...target.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(sourceRoot, ...target.split("/")), destination);
}

function cloneJson(value) {
  return structuredClone(value);
}

function regressionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
