import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { ensureWindowsInstallerBuilt, runWindowsInstaller } from "../src/windows-installer-host.mjs";
import { createOfflineDriverFixture } from "./helpers/asset-archive.mjs";
import { createSignedAssetFixture, driverAsset, hash } from "./helpers/asset-fixture.mjs";

const fixtureRoots = [];
const servers = [];
const testEnv = { AGENT_COMPUTER_USE_TEST_ALLOW_PRIVATE_NETWORK: "1" };

before(async () => {
  await ensureWindowsInstallerBuilt();
});

after(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("asset download resumes an interrupted transfer with Range and ETag", async () => {
  const harness = await createHarness();
  const source = createRawNetworkSource(randomBytes(1024 * 1024));
  const server = await createAssetServer(source.zipBytes, {
    interruptFirst: true,
    etag: '"fixture-v1"',
    slowBody: true,
  });
  const fixture = await networkFixture(harness.root, source, server.url, "resume-manifest");

  const first = await harness.prepare(fixture, { expectedExitCode: 2, allowNetwork: true });
  assert.equal(first.error.code, "asset.download_interrupted");
  const second = await harness.prepare(fixture, { allowNetwork: true });

  assert.equal(second.status, "prepared");
  assert.equal(second.resumeUsed, true);
  assert.equal(server.requests.some((request) => request.range?.startsWith("bytes=")), true);
  assert.equal(server.requests.some((request) => request.ifRange === '"fixture-v1"'), true);
});

test("asset acquisition never touches network without explicit approval", async () => {
  const harness = await createHarness();
  const source = await createOfflineDriverFixture({ root: harness.root, fixtureId: "network-disabled-source" });
  const server = await createAssetServer(source.zipBytes, { etag: '"fixture-v1"' });
  const fixture = await networkFixture(harness.root, source, server.url, "network-disabled-manifest");

  const result = await harness.prepare(fixture, { expectedExitCode: 2, allowNetwork: false });

  assert.equal(result.error.code, "asset.offline_blob_missing");
  assert.equal(server.requests.length, 0);
});

test("changed ETag restarts from zero when the server rejects a range", async () => {
  const harness = await createHarness();
  const source = await createOfflineDriverFixture({ root: harness.root, fixtureId: "etag-source" });
  const server = await createAssetServer(source.zipBytes, {
    interruptFirst: true,
    etag: '"fixture-v1"',
    changedEtag: '"fixture-v2"',
  });
  const fixture = await networkFixture(harness.root, source, server.url, "etag-manifest");
  assert.equal((await harness.prepare(fixture, { expectedExitCode: 2, allowNetwork: true })).error.code, "asset.download_interrupted");

  const result = await harness.prepare(fixture, { allowNetwork: true });

  assert.equal(result.status, "prepared");
  assert.equal(server.requests.some((request) => request.range), true);
  assert.equal(server.responses.includes(200), true);
});

test("wrong network payload hash never enters the content-addressed cache", async () => {
  const harness = await createHarness();
  const source = await createOfflineDriverFixture({ root: harness.root, fixtureId: "wrong-hash-source" });
  const corrupt = Buffer.from(source.zipBytes);
  corrupt[corrupt.length - 1] ^= 0xff;
  const server = await createAssetServer(corrupt, { etag: '"corrupt"' });
  const fixture = await networkFixture(harness.root, source, server.url, "wrong-hash-manifest");

  const result = await harness.prepare(fixture, { expectedExitCode: 2, allowNetwork: true });

  assert.equal(result.error.code, "asset.download_hash_mismatch");
  const cacheRoot = join(harness.programRoot, "cache", "assets", "sha256");
  assert.deepEqual(await readdir(cacheRoot).catch(() => []), []);
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-asset-download-"));
  fixtureRoots.push(root);
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  const emptyOfflineRoot = join(root, "empty-offline");
  await mkdir(emptyOfflineRoot, { recursive: true });
  return {
    root,
    programRoot,
    async prepare(fixture, options = {}) {
      const result = await runWindowsInstaller("asset-prepare", {
        programRoot,
        dataRoot,
        manifestPath: fixture.manifestPath,
        signaturePath: fixture.signaturePath,
        keyringPath: fixture.keyringPath,
        offlineRoot: emptyOfflineRoot,
        assetIds: [fixture.asset.id],
        operationId: `download-${fixture.manifest.releaseId}`,
        allowNetwork: options.allowNetwork,
        env: testEnv,
      });
      assert.equal(result.exitCode, options.expectedExitCode ?? 0, result.stderr || result.stdout);
      return result.report;
    },
  };
}

function createRawNetworkSource(bytes) {
  const sha256 = hash(bytes);
  return {
    zipBytes: bytes,
    asset: driverAsset({
      source: {
        ...driverAsset().source,
        fileName: "cua-driver.bin",
        sizeBytes: bytes.length,
        sha256,
      },
      content: {
        format: "raw",
        files: [
          {
            path: "cua-driver.bin",
            installPath: "bin/cua-driver.exe",
            sizeBytes: bytes.length,
            sha256,
            executable: true,
          },
        ],
      },
      provenance: {
        ...driverAsset().provenance,
        assetName: "cua-driver.bin",
        upstreamSha256: sha256,
      },
    }),
  };
}

async function networkFixture(root, source, url, fixtureId) {
  const asset = {
    ...source.asset,
    source: {
      ...source.asset.source,
      urls: [url],
    },
  };
  const signed = await createSignedAssetFixture({
    root,
    fixtureId,
    releaseId: fixtureId,
    assets: [asset],
    developmentOnly: true,
  });
  return { ...signed, asset };
}

async function createAssetServer(blob, options = {}) {
  const requests = [];
  const responses = [];
  let interrupted = false;
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    const ifRange = request.headers["if-range"] ?? null;
    requests.push({ range, ifRange });
    const currentEtag = interrupted && options.changedEtag ? options.changedEtag : options.etag;
    if (options.interruptFirst && !interrupted && !range) {
      interrupted = true;
      const partial = blob.subarray(0, Math.max(1, Math.floor(blob.length / 3)));
      responses.push(200);
      response.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": partial.length,
        ETag: options.etag,
      });
      response.end(partial);
      return;
    }

    const match = /^bytes=(\d+)-$/.exec(range ?? "");
    const canResume = match && (!options.changedEtag || ifRange === currentEtag);
    const start = canResume ? Number(match[1]) : 0;
    const status = canResume ? 206 : 200;
    const body = blob.subarray(start);
    responses.push(status);
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Length": body.length,
      ETag: currentEtag,
    };
    if (canResume) headers["Content-Range"] = `bytes ${start}-${blob.length - 1}/${blob.length}`;
    response.writeHead(status, headers);
    if (options.slowBody) {
      let offset = 0;
      const writeNext = () => {
        if (offset >= body.length) {
          response.end();
          return;
        }
        const end = Math.min(offset + 64 * 1024, body.length);
        response.write(body.subarray(offset, end));
        offset = end;
        setTimeout(writeNext, 10);
      };
      writeNext();
    } else {
      response.end(body);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const wrapper = {
    url: `http://127.0.0.1:${address.port}/asset.zip`,
    requests,
    responses,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
  servers.push(wrapper);
  return wrapper;
}
