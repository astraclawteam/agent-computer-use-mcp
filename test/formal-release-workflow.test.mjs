import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("formal release workflow is tag-only draft-first and fails closed around signing", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.equal(workflow.on.workflow_dispatch, undefined);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions["id-token"], "none");
  for (const name of [
    "validate",
    "build-windows",
    "sign-windows",
    "assemble",
    "draft-github-release",
    "publish-npm",
    "post-publish-smoke",
    "publish-github-release",
  ]) {
    assert.ok(workflow.jobs[name], name);
  }

  const signing = JSON.stringify(workflow.jobs["sign-windows"]);
  assert.match(signing, /windows-2025/);
  assert.match(signing, /azure\/login@v3/);
  assert.match(signing, /azure\/artifact-signing-action@v2/);
  assert.match(signing, /timestamp-rfc3161/);
  assert.match(signing, /verify-authenticode\.ps1/);
  assert.doesNotMatch(signing, /continue-on-error/);

  const draft = JSON.stringify(workflow.jobs["draft-github-release"]);
  const npm = JSON.stringify(workflow.jobs["publish-npm"]);
  const smoke = JSON.stringify(workflow.jobs["post-publish-smoke"]);
  const publish = JSON.stringify(workflow.jobs["publish-github-release"]);
  assert.match(draft, /gh release create[\s\S]*--draft[\s\S]*--verify-tag/);
  assert.match(npm, /id-token["']?:["']?write|id-token\\u0022:\\u0022write/);
  assert.match(npm, /npm publish[\s\S]*--access public[\s\S]*--provenance/);
  assert.doesNotMatch(npm, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.match(smoke, /post-publish-smoke\.mjs/);
  assert.match(publish, /needs[\s\S]*post-publish-smoke/);
  assert.match(publish, /gh release edit[\s\S]*--draft=false/);
  assert.doesNotMatch(source, /artifacts\/(?:windows|formal)-release\/0\.0\.1/u);
  assert.match(source, /needs\.validate\.outputs\.version/u);
});

test("formal release scripts are exposed without making the source workspace publishable", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.scripts["release:formal:validate"], "node scripts/validate-formal-release.mjs");
  assert.equal(packageJson.scripts["release:formal:assemble"], "node scripts/assemble-formal-release.mjs");
  assert.equal(packageJson.scripts["release:formal:smoke"], "node scripts/post-publish-smoke.mjs");
});
