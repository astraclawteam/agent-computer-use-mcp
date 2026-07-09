import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const REQUIRED_CATEGORIES = [
  "Win32",
  "Browser",
  "Electron",
  "WPF",
  "WinForms",
  "Qt",
  "Office",
  "Terminal",
  "Canvas",
  "Industrial",
];
const ALLOWED_STATUS = ["pass", "partial", "blocked", "insufficient"];
const ALLOWED_SOURCES = ["uia-som", "ocr", "template", "cv", "browser-semantic", "manual-only", "insufficient"];

test("Phase 6.0 app smoke matrix is an executable release artifact", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:6.0"], "node src/phase-6-0-app-smoke-matrix.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["6.0"], "app-smoke-matrix-contract");

  const result = await runNode(["src/phase-6-0-app-smoke-matrix.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "6.0");
  assert.equal(report.benchmark, "app-smoke-matrix-contract");
  assert.equal(report.matrixPath, "docs/productization/app-smoke-matrix.md");
  assert.equal(report.includeUserOverlay, false);
  assert.ok(report.rowCount >= 15);
  assert.equal(report.invalidRows.length, 0);
  for (const category of REQUIRED_CATEGORIES) {
    assert.equal(report.coverage.requiredCategories[category], true, `${category} must be covered`);
  }
  for (const status of ALLOWED_STATUS) {
    assert.equal(typeof report.statusCounts[status], "number", `${status} must be counted`);
  }
});

test("app smoke matrix rows use productized status and capability vocabularies", async () => {
  const { parseAppSmokeMatrix } = await import("../src/app-smoke-matrix.mjs");
  const matrix = parseAppSmokeMatrix(readFileSync("docs/productization/app-smoke-matrix.md", "utf8"));
  assert.ok(matrix.rows.length >= 15);
  assert.equal(matrix.rows.some((row) => row.status === "pending"), false);

  const categories = new Set(matrix.rows.map((row) => row.category));
  for (const category of REQUIRED_CATEGORIES) {
    assert.equal(categories.has(category), true, `${category} must be represented`);
  }
  for (const row of matrix.rows) {
    assert.ok(ALLOWED_STATUS.includes(row.status), `${row.appId} has invalid status ${row.status}`);
    assert.ok(row.capabilitySources.length > 0, `${row.appId} must declare capability sources`);
    for (const source of row.capabilitySources) {
      assert.ok(ALLOWED_SOURCES.includes(source), `${row.appId} has invalid source ${source}`);
    }
    assert.equal(row.includeUserOverlay, false);
    if (row.status === "insufficient") {
      assert.match(row.notes, /observation\.insufficient|unsafe|provider/i);
    }
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
