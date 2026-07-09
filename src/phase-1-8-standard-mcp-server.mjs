import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  { name: "agent-computer-use-phase-1-8-standard-server-smoke", version: "0.0.1" },
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

  const passed = health.isError === false
    && health.structuredContent?.phases?.["1.8"] === "standard-sdk-server-transport"
    && tools.tools.some((tool) => tool.name === "computer.installation");

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "1.8",
    benchmark: "official-mcp-sdk-server-stdio",
    sdk: "@modelcontextprotocol/sdk",
    serverTransport: "StdioServerTransport",
    serverImplementation: "Server",
    toolCount: tools.tools.length,
    health: {
      module: health.structuredContent?.module,
      phase: health.structuredContent?.phases?.["1.8"],
      includeUserOverlay: health.structuredContent?.includeUserOverlay,
    },
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "1.8",
    benchmark: "official-mcp-sdk-server-stdio",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
