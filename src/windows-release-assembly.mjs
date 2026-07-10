import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { packProtectedNpmPackage } from "../scripts/pack-protected-npm-package.mjs";
import { acquireReleaseAssets } from "./release-asset-acquirer.mjs";
import { loadReleaseAssetLock } from "./release-asset-lock.mjs";
import { verifyReleaseOutputs, writeReleaseOutputManifest } from "./release-output-manifest.mjs";
import { assertOfflineBundleSize } from "./release-size-policy.mjs";
import { buildReleaseSbom } from "./release-sbom.mjs";
import { buildWindowsOfflineBundle, prepareWindowsOfflineAssets } from "./windows-offline-bundle.mjs";
import { buildWindowsReleasePayload } from "./windows-release-payload.mjs";
import { WINDOWS_X64_RELEASE_TARGET, assertReleaseTarget, sameReleaseTarget } from "./release-target.mjs";

const DEFAULT_DEPENDENCIES = Object.freeze({
  acquireReleaseAssets,
  buildReleaseSbom,
  buildWindowsOfflineBundle,
  buildWindowsReleasePayload,
  loadReleaseAssetLock,
  packProtectedNpmPackage,
  prepareWindowsOfflineAssets,
  verifyReleaseOutputs,
  writeReleaseOutputManifest,
});
export async function assembleWindowsReleaseCandidate(options = {}) {
  if (process.platform !== "win32") {
    throw releaseError("release.windows_required", "Windows release assembly requires Windows");
  }
  const target = assertReleaseTarget(
    options.target ?? options.identity?.target ?? WINDOWS_X64_RELEASE_TARGET,
  );
  const outputRoot = resolve(required(options.outputRoot, "release.output_root_missing"));
  const cacheRoot = resolve(required(options.cacheRoot, "release.cache_root_missing"));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...(options.dependencies ?? {}) };
  const lock = options.lock ?? await dependencies.loadReleaseAssetLock(
    options.lockPath ?? "release/windows-x64-assets.lock.json",
  );
  const packageJson = options.packageJson ?? JSON.parse(await readFile("package.json", "utf8"));
  const identity = options.identity ?? await releaseIdentity(packageJson, target);
  validateIdentity(identity, lock, packageJson, undefined, target);
  await assertReplaceableOutputRoot(outputRoot, identity);

  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  const workRoot = join(stageRoot, ".work");
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(workRoot, { recursive: true });

    const acquiredAssets = await dependencies.acquireReleaseAssets({
      lock,
      cacheRoot,
      allowNetwork: options.allowNetwork !== false,
      fetchImpl: options.fetchImpl,
      onProgress: options.onProgress,
    });
    await verifyAcquiredAssets(lock, acquiredAssets);
    const acquired = new Map(acquiredAssets.map((asset) => [asset.id, asset]));
    const prefix = `${identity.packageName}-${identity.version}`;

    const payloadReport = await dependencies.buildWindowsReleasePayload({
      outputRoot: join(workRoot, "release"),
      nodeArchivePath: requiredAcquired(acquired, "node-runtime-windows-x64").path,
      generatedAt,
      target,
    });
    assertStageTarget(payloadReport, target, "payload");
    const sbomFileName = `${prefix}-sbom.cdx.json`;
    const sbomPath = join(workRoot, "evidence", sbomFileName);
    await dependencies.buildReleaseSbom({
      outputPath: sbomPath,
      lock,
      payloadReport,
      generatedAt,
      target,
    });
    const offlineAssets = await dependencies.prepareWindowsOfflineAssets({
      outputRoot: join(workRoot, "offline-assets"),
      packageVersion: identity.version,
      generatedAt,
      lock,
      acquiredAssets,
      target,
    });
    assertStageTarget(offlineAssets, target, "offline assets");
    const offlineReport = await dependencies.buildWindowsOfflineBundle({
      outputRoot: join(workRoot, "offline-bundle"),
      payloadBundleRoot: payloadReport.bundleRoot,
      packageName: identity.packageName,
      packageVersion: identity.version,
      generatedAt,
      assets: offlineAssets.assets,
      requiredAssetIds: offlineAssets.requiredAssetIds,
      trust: offlineAssets.trust,
      licenses: offlineAssets.licenses,
      sbomPath,
      target,
    });
    assertStageTarget(offlineReport, target, "offline bundle");
    const offlineStat = await stat(offlineReport.outputPath).catch(() => null);
    if (!offlineStat?.isFile() || offlineReport.sizeBytes !== offlineStat.size) {
      throw releaseError(
        "release.offline_bundle_size_mismatch",
        "Offline bundle report size does not match the assembled file",
      );
    }
    const offlineSize = assertOfflineBundleSize({ target, sizeBytes: offlineStat.size });
    const npmReport = await dependencies.packProtectedNpmPackage({
      packageRoot: join(workRoot, "npm-package"),
      releaseRoot: join(workRoot, "npm-release"),
    });

    const candidates = [
      artifact("windows-installer", `${prefix}-windows-x64-installer.candidate.exe`, payloadReport.installerPath, "application/vnd.microsoft.portable-executable"),
      artifact("windows-offline-bundle", offlineReport.fileName, offlineReport.outputPath, "application/zip"),
      artifact("protected-npm-package", npmReport.filename, npmReport.tarballPath, "application/gzip"),
      artifact("release-sbom", sbomFileName, sbomPath, "application/vnd.cyclonedx+json"),
      artifact("candidate-asset-manifest", `${prefix}-asset-manifest.candidate.json`, offlineAssets.trust.manifestPath, "application/json"),
      artifact("candidate-asset-signature", `${prefix}-asset-manifest.candidate.sig`, offlineAssets.trust.signaturePath, "application/json"),
      artifact("candidate-asset-keyring", `${prefix}-asset-keyring.candidate.json`, offlineAssets.trust.keyringPath, "application/json"),
    ];
    for (const candidate of candidates) {
      const destination = join(stageRoot, candidate.fileName);
      if (resolve(candidate.sourcePath) !== resolve(destination)) {
        await copyFile(candidate.sourcePath, destination);
      }
      candidate.path = destination;
      delete candidate.sourcePath;
    }

    await rm(workRoot, { recursive: true, force: true });
    const output = await dependencies.writeReleaseOutputManifest({
      identity,
      evidence: {
        target,
        runtimeSelection: payloadReport.runtimeSelection,
        offlineBundleSizeBytes: offlineSize.sizeBytes,
        offlineBundleMaxBytes: offlineSize.maxBytes,
        assetCount: offlineReport.assetCount,
        blobCount: offlineReport.blobCount,
      },
      artifacts: candidates,
      outputRoot: stageRoot,
      generatedAt,
    });
    const verification = await dependencies.verifyReleaseOutputs({
      manifestPath: output.manifestPath,
      checksumsPath: output.checksumsPath,
      artifactRoot: stageRoot,
    });
    if (verification.status !== "passed") {
      const error = releaseError("release.output_verification_failed", "final candidate output verification failed");
      error.violations = verification.violations;
      throw error;
    }

    await mkdir(dirname(outputRoot), { recursive: true });
    const promotion = await promoteReleaseCandidate({ stageRoot, outputRoot });
    return {
      status: "passed",
      platform: "windows-x64",
      target,
      installable: true,
      distributionStatus: "blocked_unsigned",
      outputRoot,
      manifestPath: join(outputRoot, output.manifestPath.slice(stageRoot.length + 1)),
      checksumsPath: join(outputRoot, output.checksumsPath.slice(stageRoot.length + 1)),
      artifacts: candidates.map((candidate) => ({
        id: candidate.id,
        fileName: candidate.fileName,
        path: join(outputRoot, candidate.fileName),
        mediaType: candidate.mediaType,
        distributionStatus: candidate.distributionStatus,
      })),
      assetCount: lock.assets.length,
      blobCount: offlineReport.blobCount,
      runtimeSelection: payloadReport.runtimeSelection,
      offlineBundleSizeBytes: offlineSize.sizeBytes,
      offlineBundleMaxBytes: offlineSize.maxBytes,
      realAssetBytesVerified: true,
      firstEnableDownloadCount: offlineReport.firstEnableDownloadCount ?? 0,
      startsDesktopControl: false,
      includeUserOverlay: false,
      previousCandidateCleanup: promotion.previousCandidateCleanup,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function promoteReleaseCandidate({
  stageRoot,
  outputRoot,
  renameImpl = rename,
  rmImpl = rm,
  statImpl = stat,
} = {}) {
  const stage = resolve(required(stageRoot, "release.stage_root_missing"));
  const output = resolve(required(outputRoot, "release.output_root_missing"));
  const backup = `${output}.previous-${randomUUID()}`;
  const hasPrevious = (await statImpl(output).catch(() => null))?.isDirectory() === true;
  if (hasPrevious) await renameImpl(output, backup);
  try {
    await renameImpl(stage, output);
  } catch (cause) {
    if (hasPrevious) {
      try {
        await renameImpl(backup, output);
      } catch (restoreCause) {
        const error = releaseError("release.output_restore_failed", "candidate promotion failed and previous output could not be restored");
        error.cause = cause;
        error.restoreCause = restoreCause;
        error.recoveryPath = backup;
        throw error;
      }
    }
    throw cause;
  }
  let previousCandidateCleanup = { status: "not-required" };
  if (hasPrevious) {
    try {
      await rmImpl(backup, { recursive: true, force: true });
      previousCandidateCleanup = { status: "completed" };
    } catch (error) {
      previousCandidateCleanup = {
        status: "deferred",
        recoveryDirectory: basename(backup),
        errorCode: typeof error?.code === "string" ? error.code : "cleanup-failed",
      };
    }
  }
  return { status: "promoted", outputRoot: output, previousCandidateCleanup };
}

export async function verifyWindowsReleaseCandidate(options = {}) {
  const outputRoot = resolve(required(options.outputRoot, "release.output_root_missing"));
  const cacheRoot = resolve(required(options.cacheRoot, "release.cache_root_missing"));
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...(options.dependencies ?? {}) };
  const lock = options.lock ?? await dependencies.loadReleaseAssetLock(
    options.lockPath ?? "release/windows-x64-assets.lock.json",
  );
  const packageJson = options.packageJson ?? JSON.parse(await readFile("package.json", "utf8"));
  const prefix = `${packageJson.name}-${packageJson.version}`;
  const manifestPath = join(outputRoot, `${prefix}-release-manifest.json`);
  const checksumsPath = join(outputRoot, `${prefix}-checksums.txt`);
  const verification = await dependencies.verifyReleaseOutputs({ manifestPath, checksumsPath, artifactRoot: outputRoot });
  if (verification.status !== "passed") {
    const error = releaseError("release.candidate_verification_failed", "existing candidate output verification failed");
    error.violations = verification.violations;
    throw error;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const target = assertReleaseTarget(options.target ?? manifest.release?.target);
  const expectedCommit = options.expectedCommit ?? process.env.GITHUB_SHA ?? await currentCommit();
  validateIdentity(manifest.release ?? {}, lock, packageJson, expectedCommit, target);
  const offlineManifestArtifact = (manifest.artifacts ?? [])
    .find((artifact) => artifact.id === "windows-offline-bundle");
  const offlineSize = assertOfflineBundleSize({
    target,
    sizeBytes: offlineManifestArtifact?.sizeBytes,
  });
  const artifacts = (manifest.artifacts ?? []).map((entry) => ({
    id: entry.id,
    fileName: entry.fileName,
    path: join(outputRoot, entry.fileName),
    mediaType: entry.mediaType,
    distributionStatus: entry.distributionStatus,
  }));
  const contracts = candidateArtifactContracts(prefix);
  const byId = new Map(artifacts.map((entry) => [entry.id, entry]));
  const fileNames = new Set(artifacts.map((entry) => entry.fileName));
  if (artifacts.length !== contracts.length || byId.size !== artifacts.length || fileNames.size !== artifacts.length
    || contracts.some((contract) => {
      const entry = byId.get(contract.id);
      return !entry || entry.fileName !== contract.fileName || entry.mediaType !== contract.mediaType
        || entry.distributionStatus !== "blocked_unsigned";
    })) {
    throw releaseError("release.candidate_inventory_invalid", "existing candidate artifact inventory is incomplete or distributable");
  }
  const expectedFiles = new Set([
    ...artifacts.map((entry) => entry.fileName),
    basename(manifestPath),
    basename(checksumsPath),
  ]);
  const actualEntries = await readdir(outputRoot, { withFileTypes: true });
  if (actualEntries.length !== expectedFiles.size
    || actualEntries.some((entry) => !entry.isFile() || !expectedFiles.has(entry.name))) {
    throw releaseError("release.candidate_inventory_invalid", "candidate directory contains unlisted or non-file entries");
  }
  const acquiredAssets = await dependencies.acquireReleaseAssets({
    lock,
    cacheRoot,
    allowNetwork: false,
  });
  await verifyAcquiredAssets(lock, acquiredAssets);
  return {
    status: "passed",
    platform: "windows-x64",
    target,
    installable: true,
    distributionStatus: "blocked_unsigned",
    outputRoot,
    manifestPath,
    checksumsPath,
    artifacts,
    assetCount: lock.assets.length,
    offlineBundleSizeBytes: offlineSize.sizeBytes,
    offlineBundleMaxBytes: offlineSize.maxBytes,
    realAssetBytesVerified: true,
    firstEnableDownloadCount: 0,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function candidateArtifactContracts(prefix) {
  return [
    { id: "windows-installer", fileName: `${prefix}-windows-x64-installer.candidate.exe`, mediaType: "application/vnd.microsoft.portable-executable" },
    { id: "windows-offline-bundle", fileName: `${prefix}-windows-x64-offline.candidate.zip`, mediaType: "application/zip" },
    { id: "protected-npm-package", fileName: `${prefix}.tgz`, mediaType: "application/gzip" },
    { id: "release-sbom", fileName: `${prefix}-sbom.cdx.json`, mediaType: "application/vnd.cyclonedx+json" },
    { id: "candidate-asset-manifest", fileName: `${prefix}-asset-manifest.candidate.json`, mediaType: "application/json" },
    { id: "candidate-asset-signature", fileName: `${prefix}-asset-manifest.candidate.sig`, mediaType: "application/json" },
    { id: "candidate-asset-keyring", fileName: `${prefix}-asset-keyring.candidate.json`, mediaType: "application/json" },
  ];
}

async function verifyAcquiredAssets(lock, acquiredAssets) {
  if (acquiredAssets.length !== lock.assets.length) {
    throw releaseError("release.acquired_asset_mismatch", "acquired asset count does not match the release lock");
  }
  const acquired = new Map(acquiredAssets.map((asset) => [asset.id, asset]));
  if (acquired.size !== acquiredAssets.length) {
    throw releaseError("release.acquired_asset_mismatch", "acquired asset IDs are not unique");
  }
  for (const locked of lock.assets) {
    const actual = acquired.get(locked.id);
    const fileStat = actual ? await stat(actual.path).catch(() => null) : null;
    if (!actual || !fileStat?.isFile()
      || fileStat.size !== locked.source.sizeBytes
      || actual.sizeBytes !== locked.source.sizeBytes
      || actual.sha256 !== locked.source.sha256
      || await sha256File(actual.path) !== locked.source.sha256) {
      throw releaseError("release.acquired_asset_mismatch", `acquired bytes do not match lock: ${locked.id}`);
    }
  }
}

async function assertReplaceableOutputRoot(outputRoot, identity) {
  const outputStat = await stat(outputRoot).catch(() => null);
  if (!outputStat) return;
  if (!outputStat.isDirectory()) {
    throw releaseError("release.output_root_unsafe", "release output root exists and is not a directory");
  }
  const markerPath = join(
    outputRoot,
    `${identity.packageName}-${identity.version}-release-manifest.json`,
  );
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw releaseError("release.output_root_unsafe", "existing output directory is not a release candidate");
  }
  if (marker.schemaVersion !== 1 || marker.release?.packageName !== identity.packageName
    || marker.release?.version !== identity.version || marker.release?.platform !== identity.platform
    || !sameReleaseTarget(marker.release?.target, identity.target)) {
    throw releaseError("release.output_root_unsafe", "existing output directory has a different release identity");
  }
}

function artifact(id, fileName, sourcePath, mediaType) {
  return {
    id,
    fileName,
    sourcePath,
    mediaType,
    distributionStatus: "blocked_unsigned",
  };
}

function requiredAcquired(acquired, id) {
  const asset = acquired.get(id);
  if (!asset) throw releaseError("release.acquired_asset_mismatch", `required acquired asset is missing: ${id}`);
  return asset;
}

async function releaseIdentity(packageJson, target) {
  return {
    packageName: packageJson.name,
    version: packageJson.version,
    tag: `v${packageJson.version}`,
    commit: process.env.GITHUB_SHA ?? await currentCommit(),
    channel: packageJson.version.startsWith("0.") ? "preview" : "latest",
    platform: target.id,
    target,
  };
}

async function currentCommit() {
  const { spawn } = await import("node:child_process");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && /^[a-f0-9]{40}$/u.test(stdout.trim())) resolvePromise(stdout.trim());
      else reject(releaseError("release.commit_unavailable", stderr.trim() || "git commit identity is unavailable"));
    });
  });
}

function validateIdentity(identity, lock, packageJson, expectedCommit, target) {
  if (identity.packageName !== packageJson.name || identity.version !== packageJson.version
    || identity.tag !== `v${packageJson.version}` || identity.platform !== target.id
    || lock.platform !== target.id || !sameReleaseTarget(identity.target, target)
    || !/^[a-f0-9]{40}$/u.test(identity.commit ?? "")
    || (expectedCommit !== undefined && identity.commit !== expectedCommit)) {
    throw releaseError("release.identity_invalid", "release identity does not match package and asset lock");
  }
}

function assertStageTarget(report, target, stage) {
  if (!sameReleaseTarget(report?.target, target)) {
    throw releaseError("release.target_mismatch", `${stage} report target does not match release target`);
  }
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, code);
  return value;
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
