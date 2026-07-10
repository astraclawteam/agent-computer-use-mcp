import { resolveCuaDriverCandidate } from "./driver-health.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAssetDeliveryConfig } from "./asset-installer-host.mjs";

export const COMPUTER_USE_MODULE_NAME = "agent-computer-use-mcp";
export const COMPUTER_USE_MCP_SERVER_ID = "agent-computer-use";
export const COMPUTER_USE_MCP_SERVER_ENTRY = "src/computer-use-mcp-server.mjs";
export const COMPUTER_USE_MCP_PROTECTED_ENTRY = "dist/launcher.mjs";

const OPTIONAL_ENV_OVERRIDES = [
  "AGENT_COMPUTER_USE_CUA_DRIVER",
  "AGENT_COMPUTER_USE_CUA_DRIVER_PATH",
  "XIAOZHICLAW_CUA_DRIVER",
  "XIAOZHICLAW_CUA_DRIVER_PATH",
  "CUA_DRIVER",
  "AGENT_COMPUTER_USE_OCR_SIDECAR_PATH",
  "XIAOZHICLAW_OCR_SIDECAR_PATH",
  "AGENT_COMPUTER_USE_ARTIFACT_ROOT",
  "AGENT_COMPUTER_USE_OCR_MODEL_ROOT",
  "AGENT_COMPUTER_USE_WINDOWS_INSTALLER",
  "AGENT_COMPUTER_USE_ASSET_MANIFEST",
  "AGENT_COMPUTER_USE_ASSET_SIGNATURE",
  "AGENT_COMPUTER_USE_ASSET_TRUST_KEYRING",
  "AGENT_COMPUTER_USE_OFFLINE_ASSET_ROOT",
  "XIAOZHICLAW_COMPUTER_USE_ARTIFACT_ROOT",
  "XIAOZHICLAW_OCR_MODEL_ROOT",
];

export function getComputerUseInstallationManifest(options = {}) {
  const env = options.env ?? process.env;
  const packageRoot = options.packageRoot ?? process.cwd();
  const artifactRoot = env.AGENT_COMPUTER_USE_ARTIFACT_ROOT
    ?? env.XIAOZHICLAW_COMPUTER_USE_ARTIFACT_ROOT
    ?? defaultLocalDataPath(env, "artifacts");
  const modelRoot = env.AGENT_COMPUTER_USE_OCR_MODEL_ROOT
    ?? env.XIAOZHICLAW_OCR_MODEL_ROOT
    ?? defaultLocalDataPath(env, "models");
  const driverPath = resolveCuaDriverCandidate(env) ?? defaultCuaDriverPath(env);
  const assetDelivery = getAssetDeliveryConfig({ env, platform: options.platform });
  const entryPath = resolveComputerUseMcpEntry({
    packageRoot,
    pathExists: options.pathExists,
  });

  return {
    phase: "1.6",
    module: COMPUTER_USE_MODULE_NAME,
    binary: COMPUTER_USE_MODULE_NAME,
    transport: "stdio",
    entry: {
      command: process.execPath,
      args: [entryPath],
      cwd: packageRoot,
    },
    paths: {
      packageRoot,
      artifactRoot,
      modelRoot,
      driverPath,
      windowsInstallerPath: assetDelivery.installerPath,
      assetManifestPath: assetDelivery.manifestPath,
      assetSignaturePath: assetDelivery.signaturePath,
      assetTrustKeyringPath: assetDelivery.keyringPath,
      offlineAssetRoot: assetDelivery.offlineRoot ?? null,
    },
    envOverrides: {
      required: [],
      optional: OPTIONAL_ENV_OVERRIDES,
    },
    observation: {
      includeUserOverlay: false,
    },
    packaging: {
      kind: "local-mcp-module",
      ownership: "gateway-host",
      splitRepoRequired: false,
    },
  };
}

export function resolveComputerUseMcpEntry(options = {}) {
  const packageRoot = options.packageRoot ?? process.cwd();
  const pathExists = options.pathExists ?? existsSync;
  return pathExists(join(packageRoot, COMPUTER_USE_MCP_PROTECTED_ENTRY))
    ? COMPUTER_USE_MCP_PROTECTED_ENTRY
    : COMPUTER_USE_MCP_SERVER_ENTRY;
}

export function buildClientMcpConfig({ client, manifest }) {
  if (!["codex", "claude-desktop"].includes(client)) {
    throw new Error(`client.unsupported: ${client}`);
  }

  return {
    mcpServers: {
      [COMPUTER_USE_MCP_SERVER_ID]: {
        command: manifest.entry.command,
        args: manifest.entry.args,
        cwd: manifest.entry.cwd,
        env: {
          AGENT_COMPUTER_USE_ARTIFACT_ROOT: manifest.paths.artifactRoot,
          AGENT_COMPUTER_USE_OCR_MODEL_ROOT: manifest.paths.modelRoot,
          ...(manifest.paths.driverPath ? { AGENT_COMPUTER_USE_CUA_DRIVER: manifest.paths.driverPath } : {}),
          AGENT_COMPUTER_USE_WINDOWS_INSTALLER: manifest.paths.windowsInstallerPath,
          AGENT_COMPUTER_USE_ASSET_MANIFEST: manifest.paths.assetManifestPath,
          AGENT_COMPUTER_USE_ASSET_SIGNATURE: manifest.paths.assetSignaturePath,
          AGENT_COMPUTER_USE_ASSET_TRUST_KEYRING: manifest.paths.assetTrustKeyringPath,
          ...(manifest.paths.offlineAssetRoot ? { AGENT_COMPUTER_USE_OFFLINE_ASSET_ROOT: manifest.paths.offlineAssetRoot } : {}),
          XIAOZHICLAW_COMPUTER_USE_ARTIFACT_ROOT: manifest.paths.artifactRoot,
          XIAOZHICLAW_OCR_MODEL_ROOT: manifest.paths.modelRoot,
          ...(manifest.paths.driverPath ? { XIAOZHICLAW_CUA_DRIVER: manifest.paths.driverPath } : {}),
        },
      },
    },
  };
}

export function getComputerUseInstallation(options = {}) {
  const client = options.client ?? "codex";
  const manifest = getComputerUseInstallationManifest(options);
  return {
    phase: "1.6",
    manifest,
    clientConfig: {
      client,
      config: buildClientMcpConfig({ client, manifest }),
    },
    includeUserOverlay: false,
  };
}

function defaultLocalDataPath(env, child) {
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return `${env.LOCALAPPDATA}\\AgentComputerUse\\${child}`;
  }
  const home = env.HOME ?? env.USERPROFILE ?? ".";
  return `${home}/.local/share/agent-computer-use/${child}`;
}

function defaultCuaDriverPath(env) {
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return `${env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
  }
  return "cua-driver";
}
