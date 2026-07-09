import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  DEFAULT_PROTECTED_NPM_ROOT,
  buildProtectedNpmPackage,
} from "./build-protected-npm-package.mjs";

export async function runProtectedNpmSmoke(options = {}) {
  const outputRoot = resolve(options.outputRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const build = await buildProtectedNpmPackage({ outputRoot });
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

export function runProtectedLauncher(options = {}) {
  const outputRoot = resolve(options.outputRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const timeoutMs = options.timeoutMs ?? 5000;
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
  return /^(src|test|scripts|windows-installer|gateway-overlay|native-lab|ocr-sidecar)\//.test(entry)
    || /\.(?:cs|csproj|py|ts|tsx)$/.test(entry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runProtectedNpmSmoke();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
