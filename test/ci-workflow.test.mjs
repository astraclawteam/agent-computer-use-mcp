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
