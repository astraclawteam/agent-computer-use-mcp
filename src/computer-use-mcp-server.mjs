#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { COMPUTER_USE_MCP_TOOLS } from "./computer-use-mcp-tools.mjs";
import { serializeToolError } from "./computer-use-errors.mjs";
import { getComputerUseInstallation } from "./computer-use-installation.mjs";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";
import { CuaDriverMcpDriver } from "./cua-driver-mcp-driver.mjs";
import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";

const router = new ComputerUseProviderRouter({
  driver: new CuaDriverMcpDriver(),
  overlayRuntime: {
    start: (args) => startGatewayManagedOverlay(args),
    stop: (handle) => {
      handle?.stop?.();
      stopGatewayManagedOverlay();
    },
  },
});

const server = new Server(
  {
    name: "agent-computer-use-mcp",
    version: "0.0.1",
  },
  {
    capabilities: {
      tools: { listChanged: false },
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: COMPUTER_USE_MCP_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  return callTool(name, args);
});

process.on("SIGINT", async () => {
  await closeAndExit(0);
});
process.on("SIGTERM", async () => {
  await closeAndExit(0);
});
process.on("uncaughtException", async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await closeAndExit(1);
});

await server.connect(new StdioServerTransport());

async function callTool(name, args) {
  let structuredContent;
  try {
    if (name === "computer.health") {
      structuredContent = await router.health(args);
    } else if (name === "computer.installation") {
      structuredContent = getComputerUseInstallation({
        client: args.client ?? "codex",
        packageRoot: process.cwd(),
      });
    } else if (name === "computer.request_access") {
      structuredContent = await router.requestAccess(args);
    } else if (name === "computer.capture") {
      structuredContent = await router.capture(args);
    } else if (name === "computer.act") {
      structuredContent = await router.act(args);
    } else if (name === "computer.cancel") {
      structuredContent = await router.cancel(args);
    } else if (name === "computer.revoke") {
      structuredContent = await router.revoke(args);
    } else if (name === "computer.list_state") {
      structuredContent = await router.listState(args);
    } else if (name === "computer.capture_window") {
      structuredContent = await router.captureWindow(args);
    } else if (name === "computer.ocr_region") {
      structuredContent = await router.ocrRegion(args);
    } else if (name === "computer.observe_diff") {
      structuredContent = await router.observeDiff(args);
    } else {
      throw new Error(`tool_not_found: ${name}`);
    }
  } catch (error) {
    const toolError = serializeToolError(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: toolError }, null, 2),
        },
      ],
      structuredContent: {
        status: "error",
        error: toolError,
        includeUserOverlay: false,
      },
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: false,
  };
}

async function closeAndExit(code) {
  await router.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(code);
}
