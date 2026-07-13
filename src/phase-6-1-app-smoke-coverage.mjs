import { readFile } from "node:fs/promises";
import { parseRealAppCatalog } from "./real-app-catalog.mjs";

const path = "docs/productization/real-app-smoke-catalog.json";
try {
  const catalog = parseRealAppCatalog(JSON.parse(await readFile(path, "utf8")));
  const roleCounts = Object.fromEntries(["required-fixture", "installed-evidence", "policy-only"].map((role) => [role, catalog.apps.filter((app) => app.role === role).length]));
  const requiredCategories = new Set(catalog.apps.filter((app) => app.role === "required-fixture").map((app) => app.requiredCategory));
  const passed = catalog.apps.length >= 20 && catalog.apps.length <= 50 && roleCounts["required-fixture"] >= 10 && roleCounts["installed-evidence"] >= 8 && roleCounts["policy-only"] >= 2 && requiredCategories.size >= 10;
  process.stdout.write(`${JSON.stringify({ status: passed ? "passed" : "failed", phase: "6.1", benchmark: "app-smoke-coverage-gate", matrixPath: path, rowCount: catalog.apps.length, roleCounts, requiredCategoryCount: requiredCategories.size, auditIssues: [], includeUserOverlay: false })}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) { process.stderr.write(`${JSON.stringify({ status: "failed", phase: "6.1", error: error?.code ?? error?.message })}\n`); process.exitCode = 1; }
