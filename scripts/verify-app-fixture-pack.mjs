import { readFile } from "node:fs/promises";

import { resolveFixturePack } from "../src/app-fixture-pack.mjs";

const values = parseArguments(process.argv.slice(2));
const lockPath = values.lock ?? "docs/productization/app-fixture-pack.lock.json";
const root = values.root ?? process.env.AGENT_COMPUTER_USE_FIXTURE_PACK
  ?? "artifacts/app-fixtures/current";

try {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const report = await resolveFixturePack({ lock, root });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    code: error?.code ?? "app.fixture_verification_failed",
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name !== "--lock" && name !== "--root") throw new Error(`app.fixture_argument_invalid: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`app.fixture_argument_value_required: ${name}`);
    values[name.slice(2)] = value;
    index += 1;
  }
  return values;
}
