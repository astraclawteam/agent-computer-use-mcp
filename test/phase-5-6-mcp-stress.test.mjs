import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 5.6 has an executable standard MCP multi-client stress script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.6"], "node src/phase-5-6-mcp-stress.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.6"], "standard-mcp-multi-client-stress");

  const result = await runNode(["src/phase-5-6-mcp-stress.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.6");
  assert.equal(report.benchmark, "standard-mcp-multi-client-stress");
  assert.equal(report.sdk, "@modelcontextprotocol/sdk");
  assert.equal(report.clientCount, 4);
  assert.equal(report.roundsPerClient, 3);
  assert.equal(report.expectedReadOnlyCalls, 36);
  assert.equal(report.completedReadOnlyCalls, 36);
  assert.equal(report.failedCalls, 0);
  assert.equal(report.stateChangingToolsCalled, 0);
  assert.equal(report.readOnlyOnly, true);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
  assert.ok(report.durationMs >= 0);
  assert.equal(report.clientSummaries.length, 4);
  for (const summary of report.clientSummaries) {
    assert.equal(summary.completedReadOnlyCalls, 9);
    assert.equal(summary.failedCalls, 0);
    assert.ok(summary.toolCount >= 1);
  }
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
