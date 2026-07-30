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
      version: "0.0.6",
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
    return callTool(router, name, args, request.params._meta?.["xiaozhiclaw/requestContext"]);
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

export const main = runComputerUseMcpServer;

export function createPlatformOcrSession(platformRuntime, options = {}) {
  const Session = options.Session ?? OcrSidecarSession;
  const paths = platformRuntime?.paths;
  if (!paths?.ocrModelRoot || !paths?.ocrRuntimeRoot) return new Session();
  const processOptions = platformRuntime?.ocrProcess
    ? {
        node: {
          command: platformRuntime.ocrProcess.command,
          args: platformRuntime.ocrProcess.args ?? [],
          label: "sea",
        },
        sidecarPath: platformRuntime.ocrProcess.sidecarPath,
      }
    : {};
  return new Session({
    ...processOptions,
    environment: createPlatformOcrEnvironment({
      modelRoot: paths.ocrModelRoot,
      runtimeRoot: paths.ocrRuntimeRoot,
      baseEnvironment: options.baseEnvironment ?? process.env,
      networkDisabled: true,
      platform: options.platform ?? process.platform,
    }),
  });
}

export async function callTool(router, name, args, requestContext) {
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
    } else if (name === "computer.acquire") {
      structuredContent = await router.requestAccess({ ...args, requestContext });
    } else if (name === "computer.observe") {
      structuredContent = await observeComputer(router, args, requestContext);
    } else if (name === "computer.act") {
      structuredContent = await router.act({ ...args, requestContext });
    } else if (name === "computer.release") {
      structuredContent = await router.cancel({ ...args, requestContext });
    } else {
      throw new Error(`tool_not_found: ${name}`);
    }
  } catch (error) {
    const toolError = serializeToolError(error);
    return {
      content: [
        {
          type: "text",
          text: renderComputerUseTextResult({ error: toolError }),
        },
      ],
      structuredContent: withResultContract({
        status: "error",
        error: toolError,
      }),
      isError: true,
    };
  }

  let projected;
  try {
    projected = await projectComputerUseMediaResult(router, name, args, structuredContent);
  } catch (error) {
    const toolError = serializeToolError(error);
    return {
      content: [{ type: "text", text: renderComputerUseTextResult({ error: toolError }) }],
      structuredContent: withResultContract({ status: "error", error: toolError }),
      isError: true,
    };
  }
  structuredContent = withResultContract(compactComputerUseResult(projected.structuredContent));
  return {
    content: [
      {
        type: "text",
        text: renderComputerUseTextResult(structuredContent),
      },
      ...projected.imageContent,
    ],
    structuredContent,
    ...(projected.imageContent.length > 0 ? {
      _meta: {
        "xiaozhiclaw/visual-understanding-capability": {
          sameTransaction: true,
          requestField: "visualQuestion",
        },
        ...(typeof args?.visualQuestion === "string"
          && args.visualQuestion.trim() ? {
        "xiaozhiclaw/visual-understanding": {
          mode: "auto",
          instruction: args.visualQuestion.trim().slice(0, 1200),
        },
          } : {}),
      },
    } : {}),
    // An indeterminate desktop action is not a protocol/tool failure. The
    // action may already have reached the application and must not be replayed;
    // the caller has to observe the fresh UI state to resolve its outcome.
    // Reserve MCP isError for rejected requests and execution failures caught
    // above so agents do not abandon a healthy connector or retry mutations.
    isError: false,
  };
}

/**
 * Project the exact structured result into compact Markdown for the Agent
 * channel. The Host and UI retain structuredContent as the lossless contract;
 * this projection removes pretty-JSON punctuation and indentation from the
 * model-visible copy without asking the Agent to read a local file.
 */
export function renderComputerUseTextResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `# Computer Use Result\n\n- **value**: ${compactMarkdownValue(value)}`;
  }
  const lines = ["# Computer Use Result"];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      lines.push("", `## ${key} (${entry.length})`);
      if (entry.length === 0) {
        lines.push("- none");
      } else {
        for (const item of entry) lines.push(`- ${compactMarkdownValue(item)}`);
      }
      continue;
    }
    lines.push(`- **${key}**: ${compactMarkdownValue(entry)}`);
  }
  return lines.join("\n");
}

