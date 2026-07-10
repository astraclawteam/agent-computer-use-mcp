import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  verifyReleaseOutputs,
  writeReleaseOutputManifest,
} from "../src/release-output-manifest.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release output manifest records exact sorted artifact hashes and checksums", async () => {
  const root = await fixtureRoot();
  const artifacts = [
    await artifact(root, "offline", "agent-0.0.1-offline.zip", "offline-bytes", "application/zip"),
    await artifact(root, "installer", "agent-0.0.1-installer.exe", "installer-bytes", "application/vnd.microsoft.portable-executable"),
    await artifact(root, "sbom", "agent-0.0.1-sbom.cdx.json", "{}\n", "application/vnd.cyclonedx+json"),
  ];
  const report = await writeReleaseOutputManifest({
    identity: {
      packageName: "agent-computer-use-mcp",
      version: "0.0.1",
      tag: "v0.0.1",
      commit: "a".repeat(40),
      channel: "preview",
      platform: "windows-x64",
    },
    artifacts,
    outputRoot: root,
    generatedAt: "2026-07-10T00:00:00.000Z",
  });

  assert.equal(report.status, "passed");
  const manifest = JSON.parse(await readFile(report.manifestPath, "utf8"));
  assert.deepEqual(
    manifest.artifacts.map((item) => item.fileName),
    ["agent-0.0.1-installer.exe", "agent-0.0.1-offline.zip", "agent-0.0.1-sbom.cdx.json"],
  );
  for (const item of manifest.artifacts) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.ok(item.sizeBytes > 0);
    assert.equal(item.distributionStatus, "blocked_unsigned");
  }
  const checksums = await readFile(report.checksumsPath, "utf8");
  assert.equal(checksums.includes("\r"), false);
  assert.match(checksums, /^[a-f0-9]{64}  agent-0\.0\.1-installer\.exe/m);
  assert.match(checksums, /^[a-f0-9]{64}  agent-computer-use-mcp-0\.0\.1-release-manifest\.json/m);
  assert.equal((await verifyReleaseOutputs({ manifestPath: report.manifestPath, checksumsPath: report.checksumsPath, artifactRoot: root })).status, "passed");
});

test("release output verification detects artifact tampering", async () => {
  const root = await fixtureRoot();
  const offline = await artifact(root, "offline", "offline.zip", "offline-bytes", "application/zip");
  const report = await writeReleaseOutputManifest({
    identity: { packageName: "agent-computer-use-mcp", version: "0.0.1", tag: "v0.0.1", commit: "b".repeat(40), channel: "preview", platform: "windows-x64" },
    artifacts: [offline],
    outputRoot: root,
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  await writeFile(offline.path, "tampered", "utf8");

  const verification = await verifyReleaseOutputs({
    manifestPath: report.manifestPath,
    checksumsPath: report.checksumsPath,
    artifactRoot: root,
  });
  assert.equal(verification.status, "failed");
  assert.ok(verification.violations.some((violation) => violation.code === "release.output_hash_mismatch"));
});

async function artifact(root, id, fileName, contents, mediaType) {
  const path = join(root, fileName);
  await mkdir(root, { recursive: true });
  await writeFile(path, contents, "utf8");
  return { id, path, fileName, mediaType, distributionStatus: "blocked_unsigned" };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-release-output-"));
  roots.push(root);
  return root;
}
