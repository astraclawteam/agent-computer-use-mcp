import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runAppAdapter } from "./app-adapters/adapter-contract.mjs";
import { INSTALLED_APP_ADAPTER_FACTORIES, PRIVACY_APP_ADAPTER_FACTORIES, TIER_A_ADAPTER_FACTORIES } from "./app-adapters/index.mjs";
import { inspectWindowsExecutableIdentity } from "./app-adapters/shared.mjs";
import { createEvidenceRun } from "./commercial-evidence.mjs";
import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";
import { startGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { runRealAppSmokeCatalog } from "./real-app-smoke-runner.mjs";

const args = parseArguments(process.argv.slice(2));
const catalog = JSON.parse(await readFile("docs/productization/real-app-smoke-catalog.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const filters = { roles: args.roles, appIds: args.appIds };
const evidenceRun = await createEvidenceRun({
  root: resolve(args.evidenceRoot ?? process.env.AGENT_COMPUTER_USE_REAL_APP_EVIDENCE_ROOT ?? "evidence/real-app"),
  runId: process.env.AGENT_COMPUTER_USE_REAL_APP_RUN_ID ?? `real-app-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`,
  manifest: { schemaVersion: 1, phase: "6.2", package: { name: packageJson.name, version: packageJson.version }, platform: process.platform, architecture: process.arch, filters },
});
const report = await runRealAppSmokeCatalog({ catalog, filters, evidenceRun, startOverlay: () => startGatewayManagedOverlay(), executeAdapter });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

async function executeAdapter(entry, context) {
  let executable;
  try { executable = await resolveExecutable(entry.executableCandidates); }
  catch (error) { return failure("infrastructure-error", error?.code ?? "app.executable_probe_failed"); }
  if (!executable) return failure("not-installed", "app.executable_missing");
  const factory = TIER_A_ADAPTER_FACTORIES[entry.adapter] ?? INSTALLED_APP_ADAPTER_FACTORIES[entry.adapter] ?? PRIVACY_APP_ADAPTER_FACTORIES[entry.adapter];
  if (!factory) return failure("product-failure", "app.adapter_not_registered");
  const mcp = new CuaDriverMcpClient({ driverPath: process.env.AGENT_COMPUTER_USE_CUA_DRIVER ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe` });
  const common = { mcp, executable, overlayTargetRectFile: context.targetRectFile, expectedText: `${entry.appId} installed evidence`, proposalProvider: async () => null, verifyProposal: async () => false };
  const privacy = entry.appId === "policy-wechat" ? { applicationId: "wechat", fixedTitlePrefixes: ["微信", "Weixin"] }
    : entry.appId === "policy-wecom" ? { applicationId: "wecom", fixedTitlePrefixes: ["企业微信", "WeCom"] } : {};
  return runAppAdapter(factory({ ...common, ...privacy }), { controlLease: { id: `real-app-${entry.appId}-${context.attemptNumber}`, status: "active" } });
}

async function resolveExecutable(candidates) {
  for (const candidate of candidates) {
    const path = resolve(candidate.replace(/%([^%]+)%/gu, (_, name) => process.env[name] ?? `%${name}%`));
    try { return await inspectWindowsExecutableIdentity(path); }
    catch (error) { if (error?.code !== "app.executable_missing") throw error; }
  }
  return null;
}

function failure(status, reason) { return { status, reason, cleanup: { status: "passed" } }; }
function parseArguments(values) {
  const result = { roles: [], appIds: [], evidenceRoot: null };
  for (let index = 0; index < values.length; index += 2) {
    const [name, value] = values.slice(index, index + 2);
    if (!["--role", "--app-id", "--evidence-root"].includes(name) || !value || value.startsWith("--")) throw new Error(`app.real_smoke_argument_invalid: ${name}`);
    if (name === "--role") result.roles.push(value); else if (name === "--app-id") result.appIds.push(value); else result.evidenceRoot = value;
  }
  return result;
}
