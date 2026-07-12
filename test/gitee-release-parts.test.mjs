import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  GITEE_PART_SIZE_BYTES,
  prepareGiteeReleaseAssets,
} from "../src/gitee-release-parts.mjs";

const roots = [];
const sourceCommit = "a".repeat(40);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Gitee transport keeps boundary assets exact and deterministically splits larger assets", async () => {
  assert.equal(GITEE_PART_SIZE_BYTES, 94_371_840);
  const root = await fixtureRoot();
  const sourceRoot = join(root, "source");
  const recoveryScriptPath = join(root, "restore.ps1");
  await writeFile(recoveryScriptPath, "# fixture recovery\n");
  const exact = await localAsset(sourceRoot, "checksums.txt", "1234");
  const chunked = await localAsset(sourceRoot, "offline.zip", "ABCDEFGHI");

  const first = await prepareGiteeReleaseAssets({
    assets: [chunked, exact],
    outputRoot: join(root, "first"),
    tag: "v1.2.3",
    sourceCommit,
    chunkSize: 4,
    recoveryScriptPath,
  });
  const second = await prepareGiteeReleaseAssets({
    assets: [exact, chunked],
    outputRoot: join(root, "second"),
    tag: "v1.2.3",
    sourceCommit,
    chunkSize: 4,
    recoveryScriptPath,
  });

  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.manifest.originals, [
    {
      name: "checksums.txt",
      sizeBytes: 4,
      sha256: sha("1234"),
      representation: "exact",
      attachments: [{ name: "checksums.txt", sizeBytes: 4, sha256: sha("1234") }],
    },
    {
      name: "offline.zip",
      sizeBytes: 9,
      sha256: sha("ABCDEFGHI"),
      representation: "chunked",
      attachments: [
        { name: "offline.zip.part001", sizeBytes: 4, sha256: sha("ABCD") },
        { name: "offline.zip.part002", sizeBytes: 4, sha256: sha("EFGH") },
        { name: "offline.zip.part003", sizeBytes: 1, sha256: sha("I") },
      ],
    },
  ]);
  assert.deepEqual(first.assets.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })), [
    { name: "checksums.txt", sizeBytes: 4, sha256: sha("1234") },
    { name: "offline.zip.part001", sizeBytes: 4, sha256: sha("ABCD") },
    { name: "offline.zip.part002", sizeBytes: 4, sha256: sha("EFGH") },
    { name: "offline.zip.part003", sizeBytes: 1, sha256: sha("I") },
    manifestAsset(first),
    recoveryAsset(first),
  ]);
  assert.equal(await readFile(first.assets[1].path, "utf8"), "ABCD");
  assert.equal(await readFile(first.assets[3].path, "utf8"), "I");
});

test("Gitee transport manifest contains identities but no token or local path", async () => {
  const root = await fixtureRoot();
  const recoveryScriptPath = join(root, "restore.ps1");
  await writeFile(recoveryScriptPath, "# safe\n");
  const prepared = await prepareGiteeReleaseAssets({
    assets: [await localAsset(root, "payload.zip", "payload")],
    outputRoot: join(root, "delivery"),
    tag: "v0.0.1",
    sourceCommit,
    chunkSize: 4,
    recoveryScriptPath,
  });
  const serialized = JSON.stringify(prepared.manifest);

  assert.equal(prepared.manifest.schemaVersion, 1);
  assert.equal(prepared.manifest.partSizeBytes, 4);
  assert.equal(prepared.manifest.tag, "v0.0.1");
  assert.equal(prepared.manifest.sourceCommit, sourceCommit);
  assert.doesNotMatch(serialized, /secret|token|[A-Z]:\\|\\source|\/tmp\//iu);
  assert.equal(prepared.assets.every(({ name, sizeBytes }) => basename(name) === name && sizeBytes <= 4 || name === "gitee-mirror-manifest.json" || name === "restore-gitee-release.ps1"), true);
});

test("Gitee transport rejects corrupt local identity before creating parts", async () => {
  const root = await fixtureRoot();
  const recoveryScriptPath = join(root, "restore.ps1");
  await writeFile(recoveryScriptPath, "# safe\n");
  const asset = await localAsset(root, "payload.zip", "payload");
  asset.sha256 = "b".repeat(64);

  await assert.rejects(
    prepareGiteeReleaseAssets({
      assets: [asset],
      outputRoot: join(root, "delivery"),
      tag: "v0.0.1",
      sourceCommit,
      chunkSize: 4,
      recoveryScriptPath,
    }),
    /gitee\.local_asset_identity_mismatch/u,
  );
});

test("Gitee transport hashes local release files through bounded streams", async () => {
  const source = await readFile("src/gitee-release-parts.mjs", "utf8");

  assert.match(source, /createReadStream/u);
  assert.match(source, /for await \(const chunk of stream\)/u);
});

function manifestAsset(prepared) {
  const asset = prepared.assets.find(({ name }) => name === "gitee-mirror-manifest.json");
  return { name: asset.name, sizeBytes: asset.sizeBytes, sha256: asset.sha256 };
}

function recoveryAsset(prepared) {
  const asset = prepared.assets.find(({ name }) => name === "restore-gitee-release.ps1");
  return { name: asset.name, sizeBytes: asset.sizeBytes, sha256: asset.sha256 };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "gitee-parts-"));
  roots.push(root);
  return root;
}

async function localAsset(root, name, contents) {
  const path = join(root, name);
  await mkdir(root, { recursive: true });
  await writeFile(path, contents);
  return { name, path, sizeBytes: Buffer.byteLength(contents), sha256: sha(contents) };
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
