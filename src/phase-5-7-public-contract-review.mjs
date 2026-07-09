import { readFile } from "node:fs/promises";
import { COMPUTER_USE_MCP_TOOLS, MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";
import {
  PUBLIC_CONTRACT_REVIEW_PATH,
  parsePublicContractReview,
  summarizePublicContractReview,
} from "./public-contract-review.mjs";

try {
  const markdown = await readFile(PUBLIC_CONTRACT_REVIEW_PATH, "utf8");
  const review = parsePublicContractReview(markdown);
  const summary = summarizePublicContractReview(review, { tools: COMPUTER_USE_MCP_TOOLS });

  process.stdout.write(`${JSON.stringify({
    status: summary.status,
    phase: "5.7",
    benchmark: "public-mcp-contract-review",
    reviewPath: PUBLIC_CONTRACT_REVIEW_PATH,
    resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
    ...summary,
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = summary.status === "passed" ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.7",
    benchmark: "public-mcp-contract-review",
    reviewPath: PUBLIC_CONTRACT_REVIEW_PATH,
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
