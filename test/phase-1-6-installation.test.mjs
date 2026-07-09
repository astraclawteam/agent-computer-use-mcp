import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  buildClientMcpConfig,
  getComputerUseInstallationManifest,
  resolveComputerUseMcpEntry,
} from "../src/computer-use-installation.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

test("Phase 1.6 prefers the protected release launcher when present", () => {
  assert.equal(resolveComputerUseMcpEntry({
    packageRoot: "C:\\package",
    pathExists: (path) => path === "C:\\package\\dist\\launcher.mjs",
  }), "dist/launcher.mjs");
  assert.equal(resolveComputerUseMcpEntry({
    packageRoot: "C:\\source",
    pathExists: () => false,
  }), "src/computer-use-mcp-server.mjs");
});

test("Phase 1.6 exposes a stable local module installation manifest", () => {
  const manifest = getComputerUseInstallationManifest({
    packageRoot: "F:\\agent-computer-use-mcp",
    env: {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      AGENT_COMPUTER_USE_CUA_DRIVER: "C:\\tools\\cua-driver.exe",
      AGENT_COMPUTER_USE_ARTIFACT_ROOT: "D:\\agent-artifacts",
      AGENT_COMPUTER_USE_OCR_MODEL_ROOT: "D:\\agent-models",
    },
  });

  assert.equal(manifest.phase, "1.6");
  assert.equal(manifest.module, "agent-computer-use-mcp");
  assert.equal(manifest.binary, "agent-computer-use-mcp");
  assert.equal(manifest.transport, "stdio");
  assert.equal(manifest.entry.command, process.execPath);
  assert.deepEqual(manifest.entry.args, ["src/computer-use-mcp-server.mjs"]);
  assert.equal(manifest.paths.packageRoot, "F:\\agent-computer-use-mcp");
  assert.equal(manifest.paths.artifactRoot, "D:\\agent-artifacts");
  assert.equal(manifest.paths.modelRoot, "D:\\agent-models");
  assert.equal(manifest.paths.driverPath, "C:\\tools\\cua-driver.exe");
  assert.equal(manifest.observation.includeUserOverlay, false);
  assert.deepEqual(manifest.envOverrides.required, []);
  assert.deepEqual(manifest.envOverrides.optional, [
    "AGENT_COMPUTER_USE_CUA_DRIVER",
    "AGENT_COMPUTER_USE_CUA_DRIVER_PATH",
    "XIAOZHICLAW_CUA_DRIVER",
    "XIAOZHICLAW_CUA_DRIVER_PATH",
    "CUA_DRIVER",
    "AGENT_COMPUTER_USE_OCR_SIDECAR_PATH",
    "XIAOZHICLAW_OCR_SIDECAR_PATH",
    "AGENT_COMPUTER_USE_ARTIFACT_ROOT",
    "AGENT_COMPUTER_USE_OCR_MODEL_ROOT",
    "XIAOZHICLAW_COMPUTER_USE_ARTIFACT_ROOT",
    "XIAOZHICLAW_OCR_MODEL_ROOT",
  ]);
});

test("Phase 1.6 builds Codex and Claude Desktop MCP client configs", () => {
  const manifest = getComputerUseInstallationManifest({
    packageRoot: "F:\\agent-computer-use-mcp",
    env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
  });

  const codex = buildClientMcpConfig({ client: "codex", manifest });
  assert.deepEqual(Object.keys(codex.mcpServers), ["agent-computer-use"]);
  assert.equal(codex.mcpServers["agent-computer-use"].command, process.execPath);
  assert.deepEqual(codex.mcpServers["agent-computer-use"].args, ["src/computer-use-mcp-server.mjs"]);
  assert.equal(codex.mcpServers["agent-computer-use"].cwd, "F:\\agent-computer-use-mcp");
  assert.equal(codex.mcpServers["agent-computer-use"].env.AGENT_COMPUTER_USE_ARTIFACT_ROOT, manifest.paths.artifactRoot);
  assert.equal(codex.mcpServers["agent-computer-use"].env.XIAOZHICLAW_COMPUTER_USE_ARTIFACT_ROOT, manifest.paths.artifactRoot);

  const claude = buildClientMcpConfig({ client: "claude-desktop", manifest });
  assert.deepEqual(claude.mcpServers, codex.mcpServers);
});

test("Phase 1.6 freezes the installation tool contract", () => {
  assert.equal(COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name).includes("computer.installation"), true);
  const tool = COMPUTER_USE_MCP_TOOLS.find((item) => item.name === "computer.installation");
  assert.equal(tool.annotations.phase, "1.6");
  assert.equal(tool.annotations.readOnlyHint, true);
});

test("computer.installation answers over stdio with config templates", async () => {
  const client = new Client(
    { name: "phase-1-6-installation-test", version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "computer.installation",
      arguments: { client: "codex" },
    });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.phase, "1.6");
    assert.equal(result.structuredContent.manifest.module, "agent-computer-use-mcp");
    assert.equal(result.structuredContent.clientConfig.client, "codex");
    assert.equal(result.structuredContent.clientConfig.config.mcpServers["agent-computer-use"].command, process.execPath);
    assert.equal(result.structuredContent.includeUserOverlay, false);
  } finally {
    await client.close();
  }
});

test("Phase 1.6 has an executable smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.6"], "node src/phase-1-6-installation.mjs");

  const result = await runNode(["src/phase-1-6-installation.mjs"]);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "1.6");
  assert.equal(report.manifest.module, "agent-computer-use-mcp");
  assert.equal(report.clientConfig.client, "codex");
  assert.equal(report.includeUserOverlay, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
