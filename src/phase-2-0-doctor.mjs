import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  { name: "agent-computer-use-phase-2-0-doctor", version: "0.0.1" },
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
  const doctor = await client.callTool({
    name: "computer.doctor",
    arguments: { fast: true, includeInstallCache: true },
  });

  const passed = tools.tools.some((tool) => tool.name === "computer.doctor")
    && doctor.isError === false
    && doctor.structuredContent?.module === "agent-computer-use-mcp"
    && doctor.structuredContent?.includeUserOverlay === false
    && doctor.structuredContent?.startsDesktopControl === false
    && doctor.structuredContent?.repairPlan?.mode === "plan-only";

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "2.0",
    benchmark: "mcp-doctor-readiness",
    sdk: "@modelcontextprotocol/sdk",
    toolCount: tools.tools.length,
    doctorStatus: doctor.structuredContent?.status,
    repairActionCount: doctor.structuredContent?.repairPlan?.actions?.length ?? 0,
    includeUserOverlay: doctor.structuredContent?.includeUserOverlay,
    startsDesktopControl: doctor.structuredContent?.startsDesktopControl,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "2.0",
    benchmark: "mcp-doctor-readiness",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
