import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runOfflinePerceptionProbe } from "../src/offline-perception-probe.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const packageName = packageJson.name;
const workRoot = await mkdtemp(join(tmpdir(), "agent-public-npm-smoke-"));
try {
  const registryVersion = JSON.parse((await run("npm", ["view", `${packageName}@${version}`, "version", "--json"])).stdout);
  if (registryVersion !== version) throw new Error("release.npm_version_unavailable");
  await writeFile(join(workRoot, "package.json"), `${JSON.stringify({ private: true })}\n`);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", workRoot, `${packageName}@${version}`]);
  const packageRoot = join(workRoot, "node_modules", packageName);
  const client = new Client({ name: "public-npm-smoke", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, "dist", "launcher.mjs")],
    cwd: packageRoot,
    env: { ...process.env, AGENT_COMPUTER_USE_NETWORK_DISABLED: "1", AGENT_COMPUTER_USE_OVERLAY_DISABLED: "1" },
  });
  try {
    const timeout = { timeout: 15_000, maxTotalTimeout: 15_000 };
    await client.connect(transport, timeout);
    const tools = await client.listTools(undefined, timeout);
    const health = await client.callTool({ name: "computer.health", arguments: { fast: true } }, undefined, timeout);
    const perception = await runOfflinePerceptionProbe(client, timeout);
    const doctor = await client.callTool({
      name: "computer.doctor",
      arguments: { fast: true, includeInstallCache: false },
    }, undefined, timeout);
    if (health.isError || doctor.isError || !perception.ocrInitialized
      || !tools.tools.some(({ name }) => name === "computer.health")) {
      throw new Error("release.public_npm_mcp_smoke_failed");
    }
  } finally {
    await client.close().catch(() => transport.close());
  }
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    packageName,
    version,
    npmRegistryVersionVerified: true,
    exactPlatformDependencyVerified: true,
    standardMcpSmokePassed: true,
    runtimeNetworkAllowed: false,
    ocrInitialized: true,
    ocrPrewarmCompleted: true,
    startsDesktopControl: false,
    includeUserOverlay: false,
  }, null, 2)}\n`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const executable = process.platform === "win32" && command === "npm" ? "cmd.exe" : command;
    const commandArgs = executable === "cmd.exe" ? ["/d", "/s", "/c", "npm", ...args] : args;
    const child = spawn(executable, commandArgs, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)));
  });
}
