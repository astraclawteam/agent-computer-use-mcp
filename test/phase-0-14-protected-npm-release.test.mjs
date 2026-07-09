import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 0.14 builds smokes and packs a protected npm release", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["release:npm:pack"], "node scripts/pack-protected-npm-package.mjs");
  assert.equal(packageJson.scripts["phase:0.14"], "node src/phase-0-14-protected-npm-release.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.14"], "protected-npm-release");

  const result = await runNode(["src/phase-0-14-protected-npm-release.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.14");
  assert.equal(report.benchmark, "protected-npm-release");
  assert.equal(report.rootPublishBlocked, true);
  assert.equal(report.integrityVerified, true);
  assert.equal(report.mcpSmokePassed, true);
  assert.equal(report.sourceEntryCount, 0);
  assert.equal(report.sourceMapCount, 0);
  assert.equal(report.obfuscatedRuntimeCount, 3);
  assert.equal(report.workspaceCleaned, true);
  assert.match(report.tarballSha256, /^[a-f0-9]{64}$/);
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
