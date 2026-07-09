import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const labProject = resolve("native-lab/NativeComputerUseLab.csproj");
const labExe = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const expectedText = "xiaozhi-mcp-action";
const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-1-4-"));
const outputFile = join(dir, "saved.txt");
const server = createMcpClient();
let lab = null;

try {
  if (!existsSync(labExe)) {
    await run("dotnet", ["build", labProject], { windowsHide: true });
  }

  lab = spawn(labExe, [outputFile], {
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));

  await server.connect();
  const access = await server.callTool("computer.request_access", {
    titlePart: basename(outputFile),
    tier: "full",
    agentId: "phase-1-4-smoke",
    reason: "Phase 1.4 real MCP action validation",
  });
  const capture = await server.callTool("computer.capture", { mode: "semantic" });
  const name = capture.elements.find((element) => element.role === "edit" && element.name === "Name")
    ?? capture.elements.find((element) => element.name === "Name");
  const save = capture.elements.find((element) => element.role === "button" && element.name === "Save")
    ?? capture.elements.find((element) => element.name === "Save");
  if (!name) throw new Error("element.not_found: Name");
  if (!save) throw new Error("element.not_found: Save");

  const setValue = await server.callTool("computer.act", {
    action: {
      kind: "set_value",
      elementToken: name.elementToken,
      elementIndex: name.elementIndex,
      value: expectedText,
    },
  });
  const click = await server.callTool("computer.act", {
    action: {
      kind: "click",
      elementToken: save.elementToken,
      elementIndex: save.elementIndex,
      deliveryMode: "background",
      captureAfter: true,
    },
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const stateBeforeCancel = await server.callTool("computer.list_state", {});
  const diskText = await readFile(outputFile, "utf8");
  const cancel = await server.callTool("computer.cancel", { reason: "phase-1-4-complete" });
  const stateAfterCancel = await server.callTool("computer.list_state", {});
  const passed = diskText === expectedText
    && access.status === "granted"
    && capture.includeUserOverlay === false
    && setValue.status === "ok"
    && click.status === "ok"
    && stateBeforeCancel.status === "active"
    && stateAfterCancel.status === "idle";

  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "1.4",
    benchmark: "real-mcp-action-lifecycle",
    server: "agent-computer-use-mcp",
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
      elementCount: capture.elements.length,
      includeUserOverlay: capture.includeUserOverlay,
    },
    setValue,
    click: {
      status: click.status,
      provider: click.provider,
      pixelLimitedAction: click.pixelLimitedAction,
      includeUserOverlay: click.includeUserOverlay,
      captureAfter: Boolean(click.capture),
    },
    stateBeforeCancel: {
      status: stateBeforeCancel.status,
      auditEvents: stateBeforeCancel.auditEvents.map((event) => event.type),
      includeUserOverlay: stateBeforeCancel.includeUserOverlay,
    },
    cancel: {
      status: cancel.status,
      includeUserOverlay: cancel.includeUserOverlay,
    },
    stateAfterCancel: {
      status: stateAfterCancel.status,
      activeController: stateAfterCancel.activeController,
      includeUserOverlay: stateAfterCancel.includeUserOverlay,
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
    serverStderr: server.stderrText().slice(-4000),
    includeUserOverlay: false,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await server.close();
  if (lab && !lab.killed) {
    lab.kill();
  }
}

function createMcpClient() {
  const client = new Client({
    name: "phase-1-4-smoke",
    version: "0.0.1",
  }, {
    capabilities: {},
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });
  let stderr = "";
  transport.stderr?.on?.("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return {
    connect: () => client.connect(transport),
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return result.structuredContent ?? result;
    },
    close: async () => {
      await client.callTool({ name: "computer.revoke", arguments: { reason: "client-close" } }).catch(() => {});
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
