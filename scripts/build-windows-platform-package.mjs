import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const args = parseArgs(process.argv.slice(2));
const sourceCommit = args.sourceCommit ?? process.env.GITHUB_SHA ?? await currentCommit();
const report = await buildWindowsPlatformPackage({
  outputRoot: resolve(args.output ?? "artifacts/npm-release/platform-win32-x64/package"),
  version: args.version ?? packageJson.version,
  sourceCommit,
  assetLockPath: args.assetLockPath,
  cacheRoot: args.cacheRoot,
  allowNetwork: args.allowNetwork,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

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
    else throw new Error(`platform.argument_unknown: ${value}`);
  }
  return result;
}

function requiredValue(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`platform.argument_missing: ${name}`);
  return value;
}

async function currentCommit() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { windowsHide: true });
  return stdout.trim();
}
