import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { writeDevelopmentAssetTrustBundle } from "./asset-manifest-signing.mjs";
import { buildOfficialCuaDriverManifest } from "./cua-driver-live-asset.mjs";
import { buildPpOcrV6SmallPack } from "./ocr-release-model-pack.mjs";
import { WINDOWS_X64_RELEASE_TARGET, assertReleaseTarget, sameReleaseTarget } from "./release-target.mjs";

const REQUIRED_PAYLOAD_PATHS = Object.freeze([
  "release-manifest.json",
  "payload/runtime/node/node.exe",
  "payload/package/dist/launcher.mjs",
  "payload/package/node_modules/onnxruntime-node/package.json",
  "payload/helpers/overlay/GatewayComputerUseOverlay.exe",
  "payload/bin/AgentComputerUse.Installer.exe",
]);

export async function prepareWindowsOfflineAssets(options = {}) {
  const target = assertReleaseTarget(options.target ?? WINDOWS_X64_RELEASE_TARGET);
  const outputRoot = resolve(required(options.outputRoot, "release.offline_asset_output_missing"));
  const packageVersion = required(options.packageVersion, "release.package_version_missing");
  const generatedAt = required(options.generatedAt, "release.generated_at_missing");
  const lockAssets = new Map((options.lock?.assets ?? []).map((asset) => [asset.id, asset]));
  const acquired = new Map((options.acquiredAssets ?? []).map((asset) => [asset.id, asset]));
  for (const [id, locked] of lockAssets) {
    const actual = acquired.get(id);
    if (!actual || actual.sizeBytes !== locked.source.sizeBytes || actual.sha256 !== locked.source.sha256) {
      throw releaseError("release.offline_bundle_incomplete", `Locked asset was not acquired exactly: ${id}`);
    }
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const det = requireAcquired(acquired, "ocr-model-pp-ocrv6-small-det");
  const rec = requireAcquired(acquired, "ocr-model-pp-ocrv6-small-rec");
  const metadata = requireAcquired(acquired, "ocr-model-pp-ocrv6-small-rec-metadata");
  const modelPack = await buildPpOcrV6SmallPack({
    detPath: det.path,
    recPath: rec.path,
    metadataPath: metadata.path,
    outputRoot: join(outputRoot, "model-pack"),
    expected: {
      det: { sizeBytes: det.sizeBytes, sha256: det.sha256 },
      rec: { sizeBytes: rec.sizeBytes, sha256: rec.sha256 },
      metadata: { sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 },
    },
  });
  const modelArchive = await archiveDirectory({
    id: "ocr-model-pp-ocrv6-small",
    sourceRoot: modelPack.root,
    outputPath: join(outputRoot, "blobs/ocr-model-pp-ocrv6-small.zip"),
    generatedAt,
  });

  const driver = requireAcquired(acquired, "cua-driver-windows-x64");
  const keyId = "candidate-release-assets";
  const driverDefinition = options.driverDefinition
    ?? buildOfficialCuaDriverManifest({ generatedAt, expiresAt: "2099-01-01T00:00:00.000Z", keyId }).assets[0];
  const modelDefinition = archiveAssetDefinition({
    id: modelArchive.id,
    kind: "model-pack",
    version: "6.0.0-small",
    packageVersion,
    archive: modelArchive,
    files: modelPack.files.map((file) => ({
      path: file.name,
      installPath: file.name,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      executable: false,
    })),
    entryPoint: "ppocrv6_dict.txt",
  });
  const definitions = [driverDefinition, modelDefinition];
  const manifest = {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion,
    releaseId: `candidate-assets-${packageVersion}-windows-x64`,
    generatedAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
    developmentOnly: true,
    target,
    signing: { algorithm: "ecdsa-p256-sha256", keyId },
    assets: definitions,
  };
  const trust = await writeDevelopmentAssetTrustBundle({ root: join(outputRoot, "trust"), manifest });
  const assets = [
    { id: driverDefinition.id, path: driver.path, sizeBytes: driver.sizeBytes, sha256: driver.sha256 },
    { id: modelDefinition.id, path: modelArchive.path, sizeBytes: modelArchive.sizeBytes, sha256: modelArchive.sha256 },
  ];
  return {
    status: "ready",
    target,
    modelPack,
    assets,
    trust: {
      manifestPath: trust.manifestPath,
      signaturePath: trust.signaturePath,
      keyringPath: trust.keyringPath,
    },
    manifest,
    requiredAssetIds: assets.map((asset) => asset.id),
    licenses: [...lockAssets.values()].map((asset) => ({ id: asset.id, ...asset.license })),
    distributionStatus: "blocked_unsigned",
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

export async function buildWindowsOfflineBundle(options = {}) {
  if (process.platform !== "win32") {
    throw releaseError("release.windows_required", "Windows offline bundle requires Windows");
  }
  const target = assertReleaseTarget(options.target ?? WINDOWS_X64_RELEASE_TARGET);
  const outputRoot = resolve(required(options.outputRoot, "release.offline_output_missing"));
  const payloadBundleRoot = resolve(required(options.payloadBundleRoot, "release.payload_root_missing"));
  const generatedAt = required(options.generatedAt, "release.generated_at_missing");
  const packageName = required(options.packageName, "release.package_name_missing");
  const packageVersion = required(options.packageVersion, "release.package_version_missing");
  const input = await validateInputs({ ...options, payloadBundleRoot, target });

  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  const contentRoot = join(stageRoot, "content");
  const outputDirectory = join(stageRoot, "output");
  const fileName = `${packageName}-${packageVersion}-windows-x64-offline.candidate.zip`;
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(contentRoot, { recursive: true });
    await cp(payloadBundleRoot, join(contentRoot, "release"), { recursive: true });
    await mkdir(join(contentRoot, "installer"), { recursive: true });
    await copyFile(
      join(payloadBundleRoot, "payload/bin/AgentComputerUse.Installer.exe"),
      join(contentRoot, "installer/AgentComputerUse.Installer.exe"),
    );

    for (const asset of input.uniqueAssets) {
      const destination = join(contentRoot, "assets", "blobs", "sha256", asset.sha256);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(asset.path, destination);
    }
    await mkdir(join(contentRoot, "trust"), { recursive: true });
    await copyFile(options.trust.manifestPath, join(contentRoot, "trust/asset-manifest.json"));
    await copyFile(options.trust.signaturePath, join(contentRoot, "trust/asset-manifest.sig"));
    await copyFile(options.trust.keyringPath, join(contentRoot, "trust/keyring.json"));
    await mkdir(join(contentRoot, "metadata"), { recursive: true });
    await writeJson(join(contentRoot, "metadata/candidate.json"), {
      schemaVersion: 1,
      packageName,
      packageVersion,
      platform: "windows-x64",
      target,
      generatedAt,
      distributionStatus: "blocked_unsigned",
      firstEnableDownloadCount: 0,
      assets: options.assets.map(({ id, sizeBytes, sha256 }) => ({ id, sizeBytes, sha256 }))
        .sort((left, right) => left.id.localeCompare(right.id, "en")),
      startsDesktopControl: false,
      includeUserOverlay: false,
    });
    await copyFile(join(payloadBundleRoot, "release-manifest.json"), join(contentRoot, "metadata/release-manifest.json"));
    await copyFile(options.sbomPath, join(contentRoot, "metadata/sbom.cdx.json"));
    await mkdir(join(contentRoot, "licenses"), { recursive: true });
    await writeJson(join(contentRoot, "licenses/THIRD-PARTY-NOTICES.json"), {
      schemaVersion: 1,
      components: [...(options.licenses ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en")),
    });
    await writeInternalChecksums(contentRoot);

    const entries = await listRelativeFiles(contentRoot);
    const stagedZipPath = join(outputDirectory, fileName);
    await createDeterministicZip({ sourceRoot: contentRoot, outputPath: stagedZipPath, generatedAt });
    const zipStat = await stat(stagedZipPath);
    const zipSha256 = await sha256File(stagedZipPath);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(outputDirectory, outputRoot);
    return {
      status: "ready",
      platform: "windows-x64",
      target,
      installable: true,
      distributionStatus: "blocked_unsigned",
      outputPath: join(outputRoot, fileName),
      fileName,
      sizeBytes: zipStat.size,
      sha256: zipSha256,
      entries,
      assetCount: options.assets.length,
      blobCount: input.uniqueAssets.length,
      firstEnableDownloadCount: 0,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function verifyWindowsOfflineBundleContents(root) {
  const contentRoot = resolve(required(root, "release.offline_root_missing"));
  const checksumPath = join(contentRoot, "metadata/checksums.txt");
  const checksums = new Map();
  let text;
  try {
    text = await readFile(checksumPath, "utf8");
  } catch {
    throw releaseError("release.offline_contents_invalid", "Offline bundle checksums are missing");
  }
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw releaseError("release.offline_contents_invalid", "Offline bundle checksums use an invalid format");
  }
  for (const line of text.slice(0, -1).split("\n")) {
    const match = /^([a-f0-9]{64})  ([^\\\r\n]+)$/u.exec(line);
    const path = match?.[2];
    if (!path || path.startsWith("/") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      || path === "metadata/checksums.txt" || checksums.has(path)) {
      throw releaseError("release.offline_contents_invalid", "Offline bundle checksums contain an invalid path");
    }
    checksums.set(path, match[1]);
  }

  const actualPaths = (await listRelativeFiles(contentRoot))
    .filter((path) => path !== "metadata/checksums.txt");
  if (actualPaths.length !== checksums.size || actualPaths.some((path) => !checksums.has(path))) {
    throw releaseError("release.offline_contents_invalid", "Offline bundle file inventory does not match checksums");
  }
  for (const path of actualPaths) {
    if (await sha256File(join(contentRoot, ...path.split("/"))) !== checksums.get(path)) {
      throw releaseError("release.offline_contents_invalid", `Offline bundle file hash does not match: ${path}`);
    }
  }
  return { status: "passed", fileCount: actualPaths.length };
}

export async function createDeterministicZip({ sourceRoot, outputPath, generatedAt }) {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", resolve("scripts/create-deterministic-zip.ps1"),
    "-SourcePath", resolve(sourceRoot),
    "-OutputPath", resolve(outputPath),
    "-GeneratedAt", generatedAt,
  ]);
  if (result.exitCode !== 0) {
    throw releaseError("release.offline_zip_failed", (result.stderr || result.stdout).trim().slice(-2000));
  }
}

async function archiveDirectory({ id, sourceRoot, outputPath, generatedAt }) {
  await createDeterministicZip({ sourceRoot, outputPath, generatedAt });
  const fileStat = await stat(outputPath);
  return { id, path: outputPath, sizeBytes: fileStat.size, sha256: await sha256File(outputPath) };
}

function archiveAssetDefinition({
  id,
  kind,
  version,
  packageVersion,
  archive,
  files,
  entryPoint,
  authenticode = { mode: "development-unsigned", timestampRequired: false },
}) {
  const fileName = `${id}.zip`;
  return {
    id,
    kind,
    version,
    platform: { os: "win32", arch: "x64" },
    requiredBeforeFirstEnable: true,
    source: {
      kind: "https-or-offline",
      urls: [`https://github.com/astraclawteam/agent-computer-use-mcp/releases/download/v${packageVersion}/${fileName}`],
      fileName,
      sizeBytes: archive.sizeBytes,
      sha256: archive.sha256,
    },
    content: { format: "zip", files },
    provenance: {
      class: "first-party",
      repository: "astraclawteam/agent-computer-use-mcp",
      tag: `v${packageVersion}`,
      assetName: fileName,
      upstreamSha256: archive.sha256,
    },
    authenticode,
    install: { view: id, entryPoint },
  };
}

function requireAcquired(acquired, id) {
  const asset = acquired.get(id);
  if (!asset) throw releaseError("release.offline_bundle_incomplete", `Acquired asset is missing: ${id}`);
  return asset;
}

async function validateInputs(options) {
  const target = assertReleaseTarget(options.target);
  const payloadPaths = await listRelativeFiles(options.payloadBundleRoot);
  if (payloadPaths.some((path) => path.startsWith("payload/assets/")
    || path.startsWith("payload/activated-assets/"))) {
    throw releaseError(
      "release.offline_activated_view_forbidden",
      "Release payload contains an activated asset view",
    );
  }
  for (const path of REQUIRED_PAYLOAD_PATHS) {
    if (!(await stat(join(options.payloadBundleRoot, path)).catch(() => null))?.isFile()) {
      throw releaseError("release.offline_bundle_incomplete", `Required payload file is missing: ${path}`);
    }
  }
  const assets = [...(options.assets ?? [])];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  if (assetsById.size !== assets.length) {
    throw releaseError("release.offline_asset_duplicate", "Offline asset IDs must be unique");
  }
  for (const id of options.requiredAssetIds ?? []) {
    if (!assetsById.has(id)) {
      throw releaseError("release.offline_bundle_incomplete", `Required offline asset is missing: ${id}`);
    }
  }
  for (const asset of assets) {
    const fileStat = await stat(asset.path).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size !== asset.sizeBytes
      || sha256(await readFile(asset.path)) !== asset.sha256) {
      throw releaseError("release.offline_bundle_incomplete", `Offline asset identity mismatch: ${asset.id}`);
    }
  }
  for (const path of [options.trust?.manifestPath, options.trust?.signaturePath, options.trust?.keyringPath]) {
    if (!path || !(await stat(path).catch(() => null))?.isFile()) {
      throw releaseError("release.offline_bundle_incomplete", "Candidate trust file is missing");
    }
  }
  const sbomStat = options.sbomPath ? await stat(options.sbomPath).catch(() => null) : null;
  if (!sbomStat?.isFile()) {
    throw releaseError("release.offline_bundle_incomplete", "Release SBOM is missing");
  }
  const sbom = JSON.parse(await readFile(options.sbomPath, "utf8"));
  if (sbom.bomFormat !== "CycloneDX") {
    throw releaseError("release.offline_bundle_incomplete", "Release SBOM is not CycloneDX");
  }
  const manifest = JSON.parse(await readFile(options.trust.manifestPath, "utf8"));
  if (manifest.developmentOnly !== true || !sameReleaseTarget(manifest.target, target)) {
    throw releaseError("release.offline_bundle_incomplete", "PR4 candidate trust must be development-only");
  }
  const byHash = new Map();
  for (const asset of assets.sort((left, right) => left.id.localeCompare(right.id, "en"))) {
    if (!byHash.has(asset.sha256)) byHash.set(asset.sha256, asset);
  }
  return { uniqueAssets: [...byHash.values()] };
}

async function listRelativeFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
      else throw releaseError("release.offline_bundle_incomplete", `Linked offline entry is forbidden: ${entry.name}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeInternalChecksums(contentRoot) {
  const paths = (await listRelativeFiles(contentRoot))
    .filter((path) => path !== "metadata/checksums.txt");
  const lines = [];
  for (const path of paths) {
    lines.push(`${await sha256File(join(contentRoot, ...path.split("/")))}  ${path}`);
  }
  await writeFile(join(contentRoot, "metadata/checksums.txt"), `${lines.join("\n")}\n`, "utf8");
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

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
