import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { verifyReleaseBundle } from "./release-bundle.mjs";
import { verifyReleaseOutputs } from "./release-output-manifest.mjs";
import {
  WINDOWS_X64_OFFLINE_MAX_BYTES,
  assertOfflineBundleSize,
} from "./release-size-policy.mjs";
import { PP_OCRV6_SMALL_MODEL_PACK } from "./ocr-model-pack.mjs";
import { verifyWindowsOfflineBundleContents } from "./windows-offline-bundle.mjs";
import {
  assembleWindowsReleaseCandidate,
  verifyWindowsReleaseCandidate,
} from "./windows-release-assembly.mjs";
import { expandVerifiedZip } from "./windows-release-payload.mjs";
import { runWindowsInstaller } from "./windows-installer-host.mjs";

const REQUIRED_SBOM_COMPONENTS = new Set([
  "agent-computer-use-mcp",
  "agent-computer-use-installer-windows-x64",
  "node-runtime-windows-x64",
  "cua-driver-windows-x64",
  "gateway-overlay-windows-x64",
  "onnxruntime-node",
  "ocr-model-pp-ocrv6-small-det",
  "ocr-model-pp-ocrv6-small-rec",
]);
const MCP_SMOKE_TIMEOUT_MS = 15_000;
const DRIVER_OVERRIDE_ENV_KEYS = Object.freeze([
  "AGENT_COMPUTER_USE_CUA_DRIVER",
  "AGENT_COMPUTER_USE_CUA_DRIVER_PATH",
  "XIAOZHICLAW_CUA_DRIVER",
  "XIAOZHICLAW_CUA_DRIVER_PATH",
  "CUA_DRIVER",
]);

