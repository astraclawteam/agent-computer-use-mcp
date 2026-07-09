import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  { name: "agent-computer-use-phase-2-1-repair", version: "0.0.1" },
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
  const repair = await client.callTool({
    name: "computer.repair",
    arguments: { dryRun: false, approved: false },
  });

  const passed = tools.tools.some((tool) => tool.name === "computer.repair")
    && repair.isError === false
    && repair.structuredContent?.status === "approval_required"
    && repair.structuredContent?.mode === "plan-only"
    && repair.structuredContent?.executesImmediately === false
    && repair.structuredContent?.includeUserOverlay === false
    && repair.structuredContent?.startsDesktopControl === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "2.1",
    benchmark: "mcp-repair-approval-gate",
    sdk: "@modelcontextprotocol/sdk",
    toolCount: tools.tools.length,
    repairStatus: repair.structuredContent?.status,
    repairActionCount: repair.structuredContent?.repairPlan?.actions?.length ?? 0,
    executesImmediately: repair.structuredContent?.executesImmediately,
    includeUserOverlay: repair.structuredContent?.includeUserOverlay,
    startsDesktopControl: repair.structuredContent?.startsDesktopControl,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "2.1",
    benchmark: "mcp-repair-approval-gate",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
