import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLIENT_COUNT = 4;
const ROUNDS_PER_CLIENT = 3;
const READ_ONLY_CALLS = [
  ["computer.health", { fast: true }],
  ["computer.installation", { client: "codex" }],
  ["computer.list_state", {}],
];
const STATE_CHANGING_TOOLS = new Set([
  "computer.request_access",
  "computer.approve",
  "computer.act",
  "computer.cancel",
  "computer.revoke",
  "computer.repair",
]);

const startedAt = performance.now();
const clients = Array.from({ length: CLIENT_COUNT }, (_, index) => (
  createClient(`agent-computer-use-phase-5-6-client-${index + 1}`)
));
const calledTools = [];

try {
  await Promise.all(clients.map(({ client, transport }) => client.connect(transport)));
  const clientSummaries = await Promise.all(clients.map(runClientStress));

  const completedReadOnlyCalls = clientSummaries
    .reduce((total, summary) => total + summary.completedReadOnlyCalls, 0);
  const failedCalls = clientSummaries
    .reduce((total, summary) => total + summary.failedCalls, 0);
  const stateChangingToolsCalled = calledTools
    .filter((name) => STATE_CHANGING_TOOLS.has(name))
    .length;
  const expectedReadOnlyCalls = CLIENT_COUNT * ROUNDS_PER_CLIENT * READ_ONLY_CALLS.length;
  const passed = clientSummaries.length === CLIENT_COUNT
    && completedReadOnlyCalls === expectedReadOnlyCalls
    && failedCalls === 0
    && stateChangingToolsCalled === 0
    && clientSummaries.every((summary) => summary.toolNames.includes("computer.health"))
    && clientSummaries.every((summary) => summary.healthPhase === "standard-mcp-multi-client-stress")
    && clientSummaries.every((summary) => summary.overlayLeakCount === 0)
    && clientSummaries.every((summary) => summary.desktopControlStartCount === 0);

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.6",
    benchmark: "standard-mcp-multi-client-stress",
    sdk: "@modelcontextprotocol/sdk",
    clientCount: CLIENT_COUNT,
    roundsPerClient: ROUNDS_PER_CLIENT,
    expectedReadOnlyCalls,
    completedReadOnlyCalls,
    failedCalls,
    stateChangingToolsCalled,
    readOnlyOnly: true,
    startsDesktopControl: false,
    includeUserOverlay: false,
    durationMs: Math.round(performance.now() - startedAt),
    clientSummaries,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.6",
    benchmark: "standard-mcp-multi-client-stress",
    error: error instanceof Error ? error.message : String(error),
    startsDesktopControl: false,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(({ client }) => client.close().catch(() => {})));
}

async function runClientStress({ name, client }) {
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  let completedReadOnlyCalls = 0;
  let failedCalls = 0;
  let healthPhase = null;
  let overlayLeakCount = 0;
  let desktopControlStartCount = 0;

  for (let round = 0; round < ROUNDS_PER_CLIENT; round += 1) {
    for (const [toolName, args] of READ_ONLY_CALLS) {
      calledTools.push(toolName);
      const response = await client.callTool({ name: toolName, arguments: args });
      if (response.isError) {
        failedCalls += 1;
        continue;
      }
      completedReadOnlyCalls += 1;
      if (response.structuredContent?.includeUserOverlay !== false) {
        overlayLeakCount += 1;
      }
      if (response.structuredContent?.startsDesktopControl === true) {
        desktopControlStartCount += 1;
      }
      if (toolName === "computer.health") {
        healthPhase = response.structuredContent?.phases?.["5.6"] ?? null;
      }
    }
  }

  return {
    name,
    toolCount: toolNames.length,
    toolNames,
    completedReadOnlyCalls,
    failedCalls,
    healthPhase,
    overlayLeakCount,
    desktopControlStartCount,
  };
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
