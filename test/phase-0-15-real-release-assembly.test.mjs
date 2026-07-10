import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 0.15 assembles installs and smokes a real offline Windows release candidate", { timeout: 300_000 }, async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["release:windows:assets"], "node scripts/fetch-windows-release-assets.mjs");
  assert.equal(packageJson.scripts["release:windows:assemble"], "node scripts/build-windows-release-candidate.mjs");
  assert.equal(packageJson.scripts["phase:0.15"], "node src/phase-0-15-real-release-assembly.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.15"], "real-release-assembly");

  const { buildReleaseMetadata } = await import("../src/release-metadata.mjs");
  assert.ok(buildReleaseMetadata({ packageJson }).artifacts.some((artifact) => artifact.command === "npm run phase:0.15"));
  const { buildReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const gate = buildReleaseReadinessGate({ packageJson });
  assert.ok(gate.commands.some((item) => item.command === "npm run phase:0.15"));
  assert.ok(gate.evidence.some((item) => item.id === "real-release-assembly" && item.command === "npm run phase:0.15"));

  const result = await runNode(["src/phase-0-15-real-release-assembly.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.15");
  assert.equal(report.benchmark, "real-release-assembly");
  assert.equal(report.realAssetBytesVerified, true);
  assert.equal(report.releaseBundleVerified, true);
  assert.equal(report.offlineBundleVerified, true);
  assert.equal(report.installerAppliedRelease, true);
  assert.equal(report.assetsPreparedAndActivatedOffline, true);
  assert.equal(report.standardMcpSmokePassed, true);
  assert.equal(report.ocrModelPackPresent, true);
  assert.equal(report.webView2InstallerPresent, true);
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
