import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { acquireReleaseAssets } from "../src/release-asset-acquirer.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release assets enter content-addressed cache only after exact verification", async () => {
  const cacheRoot = await fixtureRoot();
  const bytes = Buffer.from("locked-release-asset", "utf8");
  const lock = releaseLock([asset("node-runtime-windows-x64", bytes)]);
  const progress = [];
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return response(bytes, "https://cdn.example.test/node.zip");
  };

  const first = await acquireReleaseAssets({
    lock,
    cacheRoot,
    allowNetwork: true,
    fetchImpl,
    onProgress: (event) => progress.push(event),
  });
  const hash = sha256(bytes);
  const expectedPath = join(cacheRoot, "sha256", hash.slice(0, 2), hash, "blob");

  assert.equal(first.length, 1);
  assert.equal(first[0].path, expectedPath);
  assert.equal(first[0].cacheHit, false);
  assert.equal(await readFile(expectedPath, "utf8"), bytes.toString("utf8"));

  const second = await acquireReleaseAssets({ lock, cacheRoot, allowNetwork: false, fetchImpl });
  assert.equal(second[0].cacheHit, true);
  assert.equal(fetchCount, 1);
  assert.ok(progress.length >= 2);
  assert.equal(progress.some((event) => JSON.stringify(event).includes(cacheRoot)), false);
  assert.equal(progress.some((event) => JSON.stringify(event).includes("https://")), false);
});

test("release acquisition rejects corrupt network bytes and removes partial files", async () => {
  const cacheRoot = await fixtureRoot();
  const expected = Buffer.from("expected", "utf8");
  const lock = releaseLock([asset("driver", expected)]);

  await assert.rejects(
    () => acquireReleaseAssets({
      lock,
      cacheRoot,
      allowNetwork: true,
      fetchImpl: async () => response(Buffer.from("wrong---", "utf8"), "https://cdn.example.test/driver.zip"),
    }),
    (error) => error?.code === "release.asset_hash_mismatch",
  );

  assert.deepEqual((await listFiles(cacheRoot)).filter((path) => path.includes(".part")), []);
  assert.deepEqual((await listFiles(cacheRoot)).filter((path) => path.endsWith("/blob")), []);
});

test("release acquisition deletes a corrupt cache hit and stays offline when denied", async () => {
  const cacheRoot = await fixtureRoot();
  const bytes = Buffer.from("expected-cache-value", "utf8");
  const locked = asset("ocr-model", bytes);
  const blobPath = join(cacheRoot, "sha256", locked.source.sha256.slice(0, 2), locked.source.sha256, "blob");
  await mkdir(dirname(blobPath), { recursive: true });
  await writeFile(blobPath, "tampered", "utf8");
  let fetchCount = 0;

  await assert.rejects(
    () => acquireReleaseAssets({
      lock: releaseLock([locked]),
      cacheRoot,
      allowNetwork: false,
      fetchImpl: async () => { fetchCount += 1; return response(bytes, "https://cdn.example.test/model.onnx"); },
    }),
    (error) => error?.code === "release.asset_offline_missing",
  );

  assert.equal(fetchCount, 0);
  assert.equal((await listFiles(cacheRoot)).includes(relativeFile(cacheRoot, blobPath)), false);
});

test("release acquisition rejects a redirect that leaves HTTPS", async () => {
  const cacheRoot = await fixtureRoot();
  const bytes = Buffer.from("asset", "utf8");

  await assert.rejects(
    () => acquireReleaseAssets({
      lock: releaseLock([asset("redirected", bytes)]),
      cacheRoot,
      allowNetwork: true,
      fetchImpl: async () => response(bytes, "http://mirror.example.test/asset.zip"),
    }),
    (error) => error?.code === "release.asset_redirect_forbidden",
  );
});

test("release acquisition reports transport failures without leaving partial files", async () => {
  const cacheRoot = await fixtureRoot();
  const bytes = Buffer.from("asset", "utf8");

  await assert.rejects(
    () => acquireReleaseAssets({
      lock: releaseLock([asset("unreachable", bytes)]),
      cacheRoot,
      allowNetwork: true,
      fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }); },
    }),
    (error) => error?.code === "release.asset_download_failed"
      && error?.transportCode === "UND_ERR_CONNECT_TIMEOUT",
  );
  assert.deepEqual((await listFiles(cacheRoot)).filter((path) => path.includes(".part")), []);
});

function releaseLock(assets) {
  return { schemaVersion: 1, packageName: "agent-computer-use-mcp", platform: "windows-x64", assets };
}

function asset(id, bytes) {
  return {
    id,
    version: "1.0.0",
    source: {
      url: `https://cdn.example.test/${id}.zip`,
      fileName: `${id}.zip`,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    },
  };
}

function response(bytes, url) {
  const value = new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
  Object.defineProperty(value, "url", { value: url });
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-release-acquisition-"));
  roots.push(root);
  return root;
}

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relativeFile(root, path));
    }
  }
  return files.sort();
}

function relativeFile(root, path) {
  return path.slice(root.length + 1).replaceAll("\\", "/");
}
