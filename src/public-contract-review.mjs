import { MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";

export const PUBLIC_CONTRACT_REVIEW_PATH = "docs/productization/public-mcp-contract-review.md";

export function parsePublicContractReview(markdown) {
  const metadata = {};
  const rows = [];

  for (const line of markdown.split(/\r?\n/)) {
    const metadataMatch = /^-\s*([^:]+):\s*(.+)\s*$/.exec(line);
    if (metadataMatch) {
      metadata[normalizeMetadataKey(metadataMatch[1])] = metadataMatch[2].trim();
      continue;
    }
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/^\|\s*Tool\s*\|/.test(line)) continue;

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    const [tool, reviewStatus, compatibility, overlayExclusion, desktopControl, notes] = cells;
    rows.push({
      tool,
      reviewStatus,
      compatibility,
      overlayExclusion,
      desktopControl,
      notes,
    });
  }

  return {
    schemaVersion: Number(metadata.schemaVersion),
    resultSchemaVersion: metadata.resultSchemaVersion,
    requiresHumanReview: metadata.requiresHumanReview === "true",
    compatibilityReviewed: metadata.compatibilityReviewed === "true",
    overlayExclusionReviewed: metadata.overlayExclusionReviewed === "true",
    desktopControlReviewed: metadata.desktopControlReviewed === "true",
    rows,
  };
}

export function summarizePublicContractReview(review, options = {}) {
  const tools = options.tools ?? [];
  const toolNames = tools.map((tool) => tool.name);
  const reviewedNames = review.rows.map((row) => row.tool);
  const violations = [];

  if (review.schemaVersion !== 1) {
    violations.push({ code: "schema-version-mismatch", expected: 1, actual: review.schemaVersion });
  }
  if (review.resultSchemaVersion !== MCP_RESULT_SCHEMA_VERSION) {
    violations.push({
      code: "result-schema-version-mismatch",
      expected: MCP_RESULT_SCHEMA_VERSION,
      actual: review.resultSchemaVersion,
    });
  }
  for (const [field, value] of [
    ["requiresHumanReview", review.requiresHumanReview],
    ["compatibilityReviewed", review.compatibilityReviewed],
    ["overlayExclusionReviewed", review.overlayExclusionReviewed],
    ["desktopControlReviewed", review.desktopControlReviewed],
  ]) {
    if (value !== true) {
      violations.push({ code: "review-flag-missing", field });
    }
  }

  const missingTools = toolNames.filter((name) => !reviewedNames.includes(name));
  const extraTools = reviewedNames.filter((name) => !toolNames.includes(name));
  if (missingTools.length > 0) {
    violations.push({ code: "missing-tool-review", tools: missingTools });
  }
  if (extraTools.length > 0) {
    violations.push({ code: "unknown-tool-review", tools: extraTools });
  }

  for (const row of review.rows) {
    if (row.reviewStatus !== "reviewed") {
      violations.push({ code: "tool-not-reviewed", tool: row.tool, actual: row.reviewStatus });
    }
    if (row.compatibility !== "compatible") {
      violations.push({ code: "compatibility-not-reviewed", tool: row.tool, actual: row.compatibility });
    }
    if (row.overlayExclusion !== "overlay-free") {
      violations.push({ code: "overlay-exclusion-not-reviewed", tool: row.tool, actual: row.overlayExclusion });
    }
    if (row.desktopControl !== "reviewed") {
      violations.push({ code: "desktop-control-not-reviewed", tool: row.tool, actual: row.desktopControl });
    }
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    toolCount: toolNames.length,
    reviewedToolCount: new Set(reviewedNames).size,
    requiresHumanReview: review.requiresHumanReview,
    compatibilityReviewed: review.compatibilityReviewed,
    overlayExclusionReviewed: review.overlayExclusionReviewed,
    desktopControlReviewed: review.desktopControlReviewed,
    violationCount: violations.length,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function normalizeMetadataKey(key) {
  return key
    .trim()
    .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}
