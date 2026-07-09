import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("offline capability proof accepts health overlay semantic capture and configured OCR without network", async () => {
  const { createOfflineCapabilityProof } = await import("../src/offline-capability-proof.mjs");

  const proof = createOfflineCapabilityProof({
    capabilities: readyCapabilities(),
    bundle: { status: "ready", manifestId: "bundle-2026-07-10" },
  });

  assert.equal(proof.phase, "7.3");
  assert.equal(proof.status, "ready");
  assert.equal(proof.networkRequired, false);
  assert.equal(proof.downloadOnFirstEnable, false);
  assert.equal(proof.startsDesktopControl, false);
  assert.equal(proof.includeUserOverlay, false);
  assert.deepEqual(proof.capabilities.map((item) => [item.id, item.status, item.networkRequired]), [
    ["health", "ready", false],
    ["overlay", "ready", false],
    ["semantic-capture", "ready", false],
    ["model-pack-ocr", "ready", false],
  ]);
  assert.deepEqual(proof.blockers, []);
});

test("offline capability proof fails closed for missing OCR or any network dependency", async () => {
  const { createOfflineCapabilityProof } = await import("../src/offline-capability-proof.mjs");
  const capabilities = readyCapabilities();
  capabilities["semantic-capture"].networkRequired = true;
  capabilities["semantic-capture"].source = "remote-browser-service";
  capabilities["model-pack-ocr"].status = "missing";

  const proof = createOfflineCapabilityProof({
    capabilities,
    bundle: { status: "ready", manifestId: "bundle-2026-07-10" },
  });

  assert.equal(proof.status, "blocked");
  assert.equal(proof.networkRequired, false);
  assert.equal(proof.downloadOnFirstEnable, false);
  assert.deepEqual(proof.blockers.map((blocker) => [blocker.id, blocker.reason]), [
    ["semantic-capture", "network-required"],
    ["model-pack-ocr", "capability-not-ready"],
  ]);
  assert.deepEqual(proof.repairEntryPoints.map((entry) => entry.id), [
    "prepare-offline-semantic-capture",
    "cache-configured-ocr-model-pack",
  ]);
});

test("offline capability proof requires a ready offline bundle before enabling", async () => {
  const { createOfflineCapabilityProof } = await import("../src/offline-capability-proof.mjs");

  const proof = createOfflineCapabilityProof({
    capabilities: readyCapabilities(),
    bundle: { status: "needs_setup", manifestId: "bundle-2026-07-10" },
  });

  assert.equal(proof.status, "blocked");
  assert.deepEqual(proof.blockers.map((blocker) => [blocker.id, blocker.reason]), [
    ["offline-bundle", "bundle-not-ready"],
  ]);
  assert.deepEqual(proof.repairEntryPoints.map((entry) => entry.id), [
    "prepare-offline-bundle",
  ]);
});

test("Phase 7.3 has an executable offline capability proof smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.3"], "node src/phase-7-3-offline-capability-proof.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.3"], "offline-capability-proof");

  const result = await runNode(["src/phase-7-3-offline-capability-proof.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.3");
  assert.equal(report.readyStatus, "ready");
  assert.equal(report.blockedStatus, "blocked");
  assert.equal(report.networkRequired, false);
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function readyCapabilities() {
  return {
    health: {
      status: "ready",
      source: "computer.health.fast",
      networkRequired: false,
    },
    overlay: {
      status: "ready",
      source: "gateway-overlay-cache",
      networkRequired: false,
      includeUserOverlay: false,
    },
    "semantic-capture": {
      status: "ready",
      source: "uia-som-local",
      networkRequired: false,
    },
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
