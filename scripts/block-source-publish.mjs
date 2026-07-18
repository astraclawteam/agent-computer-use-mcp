import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertNoCutoverReleaseDefinition(records) {
  if (records.some((record) => record?.cutover === true && ["agent-computer-use-mcp", "@xiaozhiclaw/agent-computer-use-win32-x64"].includes(record.package))) {
    throw new Error("agent-computer-use-mcp is cut over but still exposes a release definition");
  }
}

function retirementRecords() {
  try { const value = JSON.parse(readFileSync("npm-retirements.json", "utf8")); return Array.isArray(value) ? value : []; }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assertNoCutoverReleaseDefinition(retirementRecords());
  process.stderr.write("release.source_publish_blocked: agent-computer-use-mcp is an outgoing npm identity; publish is blocked from the source workspace\n");
  process.exitCode = 1;
}
