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

test("app smoke catalog has commercial responsibility depth", async () => {
  const { parseRealAppCatalog } = await import("../src/real-app-catalog.mjs");
  const catalog = parseRealAppCatalog(JSON.parse(await readFile("docs/productization/real-app-smoke-catalog.json", "utf8")));
  assert.ok(catalog.apps.length >= 20 && catalog.apps.length <= 50);
  assert.ok(catalog.apps.filter((app) => app.role === "required-fixture").length >= 10);
  assert.ok(catalog.apps.filter((app) => app.role === "installed-evidence").length >= 8);
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
  assert.ok(report.requiredCategoryCount >= 10);
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
