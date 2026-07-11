import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { validateFormalReleaseIdentity } from "../src/formal-release-policy.mjs";

const exec = promisify(execFile);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const commit = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim().toLowerCase();
const mainCommits = (await exec("git", ["rev-list", "origin/main"])).stdout.trim().split(/\r?\n/u).filter(Boolean);
const report = validateFormalReleaseIdentity({
  tag: process.env.GITHUB_REF_NAME ?? process.argv[2],
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  commit,
  mainCommits,
  changelog: await readFile("CHANGELOG.md", "utf8"),
});
process.stdout.write(`${JSON.stringify({ ...report, commit, version: packageJson.version }, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
