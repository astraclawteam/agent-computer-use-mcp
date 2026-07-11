import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

import { writeProductionAssetTrustBundle } from "./asset-manifest-signing.mjs";
import { validateAuthenticodeEvidence } from "./formal-release-policy.mjs";
import { writeReleaseOutputManifest } from "./release-output-manifest.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "./release-target.mjs";
import { expandVerifiedZip } from "./windows-release-payload.mjs";

export function buildProductionAssetManifest({ candidate, keyId, generatedAt, expiresAt }) {
  if (candidate?.developmentOnly !== true || !candidate.packageName || !candidate.packageVersion) {
    throw releaseError("release.candidate_manifest_invalid", "Expected a development-only candidate manifest.");
  }
  if (!keyId || !generatedAt || !expiresAt) {
    throw releaseError("release.production_trust_missing", "Production trust identity is incomplete.");
  }
  return {
    ...candidate,
    releaseId: `${candidate.packageVersion}-windows-x64`,
    generatedAt,
    expiresAt,
    developmentOnly: false,
    signing: { algorithm: "ecdsa-p256-sha256", keyId },
  };
}

export function buildFormalArtifactPlan({ packageName, version }) {
  const prefix = `${packageName}-${version}`;
  return [
    artifact("npm-package", `${prefix}.tgz`, "application/gzip"),
    artifact("asset-manifest", `${prefix}-asset-manifest.json`, "application/json"),
    artifact("asset-signature", `${prefix}-asset-manifest.sig`, "application/json"),
    artifact("checksums", `${prefix}-checksums.txt`, "text/plain"),
    artifact("asset-keyring", `${prefix}-keyring.json`, "application/json"),
    artifact("release-manifest", `${prefix}-release-manifest.json`, "application/json"),
    artifact("release-sbom", `${prefix}-sbom.cdx.json`, "application/vnd.cyclonedx+json"),
    artifact("windows-installer", `${prefix}-windows-x64-installer.exe`, "application/vnd.microsoft.portable-executable"),
    artifact("windows-offline-bundle", `${prefix}-windows-x64-offline.zip`, "application/zip"),
  ];
}

export function sanitizeAuthenticodeEvidence(evidence) {
  return evidence.map((item) => ({
    fileName: basename(item.path),
    status: item.status,
    publisher: item.publisher,
    timestamped: item.timestamped,
    timestampStatus: item.timestampStatus,
    profileType: item.profileType,
  }));
}

export async function prepareFormalRelease({ inputRoot, stageRoot, packageName, version }) {
  const input = resolve(inputRoot);
  const stage = resolve(stageRoot);
  await assertSafeGeneratedRoot(stage);
  await rm(stage, { recursive: true, force: true });
  const offlineRoot = join(stage, "offline");
  await mkdir(offlineRoot, { recursive: true });
  const prefix = `${packageName}-${version}`;
  await expandVerifiedZip({
    archivePath: join(input, `${prefix}-windows-x64-offline.candidate.zip`),
    destinationPath: offlineRoot,
  });
  const signingPaths = [
    join(offlineRoot, "installer", "AgentComputerUse.Installer.exe"),
    join(offlineRoot, "release", "payload", "bin", "AgentComputerUse.Installer.exe"),
    join(offlineRoot, "release", "payload", "helpers", "overlay", "GatewayComputerUseOverlay.exe"),
  ];
  for (const path of signingPaths) await assertFile(path, "release.signing_input_missing");
  await writeFile(join(stage, "authenticode-files.txt"), `${signingPaths.join("\n")}\n`, "utf8");
  return { status: "prepared", stageRoot: stage, offlineRoot, signingPaths };
}

