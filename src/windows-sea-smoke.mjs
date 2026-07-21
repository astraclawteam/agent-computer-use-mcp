import { execFile, spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { verifyWindowsSeaArtifactTree } from "./windows-sea-artifact.mjs";

const execFileAsync = promisify(execFile);
const EXPECTED_TOOLS = [
  "computer.health",
  "computer.doctor",
  "computer.repair",
  "computer.installation",
  "computer.request_access",
  "computer.approve",
  "computer.capture",
  "computer.act",
  "computer.cancel",
  "computer.revoke",
  "computer.list_state",
  "computer.capture_window",
  "computer.ocr_region",
  "computer.observe_diff",
];

export async function runWindowsSeaSmoke(options = {}) {
  const archivePath = resolve(required(options.artifactPath, "sea_smoke.artifact_missing"));
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-sea-smoke-"));
  const labExecutable = resolve(options.labExecutable ?? "native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
  const labProject = resolve(options.labProject ?? "native-lab/NativeComputerUseLab.csproj");
  let lab;
  let connection;

  try {
    const localArchive = join(root, basename(archivePath));
    await copyFile(archivePath, localArchive);
    await execFileAsync("tar", ["-xzf", basename(localArchive)], { cwd: root, windowsHide: true });
    const artifactRoot = join(root, "artifact");
    const launchRoot = join(root, "launch");
    await mkdir(launchRoot);
    const manifest = JSON.parse(await readFile(join(artifactRoot, "manifest.json"), "utf8"));
    const inventory = JSON.parse(await readFile(join(artifactRoot, "inventory.json"), "utf8"));
    await verifyWindowsSeaArtifactTree(artifactRoot, inventory);
    assertArtifactContract(manifest);

    await ensureNativeLab({ labExecutable, labProject });
    const outputFile = join(root, "native-lab-result.txt");
    lab = spawn(labExecutable, [outputFile], { stdio: "ignore", windowsHide: false });
    await wait(700);

    const executablePath = join(artifactRoot, ...manifest.entrypoint.split("/"));
    connection = createMcpConnection(executablePath, launchRoot, options.environment);
    await connection.connect();
    const tools = await connection.listTools();
    assertExactTools(tools);
    const health = await connection.call("computer.health", { fast: false, prewarm: true });
    if (health.status !== "ready" || health.driver?.status !== "healthy" || health.ocr?.status !== "healthy") {
      throw smokeError("sea_smoke.health_not_ready", JSON.stringify({
        status: health.status,
        driver: health.driver?.status,
        ocr: health.ocr?.status,
      }));
    }

    const access = await connection.call("computer.request_access", {
      titlePart: basename(outputFile),
      tier: "full",
      agentId: "windows-sea-layer-a",
      reason: "Windows SEA Layer A safe Native Lab verification",
    });
    const capture = await connection.call("computer.capture", { mode: "semantic" });
    const name = findElement(capture, "Name");
    const save = findElement(capture, "Save");
    await connection.call("computer.act", {
      action: { kind: "set_value", elementToken: name.elementToken, elementIndex: name.elementIndex, value: "windows-sea-layer-a" },
    });
    const click = await connection.call("computer.act", {
      action: {
        kind: "click",
        elementToken: save.elementToken,
        elementIndex: save.elementIndex,
        deliveryMode: "background",
        captureAfter: true,
      },
    });
    await wait(300);
    const savedText = await readFile(outputFile, "utf8");
    const cancel = await connection.call("computer.cancel", { reason: "layer-a-complete" });
    const state = await connection.call("computer.list_state", {});
    if (
      access.status !== "granted"
      || capture.includeUserOverlay !== false
      || click.includeUserOverlay !== false
      || savedText !== "windows-sea-layer-a"
      || cancel.status !== "cancelled"
      || state.status !== "idle"
    ) {
      throw smokeError("sea_smoke.native_lab_failed", JSON.stringify({
        access: access.status,
        captureOverlay: capture.includeUserOverlay,
        clickOverlay: click.includeUserOverlay,
        savedText,
        cancel: cancel.status,
        state: state.status,
      }));
    }

    await connection.close();
    connection = null;
    await waitForArtifactProcessesToExit(artifactRoot);

    const tamperPath = join(artifactRoot, "runtime", "server.js");
    await writeFile(tamperPath, "\n// tampered\n", { flag: "a" });
    let tamperRejected = false;
    try {
      await verifyWindowsSeaArtifactTree(artifactRoot, inventory);
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) throw smokeError("sea_smoke.tamper_accepted");

    return {
      status: "passed",
      layer: "A",
      target: manifest.target,
      toolCount: tools.length,
      health: { status: health.status, driver: health.driver.status, ocr: health.ocr.status },
      nativeLab: { status: "passed", overlayExcluded: true, safeClick: true },
      cancellation: { status: "passed", processCleanup: true },
      tamperRejected,
      startup: { systemNodeRequired: false, sourceCwdRequired: false, networkAllowed: false },
    };
  } finally {
    await connection?.close().catch(() => {});
    if (lab && lab.exitCode === null) lab.kill();
    await rm(root, { recursive: true, force: true });
  }
}

function createMcpConnection(executablePath, cwd, environment = {}) {
  const client = new Client({ name: "windows-sea-layer-a", version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: executablePath,
    args: [],
    cwd,
    env: {
      ...process.env,
      ...environment,
      AGENT_COMPUTER_USE_NETWORK_DISABLED: "1",
      XIAOZHICLAW_CUA_NETWORK_DISABLED: "1",
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on?.("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  return {
    connect: () => client.connect(transport),
    listTools: async () => (await client.listTools()).tools.map(({ name }) => name),
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw smokeError("sea_smoke.tool_failed", `${name}: ${JSON.stringify(result.structuredContent)}`);
      return result.structuredContent ?? result;
    },
    close: async () => {
      await client.callTool({ name: "computer.revoke", arguments: { reason: "layer-a-client-close" } }).catch(() => {});
      await client.close().catch((error) => {
        throw smokeError("sea_smoke.close_failed", `${error.message}; stderr=${stderr}`);
      });
    },
  };
}

async function ensureNativeLab({ labExecutable, labProject }) {
  try {
    await readFile(labExecutable);
  } catch {
    await execFileAsync("dotnet", ["build", labProject], { windowsHide: true });
  }
}

async function waitForArtifactProcessesToExit(artifactRoot) {
  const script = [
    "$root=[IO.Path]::GetFullPath($env:SEA_SMOKE_ARTIFACT_ROOT)",
    "$items=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root,[StringComparison]::OrdinalIgnoreCase) })",
    "[Console]::Out.Write($items.Count)",
  ].join("; ");
  const deadline = Date.now() + 8_000;
  do {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
      env: { ...process.env, SEA_SMOKE_ARTIFACT_ROOT: artifactRoot },
      windowsHide: true,
    });
    if (Number.parseInt(stdout.trim(), 10) === 0) return;
    await wait(200);
  } while (Date.now() < deadline);
  throw smokeError("sea_smoke.process_cleanup_failed");
}

function assertArtifactContract(manifest) {
  if (
    manifest.id !== "agent-computer-use-mcp"
    || manifest.target?.platform !== "win32"
    || manifest.target?.arch !== "x64"
    || manifest.entrypoint !== "bin/agent-computer-use-mcp.exe"
    || manifest.startupNetworkAllowed !== false
    || manifest.selfUpdateAllowed !== false
  ) throw smokeError("sea_smoke.manifest_invalid");
}

function assertExactTools(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_TOOLS)) {
    throw smokeError("sea_smoke.tools_invalid", JSON.stringify(actual));
  }
}

function findElement(capture, name) {
  const element = capture.elements?.find((candidate) => candidate.name === name);
  if (!element) throw smokeError("sea_smoke.element_missing", name);
  return element;
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw smokeError(code);
  return value;
}

function smokeError(code, detail = "") {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
