import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runRealReleaseAssemblyPhase } from "../src/phase-0-15-real-release-assembly.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const report = await runRealReleaseAssemblyPhase({
  version: packageJson.version,
  sourceCommit: process.env.GITHUB_SHA,
  generatedAt: process.env.AGENT_COMPUTER_USE_RELEASE_GENERATED_AT,
  outputRoot: resolve("artifacts/platform-release", packageJson.version),
  allowNetwork: process.argv.includes("--allow-network"),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
