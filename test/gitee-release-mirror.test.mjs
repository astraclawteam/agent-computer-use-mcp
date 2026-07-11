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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("mirror plan keeps identical assets replaces mismatches uploads missing and removes obsolete", () => {
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
    remove: ["obsolete.exe"],
  });
});

test("mirror creates a missing release and never exposes its token", async () => {
  const root = await fixtureRoot();
  const local = await localAsset(root, "checksums.txt", "hashes");
  const requests = [];
  const fetch = sequenceFetch([
    response(404, { message: "Not Found" }),
    response(201, { id: 42, tag_name: "v1.2.3" }),
    response(200, []),
    response(201, { id: 7, name: "checksums.txt", size: local.sizeBytes, sha256: local.sha256 }),
  ], requests);

  const report = await mirrorGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
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
});

test("mirror verification downloads remote bytes and fails on any mismatch", async () => {
  const root = await fixtureRoot();
  const local = await localAsset(root, "checksums.txt", "expected");
  const release = { id: 42, tag_name: "v1.2.3" };
  const remote = [{ id: 7, name: local.name, size: local.sizeBytes, browser_download_url: "https://download.test/checksums" }];
  const passed = await verifyGiteeRelease({
    owner: "team",
    repo: "project",
    tag: "v1.2.3",
    expectedAssets: [local],
    token: "token",
    fetch: sequenceFetch([
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
      expectedAssets: [local],
      token: "token",
      fetch: sequenceFetch([
        response(200, release),
        response(200, remote),
        new Response("changed", { status: 200 }),
      ]),
    }),
    /gitee\.asset_identity_mismatch/,
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
    });
    const next = responses[index++];
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
}
