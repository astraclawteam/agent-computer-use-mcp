import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  materializeReleaseBundle,
  verifyReleaseBundle,
} from "../src/release-bundle.mjs";

const fixtureRoots = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release bundle materializes deterministic hashed payload files", async () => {
  const root = await fixtureRoot();
  const sourceRoot = join(root, "source");
  const bundleRoot = join(root, "bundle");
  await writeFixture(sourceRoot, "package/package.json", "{\"name\":\"agent-computer-use-mcp\"}\n");
  await writeFixture(sourceRoot, "helpers/overlay.exe", "signed-overlay-fixture");

  const result = await materializeReleaseBundle({
    packageName: "agent-computer-use-mcp",
    version: "0.0.1",
    sourceRoot,
    outputRoot: bundleRoot,
    files: ["package/package.json", "helpers/overlay.exe"],
    generatedAt: "2026-07-10T00:00:00.000Z",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.packageName, "agent-computer-use-mcp");
  assert.equal(result.version, "0.0.1");
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.files.map((file) => file.path), [
    "helpers/overlay.exe",
    "package/package.json",
  ]);
  assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(bundleRoot, "payload/helpers/overlay.exe"), "utf8"), "signed-overlay-fixture");

  const persistedManifest = JSON.parse(await readFile(join(bundleRoot, "release-manifest.json"), "utf8"));
  assert.equal(persistedManifest.schemaVersion, 1);
  assert.deepEqual(persistedManifest.files, result.files);
  assert.equal((await verifyReleaseBundle({ bundleRoot })).status, "ready");
});

test("release bundle rejects traversal absolute and duplicate paths", async () => {
  const root = await fixtureRoot();
  const sourceRoot = join(root, "source");
  await writeFixture(sourceRoot, "package/package.json", "{}\n");

  for (const files of [
    ["../secret.txt"],
    [join(root, "absolute.txt")],
    ["package/package.json", "package\\package.json"],
  ]) {
    await assert.rejects(
      () => materializeReleaseBundle({
        packageName: "agent-computer-use-mcp",
        version: "0.0.1",
        sourceRoot,
        outputRoot: join(root, `bundle-${Math.random()}`),
        files,
      }),
      /bundle\.(path_invalid|path_duplicate)/,
    );
  }
});

test("release bundle verification detects payload corruption", async () => {
  const root = await fixtureRoot();
  const sourceRoot = join(root, "source");
  const bundleRoot = join(root, "bundle");
  await writeFixture(sourceRoot, "package/version.txt", "v1");
  await materializeReleaseBundle({
    packageName: "agent-computer-use-mcp",
    version: "0.0.1",
    sourceRoot,
    outputRoot: bundleRoot,
    files: ["package/version.txt"],
  });

  await writeFile(join(bundleRoot, "payload/package/version.txt"), "tampered", "utf8");
  const verification = await verifyReleaseBundle({ bundleRoot });

  assert.equal(verification.status, "failed");
  assert.deepEqual(verification.violations.map((violation) => violation.code), [
    "bundle.size_mismatch",
    "bundle.hash_mismatch",
  ]);
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-bundle-"));
  fixtureRoots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}
