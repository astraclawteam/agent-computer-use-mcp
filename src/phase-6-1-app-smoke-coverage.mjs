import { readFile } from "node:fs/promises";
import {
  APP_SMOKE_MATRIX_PATH,
  REQUIRED_APP_SMOKE_CATEGORIES,
  parseAppSmokeMatrix,
  summarizeAppSmokeMatrix,
} from "./app-smoke-matrix.mjs";

try {
  const markdown = await readFile(APP_SMOKE_MATRIX_PATH, "utf8");
  const matrix = parseAppSmokeMatrix(markdown);
  const summary = summarizeAppSmokeMatrix(matrix);
  const requiredCategoriesCovered = REQUIRED_APP_SMOKE_CATEGORIES
    .every((category) => summary.coverage.requiredCategories[category]);
  const passed = summary.rowCount >= 20
    && summary.rowCount <= 50
    && requiredCategoriesCovered
    && summary.invalidRows.length === 0
    && summary.auditIssues.length === 0
    && summary.statusCounts.pass >= 2
    && summary.statusCounts.insufficient >= 3
    && summary.coverage.targetsByCategory.Browser >= 3
    && summary.coverage.targetsByCategory.Electron >= 3;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "6.1",
    benchmark: "app-smoke-coverage-gate",
    matrixPath: APP_SMOKE_MATRIX_PATH,
    requiredCategoriesCovered,
    ...summary,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "6.1",
    benchmark: "app-smoke-coverage-gate",
    matrixPath: APP_SMOKE_MATRIX_PATH,
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
