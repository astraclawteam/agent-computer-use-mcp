import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { expandVerifiedZip } from "../src/verified-zip.mjs";
import { runProtectedLauncher } from "./protected-npm-smoke.mjs";

export async function smokeOfflineBundle(options = {}) {
  const zipPath = resolve(required(options.zipPath, "release.offline_zip_missing"));
  const workRoot = await mkdtemp(join(tmpdir(), "agent-offline-platform-smoke-"));
  try {
    await expandVerifiedZip({ archivePath: zipPath, destinationPath: workRoot });
    const roots = (await readdir(workRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    if (roots.length !== 1) throw new Error("release.offline_layout_invalid");
    const offlineRoot = join(workRoot, roots[0].name);
    const coreRoot = join(offlineRoot, "runtime", "core");
    const verification = await runProtectedLauncher({
      outputRoot: coreRoot,
      args: ["--verify-only"],
      timeoutMs: 15_000,
    });
    if (verification.exitCode !== 0) {
      throw new Error(`release.offline_platform_verification_failed: ${verification.stderr || verification.stdout}`);
    }
    const verified = JSON.parse(verification.stdout);
    const client = new Client({ name: "offline-platform-smoke", version: "0.0.1" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(offlineRoot, "bin", "agent-computer-use-mcp.mjs")],
      cwd: offlineRoot,
      env: childEnvironment({
        AGENT_COMPUTER_USE_NETWORK_DISABLED: "1",
        AGENT_COMPUTER_USE_OVERLAY_DISABLED: "1",
      }),
    });
    try {
      await client.connect(transport, requestOptions());
      const tools = await client.listTools(undefined, requestOptions());
      const health = await client.callTool({ name: "computer.health", arguments: { fast: true } }, undefined, requestOptions());
      const doctor = await client.callTool({
        name: "computer.doctor",
        arguments: { fast: true, includeInstallCache: false },
      }, undefined, requestOptions());
      return {
        status: !health.isError && !doctor.isError && verified.platformVerified ? "passed" : "failed",
        toolsListed: tools.tools.some(({ name }) => name === "computer.health"),
        healthPassed: !health.isError,
        doctorPassed: !doctor.isError,
        platformVerified: verified.platformVerified === true,
        networkDisabled: true,
        desktopControlStarted: false,
      };
    } finally {
      await client.close().catch(() => transport.close());
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

function requestOptions() {
  return { timeout: 15_000, maxTotalTimeout: 15_000 };
}

function childEnvironment(overrides) {
  return Object.fromEntries(Object.entries({ ...process.env, ...overrides })
    .filter(([, value]) => typeof value === "string"));
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await smokeOfflineBundle({ zipPath: process.argv[2] });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
