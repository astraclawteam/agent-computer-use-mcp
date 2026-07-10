import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { writeDevelopmentAssetTrustBundle } from "./asset-manifest-signing.mjs";
import { buildOfficialCuaDriverManifest } from "./cua-driver-live-asset.mjs";
import { buildPpOcrV6SmallPack } from "./ocr-release-model-pack.mjs";

const REQUIRED_PAYLOAD_PATHS = Object.freeze([
  "release-manifest.json",
  "payload/runtime/node/node.exe",
  "payload/package/dist/launcher.mjs",
  "payload/package/node_modules/onnxruntime-node/package.json",
  "payload/helpers/overlay/GatewayComputerUseOverlay.exe",
  "payload/bin/AgentComputerUse.Installer.exe",
]);

export async function prepareWindowsOfflineAssets(options = {}) {
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
    },
  });
  const modelArchive = await archiveDirectory({
    id: "ocr-model-pp-ocrv6-small",
    sourceRoot: modelPack.root,
    outputPath: join(outputRoot, "blobs/ocr-model-pp-ocrv6-small.zip"),
    generatedAt,
  });

  const webView = requireAcquired(acquired, "webview2-evergreen-standalone-windows-x64");
  const webViewRoot = join(outputRoot, "webview2-source");
  const webViewName = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe";
  await mkdir(webViewRoot, { recursive: true });
  await copyFile(webView.path, join(webViewRoot, webViewName));
  const webViewArchive = await archiveDirectory({
    id: webView.id,
    sourceRoot: webViewRoot,
    outputPath: join(outputRoot, "blobs/webview2-evergreen-standalone-windows-x64.zip"),
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
  const webViewDefinition = archiveAssetDefinition({
    id: webViewArchive.id,
    kind: "system-runtime",
    version: lockAssets.get(webView.id)?.version ?? webView.version,
    packageVersion,
    archive: webViewArchive,
    files: [{
      path: webViewName,
      installPath: webViewName,
      sizeBytes: webView.sizeBytes,
      sha256: webView.sha256,
      executable: true,
    }],
    entryPoint: webViewName,
    authenticode: { mode: "microsoft", publisher: "Microsoft Corporation", timestampRequired: true },
  });
  const definitions = [driverDefinition, modelDefinition, webViewDefinition];
  const manifest = {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion,
    releaseId: `candidate-assets-${packageVersion}-windows-x64`,
    generatedAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
    developmentOnly: true,
    signing: { algorithm: "ecdsa-p256-sha256", keyId },
    assets: definitions,
  };
  const trust = await writeDevelopmentAssetTrustBundle({ root: join(outputRoot, "trust"), manifest });
  const assets = [
    { id: driverDefinition.id, path: driver.path, sizeBytes: driver.sizeBytes, sha256: driver.sha256 },
    { id: modelDefinition.id, path: modelArchive.path, sizeBytes: modelArchive.sizeBytes, sha256: modelArchive.sha256 },
    { id: webViewDefinition.id, path: webViewArchive.path, sizeBytes: webViewArchive.sizeBytes, sha256: webViewArchive.sha256 },
  ];
  return {
    status: "ready",
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
  const outputRoot = resolve(required(options.outputRoot, "release.offline_output_missing"));
  const payloadBundleRoot = resolve(required(options.payloadBundleRoot, "release.payload_root_missing"));
  const generatedAt = required(options.generatedAt, "release.generated_at_missing");
  const packageName = required(options.packageName, "release.package_name_missing");
  const packageVersion = required(options.packageVersion, "release.package_version_missing");
  await validateInputs({ ...options, payloadBundleRoot });

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

    for (const asset of [...options.assets].sort((left, right) => left.id.localeCompare(right.id, "en"))) {
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
      generatedAt,
      distributionStatus: "blocked_unsigned",
      firstEnableDownloadCount: 0,
      assets: options.assets.map(({ id, sizeBytes, sha256 }) => ({ id, sizeBytes, sha256 }))
        .sort((left, right) => left.id.localeCompare(right.id, "en")),
      startsDesktopControl: false,
      includeUserOverlay: false,
    });
    await mkdir(join(contentRoot, "licenses"), { recursive: true });
    await writeJson(join(contentRoot, "licenses/THIRD-PARTY-NOTICES.json"), {
      schemaVersion: 1,
      components: [...(options.licenses ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en")),
    });

    const entries = await listRelativeFiles(contentRoot);
    const stagedZipPath = join(outputDirectory, fileName);
    await createDeterministicZip({ sourceRoot: contentRoot, outputPath: stagedZipPath, generatedAt });
    const zipBytes = await readFile(stagedZipPath);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(outputDirectory, outputRoot);
    return {
      status: "ready",
      platform: "windows-x64",
      installable: true,
      distributionStatus: "blocked_unsigned",
      outputPath: join(outputRoot, fileName),
      fileName,
      sizeBytes: zipBytes.length,
      sha256: sha256(zipBytes),
      entries,
      assetCount: options.assets.length,
      firstEnableDownloadCount: 0,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
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
  const bytes = await readFile(outputPath);
  return { id, path: outputPath, sizeBytes: bytes.length, sha256: sha256(bytes) };
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
  for (const path of REQUIRED_PAYLOAD_PATHS) {
    if (!(await stat(join(options.payloadBundleRoot, path)).catch(() => null))?.isFile()) {
      throw releaseError("release.offline_bundle_incomplete", `Required payload file is missing: ${path}`);
    }
  }
  const assetsById = new Map((options.assets ?? []).map((asset) => [asset.id, asset]));
  for (const id of options.requiredAssetIds ?? []) {
    if (!assetsById.has(id)) {
      throw releaseError("release.offline_bundle_incomplete", `Required offline asset is missing: ${id}`);
    }
  }
  for (const asset of options.assets ?? []) {
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
  const manifest = JSON.parse(await readFile(options.trust.manifestPath, "utf8"));
  if (manifest.developmentOnly !== true) {
    throw releaseError("release.offline_bundle_incomplete", "PR4 candidate trust must be development-only");
  }
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
