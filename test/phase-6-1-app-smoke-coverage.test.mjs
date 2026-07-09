import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  APP_SMOKE_MATRIX_PATH,
  REQUIRED_APP_SMOKE_CATEGORIES,
  parseAppSmokeMatrix,
  summarizeAppSmokeMatrix,
} from "../src/app-smoke-matrix.mjs";

test("app smoke matrix has commercial beta coverage depth", async () => {
  const markdown = await readFile(APP_SMOKE_MATRIX_PATH, "utf8");
  const matrix = parseAppSmokeMatrix(markdown);
  const summary = summarizeAppSmokeMatrix(matrix);

  assert.ok(summary.rowCount >= 20, `expected at least 20 app smoke rows, got ${summary.rowCount}`);
  assert.ok(summary.rowCount <= 50, `expected at most 50 app smoke rows, got ${summary.rowCount}`);
  assert.equal(summary.invalidRows.length, 0, JSON.stringify(summary.invalidRows, null, 2));
  assert.equal(summary.auditIssues.length, 0, JSON.stringify(summary.auditIssues, null, 2));
  assert.ok(summary.statusCounts.pass >= 2, "expected at least two passing real/lab smoke rows");
  assert.ok(summary.statusCounts.insufficient >= 3, "expected self-drawn/CV insufficient cases to fail closed");
  for (const category of REQUIRED_APP_SMOKE_CATEGORIES) {
    assert.equal(summary.coverage.requiredCategories[category], true, `missing ${category}`);
  }
  assert.ok(summary.coverage.targetsByCategory.Browser >= 3, "expected Chromium, Firefox, and browser-canvas coverage");
  assert.ok(summary.coverage.targetsByCategory.Electron >= 3, "expected multiple Electron app surfaces");
});

test("Phase 6.1 has an executable app smoke coverage gate", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:6.1"], "node src/phase-6-1-app-smoke-coverage.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["6.1"], "app-smoke-coverage-gate");

  const result = await runNode(["src/phase-6-1-app-smoke-coverage.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "6.1");
  assert.equal(report.benchmark, "app-smoke-coverage-gate");
  assert.ok(report.rowCount >= 20);
  assert.ok(report.rowCount <= 50);
  assert.equal(report.auditIssues.length, 0);
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
