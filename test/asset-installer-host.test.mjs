import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAssetInstallerExecutor,
  createAssetRepairRuntime,
  getAssetDeliveryConfig,
} from "../src/asset-installer-host.mjs";

test("asset installer executor prepares and activates host-configured assets", async () => {
  const calls = [];
  const events = [];
  const controller = new AbortController();
  const executor = createAssetInstallerExecutor({
    programRoot: "C:\\Program Files\\AgentComputerUse",
    dataRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse",
    installerPath: "C:\\Program Files\\AgentComputerUse\\runtime\\windows-installer\\current\\agent-computer-use-installer.exe",
    runInstaller: async (operation, options) => {
      calls.push({ operation, options });
      if (operation === "asset-prepare") {
        return { exitCode: 0, report: { status: "prepared", releaseId: "assets-v1" } };
      }
      return { exitCode: 0, report: { status: "activated", currentReleaseId: "assets-v1" } };
    },
  });

  const result = await executor({
    operationId: "asset-host-1",
    actionIds: ["install-cua-driver-windows-x64", "cache-ocr-model-pp-ocrv6-small"],
    manifestPath: "C:\\ProgramData\\AgentComputerUse\\assets.json",
    signaturePath: "C:\\ProgramData\\AgentComputerUse\\assets.sig",
    keyringPath: "C:\\ProgramData\\AgentComputerUse\\asset-keyring.json",
    offlineRoot: "D:\\AgentComputerUseOffline",
    allowNetwork: true,
  }, {
    signal: controller.signal,
    onEvent: async (event) => events.push(event),
  });

  assert.deepEqual(calls.map((call) => call.operation), ["asset-prepare", "asset-activate"]);
  assert.deepEqual(calls[0].options.assetIds, ["cua-driver-windows-x64", "ocr-model-pp-ocrv6-small"]);
  assert.equal(calls[0].options.allowNetwork, true);
  assert.equal(calls[0].options.installerPath, "C:\\Program Files\\AgentComputerUse\\runtime\\windows-installer\\current\\agent-computer-use-installer.exe");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[1].options.releaseId, "assets-v1");
  assert.equal(events.some((event) => event.state === "preparing"), true);
  assert.equal(events.some((event) => event.state === "activating"), true);
  assert.equal(result.status, "activated");
  assert.equal(result.startsDesktopControl, false);
  assert.equal(result.includeUserOverlay, false);
});

test("asset delivery paths come only from host environment", () => {
  const config = getAssetDeliveryConfig({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      AGENT_COMPUTER_USE_ASSET_MANIFEST: "C:\\ProgramData\\AgentComputerUse\\assets.json",
      AGENT_COMPUTER_USE_ASSET_SIGNATURE: "C:\\ProgramData\\AgentComputerUse\\assets.sig",
      AGENT_COMPUTER_USE_ASSET_TRUST_KEYRING: "C:\\ProgramData\\AgentComputerUse\\asset-keyring.json",
      AGENT_COMPUTER_USE_OFFLINE_ASSET_ROOT: "D:\\AgentComputerUseOffline",
    },
  });

  assert.equal(config.programRoot, "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse");
  assert.equal(config.dataRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse");
  assert.equal(config.manifestPath, "C:\\ProgramData\\AgentComputerUse\\assets.json");
  assert.equal(config.signaturePath, "C:\\ProgramData\\AgentComputerUse\\assets.sig");
  assert.equal(config.keyringPath, "C:\\ProgramData\\AgentComputerUse\\asset-keyring.json");
  assert.equal(config.offlineRoot, "D:\\AgentComputerUseOffline");
  assert.equal(config.installerPath, "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\runtime\\windows-installer\\current\\agent-computer-use-installer.exe");
  assert.equal(Object.hasOwn(config, "allowNetwork"), false);
});

test("asset installer executor rejects unsupported repair actions before spawning", async () => {
  let calls = 0;
  const executor = createAssetInstallerExecutor({
    programRoot: "program",
    dataRoot: "data",
    runInstaller: async () => { calls += 1; },
  });

  await assert.rejects(
    () => executor({ operationId: "asset-host-2", actionIds: ["grant-accessibility-permission"] }, {
      signal: new AbortController().signal,
      onEvent: async () => {},
    }),
    /asset\.repair_action_unsupported/,
  );
  assert.equal(calls, 0);
});

test("default asset repair runtime owns its manager state and fixed delivery config", async () => {
  const calls = [];
  const runtime = createAssetRepairRuntime({
    platform: "win32",
    stateRoot: "C:\\Temp\\asset-operation-state",
    env: {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      AGENT_COMPUTER_USE_ASSET_MANIFEST: "C:\\ProgramData\\AgentComputerUse\\assets.json",
      AGENT_COMPUTER_USE_ASSET_SIGNATURE: "C:\\ProgramData\\AgentComputerUse\\assets.sig",
      AGENT_COMPUTER_USE_ASSET_TRUST_KEYRING: "C:\\ProgramData\\AgentComputerUse\\asset-keyring.json",
    },
    managerFactory(options) {
      calls.push(options);
      return { kind: "asset-operation-manager" };
    },
    runInstaller: async () => ({ exitCode: 0, report: {} }),
  });

  assert.equal(runtime.assetOperationManager.kind, "asset-operation-manager");
  assert.equal(runtime.assetDeliveryConfig.manifestPath, "C:\\ProgramData\\AgentComputerUse\\assets.json");
  assert.equal(calls[0].stateRoot, "C:\\Temp\\asset-operation-state");
  assert.equal(typeof calls[0].executor, "function");
});
