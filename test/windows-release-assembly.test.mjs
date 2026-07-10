import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  assembleWindowsReleaseCandidate,
  promoteReleaseCandidate,
  verifyWindowsReleaseCandidate,
} from "../src/windows-release-assembly.mjs";
import { WINDOWS_X64_OFFLINE_MAX_BYTES } from "../src/release-size-policy.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "../src/release-target.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows release assembly executes verified stages and atomically promotes outputs", async () => {
  const fixture = await createFixture();
  const calls = [];
  const report = await assembleWindowsReleaseCandidate({
    outputRoot: fixture.outputRoot,
    cacheRoot: join(fixture.root, "cache"),
    allowNetwork: false,
    generatedAt: "2026-07-10T00:00:00.000Z",
    lock: fixture.lock,
    identity: fixture.identity,
    dependencies: fixture.dependencies(calls),
  });

  assert.deepEqual(calls, ["acquire", "payload", "sbom", "prepare-assets", "offline-bundle", "npm-pack"]);
  assert.equal(report.status, "passed");
  assert.equal(report.platform, "windows-x64");
  assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
  assert.equal(report.installable, true);
  assert.equal(report.distributionStatus, "blocked_unsigned");
  assert.equal(report.assetCount, 6);
  assert.equal(report.blobCount, 6);
  assert.deepEqual(report.runtimeSelection.retainedNativeFiles, [
    "DirectML.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "onnxruntime_binding.node",
    "onnxruntime.dll",
  ]);
  assert.equal(report.offlineBundleSizeBytes, 11);
  assert.equal(report.offlineBundleMaxBytes, WINDOWS_X64_OFFLINE_MAX_BYTES);
  assert.equal(report.firstEnableDownloadCount, 0);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
  assert.equal((await stat(report.manifestPath)).isFile(), true);
  const manifest = JSON.parse(await readFile(report.manifestPath, "utf8"));
  assert.deepEqual(manifest.evidence.target, WINDOWS_X64_RELEASE_TARGET);
  assert.equal(manifest.evidence.offlineBundleSizeBytes, 11);
  assert.equal(manifest.evidence.offlineBundleMaxBytes, WINDOWS_X64_OFFLINE_MAX_BYTES);
  assert.equal(manifest.evidence.assetCount, 6);
  assert.equal(manifest.evidence.blobCount, 6);
  assert.equal(manifest.evidence.runtimeSelection.packageVersion, "1.27.0");
  assert.equal((await stat(report.checksumsPath)).isFile(), true);
  assert.equal((await readFile(report.checksumsPath, "utf8")).includes("\r"), false);
  assert.deepEqual(await stagingEntries(fixture.outputRoot), []);
});

test("Windows release assembly rejects an oversized offline bundle before promotion", async () => {
  const fixture = await createFixture();
  const calls = [];

  await assert.rejects(
    () => assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies: fixture.dependencies(calls, {
        offlineSizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES + 1,
      }),
    }),
    (error) => error?.code === "release.offline_bundle_too_large",
  );

  assert.deepEqual(calls, ["acquire", "payload", "sbom", "prepare-assets", "offline-bundle"]);
  assert.equal(await stat(fixture.outputRoot).catch(() => null), null);
});

test("Windows release assembly rejects a reported offline size that differs from the file", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () => assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies: fixture.dependencies([], { reportedOfflineSizeBytes: 12 }),
    }),
    (error) => error?.code === "release.offline_bundle_size_mismatch",
  );
});

test("Windows release assembly preserves the previous candidate and cleans staging after failure", async () => {
  const fixture = await createFixture();
  await mkdir(fixture.outputRoot, { recursive: true });
  await writeFile(join(fixture.outputRoot, "previous.txt"), "previous", "utf8");
  await writeFile(
    join(fixture.outputRoot, "agent-computer-use-mcp-0.0.1-release-manifest.json"),
    JSON.stringify({ schemaVersion: 1, release: fixture.identity, artifacts: [] }),
    "utf8",
  );

  await assert.rejects(
    () => assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies: fixture.dependencies([], { failStage: "offline-bundle" }),
    }),
    (error) => error?.code === "fixture.offline_failed",
  );

  assert.equal(await readFile(join(fixture.outputRoot, "previous.txt"), "utf8"), "previous");
  assert.deepEqual(await stagingEntries(fixture.outputRoot), []);
});

