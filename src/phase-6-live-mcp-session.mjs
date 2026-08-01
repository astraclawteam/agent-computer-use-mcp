import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createPhase14ServerEnvironment,
  resolvePhase14Driver,
} from "./phase-1-4-driver.mjs";

export async function openPhase6LiveMcpSession({
  packageRoot,
  env,
  nodeExecutable,
  driverPath,
} = {}) {
  const runtimeProcess = globalThis.process;
  packageRoot ??= runtimeProcess?.cwd?.();
  env ??= runtimeProcess?.env;
  nodeExecutable ??= runtimeProcess?.execPath;
  if (!packageRoot || !nodeExecutable) {
    throw new Error("phase6.live_runtime_paths_required");
  }
  const root = resolve(packageRoot);
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const effectiveEnv = {
    ...(env ?? {}),
    ...(driverPath ? { AGENT_COMPUTER_USE_CUA_DRIVER: resolve(driverPath) } : {}),
  };
  const driver = await resolvePhase14Driver({
    packageRoot: root,
    packageVersion: packageJson.version,
    env: effectiveEnv,
  });
  const client = new Client({
    name: "phase-6-live-acceptance",
    version: "0.0.1",
  }, {
    capabilities: {},
  });
  const transport = new StdioClientTransport({
    command: nodeExecutable,
    args: [resolve(root, "src/computer-use-mcp-server.mjs")],
    cwd: root,
    env: createPhase14ServerEnvironment(effectiveEnv, driver.path),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on?.("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  await client.connect(transport);
  return createPhase6LiveSession({ client, driver, stderrText: () => stderr });
}

export function createPhase6LiveSession({ client, driver = null, stderrText = () => "" } = {}) {
  if (!client || typeof client.callTool !== "function" || typeof client.close !== "function") {
    throw new TypeError("A connected official MCP client is required.");
  }
  let acquired = false;
  let closed = false;

  return Object.freeze({
    driver,
    stderrText,
    async callTool(name, args = {}) {
      if (closed) throw new Error("phase6.live_session_closed");
      const result = await client.callTool({ name, arguments: args });
      const value = result.structuredContent ?? result;
      if (name === "computer.acquire" && value?.status === "granted") acquired = true;
      if (name === "computer.release"
        && (value?.status === "released" || value?.status === "cancelled")) acquired = false;
      return value;
    },
    async close(reason = "phase-6-session-close") {
      if (closed) return;
      closed = true;
      if (acquired) {
        await client.callTool({
          name: "computer.release",
          arguments: { reason },
        }).catch(() => {});
        acquired = false;
      }
      await client.close();
    },
  });
}
