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

test("package foundation limits writable state to disposable user data", () => {
  const layout = getInstallLayout({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" } });
  assert.equal(layout.dataRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse");
  assert.equal(layout.cacheRoot, `${layout.dataRoot}\\cache`);
  assert.equal(layout.sessionRoot, `${layout.dataRoot}\\sessions`);
  assert.equal(layout.authoritativeProgramState, false);
});

test("package foundation assigns upgrade and rollback to exact npm versions", () => {
  const policy = getVersionPolicy();
  assert.equal(policy.versionSource, "package.json");
  assert.equal(policy.upgradeStrategy, "npm-install-exact-core-and-platform-version");
  assert.equal(policy.rollbackStrategy, "npm-install-previous-exact-version");
});

test("package foundation requires npm provenance hashes and SBOM", () => {
  const policy = getSigningPolicy();
  assert.equal(policy.npm.provenanceRequired, true);
  assert.deepEqual(policy.npm.publishOrder, ["@xiaozhiclaw/agent-computer-use-win32-x64", "agent-computer-use-mcp"]);
  assert.equal(policy.releaseArtifacts.sha256Required, true);
  assert.equal(policy.releaseArtifacts.sbomRequired, true);
  assert.equal(policy.windowsHelpers.firstPartyFiles.includes("gateway-overlay"), true);
});

test("offline asset manifest assigns every native byte to the platform package", () => {
  const manifest = buildOfflineAssetManifest({ packageVersion: "0.0.1", generatedAt: "2026-07-11T00:00:00.000Z" });
  assert.equal(manifest.distribution.runtimeDownloadAllowed, false);
  assert.equal(manifest.distribution.platformPackage, "@xiaozhiclaw/agent-computer-use-win32-x64@0.0.1");
  assert.deepEqual(manifest.assets.map(({ id }) => id), [
    "cua-driver-windows-x64",
    "gateway-overlay-windows",
    "ocr-runtime-onnxruntime-node",
    "ocr-model-pp-ocrv6-small",
  ]);
  assert.equal(manifest.assets.every(({ offlineRequired }) => offlineRequired), true);
  assert.equal(manifest.assets.every(({ acquisition }) => acquisition === "npm-platform-package-or-complete-zip"), true);
});

test("package files policy keeps protected core source-free", () => {
  const policy = getPackageFilesPolicy();
  assert.deepEqual(policy.forbiddenPathPrefixes, FORBIDDEN_PACKAGE_PATHS);
  assert.equal(policy.protection.sourceMap, false);
  const result = validatePackEntries([
    "package/package.json",
    "package/LICENSE",
    "package/README.md",
    "package/CHANGELOG.md",
    "package/release-integrity.json",
    "package/dist/launcher.mjs",
    "package/dist/computer-use-mcp-server.mjs",
    "package/dist/ocr-sidecar.mjs",
    "package/src/computer-use-mcp-server.mjs",
  ]);
  assert.equal(result.status, "failed");
});

test("package foundation and dry-run scripts emit current reports", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["package:foundation"], "node scripts/package-foundation-report.mjs");
  const foundation = await runNode("scripts/package-foundation-report.mjs");
  assert.equal(foundation.exitCode, 0, foundation.stderr);
  const report = JSON.parse(foundation.stdout);
  assert.equal(report.offlineAssetManifest.assets.length, 4);
  assert.equal(report.signingPolicy.npm.provenanceRequired, true);

  const dryRun = await runNode("scripts/package-dry-run.mjs");
  assert.equal(dryRun.exitCode, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).sourceMapCount, 0);
});

function runNode(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
