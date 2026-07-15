#!/usr/bin/env node
import { evaluateCommercialPromotion } from "./commercial-promotion.mjs";

const evidenceDirectories = parseEvidenceDirectories(process.argv.slice(2));
const report = await evaluateCommercialPromotion(evidenceDirectories);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.eligible ? 0 : 1;

function parseEvidenceDirectories(args) {
  const paths = [];
  const agentPaths = [];
  for (let index = 0; index < args.length; index += 2) {
    if (!["--evidence", "--agent-e2e-evidence"].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`promotion.argument_invalid: ${args[index] ?? "missing"}`);
    }
    (args[index] === "--evidence" ? paths : agentPaths).push(args[index + 1]);
  }
  return { evidenceDirectories: paths, agentE2eEvidenceDirectories: agentPaths };
}
