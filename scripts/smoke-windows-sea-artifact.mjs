import { resolve } from "node:path";
import { runWindowsSeaSmoke } from "../src/windows-sea-smoke.mjs";

const artifactPath = readOption("--artifact")
  ?? resolve("artifacts/mcp-executable/0.0.1/win32-x64/agent-computer-use-mcp-0.0.1-win32-x64.tar.gz");

const result = await runWindowsSeaSmoke({ artifactPath });
console.log(JSON.stringify(result, null, 2));

function readOption(name) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
