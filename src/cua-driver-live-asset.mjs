import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeDevelopmentAssetTrustBundle } from "./asset-manifest-signing.mjs";
import { runWindowsInstaller } from "./windows-installer-host.mjs";

export const OFFICIAL_CUA_DRIVER_WINDOWS_X64 = Object.freeze({
  version: "0.7.1",
  tag: "cua-driver-rs-v0.7.1",
  fileName: "cua-driver-rs-0.7.1-windows-x86_64.zip",
  url: "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.7.1/cua-driver-rs-0.7.1-windows-x86_64.zip",
  sizeBytes: 7762316,
  sha256: "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab",
  files: Object.freeze([
    Object.freeze({
      path: "cua-driver-rs-0.7.1-windows-x86_64/cua-driver.exe",
      installPath: "bin/cua-driver.exe",
      sizeBytes: 11498496,
      sha256: "6ee5565a36692ee4f4413bbd7336c390d28c7cbdf5c2ec7428024a2e719a54f7",
      executable: true,
    }),
    Object.freeze({
      path: "cua-driver-rs-0.7.1-windows-x86_64/cua-driver-uia.exe",
      installPath: "bin/cua-driver-uia.exe",
      sizeBytes: 7640576,
      sha256: "c6e6748f05fa74e68abbea53b8e8eff1fa981ab7085104f746dfb27a16baa5cd",
      executable: true,
    }),
  ]),
});

export function buildOfficialCuaDriverManifest(options = {}) {
  const release = OFFICIAL_CUA_DRIVER_WINDOWS_X64;
  return {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    releaseId: `live-cua-driver-${release.version}-windows-x64`,
    generatedAt: options.generatedAt,
    expiresAt: options.expiresAt,
    developmentOnly: true,
    signing: {
      algorithm: "ecdsa-p256-sha256",
      keyId: options.keyId,
    },
    assets: [
      {
        id: "cua-driver-windows-x64",
        kind: "driver",
        version: release.version,
        platform: { os: "win32", arch: "x64" },
        requiredBeforeFirstEnable: true,
        source: {
          kind: "https-or-offline",
          urls: [release.url],
          fileName: release.fileName,
          sizeBytes: release.sizeBytes,
          sha256: release.sha256,
        },
        content: {
          format: "zip",
          files: release.files.map((file) => ({ ...file })),
        },
        provenance: {
          class: "third-party",
          repository: "trycua/cua",
          tag: release.tag,
          assetName: release.fileName,
          upstreamSha256: release.sha256,
        },
        authenticode: { mode: "vendor-unsigned", timestampRequired: false },
        install: {
          view: "cua-driver",
          entryPoint: "bin/cua-driver.exe",
        },
      },
    ],
  };
}

export async function runCuaDriverLiveAsset(options = {}) {
  if (process.platform !== "win32") {
    return liveReport({ status: "skipped_environment", reason: "windows-required", temporaryRootsCleaned: true });
  }
  const root = options.root ?? await mkdtemp(join(tmpdir(), "agent-computer-use-live-driver-"));
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  const trustRoot = join(root, "trust");
  const offlineRoot = join(root, "offline-empty");
  let report;
  try {
    await mkdir(offlineRoot, { recursive: true });
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const expiresAt = options.expiresAt ?? new Date(Date.parse(generatedAt) + 24 * 60 * 60 * 1000).toISOString();
    const manifest = buildOfficialCuaDriverManifest({
      generatedAt,
      expiresAt,
      keyId: options.keyId ?? `live-${randomUUID()}`,
    });
    const trust = await writeDevelopmentAssetTrustBundle({ root: trustRoot, manifest });
    const common = {
      programRoot,
      dataRoot,
      ...trust,
      offlineRoot,
      assetIds: ["cua-driver-windows-x64"],
      operationId: `live-${randomUUID()}`,
    };
    const prepared = await runWindowsInstaller("asset-prepare", {
      ...common,
      allowNetwork: true,
    });
    if (prepared.exitCode !== 0) {
      report = classifyInstallerFailure(prepared.report);
    } else {
      const activated = await runWindowsInstaller("asset-activate", {
        ...common,
        releaseId: manifest.releaseId,
      });
      if (activated.exitCode !== 0) {
        report = liveReport({ status: "failed", reason: activated.report?.error?.code ?? "asset.activation_failed" });
      } else {
        const entryPoint = activated.report.assets[0].entryPoint;
        const version = await runExecutable(entryPoint, ["--version"], options.timeoutMs ?? 15000);
        report = version.exitCode === 0 && /cua-driver\s+0\.7\.1/i.test(version.stdout)
          ? liveReport({ status: "passed", executableVersion: version.stdout.trim() })
          : liveReport({ status: "failed", reason: "asset.executable_version_mismatch", executableVersion: version.stdout.trim() });
      }
    }
  } catch (error) {
    report = liveReport({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return {
    ...report,
    temporaryRootsCleaned: !(await pathExists(root)),
  };
}

function classifyInstallerFailure(result = {}) {
  const code = result.error?.code ?? "asset.live_installer_failed";
  const transportCodes = new Set([
    "asset.download_interrupted",
    "asset.download_timeout",
    "asset.download_http_error",
  ]);
  return liveReport({
    status: transportCodes.has(code) ? "skipped_environment" : "failed",
    reason: code,
    detail: sanitizeDetail(result.error?.message),
  });
}

function liveReport(overrides = {}) {
  return {
    status: "failed",
    benchmark: "live-cua-driver-asset",
    version: OFFICIAL_CUA_DRIVER_WINDOWS_X64.version,
    archiveSha256: OFFICIAL_CUA_DRIVER_WINDOWS_X64.sha256,
    executableSha256: OFFICIAL_CUA_DRIVER_WINDOWS_X64.files[0].sha256,
    executableVersion: null,
    reason: null,
    detail: null,
    temporaryRootsCleaned: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
    ...overrides,
  };
}

function sanitizeDetail(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[redacted-url]")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[redacted-path]")
    .slice(0, 500);
}

function runExecutable(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
