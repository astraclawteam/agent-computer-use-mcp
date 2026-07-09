import { readFile } from "node:fs/promises";
import {
  APP_SMOKE_MATRIX_PATH,
  parseAppSmokeMatrix,
  REQUIRED_APP_SMOKE_CATEGORIES,
  summarizeAppSmokeMatrix,
} from "./app-smoke-matrix.mjs";

try {
  const markdown = await readFile(APP_SMOKE_MATRIX_PATH, "utf8");
  const matrix = parseAppSmokeMatrix(markdown);
  const summary = summarizeAppSmokeMatrix(matrix);
  const allRequiredCategoriesCovered = REQUIRED_APP_SMOKE_CATEGORIES
    .every((category) => summary.coverage.requiredCategories[category]);
  const passed = summary.rowCount >= 15
    && allRequiredCategoriesCovered
    && summary.invalidRows.length === 0;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "6.0",
    benchmark: "app-smoke-matrix-contract",
    matrixPath: APP_SMOKE_MATRIX_PATH,
    ...summary,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "6.0",
    benchmark: "app-smoke-matrix-contract",
    matrixPath: APP_SMOKE_MATRIX_PATH,
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
