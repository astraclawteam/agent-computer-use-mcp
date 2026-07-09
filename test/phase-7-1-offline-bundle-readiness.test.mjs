import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("offline bundle readiness accepts a complete signed cache manifest", async () => {
  const { createOfflineBundleReadinessReport } = await import("../src/offline-bundle-readiness.mjs");

  const report = createOfflineBundleReadinessReport({
    manifest: completeManifest(),
    packageVersion: "0.0.1",
  });

  assert.equal(report.phase, "7.1");
  assert.equal(report.status, "ready");
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.requiredAssets.length, 3);
  assert.deepEqual(report.requiredAssets.map((asset) => [asset.id, asset.status]), [
    ["cua-driver-windows-x64", "ready"],
    ["gateway-overlay-windows", "ready"],
    ["ocr-runtime-onnxruntime-node", "ready"],
  ]);
  assert.deepEqual(report.optionalAssets.map((asset) => [asset.id, asset.status]), [
    ["ocr-model-pp-ocrv6-small", "ready"],
    ["webview2-runtime", "ready"],
  ]);
  assert.deepEqual(report.repairEntryPoints, []);
});

test("offline bundle readiness fails closed with exact repair entry points", async () => {
  const { createOfflineBundleReadinessReport } = await import("../src/offline-bundle-readiness.mjs");
  const manifest = completeManifest();
  manifest.assets = manifest.assets.filter((asset) => asset.id !== "gateway-overlay-windows");
  manifest.assets.find((asset) => asset.id === "cua-driver-windows-x64").sha256 = "";
  manifest.assets.find((asset) => asset.id === "ocr-runtime-onnxruntime-node").sizeBytes = 0;
  manifest.assets.find((asset) => asset.id === "ocr-model-pp-ocrv6-small").cacheKey = "";

  const report = createOfflineBundleReadinessReport({
    manifest,
    packageVersion: "0.0.1",
  });

  assert.equal(report.status, "needs_setup");
  assert.equal(report.downloadOnFirstEnable, false);
  assert.equal(report.startsDesktopControl, false);
  assert.deepEqual(report.repairEntryPoints.map((entry) => [entry.id, entry.reason]), [
    ["verify-cua-driver-windows-x64-bundle-metadata", "missing-sha256"],
    ["add-gateway-overlay-windows-to-offline-bundle", "missing-required-asset"],
    ["verify-ocr-runtime-onnxruntime-node-bundle-metadata", "missing-size"],
    ["prepare-ocr-model-pp-ocrv6-small-cache-entry", "missing-cache-key"],
  ]);
  assert.equal(report.progress.at(-1).state, "blocked");
});

test("Phase 7.1 has an executable offline bundle readiness smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.1"], "node src/phase-7-1-offline-bundle-readiness.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.1"], "offline-bundle-readiness");

  const result = await runNode(["src/phase-7-1-offline-bundle-readiness.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.1");
  assert.equal(report.readyStatus, "ready");
  assert.equal(report.missingStatus, "needs_setup");
  assert.equal(report.downloadOnFirstEnable, false);
  assert.deepEqual(report.repairEntryPointIds, [
    "verify-cua-driver-windows-x64-bundle-metadata",
    "add-gateway-overlay-windows-to-offline-bundle",
  ]);
});

function completeManifest() {
  return {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    generatedAt: "2026-07-10T00:00:00.000Z",
    assets: [
      asset("cua-driver-windows-x64", "driver", true),
      asset("gateway-overlay-windows", "overlay-shell", true),
      asset("ocr-runtime-onnxruntime-node", "runtime", true),
      asset("ocr-model-pp-ocrv6-small", "model-pack", false),
      asset("webview2-runtime", "system-runtime", false),
    ],
  };
}

function asset(id, kind, offlineRequired) {
  return {
    id,
    kind,
    platform: id.includes("windows") || id.includes("webview2") ? "win32" : "all",
    offlineRequired,
    acquisition: offlineRequired ? "offline-bundle" : "offline-bundle-or-system",
    targetRoot: id === "ocr-model-pp-ocrv6-small" ? "modelRoot/pp-ocrv6-small" : `cacheRoot/${id}`,
    cacheKey: `${id}@0.0.1`,
    version: "0.0.1",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
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
