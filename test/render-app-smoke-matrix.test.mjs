import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeVerifiedAppSmokeMatrix } from "../scripts/render-app-smoke-matrix.mjs";

test("renderer replaces hand-edited values with verified evidence and keeps missing coverage visible", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "app-matrix-render-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "matrix.md");
  await writeFile(output, "| Fake | pass | C:\\Users\\private\\app.exe |\n", "utf8");
  await writeVerifiedAppSmokeMatrix({
    output,
    catalog: {
      schemaVersion: 2,
      apps: [entry("installed-a", "Installed A"), entry("installed-b", "Installed B")],
    },
    verification: {
      status: "passed",
      runId: "verified-run",
      report: {
        schemaVersion: 2,
        fullMatrix: true,
        results: [
          { appId: "installed-a", role: "installed-evidence", status: "not-installed", attempts: [{ status: "not-installed" }] },
          { appId: "installed-b", role: "installed-evidence", status: "product-failure", attempts: [{ status: "product-failure" }] },
        ],
      },
    },
  });
  const document = await readFile(output, "utf8");
  assert.match(document, /verified-run/u);
  assert.match(document, /Installed A \| installed-evidence \| Test \| not-installed/u);
  assert.match(document, /Installed B \| installed-evidence \| Test \| product-failure/u);
  assert.doesNotMatch(document, /Fake|C:\\|\/Users\//u);
});

test("renderer rejects unverified or filtered evidence", async () => {
  const catalog = { schemaVersion: 2, apps: [entry("a", "A")] };
  await assert.rejects(writeVerifiedAppSmokeMatrix({ output: "unused.md", catalog, verification: { status: "failed" } }), /app\.matrix_evidence_unverified/u);
  await assert.rejects(writeVerifiedAppSmokeMatrix({
    output: "unused.md",
    catalog,
    verification: { status: "passed", report: { schemaVersion: 2, fullMatrix: false, results: [] } },
  }), /app\.matrix_full_evidence_required/u);
});

function entry(appId, appName) {
  return { appId, appName, category: "Test", role: "installed-evidence", adapter: "test", requiredCategory: null, executableCandidates: ["app.exe"], expectedStatus: "pass", privacyClass: "public-fixture" };
}
