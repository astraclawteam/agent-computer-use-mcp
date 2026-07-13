import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("nightly workflow runs the exact two-hour gate verifies and retains sealed evidence", async () => {
  const source = await readFile(".github/workflows/nightly-soak.yml", "utf8");
  const workflow = parse(source);
  const job = workflow.jobs["runtime-soak"];
  const steps = job.steps;
  const soak = steps.find((step) => step.name === "Run two-hour commercial soak");
  const verify = steps.find((step) => step.name === "Verify nightly soak evidence");
  const upload = steps.find((step) => step.name === "Upload nightly soak evidence");

  assert.ok(workflow.on.schedule.length > 0);
  assert.match(job["runs-on"], /^windows-/u);
  assert.ok(job["timeout-minutes"] > 120);
  assert.equal(
    soak.run,
    "npm run phase:8.0 -- --gate nightly --duration-ms 7200000 --evidence-root evidence/nightly --seed 20260713",
  );
  assert.match(String(verify.if), /always\(\)/u);
  assert.match(verify.run, /npm run evidence:verify --/u);
  assert.match(verify.run, /evidence[\\/]nightly/u);
  assert.match(String(upload.if), /always\(\)/u);
  assert.equal(upload.uses, "actions/upload-artifact@v4");
  assert.equal(upload.with["retention-days"], 30);
  assert.equal(upload.with["if-no-files-found"], "error");
  const paths = String(upload.with.path).trim().split(/\r?\n/u).map((path) => path.trim());
  assert.deepEqual(paths, [
    "evidence/nightly/**/run-manifest.json",
    "evidence/nightly/**/events.jsonl",
    "evidence/nightly/**/report.json",
    "evidence/nightly/**/checksums.txt",
  ]);
  assert.doesNotMatch(source, /\.(?:png|jpe?g|webp|bmp|gif)\b/iu);
  assert.ok(steps.indexOf(verify) < steps.indexOf(upload));
});
