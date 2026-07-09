import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const clientNames = [
  "agent-computer-use-phase-5-1-client-a",
  "agent-computer-use-phase-5-1-client-b",
];
const clients = clientNames.map((name) => createClient(name));

try {
  await Promise.all(clients.map(({ client, transport }) => client.connect(transport)));

  const results = await Promise.all(clients.map(async ({ client, name }) => {
    const tools = await client.listTools();
    const health = await client.callTool({
      name: "computer.health",
      arguments: { fast: true },
    });
    const installation = await client.callTool({
      name: "computer.installation",
      arguments: { client: "codex" },
    });
    return {
      name,
      toolNames: tools.tools.map((tool) => tool.name),
      health,
      installation,
    };
  }));

  const passed = results.length === 2
    && results.every((result) => result.toolNames.includes("computer.health"))
    && results.every((result) => result.toolNames.includes("computer.installation"))
    && results.every((result) => result.health.isError === false)
    && results.every((result) => result.health.structuredContent?.phases?.["5.1"] === "standard-mcp-multi-client")
    && results.every((result) => result.installation.isError === false)
    && results.every((result) => result.installation.structuredContent?.clientConfig?.config?.mcpServers?.["agent-computer-use"])
    && results.every((result) => result.health.structuredContent?.includeUserOverlay === false);

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.1",
    benchmark: "standard-mcp-multi-client",
    sdk: "@modelcontextprotocol/sdk",
    clientCount: results.length,
    clientNames: results.map((result) => result.name),
    healthCalls: results.filter((result) => result.health.isError === false).length,
    installationCalls: results.filter((result) => result.installation.isError === false).length,
    toolCounts: results.map((result) => result.toolNames.length),
    readOnlyOnly: true,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.1",
    benchmark: "standard-mcp-multi-client",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(({ client }) => client.close().catch(() => {})));
}

function createClient(name) {
  const client = new Client(
    { name, version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });
  return { name, client, transport };
}
