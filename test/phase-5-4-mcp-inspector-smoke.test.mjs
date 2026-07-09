import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 5.4 has an executable MCP Inspector compatibility smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.4"], "node src/phase-5-4-mcp-inspector-smoke.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.4"], "mcp-inspector-smoke");

  const result = await runNode(["src/phase-5-4-mcp-inspector-smoke.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.4");
  assert.equal(report.benchmark, "mcp-inspector-smoke");
  assert.equal(report.sdk, "@modelcontextprotocol/sdk");
  assert.equal(report.clientProfile, "mcp-inspector");
  assert.equal(report.initialized, true);
  assert.equal(report.listTools, true);
  assert.equal(report.readOnlyOnly, true);
  assert.equal(report.stateChangingToolsCalled, 0);
  assert.deepEqual(report.readOnlyCalls, ["computer.health", "computer.installation"]);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
  assert.ok(report.toolNames.includes("computer.health"));
  assert.ok(report.toolNames.includes("computer.installation"));
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
