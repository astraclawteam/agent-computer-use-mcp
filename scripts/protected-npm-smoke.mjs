import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  DEFAULT_PROTECTED_NPM_ROOT,
  buildProtectedNpmPackage,
} from "./build-protected-npm-package.mjs";
import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

export const PROTECTED_LAUNCHER_TIMEOUT_MS = 30_000;

export async function runProtectedNpmSmoke(options = {}) {
  const outputRoot = resolve(options.outputRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const build = await buildProtectedNpmPackage({ outputRoot });
  await buildSmokePlatformPackage(outputRoot, build.integrity.packageVersion);
  const verification = await runProtectedLauncher({ outputRoot, args: ["--verify-only"] });
  if (verification.exitCode !== 0) {
    throw new Error(`release.integrity_verification_failed: ${verification.stderr || verification.stdout}`);
  }
  const integrity = JSON.parse(verification.stdout);

  const client = new Client(
    { name: "protected-npm-release-smoke", version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(outputRoot, "dist/launcher.mjs")],
    cwd: outputRoot,
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const healthResult = await client.callTool({
      name: "computer.health",
      arguments: { fast: true },
    });
    const installationResult = await client.callTool({
      name: "computer.installation",
      arguments: { client: "codex" },
    });
    if (healthResult.isError || installationResult.isError) {
      throw new Error("release.mcp_smoke_failed: protected runtime returned a tool error");
    }

    const entries = build.inventory.entries;
    return {
      status: "passed",
      packageName: integrity.packageName,
      packageVersion: integrity.packageVersion,
      integrityVerified: integrity.status === "passed" && integrity.fileCount === build.integrity.files.length,
      platformVerified: integrity.platformVerified === true,
      toolNames: tools.tools.map((tool) => tool.name),
      health: healthResult.structuredContent,
      installationEntry: installationResult.structuredContent?.manifest?.entry?.args?.[0] ?? null,
      sourceEntryCount: entries.filter(isSourceEntry).length,
      sourceMapCount: entries.filter((entry) => entry.endsWith(".map")).length,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await client.close();
  }
}

async function buildSmokePlatformPackage(outputRoot, version) {
  const platformRoot = join(outputRoot, "node_modules", "@agent-computer-use", "win32-x64");
  await buildWindowsPlatformPackage({
    outputRoot: platformRoot,
    version,
    sourceCommit: "a".repeat(40),
    materialize: async (stageRoot) => {
      await writeFixture(stageRoot, "cua-driver/cua-driver.exe", "smoke-driver");
      await writeFixture(stageRoot, "overlay/GatewayComputerUseOverlay.exe", "smoke-overlay");
      await writeFixture(stageRoot, "ocr-runtime/onnxruntime.dll", "smoke-runtime");
      await writeFixture(stageRoot, "models/pp-ocr-v6/det.onnx", "smoke-det");
    },
  });
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}

export function runProtectedLauncher(options = {}) {
  const outputRoot = resolve(options.outputRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const timeoutMs = options.timeoutMs ?? PROTECTED_LAUNCHER_TIMEOUT_MS;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(outputRoot, "dist/launcher.mjs"), ...(options.args ?? [])],
      {
        cwd: outputRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function isSourceEntry(entry) {
  return /^(src|test|scripts|gateway-overlay|native-lab|ocr-sidecar)\//.test(entry)
    || /\.(?:cs|csproj|py|ts|tsx)$/.test(entry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runProtectedNpmSmoke();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

