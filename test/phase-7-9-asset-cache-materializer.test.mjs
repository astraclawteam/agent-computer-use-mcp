import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 7.9 proves trusted asset acquisition cache activation rollback and MCP repair", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.9"], "node src/phase-7-9-asset-cache-materializer.mjs");
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /run: npm run phase:7\.9/);

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.9"], "trusted-asset-cache-materializer");

  const result = await runNode(["src/phase-7-9-asset-cache-materializer.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.9");
  assert.equal(report.benchmark, "trusted-asset-cache-materializer");
  assert.equal(report.installerKind, "native-aot");
  assert.equal(report.manifestVerified, true);
  assert.equal(report.offlineCacheKeyMatchesHttp, true);
  assert.equal(report.resumeUsed, true);
  assert.equal(report.corruptBlobRejected, true);
  assert.equal(report.zipTraversalRejected, true);
  assert.equal(report.activationAtomic, true);
  assert.equal(report.rollbackVerified, true);
  assert.equal(report.mcpRepairVerified, true);
  assert.equal(report.runtimeResolvedActiveDriver, true);
  assert.equal(report.activeDriverResolutionReason, "ready");
  assert.equal(report.firstEnableDownloadCount, 0);
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