function compactMarkdownValue(value) {
  if (value === undefined) return "undefined";
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

export async function projectComputerUseMediaResult(router, name, args, value) {
  if (name !== "computer.observe") {
    return { structuredContent: value, imageContent: [] };
  }
  const mode = args?.mode;
  const artifactPath = value?.artifact?.path ?? value?.capture?.path;
  const shouldAttachImage = (mode === "screenshot" || mode === "capture-window")
    && typeof artifactPath === "string";
  const structuredContent = sanitizeObservationMediaPaths(value, shouldAttachImage);
  if (!shouldAttachImage) return { structuredContent, imageContent: [] };
  if (typeof router?.readOwnedArtifact !== "function") {
    throw new Error("artifact.bridge_unavailable: Computer Use cannot safely read its capture asset");
  }
  const bytes = await router.readOwnedArtifact(artifactPath, { maxBytes: 20 * 1024 * 1024 });
  if (!Buffer.isBuffer(bytes)
    || bytes.byteLength < 8
    || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    throw new Error("artifact.invalid: Computer Use capture is not a PNG image");
  }
  return {
    structuredContent,
    imageContent: [{
      type: "image",
      data: bytes.toString("base64"),
      mimeType: "image/png",
    }],
  };
}

function sanitizeObservationMediaPaths(value, hasImageContent) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeObservationMediaPaths(entry, hasImageContent));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "path" || key === "imagePath" || key === "outputPath") && typeof entry === "string") continue;
    result[key] = sanitizeObservationMediaPaths(entry, hasImageContent);
  }
  if (value.artifact && typeof value.artifact === "object") {
    result.artifact = {
      ...result.artifact,
      ...(hasImageContent ? { delivery: "mcp-image-content" } : {}),
    };
  }
  return result;
}

/**
 * Keep the provider's full observation in memory for admission and action
 * grounding, but expose a compact model-facing projection over MCP. OCR
 * elements otherwise repeat provenance, hashes, and identical geometry for
 * every recognized fragment, which can turn one screen into a result large
 * enough to require several unrelated file reads before the agent can act.
 */
export function compactComputerUseResult(value) {
  if (Array.isArray(value)) return value.map(compactComputerUseResult);
  if (!value || typeof value !== "object") return value;

  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "elements" && Array.isArray(entry)) {
      compacted.elements = entry.map(compactPerceptionElement);
      compacted.elementCount = entry.length;
      continue;
    }
    compacted[key] = compactComputerUseResult(entry);
  }

  if (Array.isArray(value.elements) && value.elements.length > 0) {
    const repeatedText = value.elements.map((element) => element?.name).filter(Boolean).join("\n");
    if (compacted.text === repeatedText) delete compacted.text;
  }
  return compacted;
}

function compactPerceptionElement(element) {
  if (!element || typeof element !== "object") return element;
  const compacted = {};
  for (const key of [
    "elementToken",
    "elementIndex",
    "role",
    "name",
    "actions",
    "bounds",
    "confidence",
    "source",
  ]) {
    if (element[key] !== undefined) compacted[key] = compactComputerUseResult(element[key]);
  }
  if (element.value !== undefined && element.value !== element.name) compacted.value = element.value;
  if (element.state && Object.keys(element.state).length > 0) compacted.state = compactComputerUseResult(element.state);
  for (const flag of [
    "exact",
    "approvedActionLabel",
    "passwordRegion",
    "paymentRegion",
    "privateRegion",
  ]) {
    if (element[flag] === true) compacted[flag] = true;
  }
  return compacted;
}

export async function observeComputer(router, args, requestContext) {
  const { mode, ...options } = args;
  if (mode === "state") return router.listState();
  if (mode === "semantic" || mode === "screenshot" || mode === "ocr-region") {
    return router.capture({
      ...options,
      mode,
      ...(requestContext === undefined ? {} : { requestContext }),
    });
  }
  if (mode === "capture-window") return router.captureWindow(options);
  if (mode === "diff") return router.observeDiff(options);
  throw new Error(`observe_mode_not_found: ${mode}`);
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
  await main();
}
