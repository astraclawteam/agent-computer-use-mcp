export const APP_SMOKE_MATRIX_PATH = "docs/productization/app-smoke-matrix.md";

export const REQUIRED_APP_SMOKE_CATEGORIES = [
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

export const APP_SMOKE_STATUSES = ["pass", "partial", "blocked", "insufficient"];
export const APP_SMOKE_CAPABILITY_SOURCES = [
  "uia-som",
  "ocr",
  "template",
  "cv",
  "browser-semantic",
  "manual-only",
  "insufficient",
];

export function parseAppSmokeMatrix(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/^\|\s*Category\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    const [category, target, flow, source, status, notes] = cells;
    rows.push({
      appId: slugify(`${category}-${target}`),
      appName: target,
      category,
      status,
      capabilitySources: splitSources(source),
      flow,
      includeUserOverlay: false,
      policyEvents: extractPolicyEvents(notes),
      artifacts: [],
      notes,
    });
  }
  return {
    schemaVersion: 1,
    rows,
  };
}

export function summarizeAppSmokeMatrix(matrix) {
  const invalidRows = [];
  const statusCounts = Object.fromEntries(APP_SMOKE_STATUSES.map((status) => [status, 0]));
  const coverage = {
    requiredCategories: Object.fromEntries(REQUIRED_APP_SMOKE_CATEGORIES.map((category) => [category, false])),
  };

  for (const row of matrix.rows) {
    if (Object.hasOwn(statusCounts, row.status)) {
      statusCounts[row.status] += 1;
    }
    if (Object.hasOwn(coverage.requiredCategories, row.category)) {
      coverage.requiredCategories[row.category] = true;
    }
    const errors = validateAppSmokeRow(row);
    if (errors.length > 0) {
      invalidRows.push({ appId: row.appId, errors });
    }
  }

  return {
    rowCount: matrix.rows.length,
    statusCounts,
    coverage,
    invalidRows,
  };
}

export function validateAppSmokeRow(row) {
  const errors = [];
  if (!APP_SMOKE_STATUSES.includes(row.status)) {
    errors.push(`invalid status: ${row.status}`);
  }
  if (!row.capabilitySources.length) {
    errors.push("missing capability source");
  }
  for (const source of row.capabilitySources) {
    if (!APP_SMOKE_CAPABILITY_SOURCES.includes(source)) {
      errors.push(`invalid capability source: ${source}`);
    }
  }
  if (row.includeUserOverlay !== false) {
    errors.push("includeUserOverlay must be false");
  }
  if (row.status === "insufficient" && !/observation\.insufficient|unsafe|provider/i.test(row.notes)) {
    errors.push("insufficient rows must describe observation.insufficient or unsafe provider behavior");
  }
  return errors;
}

function splitSources(source) {
  return source.split("/").map((item) => item.trim()).filter(Boolean);
}

function extractPolicyEvents(notes) {
  const events = notes.match(/policy\.[a-z0-9_.-]+|observation\.insufficient/gi);
  return events ? [...new Set(events)] : [];
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
