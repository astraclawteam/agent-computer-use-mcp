import { join } from "node:path";

import { AssetOperationManager } from "./asset-operation-manager.mjs";
import { getInstallLayout } from "./package-foundation.mjs";
import { runWindowsInstaller } from "./windows-installer-host.mjs";

const REPAIR_ACTION_ASSETS = new Map([
  ["install-cua-driver-windows-x64", "cua-driver-windows-x64"],
  ["build-or-install-gateway-overlay-windows", "gateway-overlay-windows"],
  ["install-ocr-runtime-onnxruntime-node", "ocr-runtime-onnxruntime-node"],
  ["cache-ocr-model-pp-ocrv6-small", "ocr-model-pp-ocrv6-small"],
  ["install-webview2-runtime", "webview2-runtime"],
]);

export function getAssetDeliveryConfig(options = {}) {
  const env = options.env ?? process.env;
  const layout = getInstallLayout({
    platform: options.platform ?? process.platform,
    env,
  });
  return compact({
    programRoot: layout.cacheRoot,
    dataRoot: layout.dataRoot,
    manifestPath: env.AGENT_COMPUTER_USE_ASSET_MANIFEST,
    signaturePath: env.AGENT_COMPUTER_USE_ASSET_SIGNATURE,
    keyringPath: env.AGENT_COMPUTER_USE_ASSET_TRUST_KEYRING,
    offlineRoot: env.AGENT_COMPUTER_USE_OFFLINE_ASSET_ROOT,
  });
}

export function createAssetInstallerExecutor(options = {}) {
  const runInstaller = options.runInstaller ?? runWindowsInstaller;
  const fixedRoots = {
    programRoot: options.programRoot,
    dataRoot: options.dataRoot,
  };

  return async function executeAssetInstall(request, context) {
    const assetIds = mapRepairActions(request.actionIds);
    requireDeliveryConfig({ ...fixedRoots, ...request });
    await context.onEvent({ state: "preparing", percent: 10, assetIds });
    const common = {
      ...fixedRoots,
      manifestPath: request.manifestPath,
      signaturePath: request.signaturePath,
      keyringPath: request.keyringPath,
      offlineRoot: request.offlineRoot,
      operationId: request.operationId,
      signal: context.signal,
      onProgress: (event) => context.onEvent(event),
    };
    const prepared = await runInstaller("asset-prepare", {
      ...common,
      assetIds,
      allowNetwork: request.allowNetwork === true,
    });
    assertInstallerSucceeded("asset-prepare", prepared, "prepared");
    await context.onEvent({
      state: "prepared",
      percent: 75,
      releaseId: prepared.report.releaseId,
      cacheHitCount: prepared.report.cacheHitCount,
      cacheMissCount: prepared.report.cacheMissCount,
      resumeUsed: prepared.report.resumeUsed,
    });
    await context.onEvent({ state: "activating", percent: 85, releaseId: prepared.report.releaseId });
    const activated = await runInstaller("asset-activate", {
      ...common,
      releaseId: prepared.report.releaseId,
    });
    assertInstallerSucceeded("asset-activate", activated, "activated");
    return {
      ...activated.report,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  };
}

export function createAssetRepairRuntime(options = {}) {
  const assetDeliveryConfig = getAssetDeliveryConfig(options);
  const executor = createAssetInstallerExecutor({
    ...assetDeliveryConfig,
    runInstaller: options.runInstaller,
  });
  const managerFactory = options.managerFactory
    ?? ((managerOptions) => new AssetOperationManager(managerOptions));
  const assetOperationManager = managerFactory({
    executor,
    stateRoot: options.stateRoot ?? join(assetDeliveryConfig.dataRoot, "runtime", "asset-operations"),
    clock: options.clock,
  });
  return { assetDeliveryConfig, assetOperationManager };
}

function mapRepairActions(actionIds = []) {
  const assetIds = [];
  for (const actionId of [...new Set(actionIds)]) {
    const assetId = REPAIR_ACTION_ASSETS.get(actionId);
    if (!assetId) throw new Error(`asset.repair_action_unsupported: ${actionId}`);
    assetIds.push(assetId);
  }
  if (assetIds.length === 0) throw new Error("asset.repair_actions_required");
  return assetIds;
}

function requireDeliveryConfig(config) {
  for (const key of ["programRoot", "dataRoot", "manifestPath", "signaturePath", "keyringPath"]) {
    if (typeof config[key] !== "string" || config[key].length === 0) {
      throw new Error(`asset.delivery_config_missing: ${key}`);
    }
  }
}

function assertInstallerSucceeded(operation, result, expectedStatus) {
  if (result?.exitCode !== 0 || result?.report?.status !== expectedStatus) {
    const code = result?.report?.error?.code ?? "asset.installer_failed";
    throw new Error(`${code}: ${operation}`);
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""));
}
