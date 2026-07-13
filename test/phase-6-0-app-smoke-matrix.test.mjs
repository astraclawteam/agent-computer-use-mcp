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
  assert.equal(report.matrixPath, "docs/productization/real-app-smoke-catalog.json");
  assert.equal(report.includeUserOverlay, false);
  assert.ok(report.rowCount >= 15);
  assert.ok(report.roleCounts["required-fixture"] >= 10);
  assert.ok(report.roleCounts["installed-evidence"] >= 8);
  assert.ok(report.roleCounts["policy-only"] >= 2);
});

test("app smoke catalog uses explicit productized roles", async () => {
  const { parseRealAppCatalog } = await import("../src/real-app-catalog.mjs");
  const catalog = parseRealAppCatalog(JSON.parse(readFileSync("docs/productization/real-app-smoke-catalog.json", "utf8")));
  assert.ok(catalog.apps.length >= 20);
  assert.equal(catalog.apps.some((app) => Object.hasOwn(app, "required")), false);
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
