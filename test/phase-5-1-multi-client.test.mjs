import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 5.1 has an executable standard MCP multi-client smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.1"], "node src/phase-5-1-multi-client.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.1"], "standard-mcp-multi-client");

  const result = await runNode(["src/phase-5-1-multi-client.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.1");
  assert.equal(report.benchmark, "standard-mcp-multi-client");
  assert.equal(report.sdk, "@modelcontextprotocol/sdk");
  assert.equal(report.clientCount, 2);
  assert.equal(report.healthCalls, 2);
  assert.equal(report.installationCalls, 2);
  assert.equal(report.readOnlyOnly, true);
  assert.equal(report.includeUserOverlay, false);
  assert.deepEqual(report.clientNames, [
    "agent-computer-use-phase-5-1-client-a",
    "agent-computer-use-phase-5-1-client-b",
  ]);
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