test("Windows release assembly rejects corrupt acquired bytes before building a payload", async () => {
  const fixture = await createFixture();
  const calls = [];
  const dependencies = fixture.dependencies(calls);
  dependencies.acquireReleaseAssets = async () => {
    calls.push("acquire");
    const assets = await fixture.acquired();
    await writeFile(assets[0].path, "corrupt", "utf8");
    return assets;
  };

  await assert.rejects(
    () => assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies,
    }),
    (error) => error?.code === "release.acquired_asset_mismatch",
  );

  assert.deepEqual(calls, ["acquire"]);
  assert.equal(await stat(fixture.outputRoot).catch(() => null), null);
  assert.deepEqual(await stagingEntries(fixture.outputRoot), []);
});

test("verified Windows candidate can be reopened without rebuilding release stages", async () => {
  const fixture = await createFixture();
  const dependencies = fixture.dependencies([]);
  await assembleWindowsReleaseCandidate({
    outputRoot: fixture.outputRoot,
    cacheRoot: join(fixture.root, "cache"),
    allowNetwork: false,
    generatedAt: "2026-07-10T00:00:00.000Z",
    lock: fixture.lock,
    identity: fixture.identity,
    dependencies,
  });
  const calls = [];
  const reopenedDependencies = fixture.dependencies(calls);

  const report = await verifyWindowsReleaseCandidate({
    outputRoot: fixture.outputRoot,
    cacheRoot: join(fixture.root, "cache"),
    lock: fixture.lock,
    packageJson: { name: fixture.identity.packageName, version: fixture.identity.version },
    expectedCommit: fixture.identity.commit,
    dependencies: reopenedDependencies,
  });

  assert.equal(report.status, "passed");
  assert.equal(report.realAssetBytesVerified, true);
  assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
  assert.equal(report.artifacts.length, 7);
  assert.deepEqual(calls, ["acquire"]);
});

test("Windows candidate verification rejects output from a different commit", async () => {
  const fixture = await createFixture();
  await assembleWindowsReleaseCandidate({
    outputRoot: fixture.outputRoot,
    cacheRoot: join(fixture.root, "cache"),
    allowNetwork: false,
    generatedAt: "2026-07-10T00:00:00.000Z",
    lock: fixture.lock,
    identity: fixture.identity,
    dependencies: fixture.dependencies([]),
  });

  await assert.rejects(
    () => verifyWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      lock: fixture.lock,
      packageJson: { name: fixture.identity.packageName, version: fixture.identity.version },
      expectedCommit: "b".repeat(40),
      dependencies: fixture.dependencies([]),
    }),
    (error) => error?.code === "release.identity_invalid",
  );
});

test("Windows candidate verification rejects files outside the release inventory", async () => {
  const fixture = await createFixture();
  await assembleWindowsReleaseCandidate({
    outputRoot: fixture.outputRoot,
    cacheRoot: join(fixture.root, "cache"),
    allowNetwork: false,
    generatedAt: "2026-07-10T00:00:00.000Z",
    lock: fixture.lock,
    identity: fixture.identity,
    dependencies: fixture.dependencies([]),
  });
  await writeFile(join(fixture.outputRoot, "untracked.exe"), "untracked", "utf8");

  await assert.rejects(
    () => verifyWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      lock: fixture.lock,
      packageJson: { name: fixture.identity.packageName, version: fixture.identity.version },
      expectedCommit: fixture.identity.commit,
      dependencies: fixture.dependencies([]),
    }),
    (error) => error?.code === "release.candidate_inventory_invalid",
  );
});

test("Windows candidate verification enforces exact artifact filenames and media types", async () => {
  for (const mutation of ["media-type", "file-name"]) {
    const fixture = await createFixture();
    await assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies: fixture.dependencies([]),
    });
    const manifestPath = join(fixture.outputRoot, "agent-computer-use-mcp-0.0.1-release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const installer = manifest.artifacts.find((artifact) => artifact.id === "windows-installer");
    if (mutation === "media-type") {
      installer.mediaType = "application/octet-stream";
    } else {
      const renamed = "renamed-installer.exe";
      await rename(join(fixture.outputRoot, installer.fileName), join(fixture.outputRoot, renamed));
      installer.fileName = renamed;
    }
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const dependencies = fixture.dependencies([]);
    dependencies.verifyReleaseOutputs = async () => ({ status: "passed", violations: [] });

    await assert.rejects(
      () => verifyWindowsReleaseCandidate({
        outputRoot: fixture.outputRoot,
        cacheRoot: join(fixture.root, "cache"),
        lock: fixture.lock,
        packageJson: { name: fixture.identity.packageName, version: fixture.identity.version },
        expectedCommit: fixture.identity.commit,
        dependencies,
      }),
      (error) => error?.code === "release.candidate_inventory_invalid",
      mutation,
    );
  }
});

