import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const READ_ONLY_CALLS = ["computer.health", "computer.installation"];
const STATE_CHANGING_TOOLS = new Set([
  "computer.request_access",
  "computer.act",
  "computer.cancel",
  "computer.revoke",
  "computer.repair",
]);

const client = new Client(
  { name: "mcp-inspector", version: "0.0.1" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/computer-use-mcp-server.mjs"],
  cwd: process.cwd(),
});
const calledTools = [];

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const health = await callInspectorTool("computer.health", { fast: true });
  const installation = await callInspectorTool("computer.installation", { client: "codex" });
  const stateChangingToolsCalled = calledTools
    .filter((name) => STATE_CHANGING_TOOLS.has(name))
    .length;

  const passed = toolNames.includes("computer.health")
    && toolNames.includes("computer.installation")
    && health.isError === false
    && installation.isError === false
    && health.structuredContent?.phases?.["5.4"] === "mcp-inspector-smoke"
    && health.structuredContent?.includeUserOverlay === false
    && installation.structuredContent?.includeUserOverlay === false
    && stateChangingToolsCalled === 0;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.4",
    benchmark: "mcp-inspector-smoke",
    sdk: "@modelcontextprotocol/sdk",
    clientProfile: "mcp-inspector",
    initialized: true,
    listTools: true,
    toolNames,
    readOnlyCalls: calledTools,
    readOnlyOnly: true,
    stateChangingToolsCalled,
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.4",
    benchmark: "mcp-inspector-smoke",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}

async function callInspectorTool(name, args) {
  calledTools.push(name);
  return client.callTool({ name, arguments: args });
}
