import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 0.15 assembles installs and smokes a real offline Windows release candidate", { timeout: 900_000 }, async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["release:windows:assets"], "node scripts/fetch-windows-release-assets.mjs");
  assert.equal(packageJson.scripts["release:windows:assemble"], "node scripts/build-windows-release-candidate.mjs");
  assert.equal(packageJson.scripts["phase:0.15"], "node src/phase-0-15-real-release-assembly.mjs");
  assert.match(readFileSync("scripts/build-windows-release-candidate.mjs", "utf8"), /artifacts\/windows-release/u);
  const phaseSource = readFileSync("src/phase-0-15-real-release-assembly.mjs", "utf8");
  assert.match(phaseSource, /artifacts\/windows-release/u);
  assert.match(phaseSource, /WINDOWS_X64_OFFLINE_MAX_BYTES/u);
  assert.match(phaseSource, /offlineBundleSizeBytes/u);
  assert.match(phaseSource, /offlineBundleMaxBytes/u);

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.15"], "real-release-assembly");

  const { buildReleaseMetadata } = await import("../src/release-metadata.mjs");
  assert.ok(buildReleaseMetadata({ packageJson }).artifacts.some((artifact) => artifact.command === "npm run phase:0.15"));
  const { buildReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const gate = buildReleaseReadinessGate({ packageJson });
  assert.ok(gate.commands.some((item) => item.command === "npm run phase:0.15"));
  assert.ok(gate.evidence.some((item) => item.id === "real-release-assembly" && item.command === "npm run phase:0.15"));

  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /run: npm run phase:7\.9[\s\S]*run: npm run phase:0\.15/u);
  const releaseDocs = [
    "docs/productization/roadmap.md",
    "docs/productization/release-gates.md",
    "docs/productization/README.md",
    "README.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(releaseDocs, /artifacts\/windows-release\/<version>\//u);
  for (const fileName of [
    "agent-computer-use-mcp-X.Y.Z-windows-x64-installer.candidate.exe",
    "agent-computer-use-mcp-X.Y.Z-windows-x64-offline.candidate.zip",
    "agent-computer-use-mcp-X.Y.Z.tgz",
    "agent-computer-use-mcp-X.Y.Z-sbom.cdx.json",
    "agent-computer-use-mcp-X.Y.Z-asset-manifest.candidate.json",
    "agent-computer-use-mcp-X.Y.Z-asset-manifest.candidate.sig",
    "agent-computer-use-mcp-X.Y.Z-asset-keyring.candidate.json",
    "agent-computer-use-mcp-X.Y.Z-release-manifest.json",
    "agent-computer-use-mcp-X.Y.Z-checksums.txt",
  ]) {
    assert.equal(releaseDocs.includes(fileName), true, fileName);
  }
  for (const assetId of [
    "node-runtime-windows-x64",
    "cua-driver-windows-x64",
    "ocr-model-pp-ocrv6-small-det",
    "ocr-model-pp-ocrv6-small-rec",
    "ocr-model-pp-ocrv6-small-rec-metadata",
  ]) {
    assert.equal(releaseDocs.includes(assetId), true, assetId);
  }
  assert.match(releaseDocs, /blocked_unsigned[\s\S]*PR5/u);

  const result = await runNode(["src/phase-0-15-real-release-assembly.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.15");
  assert.equal(report.benchmark, "real-release-assembly");
  assert.equal(report.realAssetBytesVerified, true);
  assert.equal(report.releaseBundleVerified, true);
  assert.equal(report.offlineBundleVerified, true);
  assert.ok(report.offlineBundleSizeBytes <= report.offlineBundleMaxBytes);
  assert.equal(report.offlineBundleMaxBytes, 310 * 1024 * 1024);
  assert.ok(report.offlineVerifiedFileCount > 0);
  assert.equal(report.installerAppliedRelease, true);
  assert.equal(report.assetsPreparedAndActivatedOffline, true);
  assert.equal(report.standardMcpSmokePassed, true);
  assert.equal(report.activatedDriverResolvedByMcp, true);
  assert.equal(report.activatedDriverPathMatches, true);
  assert.equal(report.mcpDeadlineMs, 15_000);
  assert.equal(report.ocrModelPackPresent, true);
  assert.equal(report.nativeOverlayPresent, true);
  assert.equal(report.overlayRequiresWebView2, false);
  assert.equal(report.checksumsVerified, true);
  assert.equal(report.sbomVerified, true);
  assert.equal(report.firstEnableDownloadCount, 0);
  assert.equal(report.networkAllowedDuringInstall, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        agent_computer_use_cua_driver: "C:\\host-tools\\must-not-be-used\\cua-driver.exe",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
