import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { verifyEvidenceDirectory } from "../src/commercial-evidence.mjs";
import { parseRealAppCatalog } from "../src/real-app-catalog.mjs";

export async function writeVerifiedAppSmokeMatrix(options) {
  if (options.verification?.status !== "passed") throw new Error("app.matrix_evidence_unverified");
  const report = options.verification.report;
  if (report?.schemaVersion !== 2 || report.fullMatrix !== true) throw new Error("app.matrix_full_evidence_required");
  const catalog = parseRealAppCatalog(options.catalog);
  const results = new Map((report.results ?? []).map((result) => [result.appId, result]));
  const rows = catalog.apps.map((entry) => {
    const result = results.get(entry.appId);
    if (!result) throw new Error(`app.matrix_result_missing: ${entry.appId}`);
    return `| ${cell(entry.appName)} | ${entry.role} | ${cell(entry.category)} | ${result.status} | ${result.attempts?.length ?? 0} |`;
  });
  const document = [
    "# Real Application Smoke Matrix",
    "",
    `Generated from verified evidence run \`${cell(options.verification.runId ?? "unknown")}\`. Do not edit status cells by hand.`,
    "",
    "| Application | Evidence role | Category | Verified status | Attempts |",
    "| --- | --- | --- | --- | ---: |",
    ...rows,
    "",
  ].join("\n");
  await writeFile(options.output, document, "utf8");
  return document;
}

function cell(value) { return String(value).replaceAll("|", "\\|").replaceAll(/[\r\n]/gu, " "); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [evidencePath, output = "docs/productization/app-smoke-matrix.md"] = process.argv.slice(2);
  if (!evidencePath) throw new Error("app.matrix_evidence_path_required");
  const catalog = JSON.parse(await readFile("docs/productization/real-app-smoke-catalog.json", "utf8"));
  const verification = await verifyEvidenceDirectory(evidencePath);
  await writeVerifiedAppSmokeMatrix({ output, catalog, verification });
}
