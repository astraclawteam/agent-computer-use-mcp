import {
  executeRuntimeSoakPhase,
  parseRuntimeSoakArgs,
} from "./runtime-soak-evidence.mjs";

const options = parseRuntimeSoakArgs(process.argv.slice(2));
const report = await executeRuntimeSoakPhase(options);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
