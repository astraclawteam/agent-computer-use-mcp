import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";

const client = new Client(
  { name: "agent-computer-use-phase-5-3-tool-schemas", version: "0.0.1" },
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

  const toolsWithOutputSchema = tools.tools.filter((tool) => {
    const schema = tool.outputSchema;
    return schema?.type === "object"
      && schema.additionalProperties === false
      && schema.properties?.includeUserOverlay?.const === false
      && schema.properties?.resultSchemaVersion?.const === MCP_RESULT_SCHEMA_VERSION
      && schema.required?.includes("includeUserOverlay")
      && schema.required?.includes("resultSchemaVersion");
  }).length;
  const versionedContracts = tools.tools.filter((tool) => (
    tool.outputSchema?.properties?.resultSchemaVersion?.const === MCP_RESULT_SCHEMA_VERSION
  )).length;
  const passed = tools.tools.length > 0
    && toolsWithOutputSchema === tools.tools.length
    && versionedContracts === tools.tools.length
    && health.isError === false
    && health.structuredContent?.resultSchemaVersion === MCP_RESULT_SCHEMA_VERSION
    && health.structuredContent?.phases?.["5.3"] === "strict-tool-output-schemas"
    && health.structuredContent?.includeUserOverlay === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.3",
    benchmark: "strict-tool-output-schemas",
    sdk: "@modelcontextprotocol/sdk",
    toolCount: tools.tools.length,
    toolsWithOutputSchema,
    versionedContracts,
    healthResultSchemaVersion: health.structuredContent?.resultSchemaVersion,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.3",
    benchmark: "strict-tool-output-schemas",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
