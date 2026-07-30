import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("tag workflow verifies and publishes exactly one Windows GitHub Release artifact", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);
  const job = workflow.jobs["windows-artifact"];
  const runs = job.steps.map((step) => step.run ?? "").join("\n");
  const actions = job.steps.map((step) => step.uses ?? "").filter(Boolean);

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.equal(workflow.permissions.contents, "write");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(job["runs-on"], "windows-latest");
  assert.equal(actions.includes("actions/checkout@v6"), true);
  assert.equal(actions.includes("actions/setup-node@v6"), true);
  assert.equal(actions.includes("actions/setup-dotnet@v5"), true);
  assert.match(runs, /release\.tag_version_mismatch/u);
  assert.match(runs, /release\.commit_not_on_main/u);
  assert.match(runs, /release\.changelog_missing/u);
  assert.match(runs, /npm test/u);
  assert.match(runs, /phase:1\.6/u);
  assert.match(runs, /phase:1\.7/u);
  assert.match(runs, /phase:1\.8/u);
  assert.match(runs, /artifact:windows:build -- --allow-network --source-commit/u);
  assert.match(runs, /SHA256SUMS\.txt/u);
  assert.match(runs, /gh release create/u);
  assert.match(runs, /--verify-tag/u);
  assert.match(runs, /--latest/u);
  assert.doesNotMatch(source, /npm publish|NODE_AUTH_TOKEN|GITEE_TOKEN|gitee\.com/iu);
});