test("Windows release assembly refuses to replace an unrelated output directory", async () => {
  const fixture = await createFixture();
  await mkdir(fixture.outputRoot, { recursive: true });
  const markerPath = join(fixture.outputRoot, "unrelated.txt");
  await writeFile(markerPath, "keep", "utf8");

  await assert.rejects(
    () => assembleWindowsReleaseCandidate({
      outputRoot: fixture.outputRoot,
      cacheRoot: join(fixture.root, "cache"),
      allowNetwork: false,
      generatedAt: "2026-07-10T00:00:00.000Z",
      lock: fixture.lock,
      identity: fixture.identity,
      dependencies: fixture.dependencies([]),
    }),
    (error) => error?.code === "release.output_root_unsafe",
  );

  assert.equal(await readFile(markerPath, "utf8"), "keep");
});

test("candidate promotion restores the previous output when the final rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-release-promotion-"));
  roots.push(root);
  const outputRoot = join(root, "candidate");
  const stageRoot = join(root, "candidate.staging");
  await writeFixture(join(outputRoot, "old.txt"), "old");
  await writeFixture(join(stageRoot, "new.txt"), "new");

  await assert.rejects(
    () => promoteReleaseCandidate({
      outputRoot,
      stageRoot,
      async renameImpl(source, destination) {
        if (source === stageRoot && destination === outputRoot) {
          const error = new Error("simulated promotion failure");
          error.code = "EACCES";
          throw error;
        }
        await rename(source, destination);
      },
    }),
    (error) => error?.code === "EACCES",
  );

  assert.equal(await readFile(join(outputRoot, "old.txt"), "utf8"), "old");
  assert.equal(await readFile(join(stageRoot, "new.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(root)).filter((entry) => entry.includes(".previous-")), []);
});

test("candidate promotion reports deferred backup cleanup after the new output is active", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-release-cleanup-"));
  roots.push(root);
  const outputRoot = join(root, "candidate");
  const stageRoot = join(root, "candidate.staging");
  await writeFixture(join(outputRoot, "old.txt"), "old");
  await writeFixture(join(stageRoot, "new.txt"), "new");

  const result = await promoteReleaseCandidate({
    outputRoot,
    stageRoot,
    async rmImpl() {
      const error = new Error("simulated cleanup failure");
      error.code = "EACCES";
      throw error;
    },
  });

  assert.equal(result.status, "promoted");
  assert.equal(result.previousCandidateCleanup.status, "deferred");
  assert.equal(await readFile(join(outputRoot, "new.txt"), "utf8"), "new");
  const backups = (await readdir(root)).filter((entry) => entry.includes(".previous-"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(root, backups[0], "old.txt"), "utf8"), "old");
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-release-assembly-"));
  roots.push(root);
  const assetRoot = join(root, "assets");
  await mkdir(assetRoot, { recursive: true });
  const ids = [
    "node-runtime-windows-x64",
    "cua-driver-windows-x64",
    "ocr-model-pp-ocrv6-small-det",
    "ocr-model-pp-ocrv6-small-rec",
    "ocr-model-pp-ocrv6-small-rec-metadata",
    "webview2-evergreen-standalone-windows-x64",
  ];
  const assets = [];
  for (const id of ids) {
    const bytes = Buffer.from(`locked:${id}`, "utf8");
    const path = join(assetRoot, `${id}.bin`);
    await writeFile(path, bytes);
    assets.push({
      id,
      kind: "file",
      version: "1.0.0",
      source: {
        url: `https://example.test/${id}`,
        fileName: `${id}.bin`,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
      },
      license: { spdx: "MIT", sourceUrl: "https://example.test/license" },
      install: { role: "fixture", fileName: `${id}.bin` },
    });
  }
  const lock = {
    schemaVersion: 1,
    packageName: "agent-computer-use-mcp",
    platform: "windows-x64",
    assets,
  };
  const acquired = async () => Promise.all(assets.map(async (asset) => ({
    id: asset.id,
    version: asset.version,
    path: join(assetRoot, `${asset.id}.bin`),
    sizeBytes: asset.source.sizeBytes,
    sha256: asset.source.sha256,
    cacheHit: true,
  })));
  const identity = {
    packageName: "agent-computer-use-mcp",
    version: "0.0.1",
    tag: "v0.0.1",
    commit: "a".repeat(40),
    channel: "preview",
    platform: "windows-x64",
    target: WINDOWS_X64_RELEASE_TARGET,
  };
  return {
    root,
    outputRoot: join(root, "candidate"),
    lock,
    acquired,
    identity,
    dependencies(calls, options = {}) {
      return fixtureDependencies({ calls, acquired, options });
    },
  };
}

function fixtureDependencies({ calls, acquired, options }) {
  return {
    async acquireReleaseAssets() {
      calls.push("acquire");
      return acquired();
    },
    async buildWindowsReleasePayload({ outputRoot, target }) {
      calls.push("payload");
      assert.deepEqual(target, WINDOWS_X64_RELEASE_TARGET);
      const installerPath = join(outputRoot, "payload/bin/AgentComputerUse.Installer.exe");
      const overlayPath = join(outputRoot, "payload/helpers/overlay/GatewayComputerUseOverlay.exe");
      await writeFixture(installerPath, "installer");
      await writeFixture(overlayPath, "overlay");
      await writeFixture(join(outputRoot, "release-manifest.json"), "{}");
      return {
        status: "ready",
        target,
        runtimeSelection: {
          target,
          packageVersion: "1.27.0",
          retainedNativeFiles: [
            "DirectML.dll",
            "dxcompiler.dll",
            "dxil.dll",
            "onnxruntime_binding.node",
            "onnxruntime.dll",
          ],
          retainedNativeBytes: 64_000_000,
          removedNativeBytes: 200_000_000,
        },
        bundleRoot: outputRoot,
        installerPath,
        files: [{ path: "helpers/overlay/GatewayComputerUseOverlay.exe", bytes: 7, sha256: sha256("overlay") }],
      };
    },
    async prepareWindowsOfflineAssets({ outputRoot, target }) {
      calls.push("prepare-assets");
      assert.deepEqual(target, WINDOWS_X64_RELEASE_TARGET);
      const trustRoot = join(outputRoot, "trust");
      const manifestPath = await writeFixture(join(trustRoot, "asset-manifest.json"), "{}");
      const signaturePath = await writeFixture(join(trustRoot, "asset-manifest.sig"), "signature");
      const keyringPath = await writeFixture(join(trustRoot, "keyring.json"), "{}");
      const assets = [{ id: "offline", path: await writeFixture(join(outputRoot, "offline.bin"), "offline"), sizeBytes: 7, sha256: sha256("offline") }];
      return {
        status: "ready",
        target,
        assets,
        trust: { manifestPath, signaturePath, keyringPath },
        requiredAssetIds: ["offline"],
        licenses: [],
      };
    },
    async buildWindowsOfflineBundle({ outputRoot, target }) {
      calls.push("offline-bundle");
      assert.deepEqual(target, WINDOWS_X64_RELEASE_TARGET);
      if (options.failStage === "offline-bundle") {
        const error = new Error("fixture.offline_failed");
        error.code = "fixture.offline_failed";
        throw error;
      }
      const fileName = "agent-computer-use-mcp-0.0.1-windows-x64-offline.candidate.zip";
      const outputPath = await writeFixture(join(outputRoot, fileName), "offline-zip");
      if (options.offlineSizeBytes !== undefined) await truncate(outputPath, options.offlineSizeBytes);
      const sizeBytes = (await stat(outputPath)).size;
      return {
        status: "ready",
        target,
        outputPath,
        fileName,
        sizeBytes: options.reportedOfflineSizeBytes ?? sizeBytes,
        firstEnableDownloadCount: 0,
        assetCount: 6,
        blobCount: 6,
      };
    },
    async packProtectedNpmPackage({ releaseRoot }) {
      calls.push("npm-pack");
      const filename = "agent-computer-use-mcp-0.0.1.tgz";
      return { status: "passed", filename, tarballPath: await writeFixture(join(releaseRoot, filename), "npm") };
    },
    async buildReleaseSbom({ outputPath, target }) {
      calls.push("sbom");
      assert.deepEqual(target, WINDOWS_X64_RELEASE_TARGET);
      await writeFixture(outputPath, JSON.stringify({ bomFormat: "CycloneDX" }));
      return { status: "passed", outputPath };
    },
  };
}

async function stagingEntries(outputRoot) {
  const parent = dirname(outputRoot);
  const prefix = `${basename(outputRoot)}.staging-`;
  return (await readdir(parent).catch(() => [])).filter((entry) => entry.startsWith(prefix));
}

async function writeFixture(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
