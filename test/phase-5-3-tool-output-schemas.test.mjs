import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

test("all public MCP tools declare strict output schemas", () => {
  for (const tool of COMPUTER_USE_MCP_TOOLS) {
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} inputSchema must be an object`);
    assert.equal(tool.inputSchema?.additionalProperties, false, `${tool.name} inputSchema must reject unknown fields`);
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} outputSchema must be an object`);
    assert.equal(tool.outputSchema?.additionalProperties, false, `${tool.name} outputSchema must reject unknown fields`);
    assert.equal(tool.outputSchema.properties?.includeUserOverlay?.const, false, `${tool.name} must lock overlay exclusion`);
    assert.equal(tool.outputSchema.properties?.resultSchemaVersion?.const, "5.3", `${tool.name} must expose a versioned result contract`);
    assert.equal(tool.outputSchema.required.includes("includeUserOverlay"), true, `${tool.name} must require includeUserOverlay`);
    assert.equal(tool.outputSchema.required.includes("resultSchemaVersion"), true, `${tool.name} must require resultSchemaVersion`);
  }
});

test("Phase 5.3 has an executable strict tool schema smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.3"], "node src/phase-5-3-tool-schemas.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.3"], "strict-tool-output-schemas");

  const result = await runNode(["src/phase-5-3-tool-schemas.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.3");
  assert.equal(report.benchmark, "strict-tool-output-schemas");
  assert.equal(report.toolCount, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(report.toolsWithOutputSchema, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(report.versionedContracts, COMPUTER_USE_MCP_TOOLS.length);
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
