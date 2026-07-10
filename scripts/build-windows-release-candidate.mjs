import { resolve } from "node:path";

import { assembleWindowsReleaseCandidate } from "../src/windows-release-assembly.mjs";

const report = await assembleWindowsReleaseCandidate({
  outputRoot: resolve(process.env.AGENT_COMPUTER_USE_RELEASE_OUTPUT_ROOT ?? "artifacts/release/windows-x64-candidate"),
  cacheRoot: resolve(process.env.AGENT_COMPUTER_USE_RELEASE_CACHE_ROOT ?? "artifacts/release-cache"),
  allowNetwork: process.env.AGENT_COMPUTER_USE_RELEASE_ALLOW_NETWORK !== "0",
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
