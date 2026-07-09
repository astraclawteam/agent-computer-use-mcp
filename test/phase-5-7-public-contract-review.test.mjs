import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPUTER_USE_MCP_TOOLS, MCP_RESULT_SCHEMA_VERSION } from "../src/computer-use-mcp-tools.mjs";

const REVIEW_PATH = "docs/productization/public-mcp-contract-review.md";

test("public MCP contract review document covers every public tool", async () => {
  assert.equal(existsSync(REVIEW_PATH), true);

  const {
    parsePublicContractReview,
    summarizePublicContractReview,
  } = await import("../src/public-contract-review.mjs");
  const review = parsePublicContractReview(readFileSync(REVIEW_PATH, "utf8"));
  const summary = summarizePublicContractReview(review, { tools: COMPUTER_USE_MCP_TOOLS });

  assert.equal(review.schemaVersion, 1);
  assert.equal(review.resultSchemaVersion, MCP_RESULT_SCHEMA_VERSION);
  assert.equal(summary.status, "passed", JSON.stringify(summary.violations, null, 2));
  assert.equal(summary.toolCount, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(summary.reviewedToolCount, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(summary.requiresHumanReview, true);
  assert.equal(summary.compatibilityReviewed, true);
  assert.equal(summary.overlayExclusionReviewed, true);
  assert.equal(summary.desktopControlReviewed, true);
  assert.equal(summary.violationCount, 0);
});

test("Phase 5.7 has an executable public MCP contract review smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.7"], "node src/phase-5-7-public-contract-review.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.7"], "public-mcp-contract-review");

  const result = await runNode(["src/phase-5-7-public-contract-review.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.7");
  assert.equal(report.benchmark, "public-mcp-contract-review");
  assert.equal(report.reviewPath, REVIEW_PATH);
  assert.equal(report.toolCount, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(report.reviewedToolCount, COMPUTER_USE_MCP_TOOLS.length);
  assert.equal(report.resultSchemaVersion, MCP_RESULT_SCHEMA_VERSION);
  assert.equal(report.requiresHumanReview, true);
  assert.equal(report.compatibilityReviewed, true);
  assert.equal(report.overlayExclusionReviewed, true);
  assert.equal(report.desktopControlReviewed, true);
  assert.equal(report.violationCount, 0);
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
