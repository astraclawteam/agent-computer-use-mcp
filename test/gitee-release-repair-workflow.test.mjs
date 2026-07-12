import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("Gitee repair workflow reuses an immutable published GitHub release", async () => {
  const source = await readFile(".github/workflows/gitee-release-repair.yml", "utf8");
  const workflow = parse(source);
  const input = workflow.on.workflow_dispatch.inputs.tag;
  const jobs = workflow.jobs;

  assert.equal(input.required, true);
  assert.equal(input.type, "string");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(jobs), ["repair-gitee-release"]);
  const job = jobs["repair-gitee-release"];
  assert.equal(job.environment, "gitee-release-repair");
  assert.equal(job["runs-on"], "ubuntu-latest");
  const runs = job.steps.map(({ run }) => run ?? "").join("\n");

  assert.match(runs, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/u);
  assert.match(runs, /git fetch origin main/u);
  assert.match(runs, /git rev-parse "\$\{TAG\}\^\{commit\}"/u);
  assert.match(runs, /git merge-base --is-ancestor/u);
  assert.match(runs, /gh release view[\s\S]*isDraft/u);
  assert.match(runs, /gh release download/u);
  assert.match(runs, /sync-gitee-release-ref\.mjs[\s\S]*mirror-gitee-release\.mjs/u);
  assert.match(runs, /mirror-gitee-release\.mjs/u);
  assert.match(runs, /verify-gitee-release\.mjs/u);
  assert.match(source, /vars\.GITEE_OWNER/u);
  assert.match(source, /vars\.GITEE_REPO/u);
  assert.match(source, /secrets\.GITEE_TOKEN/u);
  assert.doesNotMatch(runs, /npm\s+(?:publish|pack)|build-platform-release|gh release (?:create|edit|delete|upload)|git (?:push|tag)/iu);
});
