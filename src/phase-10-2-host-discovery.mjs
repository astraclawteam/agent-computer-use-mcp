#!/usr/bin/env node
import { createClaudeDesktopDriver } from "./agent-e2e/host-drivers/claude-desktop.mjs";
import { createCodexDesktopDriver } from "./agent-e2e/host-drivers/codex-desktop.mjs";
import { createXiaozhiWebDriver } from "./agent-e2e/host-drivers/xiaozhi-web.mjs";

const url = parseUrl(process.argv.slice(2));
const drivers = [
  createCodexDesktopDriver(),
  createClaudeDesktopDriver(),
  createXiaozhiWebDriver({ lane: "xiaozhi-deepseek-v4-flash", url }),
  createXiaozhiWebDriver({ lane: "xiaozhi-claude-sonnet-5", url }),
];
const lanes = await Promise.all(drivers.map((driver) => driver.discover()));
const report = Object.freeze({
  schemaVersion: 1,
  phase: "10.2",
  benchmark: "agent-e2e-host-discovery",
  status: lanes.every((lane) => lane.available) ? "ready" : "blocked",
  qualificationClaim: false,
  lanes,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function parseUrl(args) {
  if (args.length === 0) return "http://127.0.0.1:5174/";
  if (args.length !== 2 || args[0] !== "--url" || !args[1]) throw new Error("agent_e2e.discovery_argument_invalid");
  return args[1];
}
