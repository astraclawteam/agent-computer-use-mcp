import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FORBIDDEN_PACKAGE_PATHS,
  buildOfflineAssetManifest,
  getInstallLayout,
  getPackageFilesPolicy,
  getSigningPolicy,
  getVersionPolicy,
  validatePackEntries,
} from "../src/package-foundation.mjs";

test("package foundation defines stable install directories", () => {
  const layout = getInstallLayout({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    },
  });

  assert.equal(layout.dataRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse");
  assert.equal(layout.artifactRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\artifacts");
  assert.equal(layout.modelRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models");
  assert.equal(layout.cacheRoot, "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse");
  assert.equal(layout.driverRoot, "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\cua-driver");
  assert.equal(layout.overlayRoot, "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\overlay");
});

test("package foundation documents version and upgrade policy", () => {
  const policy = getVersionPolicy();

  assert.equal(policy.versionSource, "package.json");
  assert.equal(policy.channel, "0.x-preview");
  assert.equal(policy.publicContract, "computer.* MCP tools and structuredContent schemas");
  assert.equal(policy.upgradeStrategy, "side-by-side-assets-in-place-package");
  assert.equal(policy.rollbackStrategy, "retain previous asset manifest until next successful doctor run");
  assert.deepEqual(policy.compatibilityAliases, ["XIAOZHICLAW_*"]);
});

test("package foundation documents Windows signing policy", () => {
  const policy = getSigningPolicy();

  assert.equal(policy.windowsHelpers.signingRequired, true);
  assert.deepEqual(policy.windowsHelpers.files, [
    "gateway-overlay",
    "cua-driver",
    "future-native-sidecars",
  ]);
  assert.equal(policy.unsignedDevelopmentBuilds.allowed, true);
  assert.equal(policy.unsignedDevelopmentBuilds.distribution, "blocked");
});

test("offline asset manifest declares productized asset packs", () => {
  const manifest = buildOfflineAssetManifest({
    packageVersion: "0.0.1",
    generatedAt: "2026-07-09T00:00:00.000Z",
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageName, "agent-computer-use-mcp");
  assert.equal(manifest.packageVersion, "0.0.1");
  assert.deepEqual(manifest.installRoots.windows, {
    dataRoot: "%LOCALAPPDATA%\\AgentComputerUse",
    cacheRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse",
  });
  assert.deepEqual(manifest.assets.map((asset) => asset.id), [
    "cua-driver-windows-x64",
    "gateway-overlay-windows",
    "ocr-runtime-onnxruntime-node",
    "ocr-model-pp-ocrv6-small",
    "webview2-runtime",
  ]);
  assert.equal(manifest.assets.find((asset) => asset.id === "ocr-model-pp-ocrv6-small").offlineRequired, false);
  assert.equal(manifest.assets.find((asset) => asset.id === "webview2-runtime").offlineRequired, false);
});

test("package files policy rejects generated artifacts and local caches", () => {
  const policy = getPackageFilesPolicy();
  assert.deepEqual(policy.forbiddenPathPrefixes, FORBIDDEN_PACKAGE_PATHS);
  assert.equal(policy.includeRoots.includes("scripts/"), true);
  assert.equal(policy.includeRoots.includes("docs/productization/"), true);
  assert.equal(policy.includeRoots.includes("windows-installer/"), true);

  const result = validatePackEntries([
    "package/package.json",
    "package/src/computer-use-mcp-server.mjs",
    "package/gateway-overlay/bin/Debug/net10.0-windows/GatewayComputerUseOverlay.exe",
    "package/node_modules/@modelcontextprotocol/sdk/package.json",
  ]);

  assert.equal(result.status, "failed");
  assert.deepEqual(result.violations.map((item) => item.matchedPrefix), [
    "gateway-overlay/bin/",
    "node_modules/",
  ]);
});

test("package dry-run script emits a JSON report", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts.test, "node --test");
  assert.equal(packageJson.scripts["package:dry-run"], "node scripts/package-dry-run.mjs");
  assert.equal(packageJson.scripts["package:foundation"], "node scripts/package-foundation-report.mjs");
  assert.equal(packageJson.scripts["assets:manifest"], "node scripts/offline-asset-manifest.mjs");

  const result = await runNode(["scripts/package-foundation-report.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.packageName, "agent-computer-use-mcp");
  assert.equal(report.offlineAssetManifest.assets.length, 5);
  assert.equal(report.signingPolicy.windowsHelpers.signingRequired, true);
  assert.equal(report.packageFilesPolicy.forbiddenPathPrefixes.includes("node_modules/"), true);
});

test("npm package includes executable productization review documents", async () => {
  const result = process.platform === "win32"
    ? await runCommand("cmd.exe", ["/d", "/s", "/c", "npm pack --dry-run --json"])
    : await runCommand("npm", ["pack", "--dry-run", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const packReport = JSON.parse(result.stdout)[0];
  const files = packReport.files.map((file) => file.path);

  assert.ok(files.includes("docs/productization/app-smoke-matrix.md"));
  assert.ok(files.includes("docs/productization/public-mcp-contract-review.md"));
  assert.ok(files.includes("docs/productization/release-gates.md"));
  assert.ok(files.includes("windows-installer/AgentComputerUse.Installer.csproj"));
  assert.ok(files.includes("windows-installer/Program.cs"));
  assert.equal(files.some((file) => file.startsWith("windows-installer/bin/")), false);
  assert.equal(files.some((file) => file.startsWith("windows-installer/obj/")), false);
});

test("offline asset manifest script emits the asset manifest only", async () => {
  const result = await runNode(["scripts/offline-asset-manifest.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.packageName, "agent-computer-use-mcp");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(Array.isArray(manifest.assets), true);
  assert.equal(Object.hasOwn(manifest, "installLayout"), false);
});

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

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
