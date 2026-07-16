import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("release workflow is tag-only and produces verified npm tarball artifacts", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);
  const jobs = workflow.jobs;

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.deepEqual(Object.keys(jobs), [
    "validate",
    "build-npm-artifacts",
  ]);
  assert.equal(jobs.validate["runs-on"], "windows-2025");
  assert.equal(jobs["build-npm-artifacts"].needs, "validate");
  const buildRuns = stepRuns(jobs["build-npm-artifacts"]);
  assert.match(buildRuns, /build-platform-release\.mjs --allow-network/u);
  const upload = jobs["build-npm-artifacts"].steps.find(({ uses }) => uses === "actions/upload-artifact@v4");
  assert.equal(upload.with.name, "npm-release-tarballs");
  assert.match(upload.with.path, /artifacts\/platform-release\/\$\{\{ needs\.validate\.outputs\.version \}\}\/\*\.tgz/u);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.doesNotMatch(source, /npm publish|NODE_AUTH_TOKEN|NPM_(?:CORE|PLATFORM_)?TOKEN/iu);
  assert.doesNotMatch(source, /gh release|GITEE_TOKEN|mirror-gitee-release/u);
  assert.doesNotMatch(source, /azure|artifact-signing|authenticode|installer|test certificate|ASSET_SIGNING_PRIVATE_KEY/iu);
});

function stepRuns(job) {
  return job.steps.map((step) => step.run ?? "").join("\n");
}
