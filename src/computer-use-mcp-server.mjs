#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { COMPUTER_USE_MCP_TOOLS, MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";
import { serializeToolError } from "./computer-use-errors.mjs";
import { getComputerUseInstallation } from "./computer-use-installation.mjs";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";
import { CuaDriverMcpDriver } from "./cua-driver-mcp-driver.mjs";
import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { createPlatformOcrEnvironment, OcrSidecarSession } from "./ocr-sidecar.mjs";

export async function runComputerUseMcpServer(options = {}) {
  const router = new ComputerUseProviderRouter({
    ocrSession: createPlatformOcrSession(options.platformRuntime),
    driver: new CuaDriverMcpDriver({
      driverPath: options.platformRuntime?.paths?.cuaDriverExecutable,
    }),
    overlayRuntime: {
      start: (args) => startGatewayManagedOverlay({
        ...args,
        executablePath: options.platformRuntime?.paths?.overlayExecutable,
      }),
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
    return callTool(router, name, args);
  });

  let unregisterShutdownHandlers = () => {};
  const shutdown = createServerShutdown({
    router,
    server,
    cleanup: () => unregisterShutdownHandlers(),
  });
  unregisterShutdownHandlers = registerServerShutdownHandlers({ shutdown });
  await server.connect(new StdioServerTransport());
}

export function createPlatformOcrSession(platformRuntime, options = {}) {
  const Session = options.Session ?? OcrSidecarSession;
  const paths = platformRuntime?.paths;
  if (!paths?.ocrModelRoot || !paths?.ocrRuntimeRoot) return new Session();
  return new Session({
    environment: createPlatformOcrEnvironment({
      modelRoot: paths.ocrModelRoot,
      runtimeRoot: paths.ocrRuntimeRoot,
      baseEnvironment: options.baseEnvironment ?? process.env,
      networkDisabled: true,
      platform: options.platform ?? process.platform,
    }),
  });
}

async function callTool(router, name, args) {
  let structuredContent;
  try {
    if (name === "computer.health") {
      structuredContent = await router.health(args);
    } else if (name === "computer.doctor") {
      structuredContent = await router.doctor(args);
    } else if (name === "computer.repair") {
      structuredContent = await router.repair(args);
    } else if (name === "computer.installation") {
      structuredContent = getComputerUseInstallation({
        client: args.client ?? "codex",
        packageRoot: process.cwd(),
      });
    } else if (name === "computer.request_access") {
      structuredContent = await router.requestAccess(args);
    } else if (name === "computer.approve") {
      structuredContent = await router.approveAccess(args);
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
      structuredContent: withResultContract({
        status: "error",
        error: toolError,
      }),
      isError: true,
    };
  }

  structuredContent = withResultContract(structuredContent);
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

function withResultContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
      value,
      includeUserOverlay: false,
    };
  }
  return {
    ...value,
    resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
    includeUserOverlay: false,
  };
}

export function createServerShutdown({
  router,
  server,
  cleanup = () => {},
  setExitCode = (code) => {
    process.exitCode = code;
  },
}) {
  let requestedExitCode = 0;
  let shutdownPromise = null;
  let shutdownComplete = false;
  return function shutdown(code = 0) {
    requestedExitCode = Math.max(requestedExitCode, code);
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        try {
          await router.close();
        } catch {
          // Continue shutting down the MCP transport even if provider cleanup fails.
        }
        try {
          await server.close();
        } catch {
          // Exit after both independent cleanup stages have been attempted.
        }
        try {
          await cleanup();
        } catch {
          // Handler cleanup must not prevent the process from receiving its exit code.
        }
        shutdownComplete = true;
        setExitCode(requestedExitCode);
      })();
    } else if (shutdownComplete) {
      setExitCode(requestedExitCode);
    }
    return shutdownPromise;
  };
}

export function registerServerShutdownHandlers({
  shutdown,
  stdin = process.stdin,
  processTarget = process,
}) {
  const onEnd = () => {
    void shutdown(0);
  };
  const onClose = () => {
    void shutdown(0);
  };
  const onSigint = () => {
    void shutdown(0);
  };
  const onSigterm = () => {
    void shutdown(0);
  };
  const onUncaughtException = (error) => {
    processTarget.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    void shutdown(1);
  };
  stdin.on("end", onEnd);
  stdin.on("close", onClose);
  processTarget.on("SIGINT", onSigint);
  processTarget.on("SIGTERM", onSigterm);
  processTarget.on("uncaughtException", onUncaughtException);

  let registered = true;
  return function unregister() {
    if (!registered) return;
    registered = false;
    stdin.off("end", onEnd);
    stdin.off("close", onClose);
    processTarget.off("SIGINT", onSigint);
    processTarget.off("SIGTERM", onSigterm);
    processTarget.off("uncaughtException", onUncaughtException);
  };
}

export function shouldAutoStartComputerUseMcpServer(options = {}) {
  const argv = options.argv ?? process.argv;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  return Boolean(argv[1]) && resolve(argv[1]) === fileURLToPath(moduleUrl);
}

if (shouldAutoStartComputerUseMcpServer()) {
  await runComputerUseMcpServer();
}
