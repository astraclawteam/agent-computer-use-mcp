import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { verifyReleaseOutputs } from "../src/release-output-manifest.mjs";
import { runWindowsInstaller } from "../src/windows-installer-host.mjs";
import { expandVerifiedZip } from "../src/windows-release-payload.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const packageName = packageJson.name;
const prefix = `${packageName}-${version}`;
const formalRoot = resolve(process.env.AGENT_COMPUTER_USE_FORMAL_OUTPUT_ROOT ?? join("artifacts/formal-release", version));
const workRoot = await mkdtemp(join(tmpdir(), "agent-formal-release-smoke-"));

try {
  const registryVersion = JSON.parse((await run("npm", ["view", `${packageName}@${version}`, "version", "--json"])).stdout);
  if (registryVersion !== version) throw new Error("release.npm_version_unavailable");
  const verification = await verifyReleaseOutputs({
    manifestPath: join(formalRoot, `${prefix}-release-manifest.json`),
    checksumsPath: join(formalRoot, `${prefix}-checksums.txt`),
    artifactRoot: formalRoot,
  });
  if (verification.status !== "passed") throw new Error("release.formal_output_invalid");

  const npmRoot = join(workRoot, "npm");
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", npmRoot, `${packageName}@${version}`]);
  const packageRoot = join(npmRoot, "node_modules", packageName);
  const client = new Client({ name: "formal-release-smoke", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, "dist", "launcher.mjs")],
    cwd: packageRoot,
  });
  let mcpPassed = false;
  try {
    await client.connect(transport, { timeout: 15_000, maxTotalTimeout: 15_000 });
    const tools = await client.listTools(undefined, { timeout: 15_000, maxTotalTimeout: 15_000 });
    const health = await client.callTool(
      { name: "computer.health", arguments: { fast: true } },
      undefined,
      { timeout: 15_000, maxTotalTimeout: 15_000 },
    );
    mcpPassed = !health.isError && tools.tools.some((tool) => tool.name === "computer.health");
  } finally {
    await client.close().catch(() => transport.close());
  }
  if (!mcpPassed) throw new Error("release.npm_mcp_smoke_failed");

  const expanded = join(workRoot, "offline");
  await expandVerifiedZip({
    archivePath: join(formalRoot, `${prefix}-windows-x64-offline.zip`),
    destinationPath: expanded,
  });
  const installerPath = join(expanded, "installer", "AgentComputerUse.Installer.exe");
  if (!(await stat(installerPath)).isFile()) throw new Error("release.installer_missing");
  const install = await runWindowsInstaller("install", {
    installerPath,
    bundleRoot: join(expanded, "release"),
    programRoot: join(workRoot, "program"),
    dataRoot: join(workRoot, "data"),
  });
  if (install.exitCode !== 0 || install.report?.status !== "installed") {
    throw new Error(`release.post_publish_install_failed: ${install.stderr || install.stdout}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    packageName,
    version,
    npmRegistryVersionVerified: true,
    releaseOutputsVerified: true,
    standardMcpSmokePassed: true,
    signedInstallerApplied: true,
    includeUserOverlay: false,
  }, null, 2)}\n`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)));
  });
}
