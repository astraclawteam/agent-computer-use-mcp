import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("ordinary CI stays offline while release workflows own real platform assets", async () => {
  const source = await readFile(".github/workflows/ci.yml", "utf8");
  const workflow = parse(source);
  const runs = workflow.jobs.test.steps.map((step) => step.run ?? "").join("\n");
  const validation = await readFile(
    ".github/workflows/platform-release-validation.yml",
    "utf8",
  );
  const release = await readFile(".github/workflows/release.yml", "utf8");

  assert.doesNotMatch(runs, /phase:7\.8|phase:7\.9|phase:0\.15|release:windows:size-report/u);
  assert.doesNotMatch(source, /installer/iu);
  assert.match(validation, /build-platform-release\.mjs --allow-network/u);
  assert.match(validation, /windows-release-size-report\.mjs/u);
  assert.match(release, /build-platform-release\.mjs --allow-network/u);
  assert.match(release, /release:windows:size-report/u);
});

test("pull request CI runs and retains exact commercial soak evidence", async () => {
  const source = await readFile(".github/workflows/ci.yml", "utf8");
  const workflow = parse(source);
  const steps = workflow.jobs.test.steps;
  const soak = steps.find((step) => step.name === "Run 15-minute commercial soak");
  const upload = steps.find((step) => step.uses === "actions/upload-artifact@v4");
  assert.equal(soak.run, "npm run soak:pr");
  assert.equal(upload.if, "always()");
  assert.equal(upload.with["retention-days"], 30);
  assert.match(upload.with.path, /run-manifest\.json/u);
  assert.match(upload.with.path, /events\.jsonl/u);
  assert.match(upload.with.path, /report\.json/u);
  assert.match(upload.with.path, /checksums\.txt/u);
  assert.doesNotMatch(JSON.stringify(upload), /png|jpe?g|screenshot/iu);
});
