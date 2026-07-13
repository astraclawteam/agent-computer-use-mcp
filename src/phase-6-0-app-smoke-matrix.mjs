import { readFile } from "node:fs/promises";
import { parseRealAppCatalog } from "./real-app-catalog.mjs";

const path = "docs/productization/real-app-smoke-catalog.json";
try {
  const catalog = parseRealAppCatalog(JSON.parse(await readFile(path, "utf8")));
  const roleCounts = countRoles(catalog.apps);
  const passed = catalog.apps.length >= 20 && roleCounts["required-fixture"] >= 10 && roleCounts["installed-evidence"] >= 8 && roleCounts["policy-only"] >= 2;
  process.stdout.write(`${JSON.stringify({ status: passed ? "passed" : "failed", phase: "6.0", benchmark: "app-smoke-matrix-contract", matrixPath: path, rowCount: catalog.apps.length, roleCounts, includeUserOverlay: false })}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) { process.stderr.write(`${JSON.stringify({ status: "failed", phase: "6.0", error: error?.code ?? error?.message })}\n`); process.exitCode = 1; }

function countRoles(apps) { return Object.fromEntries(["required-fixture", "installed-evidence", "policy-only"].map((role) => [role, apps.filter((app) => app.role === role).length])); }
