#!/usr/bin/env node
import { evaluateQualificationEvidenceDirectories } from "./agent-e2e/qualification-evidence-aggregator.mjs";

const evidence = parseArguments(process.argv.slice(2));
const report = await evaluateQualificationEvidenceDirectories(evidence);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.agentE2eEligible ? 0 : 1;

function parseArguments(values) {
  const paths = [];
  for (let index = 0; index < values.length; index += 2) {
    if (values[index] !== "--evidence" || !values[index + 1] || values[index + 1].startsWith("--")) {
      throw new Error(`agent_e2e.evidence_argument_invalid: ${values[index] ?? "missing"}`);
    }
    paths.push(values[index + 1]);
  }
  return paths;
}
