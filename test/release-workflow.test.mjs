import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("tag workflow registers and publicly verifies Hub before publishing the GitHub Release", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);
  const buildJob = workflow.jobs["windows-artifact"];
  const hubJob = workflow.jobs["hub-register"];
  const releaseJob = workflow.jobs["github-release"];
  const buildRuns = buildJob.steps.map((step) => step.run ?? "").join("\n");
  const hubRuns = hubJob.steps.map((step) => step.run ?? "").join("\n");
  const releaseRuns = releaseJob.steps.map((step) => step.run ?? "").join("\n");
  const buildActions = buildJob.steps.map((step) => step.uses ?? "").filter(Boolean);
  const hubActions = hubJob.steps.map((step) => step.uses ?? "").filter(Boolean);
  const releaseActions = releaseJob.steps.map((step) => step.uses ?? "").filter(Boolean);

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(buildJob["runs-on"], "windows-latest");
  assert.equal(buildActions.includes("actions/checkout@v6"), true);
  assert.equal(buildActions.includes("actions/setup-node@v6"), true);
  assert.equal(buildActions.includes("actions/setup-dotnet@v5"), true);
  assert.equal(buildActions.includes("actions/upload-artifact@v4"), true);
  assert.match(buildRuns, /release\.tag_version_mismatch/u);
  assert.match(buildRuns, /release\.commit_not_on_main/u);
  assert.match(buildRuns, /release\.changelog_missing/u);
  assert.match(buildRuns, /npm test/u);
  assert.doesNotMatch(buildRuns, /verify:phase-6:release-evidence/u);
  assert.match(buildRuns, /phase:1\.6/u);
  assert.match(buildRuns, /phase:1\.7/u);
  assert.match(buildRuns, /phase:1\.8/u);
  assert.match(buildRuns, /artifact:windows:build -- --allow-network --source-commit/u);
  assert.match(buildRuns, /SHA256SUMS\.txt/u);
  assert.doesNotMatch(buildRuns, /gh release create/u);

  assert.equal(hubJob.needs, "windows-artifact");
  assert.equal(hubJob["runs-on"], "ubuntu-latest");
  assert.equal(hubActions.includes("actions/download-artifact@v4"), true);
  assert.equal(workflow.env.HUB_PUBLISHER_REPOSITORY, "https://gitee.com/huizhou-shunshi-intelligent/qlogicagent-hub.git");
  assert.match(workflow.env.HUB_PUBLISHER_COMMIT, /^[0-9a-f]{40}$/u);
  assert.match(hubRuns, /release-official-mcp-artifact-remote\.mjs/u);
  assert.match(hubRuns, /verify-hub-public-release\.mjs/u);
  assert.match(hubRuns, /HUB_RELEASE_SSH_PRIVATE_KEY is required/u);
  assert.match(hubRuns, /HUB_RELEASE_KNOWN_HOSTS is required/u);

  assert.deepEqual(releaseJob.needs, ["windows-artifact", "hub-register"]);
  assert.equal(releaseJob.permissions.contents, "write");
  assert.equal(releaseActions.includes("actions/download-artifact@v4"), true);
  assert.match(releaseRuns, /gh release create/u);
  assert.match(releaseRuns, /--verify-tag/u);
  assert.match(releaseRuns, /--latest/u);
  assert.doesNotMatch(source, /npm publish|NODE_AUTH_TOKEN|GITEE_TOKEN|git push/u);
});
