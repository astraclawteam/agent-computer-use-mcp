import assert from "node:assert/strict";
import { test } from "node:test";

import { syncGiteeReleaseRef } from "../src/gitee-ref-sync.mjs";

const sourceCommit = "a".repeat(40);

test("Gitee ref sync pushes only verified main and tag refs without force or token arguments", async () => {
  const calls = [];
  const report = await syncGiteeReleaseRef({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    token: "secret-token",
    fetch: refSyncFetch({ tagStatus: 404 }),
    runGit: async (args, options) => {
      calls.push({ args, options });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.deepEqual(report, { status: "synced", tag: "v1.2.3", sourceCommit });
  assert.deepEqual(calls[0].args, [
    "push",
    "--porcelain",
    "https://gitee.com/team/project.git",
    `${sourceCommit}:refs/heads/main`,
    `${sourceCommit}:refs/tags/v1.2.3`,
  ]);
  assert.equal(calls[0].args.includes("--force"), false);
  assert.doesNotMatch(JSON.stringify(calls[0].args), /secret-token/u);
  assert.doesNotMatch(JSON.stringify(report), /secret-token|automation/u);
  assert.equal(calls[0].options.env.GIT_CONFIG_KEY_0, "credential.helper");
  assert.equal(calls[0].options.env.GIT_CONFIG_KEY_1, "http.extraHeader");
  assert.match(calls[0].options.env.GIT_CONFIG_VALUE_1, /^Authorization: Basic /u);
  assert.doesNotMatch(calls[0].options.env.GIT_CONFIG_VALUE_1, /secret-token/u);
});

test("Gitee ref sync validates credentials and sanitizes git failures", async () => {
  await assert.rejects(
    syncGiteeReleaseRef({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      token: "\uFEFFsecret",
      fetch: () => assert.fail("invalid token must fail before fetch"),
    }),
    /gitee\.config_invalid: token/u,
  );

  await assert.rejects(
    syncGiteeReleaseRef({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      token: "secret-token",
      fetch: refSyncFetch({ tagStatus: 404 }),
      runGit: async () => ({ exitCode: 1, stdout: "", stderr: "secret-token rejected" }),
    }),
    (error) => error.code === "gitee.ref_sync_failed" && !error.message.includes("secret-token"),
  );
});

test("Gitee ref sync preserves an existing annotated tag with the same source commit", async () => {
  const calls = [];
  await syncGiteeReleaseRef({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    mainCommit: "b".repeat(40),
    token: "secret-token",
    fetch: refSyncFetch({ tagStatus: 200, tagCommit: sourceCommit }),
    runGit: async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls[0], [
    "push",
    "--porcelain",
    "https://gitee.com/team/project.git",
    `${"b".repeat(40)}:refs/heads/main`,
  ]);

  await assert.rejects(
    syncGiteeReleaseRef({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      token: "secret-token",
      fetch: refSyncFetch({ tagStatus: 200, tagCommit: "c".repeat(40) }),
      runGit: () => assert.fail("conflicting tag must fail before git"),
    }),
    /gitee\.tag_commit_mismatch/u,
  );
});

function refSyncFetch({ tagStatus, tagCommit }) {
  return async (url) => {
    if (String(url).endsWith("/user")) {
      return jsonResponse(200, { login: "automation" });
    }
    if (String(url).endsWith("/commits/v1.2.3")) {
      return jsonResponse(tagStatus, tagStatus === 200 ? { sha: tagCommit } : { message: "Not Found" });
    }
    assert.fail(`unexpected request: ${url}`);
  };
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