export async function runRealReleaseAssemblyPhase(options = {}) {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const candidateRoot = resolve(options.candidateRoot ?? join("artifacts/windows-release", packageJson.version));
  const cacheRoot = resolve(options.cacheRoot ?? "artifacts/release-cache");
  const candidateExists = (await stat(candidateRoot).catch(() => null))?.isDirectory() === true;
  const assembly = candidateExists
    ? await (options.verifyWindowsReleaseCandidate ?? verifyWindowsReleaseCandidate)({ outputRoot: candidateRoot, cacheRoot })
    : await (options.assembleWindowsReleaseCandidate ?? assembleWindowsReleaseCandidate)({
      outputRoot: candidateRoot,
      cacheRoot,
      allowNetwork: options.allowNetwork !== false,
    });
  const workRoot = await mkdtemp(join(tmpdir(), "agent-release-phase-0-15-"));
  try {
    const outputVerification = await verifyReleaseOutputs({
      manifestPath: assembly.manifestPath,
      checksumsPath: assembly.checksumsPath,
      artifactRoot: assembly.outputRoot,
    });
    const offline = requiredArtifact(assembly, "windows-offline-bundle");
    const offlineFileSize = (await stat(offline.path)).size;
    const offlineSize = assertOfflineBundleSize({ target: assembly.target, sizeBytes: offlineFileSize });
    const offlineBundleSizeVerified = assembly.offlineBundleSizeBytes === offlineSize.sizeBytes
      && assembly.offlineBundleMaxBytes === offlineSize.maxBytes
      && offlineSize.maxBytes === WINDOWS_X64_OFFLINE_MAX_BYTES;
    const expandedRoot = join(workRoot, "offline");
    await expandVerifiedZip({ archivePath: offline.path, destinationPath: expandedRoot });
    const releaseVerification = await verifyReleaseBundle({ bundleRoot: join(expandedRoot, "release") });
    const offlineContents = await verifyWindowsOfflineBundleContents(expandedRoot);
    const offlineBundleVerified = offlineContents.status === "passed" && await requiredOfflineEntriesPresent(expandedRoot);

    const localAppData = join(workRoot, "local-app-data");
    const programRoot = join(localAppData, "Programs", "AgentComputerUse");
    const dataRoot = join(localAppData, "AgentComputerUse");
    const installerPath = join(expandedRoot, "installer", "AgentComputerUse.Installer.exe");
    const install = await runWindowsInstaller("install", {
      installerPath,
      bundleRoot: join(expandedRoot, "release"),
      programRoot,
      dataRoot,
    });
    assertInstaller(install, "installed", "release install");

    const manifestPath = join(expandedRoot, "trust", "asset-manifest.json");
    const signaturePath = join(expandedRoot, "trust", "asset-manifest.sig");
    const keyringPath = join(expandedRoot, "trust", "keyring.json");
    const assetManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const assetIds = assetManifest.assets.map((asset) => asset.id);
    const common = {
      installerPath,
      programRoot,
      dataRoot,
      manifestPath,
      signaturePath,
      keyringPath,
      offlineRoot: join(expandedRoot, "assets"),
    };
    const prepared = await runWindowsInstaller("asset-prepare", {
      ...common,
      assetIds,
      allowNetwork: false,
      operationId: "phase-0-15-prepare",
    });
    assertInstaller(prepared, "prepared", "offline asset preparation");
    const activated = await runWindowsInstaller("asset-activate", {
      ...common,
      releaseId: prepared.report.releaseId,
      operationId: "phase-0-15-activate",
    });
    assertInstaller(activated, "activated", "offline asset activation");

    const activePayloadRoot = install.report.activePayloadRoot;
    const runtime = JSON.parse(await readFile(join(activePayloadRoot, "runtime-entrypoints.json"), "utf8"));
    const driver = activated.report.assets.find((asset) => asset.id === "cua-driver-windows-x64");
    const mcpSmoke = await smokeInstalledMcp({
      activePayloadRoot,
      runtime,
      localAppData,
      expectedDriverPath: driver?.entryPoint,
    });
    const model = activated.report.assets.find((asset) => asset.id === "ocr-model-pp-ocrv6-small");
    const ocrModelPackPresent = await assetFilesPresent(model, PP_OCRV6_SMALL_MODEL_PACK.files);
    const nativeOverlayPresent = (await stat(join(activePayloadRoot, ...runtime.overlay.split("/"))).catch(() => null))?.isFile() === true;
    const overlayRequiresWebView2 = false;
    const sbomVerified = await verifySbom(requiredArtifact(assembly, "release-sbom").path);

    const checksumsVerified = outputVerification.status === "passed";
    const passed = assembly.realAssetBytesVerified === true
      && releaseVerification.status === "ready"
      && offlineBundleVerified
      && offlineBundleSizeVerified
      && install.report.status === "installed"
      && prepared.report.status === "prepared"
      && activated.report.status === "activated"
      && mcpSmoke.status === "passed"
      && ocrModelPackPresent
      && nativeOverlayPresent
      && checksumsVerified
      && sbomVerified;
    return {
      status: passed ? "passed" : "failed",
      phase: "0.15",
      benchmark: "real-release-assembly",
      realAssetBytesVerified: assembly.realAssetBytesVerified === true,
      releaseBundleVerified: releaseVerification.status === "ready",
      offlineBundleVerified,
      offlineBundleSizeBytes: offlineSize.sizeBytes,
      offlineBundleMaxBytes: offlineSize.maxBytes,
      offlineVerifiedFileCount: offlineContents.fileCount,
      installerAppliedRelease: install.report.status === "installed",
      assetsPreparedAndActivatedOffline: prepared.report.status === "prepared" && activated.report.status === "activated",
      standardMcpSmokePassed: mcpSmoke.status === "passed",
      activatedDriverResolvedByMcp: mcpSmoke.activatedDriverResolved,
      activatedDriverPathMatches: mcpSmoke.activatedDriverPathMatches,
      mcpDeadlineMs: MCP_SMOKE_TIMEOUT_MS,
      ocrModelPackPresent,
      nativeOverlayPresent,
      overlayRequiresWebView2,
      checksumsVerified,
      sbomVerified,
      firstEnableDownloadCount: assembly.firstEnableDownloadCount,
      networkAllowedDuringInstall: false,
      distributionStatus: assembly.distributionStatus,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function smokeInstalledMcp({ activePayloadRoot, runtime, localAppData, expectedDriverPath }) {
  const nodePath = join(activePayloadRoot, ...runtime.mcp.command.split("/"));
  const launcherPath = join(activePayloadRoot, ...runtime.mcp.args[0].split("/"));
  const packageRoot = join(activePayloadRoot, "package");
  for (const path of [nodePath, launcherPath]) {
    if (!(await stat(path).catch(() => null))?.isFile()) return { status: "failed", reason: "runtime-entrypoint-missing" };
  }
  const client = new Client(
    { name: "phase-0-15-installed-client", version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: nodePath,
    args: [launcherPath],
    cwd: packageRoot,
    env: childEnvironment({ LOCALAPPDATA: localAppData }, DRIVER_OVERRIDE_ENV_KEYS),
  });
  try {
    await client.connect(transport, requestOptions());
    const tools = await client.listTools(undefined, requestOptions());
    const health = await client.callTool(
      { name: "computer.health", arguments: { fast: true } },
      undefined,
      requestOptions(),
    );
    const doctor = await client.callTool(
      { name: "computer.doctor", arguments: { fast: true } },
      undefined,
      requestOptions(),
    );
    const driver = doctor.structuredContent?.installCache?.assets?.find((asset) => asset.id === "cua-driver-windows-x64");
    const activatedDriverPathMatches = samePath(driver?.health?.driverPath ?? driver?.path, expectedDriverPath);
    const activatedDriverResolved = driver?.status === "healthy" && activatedDriverPathMatches;
    return {
      status: !health.isError && !doctor.isError && activatedDriverResolved
        && tools.tools.some((tool) => tool.name === "computer.health") ? "passed" : "failed",
      activatedDriverResolved,
      activatedDriverPathMatches,
    };
  } finally {
    await closeMcpClient(client, transport);
  }
}

async function requiredOfflineEntriesPresent(root) {
  const paths = [
    "installer/AgentComputerUse.Installer.exe",
    "release/release-manifest.json",
    "release/payload/runtime/node/node.exe",
    "release/payload/package/dist/launcher.mjs",
    "release/payload/helpers/overlay/GatewayComputerUseOverlay.exe",
    "trust/asset-manifest.json",
    "trust/asset-manifest.sig",
    "trust/keyring.json",
    "metadata/candidate.json",
    "metadata/release-manifest.json",
    "metadata/sbom.cdx.json",
    "metadata/checksums.txt",
    "licenses/THIRD-PARTY-NOTICES.json",
  ];
  return (await Promise.all(paths.map(async (path) => (await stat(join(root, ...path.split("/"))).catch(() => null))?.isFile() === true)))
    .every(Boolean);
}

function requestOptions() {
  return { timeout: MCP_SMOKE_TIMEOUT_MS, maxTotalTimeout: MCP_SMOKE_TIMEOUT_MS };
}

function childEnvironment(overrides, omittedKeys = []) {
  const env = { ...process.env, ...overrides };
  const omitted = new Set(omittedKeys.map((key) => key.toUpperCase()));
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => (
    typeof value === "string" && !omitted.has(key.toUpperCase())
  )));
}

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalize = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

async function closeMcpClient(client, transport) {
  let timer;
  try {
    await Promise.race([
      client.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("release.mcp_close_timeout")), MCP_SMOKE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    await transport.close().catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

async function assetFilesPresent(asset, expectedNames) {
  if (!asset || !(await stat(asset.entryPoint).catch(() => null))?.isFile()) return false;
  const filesByName = new Map(asset.files.map((file) => [file.path.replaceAll("\\", "/").split("/").at(-1), file]));
  for (const expected of expectedNames) {
    const definition = typeof expected === "string" ? { path: expected } : expected;
    const actual = filesByName.get(definition.path);
    if (!actual || (definition.sizeBytes !== undefined && actual.sizeBytes !== definition.sizeBytes)
      || (definition.sha256 !== undefined && actual.sha256 !== definition.sha256)) return false;
  }
  return (await Promise.all(asset.files.map(async (file) => (
    await stat(join(asset.root, ...file.path.replaceAll("\\", "/").split("/"))).catch(() => null)
  )?.isFile() === true)))
    .every(Boolean);
}

async function verifySbom(path) {
  const sbom = JSON.parse(await readFile(path, "utf8"));
  if (sbom.bomFormat !== "CycloneDX") return false;
  const names = new Set([sbom.metadata?.component?.name, ...(sbom.components ?? []).map((component) => component.name)]);
  return [...REQUIRED_SBOM_COMPONENTS].every((name) => names.has(name));
}

function requiredArtifact(assembly, id) {
  const artifact = assembly.artifacts.find((entry) => entry.id === id);
  if (!artifact) throw new Error(`release.phase_0_15_artifact_missing: ${id}`);
  return artifact;
}

function assertInstaller(result, expectedStatus, operation) {
  if (result.exitCode !== 0 || result.report?.status !== expectedStatus) {
    throw new Error(`release.phase_0_15_installer_failed: ${operation}: ${result.stderr || result.stdout}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runRealReleaseAssemblyPhase();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
