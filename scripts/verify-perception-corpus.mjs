#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyPerceptionCorpus } from "../src/perception-corpus.mjs";
import { scanCorpusPrivacy } from "../src/perception-privacy-scanner.mjs";

const args = process.argv.slice(2);
const root = readOption("--root") ?? process.env.AGENT_COMPUTER_USE_PERCEPTION_CORPUS;
const lockPath = readOption("--lock");
const tier = readOption("--tier") ?? "full";
if (!root) throw verifyError("perception.corpus_argument_required");
if (!lockPath) throw verifyError("perception.corpus_lock_required");
const lock = JSON.parse(await readFile(resolve(lockPath), "utf8"));
const corpus = await verifyPerceptionCorpus({ root, lock, tier });
const privacy = await scanCorpusPrivacy({ manifest: corpus, root });
if (privacy.status !== "passed") throw verifyError("perception.corpus_privacy_rejected");
process.stdout.write(`${JSON.stringify({
  status: "verified",
  packId: corpus.packId,
  version: corpus.version,
  tier: corpus.tier,
  samples: corpus.samples.length,
  privacy: privacy.status,
})}\n`);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw verifyError(`${name.slice(2)}.argument_required`);
  return value;
}

function verifyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
