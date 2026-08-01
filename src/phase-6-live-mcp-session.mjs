import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  driverSha256,
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
  const resolvedDriverPath = driverPath ? resolve(driverPath) : null;
  const effectiveEnv = {
    ...(env ?? {}),
    ...(resolvedDriverPath ? { AGENT_COMPUTER_USE_CUA_DRIVER: resolvedDriverPath } : {}),
  };
  const driver = resolvedDriverPath && driverSha256
    ? await verifyExplicitDriver(resolvedDriverPath, driverSha256)
    : await resolvePhase14Driver({
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

async function verifyExplicitDriver(path, expectedSha256) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error("phase6.live_driver_sha256_invalid");
  }
  const actualSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error("phase6.live_driver_sha256_mismatch");
  }
  return {
    path,
    source: "verified-explicit",
    version: null,
  };
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
      const result = await callClientTool(client, name, args);
      const value = result.structuredContent ?? result;
      acquired = updateAcquiredState(acquired, name, value);
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

function callClientTool(client, name, args) {
  return client.callTool({ name, arguments: args });
}

function updateAcquiredState(acquired, name, value) {
  if (name === "computer.acquire" && value?.status === "granted") return true;
  if (name === "computer.release"
    && (value?.status === "released" || value?.status === "cancelled")) return false;
  return acquired;
}
