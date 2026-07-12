import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  mirrorGiteeRelease,
  planGiteeMirror,
  verifyGiteeRelease,
} from "../src/gitee-release-mirror.mjs";

const roots = [];
const sourceCommit = "a".repeat(40);
const releaseNotes = "# Release v1.2.3\n\nAuthoritative GitHub notes.";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("mirror plan keeps identical assets replaces mismatches uploads missing and ignores unrelated attachments", () => {
  const githubAssets = [
    asset("checksums.txt", 10, "a"),
    asset("agent-computer-use-mcp-1.2.3-windows-x64.zip", 20, "b"),
    asset("SBOM.cdx.json", 30, "c"),
  ];
  const giteeAssets = [
    { id: 1, ...asset("checksums.txt", 10, "a") },
    { id: 2, ...asset("agent-computer-use-mcp-1.2.3-windows-x64.zip", 19, "d") },
    { id: 3, ...asset("obsolete.exe", 5, "e") },
  ];

  assert.deepEqual(planGiteeMirror({ githubAssets, giteeAssets }), {
    keep: ["checksums.txt"],
    replace: ["agent-computer-use-mcp-1.2.3-windows-x64.zip"],
    upload: ["SBOM.cdx.json"],
    remove: [],
  });
});

test("mirror creates a missing release and never exposes its token", async () => {
  const root = await fixtureRoot();
  const local = await localAsset(root, "checksums.txt", "hashes");
  const requests = [];
  const fetch = sequenceFetch([
    response(200, { sha: sourceCommit }),
    response(404, { message: "Not Found" }),
    response(201, { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: releaseNotes }),
    response(200, []),
    response(201, { id: 7, name: "checksums.txt", size: local.sizeBytes, sha256: local.sha256 }),
  ], requests);

  const report = await mirrorGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    releaseNotes,
    assets: [local],
    token: "secret-token",
    fetch,
  });

  assert.equal(report.status, "mirrored");
  assert.equal(report.releaseId, 42);
  assert.deepEqual(report.plan.upload, ["checksums.txt"]);
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
  assert.equal(requests.some(({ authorization }) => authorization === "token secret-token"), true);
  assert.equal(requests.every(({ url }) => !url.includes("secret-token")), true);
  const create = requests.find(({ method, url }) => method === "POST" && url.endsWith("/releases"));
  assert.deepEqual(create.json, {
    tag_name: "v1.2.3",
    target_commitish: sourceCommit,
    name: "v1.2.3",
    body: releaseNotes,
    prerelease: false,
  });
});

test("mirror updates release notes without deleting unrelated attachments", async () => {
  const root = await fixtureRoot();
  const local = await localAsset(root, "checksums.txt", "expected");
  const requests = [];
  const fetch = sequenceFetch([
    response(200, { sha: sourceCommit }),
    response(200, { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: "stale" }),
    response(200, { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: releaseNotes }),
    response(200, [
      { id: 7, name: local.name, size: local.sizeBytes, sha256: local.sha256 },
      { id: 8, name: "operator-evidence.txt", size: 5, sha256: "b".repeat(64) },
    ]),
  ], requests);

  const report = await mirrorGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    releaseNotes,
    assets: [local],
    token: "token",
    fetch,
  });

  assert.deepEqual(report.plan, { keep: [local.name], replace: [], upload: [], remove: [] });
  assert.equal(requests.some(({ method }) => method === "PATCH"), true);
  assert.equal(requests.some(({ method }) => method === "DELETE"), false);
});

test("mirror rejects a Gitee tag that resolves to a different commit", async () => {
  await assert.rejects(
    mirrorGiteeRelease({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      releaseNotes,
      assets: [],
      token: "token",
      fetch: sequenceFetch([response(200, { sha: "b".repeat(40) })]),
    }),
    /gitee\.tag_commit_mismatch/u,
  );
});

test("mirror rejects a non-ASCII or whitespace token before creating HTTP headers", async () => {
  for (const token of ["\uFEFFsecret", " secret", "secret\n"]) {
    await assert.rejects(
      mirrorGiteeRelease({
        owner: "team",
        repo: "project",
        tag: "v1.2.3",
        sourceCommit,
        releaseNotes,
        assets: [],
        token,
        fetch: () => assert.fail("invalid token must fail before fetch"),
      }),
      /gitee\.config_invalid: token/u,
    );
  }
});

test("mirror verification rejects release notes that differ from GitHub", async () => {
  await assert.rejects(
    verifyGiteeRelease({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      releaseNotes,
      expectedAssets: [],
      token: "token",
      fetch: sequenceFetch([
        response(200, { sha: sourceCommit }),
        response(200, { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: "different" }),
      ]),
    }),
    /gitee\.release_metadata_mismatch/u,
  );
});

