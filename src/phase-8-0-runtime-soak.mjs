import { runRuntimeSoak } from "./runtime-soak-runner.mjs";

const options = parseArgs(process.argv.slice(2));
const report = await runRuntimeSoak(options);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

function parseArgs(args) {
  const values = {
    durationMs: Number(process.env.AGENT_COMPUTER_USE_SOAK_DURATION_MS ?? 60_000),
    clientCount: Number(process.env.AGENT_COMPUTER_USE_SOAK_CLIENTS ?? 2),
    concurrency: Number(process.env.AGENT_COMPUTER_USE_SOAK_CONCURRENCY ?? 2),
    faultEveryRounds: Number(process.env.AGENT_COMPUTER_USE_SOAK_FAULT_EVERY_ROUNDS ?? 20),
  };
  const names = new Map([
    ["--duration-ms", "durationMs"],
    ["--clients", "clientCount"],
    ["--concurrency", "concurrency"],
    ["--fault-every-rounds", "faultEveryRounds"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]);
    if (!name || args[index + 1] === undefined) throw new Error(`runtime.soak_argument_invalid: ${args[index]}`);
    values[name] = Number(args[index + 1]);
  }
  return values;
}
