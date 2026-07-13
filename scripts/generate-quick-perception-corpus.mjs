#!/usr/bin/env node
import { resolve } from "node:path";

import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";

const args = process.argv.slice(2);
const outputRoot = resolve(readOption(args, "--output") ?? "artifacts/perception-corpus/quick");
const seed = Number(readOption(args, "--seed") ?? 20260713);
const manifest = await generateQuickCorpus({ outputRoot, seed });
process.stdout.write(`${JSON.stringify({
  status: "generated",
  packId: manifest.packId,
  version: manifest.version,
  samples: manifest.samples.length,
})}\n`);

function readOption(values, name) {
  const index = values.indexOf(name);
  if (index === -1) return undefined;
  if (!values[index + 1] || values[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return values[index + 1];
}