export async function assembleFormalRelease(options) {
  const packageName = options.packageName;
  const version = options.version;
  const prefix = `${packageName}-${version}`;
  const inputRoot = resolve(options.inputRoot);
  const stageRoot = resolve(options.stageRoot);
  const offlineRoot = join(stageRoot, "offline");
  const outputRoot = resolve(options.outputRoot);
  await assertSafeGeneratedRoot(outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const signingPaths = (await readFile(join(stageRoot, "authenticode-files.txt"), "utf8"))
    .split(/\r?\n/u).filter(Boolean);
  const authenticodeEvidence = JSON.parse(await readFile(options.authenticodeEvidencePath, "utf8"));
  const signatureReport = validateAuthenticodeEvidence({
    evidence: authenticodeEvidence,
    expectedPublisher: options.expectedPublisher,
    requiredPaths: signingPaths,
  });
  if (signatureReport.status !== "passed") {
    const error = releaseError("release.authenticode_gate_failed", "Production Authenticode verification failed.");
    error.violations = signatureReport.violations;
    throw error;
  }

  const candidateManifestPath = join(inputRoot, `${prefix}-asset-manifest.candidate.json`);
  const candidate = JSON.parse(await readFile(candidateManifestPath, "utf8"));
  const manifest = buildProductionAssetManifest({
    candidate,
    keyId: options.assetKeyId,
    generatedAt: options.generatedAt,
    expiresAt: options.expiresAt,
  });
  const trustRoot = join(stageRoot, "production-trust");
  const trust = await writeProductionAssetTrustBundle({
    root: trustRoot,
    manifest,
    privateKeyPem: await readFile(options.assetPrivateKeyPath, "utf8"),
    publicKeyPem: await readFile(options.assetPublicKeyPath, "utf8"),
  });
  await mkdir(join(offlineRoot, "trust"), { recursive: true });
  await copyFile(trust.manifestPath, join(offlineRoot, "trust", "asset-manifest.json"));
  await copyFile(trust.signaturePath, join(offlineRoot, "trust", "asset-manifest.sig"));
  await copyFile(trust.keyringPath, join(offlineRoot, "trust", "keyring.json"));
  await rm(join(offlineRoot, "metadata", "candidate.json"), { force: true });
  await writeFile(join(offlineRoot, "metadata", "release-channel.json"), `${JSON.stringify({
    schemaVersion: 1,
    tag: `v${version}`,
    commit: options.commit,
    channel: "preview",
    distributionStatus: "ready",
  }, null, 2)}\n`, "utf8");
  await writeInternalChecksums(offlineRoot);

  const formalPlan = buildFormalArtifactPlan({ packageName, version });
  const byId = new Map(formalPlan.map((item) => [item.id, item]));
  const offlinePath = join(outputRoot, byId.get("windows-offline-bundle").fileName);
  await run("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", resolve("scripts/create-deterministic-zip.ps1"),
    "-SourcePath", offlineRoot,
    "-OutputPath", offlinePath,
    "-GeneratedAt", options.generatedAt,
  ]);
  const copies = [
    [join(offlineRoot, "installer", "AgentComputerUse.Installer.exe"), byId.get("windows-installer").fileName],
    [join(inputRoot, `${prefix}.tgz`), byId.get("npm-package").fileName],
    [join(inputRoot, `${prefix}-sbom.cdx.json`), byId.get("release-sbom").fileName],
    [trust.manifestPath, byId.get("asset-manifest").fileName],
    [trust.signaturePath, byId.get("asset-signature").fileName],
    [trust.keyringPath, byId.get("asset-keyring").fileName],
  ];
  for (const [source, fileName] of copies) await copyFile(source, join(outputRoot, fileName));

  const distributable = formalPlan.filter((item) => !["checksums", "release-manifest"].includes(item.id));
  const output = await writeReleaseOutputManifest({
    identity: {
      packageName,
      version,
      tag: `v${version}`,
      commit: options.commit,
      channel: "preview",
      platform: "windows-x64",
      target: WINDOWS_X64_RELEASE_TARGET,
    },
    evidence: { authenticode: sanitizeAuthenticodeEvidence(authenticodeEvidence), assetManifestKeyId: options.assetKeyId },
    artifacts: distributable.map((item) => ({
      ...item,
      path: join(outputRoot, item.fileName),
      distributionStatus: "ready",
    })),
    outputRoot,
    generatedAt: options.generatedAt,
  });
  return { status: "passed", outputRoot, ...output, artifacts: formalPlan };
}

async function writeInternalChecksums(root) {
  const checksumPath = join(root, "metadata", "checksums.txt");
  const files = (await walkFiles(root))
    .filter((path) => resolve(path) !== resolve(checksumPath))
    .sort((a, b) => relative(root, a).localeCompare(relative(root, b), "en"));
  const lines = [];
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    lines.push(`${createHash("sha256").update(await readFile(path)).digest("hex")}  ${name}`);
  }
  await writeFile(checksumPath, `${lines.join("\n")}\n`, "utf8");
}

async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw releaseError("release.link_forbidden", path);
  }
  return files;
}

async function assertSafeGeneratedRoot(path) {
  const repository = resolve(".");
  const generated = resolve(path);
  if (!generated.startsWith(`${repository}\\artifacts\\`) && !generated.startsWith(`${repository}/artifacts/`)) {
    throw releaseError("release.output_root_unsafe", generated);
  }
}

async function assertFile(path, code) {
  if (!(await stat(path).catch(() => null))?.isFile()) throw releaseError(code, path);
}

function artifact(id, fileName, mediaType) {
  return { id, fileName, mediaType };
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(releaseError("release.command_failed", `${command} exited ${code}: ${stderr || stdout}`)));
  });
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