test("mirror verification downloads remote bytes and fails on any mismatch", async () => {
  const root = await fixtureRoot();
  const local = await localAsset(root, "checksums.txt", "expected");
  const release = { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: releaseNotes };
  const remote = [
    { id: 7, name: local.name, size: local.sizeBytes, browser_download_url: "https://download.test/checksums" },
    { id: 8, name: "operator-evidence.txt", size: 5, sha256: "b".repeat(64) },
  ];
  const passed = await verifyGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    releaseNotes,
    expectedAssets: [local],
    token: "token",
    fetch: sequenceFetch([
      response(200, { sha: sourceCommit }),
      response(200, release),
      response(200, remote),
      new Response("expected", { status: 200 }),
    ]),
  });
  assert.equal(passed.status, "passed");

  await assert.rejects(
    verifyGiteeRelease({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      releaseNotes,
      expectedAssets: [local],
      token: "token",
      fetch: sequenceFetch([
        response(200, { sha: sourceCommit }),
        response(200, release),
        response(200, remote),
        new Response("changed", { status: 200 }),
      ]),
    }),
    /gitee\.asset_identity_mismatch/,
  );
});

test("mirror verification hashes remote attachments sequentially with bounded memory", async () => {
  const root = await fixtureRoot();
  const first = await localAsset(root, "first.part001", "first");
  const second = await localAsset(root, "second.part001", "second");
  const release = { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: releaseNotes };
  let activeDownloads = 0;
  let maximumDownloads = 0;
  const fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/commits/v1.2.3")) return response(200, { sha: sourceCommit });
    if (value.endsWith("/releases/tags/v1.2.3")) return response(200, release);
    if (value.includes("/attach_files?")) {
      return response(200, [
        { id: 1, name: first.name, size: first.sizeBytes, browser_download_url: "https://download.test/first" },
        { id: 2, name: second.name, size: second.sizeBytes, browser_download_url: "https://download.test/second" },
      ]);
    }
    if (value.startsWith("https://download.test/")) {
      activeDownloads += 1;
      maximumDownloads = Math.max(maximumDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeDownloads -= 1;
      return new Response(value.endsWith("first") ? "first" : "second", { status: 200 });
    }
    assert.fail(`unexpected request: ${value}`);
  };

  const report = await verifyGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    sourceCommit,
    releaseNotes,
    expectedAssets: [first, second],
    originals: [{ name: "archive.zip", sizeBytes: 11, sha256: "c".repeat(64), representation: "chunked" }],
    token: "token",
    fetch,
  });

  assert.equal(maximumDownloads, 1);
  assert.deepEqual(report.originals, [
    { name: "archive.zip", sizeBytes: 11, sha256: "c".repeat(64), representation: "chunked" },
  ]);
});

test("mirror verification downloads bytes instead of trusting an API-reported hash", async () => {
  const root = await fixtureRoot();
  const expected = await localAsset(root, "checksums.txt", "expected");
  const release = { id: 42, tag_name: "v1.2.3", name: "v1.2.3", body: releaseNotes };

  await assert.rejects(
    verifyGiteeRelease({
      owner: "team",
      repo: "project",
      tag: "v1.2.3",
      sourceCommit,
      releaseNotes,
      expectedAssets: [expected],
      token: "token",
      fetch: sequenceFetch([
        response(200, { sha: sourceCommit }),
        response(200, release),
        response(200, [{
          id: 7,
          name: expected.name,
          size: expected.sizeBytes,
          sha256: expected.sha256,
          browser_download_url: "https://download.test/checksums",
        }]),
        new Response("changed", { status: 200 }),
      ]),
    }),
    /gitee\.asset_identity_mismatch/u,
  );
});

function asset(name, sizeBytes, sha256) {
  return { name, sizeBytes, sha256: sha256.repeat(64).slice(0, 64) };
}

async function localAsset(root, name, contents) {
  const path = join(root, name);
  await writeFile(path, contents);
  const bytes = Buffer.from(contents);
  return {
    name,
    path,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-gitee-mirror-"));
  roots.push(root);
  return root;
}

function response(status, json) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequenceFetch(responses, requests = []) {
  let index = 0;
  return async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method ?? "GET",
      authorization: new Headers(options.headers).get("authorization"),
      json: typeof options.body === "string" ? JSON.parse(options.body) : null,
    });
    const next = responses[index++];
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
}
