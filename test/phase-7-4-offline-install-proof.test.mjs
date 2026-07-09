import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("offline install proof accepts prepared install roots, bundle, and offline capabilities", async () => {
  const { createOfflineInstallProof } = await import("../src/offline-install-proof.mjs");

  const proof = createOfflineInstallProof({
    installLayout: readyInstallLayout(),
    bundle: readyBundle(),
    capabilities: readyCapabilities(),
  });

  assert.equal(proof.phase, "7.4");
  assert.equal(proof.status, "ready");
  assert.equal(proof.mode, "offline-install-proof");
  assert.equal(proof.networkRequired, false);
  assert.equal(proof.downloadOnFirstEnable, false);
  assert.equal(proof.startsDesktopControl, false);
  assert.equal(proof.includeUserOverlay, false);
  assert.deepEqual(proof.installRoots.map((root) => [root.id, root.status]), [
    ["dataRoot", "ready"],
    ["cacheRoot", "ready"],
    ["driverRoot", "ready"],
    ["overlayRoot", "ready"],
    ["runtimeRoot", "ready"],
    ["modelRoot", "ready"],
  ]);
  assert.deepEqual(proof.proofs.map((item) => [item.id, item.status]), [
    ["offline-bundle", "ready"],
    ["health", "ready"],
    ["overlay", "ready"],
    ["semantic-capture", "ready"],
    ["model-pack-ocr", "ready"],
  ]);
  assert.deepEqual(proof.blockers, []);
  assert.deepEqual(proof.repairEntryPoints, []);
});

test("offline install proof fails closed when roots, bundle, or capabilities are not ready", async () => {
  const { createOfflineInstallProof } = await import("../src/offline-install-proof.mjs");
  const capabilities = readyCapabilities();
  capabilities["semantic-capture"].networkRequired = true;
  capabilities["model-pack-ocr"].status = "missing";

  const proof = createOfflineInstallProof({
    installLayout: {
      ...readyInstallLayout(),
      cacheRoot: "",
      overlayRoot: "",
    },
    bundle: { status: "needs_setup", manifestId: "bundle-2026-07-10" },
    capabilities,
  });

  assert.equal(proof.status, "blocked");
  assert.equal(proof.networkRequired, false);
  assert.equal(proof.downloadOnFirstEnable, false);
  assert.deepEqual(proof.blockers.map((blocker) => [blocker.id, blocker.reason]), [
    ["cacheRoot", "install-root-missing"],
    ["overlayRoot", "install-root-missing"],
    ["offline-bundle", "bundle-not-ready"],
    ["semantic-capture", "network-required"],
    ["model-pack-ocr", "capability-not-ready"],
  ]);
  assert.deepEqual(proof.repairEntryPoints.map((entry) => entry.id), [
    "prepare-cacheRoot",
    "prepare-overlayRoot",
    "prepare-offline-bundle",
    "prepare-offline-semantic-capture",
    "cache-configured-ocr-model-pack",
  ]);
  assert.equal(proof.repairEntryPoints.every((entry) => entry.executesImmediately === false), true);
});

test("Phase 7.4 has an executable offline install proof smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.4"], "node src/phase-7-4-offline-install-proof.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.4"], "offline-install-proof");

  const result = await runNode(["src/phase-7-4-offline-install-proof.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.4");
  assert.equal(report.readyStatus, "ready");
  assert.equal(report.blockedStatus, "blocked");
  assert.equal(report.networkRequired, false);
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function readyInstallLayout() {
  return {
    dataRoot: "%LOCALAPPDATA%\\AgentComputerUse",
    cacheRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse",
    driverRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse\\cua-driver",
    overlayRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse\\overlay",
    runtimeRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse\\runtime",
    modelRoot: "%LOCALAPPDATA%\\AgentComputerUse\\models",
  };
}

function readyBundle() {
  return {
    status: "ready",
    manifestId: "bundle-2026-07-10",
    requiredAssets: [
      { id: "cua-driver-windows-x64", status: "ready" },
      { id: "gateway-overlay-windows", status: "ready" },
      { id: "ocr-runtime-onnxruntime-node", status: "ready" },
    ],
  };
}

function readyCapabilities() {
  return {
    health: { status: "ready", source: "computer.health.fast", networkRequired: false },
    overlay: { status: "ready", source: "gateway-overlay-cache", networkRequired: false, includeUserOverlay: false },
    "semantic-capture": { status: "ready", source: "uia-som-local", networkRequired: false },
    "model-pack-ocr": {
      status: "ready",
      source: "pp-ocrv6-small-local-model-pack",
      modelPackId: "ocr-model-pp-ocrv6-small",
      networkRequired: false,
    },
  };
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
