#!/usr/bin/env node
import { validateCampaignInputs, evaluateHostDiscovery } from "./agent-e2e/campaign-preflight.mjs";
import { createClaudeDesktopDriver } from "./agent-e2e/host-drivers/claude-desktop.mjs";
import { createCodexDesktopDriver } from "./agent-e2e/host-drivers/codex-desktop.mjs";
import { createXiaozhiWebDriver } from "./agent-e2e/host-drivers/xiaozhi-web.mjs";

const args = parseArguments(process.argv.slice(2));
const inputs = await validateCampaignInputs(args);
const drivers = [
  createCodexDesktopDriver(),
  createClaudeDesktopDriver(),
  createXiaozhiWebDriver({ lane: "xiaozhi-deepseek-v4-flash", url: args.url }),
  createXiaozhiWebDriver({ lane: "xiaozhi-claude-sonnet-5", url: args.url }),
];
const discovery = evaluateHostDiscovery(await Promise.all(drivers.map((driver) => driver.discover())));
const report = Object.freeze({
  schemaVersion: 1,
  phase: "10.3",
  benchmark: "agent-e2e-campaign",
  status: discovery.status,
  qualificationClaim: false,
  inputs: { releasedPackagesVerified: true, evidenceRootConfigured: Boolean(inputs.evidenceRoot) },
  blockers: discovery.blockers,
  lanes: discovery.lanes,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "ready" ? 0 : 1;

function parseArguments(values) {
  const result = { url: "http://127.0.0.1:5174/" };
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!["--release-package", "--platform-package", "--evidence-root", "--url"].includes(name) || !value || value.startsWith("--")) {
      throw new Error(`agent_e2e.campaign_argument_invalid: ${name ?? "missing"}`);
    }
    if (name === "--release-package") result.releasePackage = value;
    else if (name === "--platform-package") result.platformPackage = value;
    else if (name === "--evidence-root") result.evidenceRoot = value;
    else result.url = value;
  }
  return result;
}
