import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createPhase14ServerEnvironment,
  resolvePhase14Driver,
} from "./phase-1-4-driver.mjs";

const labProject = resolve("native-lab/NativeComputerUseLab.csproj");
const labExe = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const expectedText = "xiaozhi-mcp-action";
const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-1-4-"));
const outputFile = join(dir, "saved.txt");
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
let server = null;
let driverResolution = null;
let lab = null;

try {
  driverResolution = await resolvePhase14Driver({
    packageRoot: process.cwd(),
    packageVersion: packageJson.version,
  });
  server = createMcpClient(driverResolution.path);
  if (!existsSync(labExe)) {
    await run("dotnet", ["build", labProject], { windowsHide: true });
  }

  lab = spawn(labExe, [outputFile], {
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));

  await server.connect();
  const state = await server.callTool("computer.observe", { mode: "state" });
  const targetWindow = state.windows?.find((window) => window.title?.includes(basename(outputFile)));
  if (!targetWindow?.windowId) {
    throw new Error(`window.not_found: ${basename(outputFile)}`);
  }
  const access = await server.callTool("computer.acquire", {
    windowId: targetWindow.windowId,
    tier: "full",
    agentId: "phase-1-4-smoke",
    reason: "Phase 1.4 real MCP action validation",
  });
  if (access.status !== "granted") {
    throw new Error(`acquire.failed: ${JSON.stringify(access)}`);
  }
  const capture = await server.callTool("computer.observe", { mode: "semantic" });
  if (!Array.isArray(capture.scene?.elements)) {
    throw new Error(`observe.invalid_response: ${JSON.stringify(capture)}`);
  }
  const name = capture.scene.elements.find((element) => element.type === "Editable" && element.name === "Name")
    ?? capture.scene.elements.find((element) => element.name === "Name");
  const save = capture.scene.elements.find((element) => element.type === "ActionableItem" && element.name === "Save")
    ?? capture.scene.elements.find((element) => element.name === "Save");
  if (!name) throw new Error("element.not_found: Name");
  if (!save) throw new Error("element.not_found: Save");

  const setValue = await server.callTool("computer.act", {
    action: {
      kind: "set_value",
      elementId: name.id,
      value: expectedText,
    },
  });
  const postValueCapture = await server.callTool("computer.observe", { mode: "semantic" });
  const postValueSave = postValueCapture.scene?.elements.find((element) => element.type === "ActionableItem" && element.name === "Save")
    ?? postValueCapture.scene?.elements.find((element) => element.name === "Save");
  if (!postValueSave) throw new Error("element.not_found_after_set_value: Save");
  const click = await server.callTool("computer.act", {
    action: {
      kind: "click",
      elementId: postValueSave.id,
      deliveryMode: "background",
      captureAfter: true,
    },
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const stateBeforeRelease = await server.callTool("computer.observe", { mode: "state" });
  const diskText = await readFile(outputFile, "utf8");
  const release = await server.callTool("computer.release", { reason: "phase-1-4-complete" });
  const stateAfterRelease = await server.callTool("computer.observe", { mode: "state" });
  const clickOutcomeIsHonest = click.outcome === "committed"
    || click.outcome === "indeterminate";
  const passed = diskText === expectedText
    && access.status === "granted"
    && capture.includeUserOverlay === false
    && setValue.outcome === "committed"
    && clickOutcomeIsHonest
    && stateBeforeRelease.status === "active"
    && stateAfterRelease.status === "idle";

  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "1.4",
    benchmark: "real-mcp-action-lifecycle",
    server: "agent-computer-use-mcp",
    driver: {
      source: driverResolution.source,
      version: driverResolution.version,
    },
    filePath: outputFile,
    diskText,
    access: {
      status: access.status,
      overlayVisible: access.overlay?.visible,
      window: access.controller?.window,
      includeUserOverlay: access.includeUserOverlay,
    },
    capture: {
      observationId: capture.observationId,
      elementCount: capture.scene.elements.length,
      includeUserOverlay: capture.includeUserOverlay,
    },
    setValue,
    click: {
      status: click.status,
      outcome: click.outcome,
      externallyVerifiedBy: diskText === expectedText ? "saved-file-bytes" : null,
      provider: click.provider,
      pixelLimitedAction: click.pixelLimitedAction,
      includeUserOverlay: click.includeUserOverlay,
      captureAfter: Boolean(click.capture),
    },
    stateBeforeRelease: {
      status: stateBeforeRelease.status,
      auditEvents: stateBeforeRelease.auditEvents.map((event) => event.type),
      includeUserOverlay: stateBeforeRelease.includeUserOverlay,
    },
    release: {
      status: release.status,
      includeUserOverlay: release.includeUserOverlay,
    },
    stateAfterRelease: {
      status: stateAfterRelease.status,
      activeController: stateAfterRelease.activeController,
      includeUserOverlay: stateAfterRelease.includeUserOverlay,
    },
    includeUserOverlay: false,
  }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    phase: "1.4",
    benchmark: "real-mcp-action-lifecycle",
    error: error instanceof Error ? error.message : String(error),
    serverStderr: server?.stderrText().slice(-4000) ?? "",
    includeUserOverlay: false,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await server?.close();
  if (lab && !lab.killed) {
    lab.kill();
  }
}

function createMcpClient(driverPath) {
  const client = new Client({
    name: "phase-1-4-smoke",
    version: "0.0.1",
  }, {
    capabilities: {},
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs", "--tool-surface=host"],
    cwd: process.cwd(),
    env: createPhase14ServerEnvironment(process.env, driverPath),
    stderr: "pipe",
  });
  let stderr = "";

  return {
    connect: async () => {
      await client.connect(transport);
      transport.stderr?.on?.("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
    },
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return result.structuredContent ?? result;
    },
    close: async () => {
      await client.callTool({ name: "computer.release", arguments: { reason: "client-close" } }).catch(() => {});
      await client.close().catch(() => {});
    },
    stderrText: () => stderr,
  };
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      shell: false,
      windowsHide: options.windowsHide ?? true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
