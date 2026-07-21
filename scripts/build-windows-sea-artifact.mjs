#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { buildWindowsSeaArtifact } from "../src/windows-sea-artifact.mjs";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const sourceCommit = args.sourceCommit ?? await currentCommit();
const version = args.version ?? packageJson.version;
const result = await buildWindowsSeaArtifact({
  outputRoot: resolve(args.output ?? `artifacts/mcp-executable/${version}/win32-x64`),
  version,
  sourceCommit,
  allowNetwork: args.allowNetwork,
  assetLockPath: args.assetLockPath,
  cacheRoot: args.cacheRoot,
});
process.stdout.write(`${JSON.stringify({
  status: result.status,
  archivePath: result.archivePath,
  sha256: result.archiveSha256,
  sizeBytes: result.archiveSizeBytes,
  publisherInputPath: result.publisherInputPath,
}, null, 2)}\n`);

function parseArgs(values) {
  const result = { allowNetwork: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--allow-network") result.allowNetwork = true;
    else if (value === "--output") result.output = requiredValue(values[++index], value);
    else if (value === "--version") result.version = requiredValue(values[++index], value);
    else if (value === "--source-commit") result.sourceCommit = requiredValue(values[++index], value);
    else if (value === "--asset-lock") result.assetLockPath = requiredValue(values[++index], value);
    else if (value === "--cache-root") result.cacheRoot = requiredValue(values[++index], value);
    else throw new Error(`sea.argument_unknown: ${value}`);
  }
  return result;
}

function requiredValue(value, name) {
  if (!value) throw new Error(`sea.argument_missing: ${name}`);
  return value;
}

async function currentCommit() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { windowsHide: true });
  return stdout.trim();
}
