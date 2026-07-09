import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  { name: "agent-computer-use-phase-1-7-standard-client", version: "0.0.1" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/computer-use-mcp-server.mjs"],
  cwd: process.cwd(),
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const health = await client.callTool({
    name: "computer.health",
    arguments: { fast: true },
  });
  const installation = await client.callTool({
    name: "computer.installation",
    arguments: { client: "codex" },
  });

  const toolNames = tools.tools.map((tool) => tool.name);
  const passed = toolNames.includes("computer.health")
    && toolNames.includes("computer.installation")
    && health.isError === false
    && health.structuredContent?.phases?.["1.7"] === "standard-sdk-client-smoke"
    && installation.isError === false
    && installation.structuredContent?.clientConfig?.config?.mcpServers?.["agent-computer-use"]?.command === process.execPath;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "1.7",
    benchmark: "official-mcp-sdk-client-stdio",
    sdk: "@modelcontextprotocol/sdk",
    toolCount: toolNames.length,
    tools: toolNames,
    health: {
      module: health.structuredContent?.module,
      phase: health.structuredContent?.phases?.["1.7"],
      includeUserOverlay: health.structuredContent?.includeUserOverlay,
    },
    clientConfig: installation.structuredContent?.clientConfig,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "1.7",
    benchmark: "official-mcp-sdk-client-stdio",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
