import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 7.8 proves real Windows installer transactions", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.8"], "node src/phase-7-8-windows-installer-transaction.mjs");
  assert.equal(packageJson.scripts["installer:build"], "dotnet build windows-installer/AgentComputerUse.Installer.csproj --configuration Release --nologo");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.8"], "windows-installer-transaction");

  const result = await runNode(["src/phase-7-8-windows-installer-transaction.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.8");
  assert.equal(report.benchmark, "windows-installer-transaction");
  assert.equal(report.install.currentVersion, "0.0.1");
  assert.equal(report.install.revision, 1);
  assert.equal(report.upgrade.currentVersion, "0.0.2");
  assert.equal(report.upgrade.previousVersion, "0.0.1");
  assert.equal(report.rollback.currentVersion, "0.0.1");
  assert.equal(report.rollback.previousVersion, "0.0.2");
  assert.equal(report.activeAfterRejectedUpgrade, "0.0.1");
  assert.equal(report.corruptedBundleRejected, true);
  assert.equal(report.transactionRootsClean, true);
  assert.equal(report.networkRequired, false);
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
