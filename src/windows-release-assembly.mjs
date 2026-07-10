import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { packProtectedNpmPackage } from "../scripts/pack-protected-npm-package.mjs";
import { acquireReleaseAssets } from "./release-asset-acquirer.mjs";
import { loadReleaseAssetLock } from "./release-asset-lock.mjs";
import { verifyReleaseOutputs, writeReleaseOutputManifest } from "./release-output-manifest.mjs";
import { buildReleaseSbom } from "./release-sbom.mjs";
import { buildWindowsOfflineBundle, prepareWindowsOfflineAssets } from "./windows-offline-bundle.mjs";
import { buildWindowsReleasePayload } from "./windows-release-payload.mjs";

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
const REQUIRED_ARTIFACT_IDS = Object.freeze([
  "windows-installer",
  "windows-offline-bundle",
  "protected-npm-package",
  "release-sbom",
  "candidate-asset-manifest",
  "candidate-asset-signature",
  "candidate-asset-keyring",
]);

export async function assembleWindowsReleaseCandidate(options = {}) {
  if (process.platform !== "win32") {
    throw releaseError("release.windows_required", "Windows release assembly requires Windows");
  }
  const outputRoot = resolve(required(options.outputRoot, "release.output_root_missing"));
  const cacheRoot = resolve(required(options.cacheRoot, "release.cache_root_missing"));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...(options.dependencies ?? {}) };
  const lock = options.lock ?? await dependencies.loadReleaseAssetLock(
    options.lockPath ?? "release/windows-x64-assets.lock.json",
  );
  const packageJson = options.packageJson ?? JSON.parse(await readFile("package.json", "utf8"));
  const identity = options.identity ?? await releaseIdentity(packageJson, lock.platform);
  validateIdentity(identity, lock, packageJson);

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

    const payloadReport = await dependencies.buildWindowsReleasePayload({
      outputRoot: join(workRoot, "release"),
      nodeArchivePath: requiredAcquired(acquired, "node-runtime-windows-x64").path,
      generatedAt,
    });
    const offlineAssets = await dependencies.prepareWindowsOfflineAssets({
      outputRoot: join(workRoot, "offline-assets"),
      packageVersion: identity.version,
      generatedAt,
      lock,
      acquiredAssets,
    });
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
    });
    const npmReport = await dependencies.packProtectedNpmPackage({
      packageRoot: join(workRoot, "npm-package"),
      releaseRoot: join(workRoot, "npm-release"),
    });

    const prefix = `${identity.packageName}-${identity.version}`;
    const sbomFileName = `${prefix}-sbom.cdx.json`;
    const sbomPath = join(stageRoot, sbomFileName);
    await dependencies.buildReleaseSbom({
      outputPath: sbomPath,
      lock,
      payloadReport,
      generatedAt,
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

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
    return {
      status: "passed",
      platform: "windows-x64",
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
      realAssetBytesVerified: true,
      firstEnableDownloadCount: offlineReport.firstEnableDownloadCount ?? 0,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
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
  validateIdentity(manifest.release ?? {}, lock, packageJson);
  const artifacts = (manifest.artifacts ?? []).map((entry) => ({
    id: entry.id,
    fileName: entry.fileName,
    path: join(outputRoot, entry.fileName),
    mediaType: entry.mediaType,
    distributionStatus: entry.distributionStatus,
  }));
  const byId = new Map(artifacts.map((entry) => [entry.id, entry]));
  if (byId.size !== artifacts.length || REQUIRED_ARTIFACT_IDS.some((id) => !byId.has(id))
    || artifacts.some((entry) => entry.distributionStatus !== "blocked_unsigned")) {
    throw releaseError("release.candidate_inventory_invalid", "existing candidate artifact inventory is incomplete or distributable");
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
    installable: true,
    distributionStatus: "blocked_unsigned",
    outputRoot,
    manifestPath,
    checksumsPath,
    artifacts,
    assetCount: lock.assets.length,
    realAssetBytesVerified: true,
    firstEnableDownloadCount: 0,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
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

async function releaseIdentity(packageJson, platform) {
  return {
    packageName: packageJson.name,
    version: packageJson.version,
    tag: `v${packageJson.version}`,
    commit: process.env.GITHUB_SHA ?? await currentCommit(),
    channel: packageJson.version.startsWith("0.") ? "preview" : "latest",
    platform,
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

function validateIdentity(identity, lock, packageJson) {
  if (identity.packageName !== packageJson.name || identity.version !== packageJson.version
    || identity.tag !== `v${packageJson.version}` || identity.platform !== lock.platform
    || !/^[a-f0-9]{40}$/u.test(identity.commit ?? "")) {
    throw releaseError("release.identity_invalid", "release identity does not match package and asset lock");
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
