import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("release workflow is tag-only draft-first with two npm provenance publishes", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);
  const jobs = workflow.jobs;

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.deepEqual(Object.keys(jobs), [
    "validate",
    "build-release",
    "draft-github-release",
    "publish-platform-npm",
    "publish-core-npm",
    "post-publish-npm-smoke",
    "publish-github-release",
    "mirror-gitee-release",
    "verify-gitee-release",
  ]);
  assert.equal(jobs.validate["runs-on"], "windows-2025");
  assert.equal(jobs["build-release"].needs, "validate");
  assert.deepEqual(jobs["draft-github-release"].needs, ["validate", "build-release"]);
  assert.deepEqual(jobs["publish-platform-npm"].needs, ["validate", "draft-github-release"]);
  assert.deepEqual(jobs["publish-core-npm"].needs, ["validate", "publish-platform-npm"]);
  assert.deepEqual(jobs["post-publish-npm-smoke"].needs, ["validate", "publish-core-npm"]);
  assert.equal(jobs["publish-github-release"].needs, "post-publish-npm-smoke");
  assert.equal(jobs["mirror-gitee-release"].needs, "publish-github-release");
  assert.equal(jobs["verify-gitee-release"].needs, "mirror-gitee-release");

  const platformRuns = stepRuns(jobs["publish-platform-npm"]);
  const coreRuns = stepRuns(jobs["publish-core-npm"]);
  assert.match(platformRuns, /npm publish "\.\/release-assets\/agent-computer-use-win32-x64-/u);
  assert.match(coreRuns, /npm publish "\.\/release-assets\/agent-computer-use-mcp-/u);
  assert.match(platformRuns, /npm publish[\s\S]*agent-computer-use-win32-x64[\s\S]*--access public --provenance/u);
  assert.match(coreRuns, /npm publish[\s\S]*agent-computer-use-mcp-[\s\S]*?\.tgz[\s\S]*--access public --provenance/u);
  assert.equal(jobs["publish-platform-npm"].environment, "release");
  assert.equal(jobs["publish-core-npm"].environment, "release");
  assert.equal(jobs["mirror-gitee-release"].environment, "release");
  assert.equal(jobs["verify-gitee-release"].environment, "release");
  assert.match(source, /vars\.GITEE_OWNER/u);
  assert.match(source, /vars\.GITEE_REPO/u);
  assert.match(source, /secrets\.GITEE_TOKEN/u);
  assert.match(stepRuns(jobs["post-publish-npm-smoke"]), /post-publish-smoke\.mjs/u);
  assert.match(stepRuns(jobs["mirror-gitee-release"]), /gh release view[\s\S]*--json body/u);
  assert.match(stepRuns(jobs["verify-gitee-release"]), /gh release view[\s\S]*--json body/u);
  assert.match(source, /RELEASE_SOURCE_COMMIT:[\s\S]*github\.sha/u);
  assert.match(source, /RELEASE_NOTES_PATH:/u);
  const releaseCommands = [
    ...stepRuns(jobs["draft-github-release"]).matchAll(/^gh release .+$/gmu),
    ...stepRuns(jobs["publish-github-release"]).matchAll(/^gh release .+$/gmu),
    ...stepRuns(jobs["mirror-gitee-release"]).matchAll(/^gh release .+$/gmu),
    ...stepRuns(jobs["verify-gitee-release"]).matchAll(/^gh release .+$/gmu),
  ].map(([command]) => command);
  assert.equal(releaseCommands.length, 6);
  for (const command of releaseCommands) {
    assert.match(command, /--repo "\$\{GITHUB_REPOSITORY\}"/u);
  }
  assert.doesNotMatch(source, /azure|artifact-signing|authenticode|installer|test certificate|ASSET_SIGNING_PRIVATE_KEY/iu);
});

function stepRuns(job) {
  return job.steps.map((step) => step.run ?? "").join("\n");
}
