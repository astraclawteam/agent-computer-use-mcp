import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writeDevelopmentAssetTrustBundle } from "./asset-manifest-signing.mjs";

export async function createPhaseDriverFixture(options) {
  const fixtureRoot = join(options.root, options.fixtureId);
  const sourceRoot = join(fixtureRoot, "source");
  const zipPath = join(sourceRoot, "cua-driver.zip");
  const version = options.version ?? "0.7.1";
  const driverBytes = Buffer.from(options.driverContents ?? `driver-${version}`, "utf8");
  const uiaBytes = Buffer.from(options.uiaContents ?? `uia-${version}`, "utf8");
  const archiveEntries = options.archiveEntries ?? [
    { path: "cua-driver/cua-driver.exe", contentsBase64: driverBytes.toString("base64") },
    { path: "cua-driver/cua-driver-uia.exe", contentsBase64: uiaBytes.toString("base64") },
  ];
  await mkdir(sourceRoot, { recursive: true });
  await createZip(zipPath, archiveEntries);
  const zipBytes = await readFile(zipPath);
  const archiveSha256 = sha256(zipBytes);
  const asset = {
    id: "cua-driver-windows-x64",
    kind: "driver",
    version,
    platform: { os: "win32", arch: "x64" },
    requiredBeforeFirstEnable: true,
    source: {
      kind: "https-or-offline",
      urls: options.urls ?? ["https://downloads.example.com/cua-driver.zip"],
      fileName: "cua-driver.zip",
      sizeBytes: zipBytes.length,
      sha256: archiveSha256,
    },
    content: {
      format: "zip",
      files: options.contentFiles ?? [
        fileEntry("cua-driver/cua-driver.exe", "bin/cua-driver.exe", driverBytes),
        fileEntry("cua-driver/cua-driver-uia.exe", "bin/cua-driver-uia.exe", uiaBytes),
      ],
    },
    provenance: {
      class: "third-party",
      repository: "trycua/cua",
      tag: `cua-driver-rs-v${version}`,
      assetName: "cua-driver.zip",
      upstreamSha256: archiveSha256,
    },
    authenticode: { mode: "vendor-unsigned" },
    install: { view: "cua-driver", entryPoint: "bin/cua-driver.exe" },
  };
  const signed = await createPhaseSignedFixture({
    root: fixtureRoot,
    releaseId: options.releaseId,
    asset,
  });
  const offlineRoot = join(fixtureRoot, "offline");
  const offlineBlobPath = join(offlineRoot, "blobs", "sha256", archiveSha256);
  if (options.includeOffline !== false) {
    await mkdir(join(offlineRoot, "blobs", "sha256"), { recursive: true });
    await writeFile(offlineBlobPath, zipBytes);
  }
  return {
    ...signed,
    asset,
    archiveSha256,
    driverBytes,
    uiaBytes,
    zipBytes,
    offlineRoot,
    offlineBlobPath,
  };
}

export async function createPhaseSignedFixture(options) {
  const trustRoot = join(options.root, "trust");
  const manifest = {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    releaseId: options.releaseId,
    generatedAt: "2026-07-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    developmentOnly: true,
    signing: { algorithm: "ecdsa-p256-sha256", keyId: "phase-7-9-fixture-key" },
    assets: [options.asset],
  };
  const paths = await writeDevelopmentAssetTrustBundle({ root: trustRoot, manifest });
  return { ...paths, manifest };
}

function fileEntry(path, installPath, bytes) {
  return {
    path,
    installPath,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    executable: true,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createZip(outputPath, entries) {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression",
    "$entries = ConvertFrom-Json $env:AGENT_ASSET_ZIP_ENTRIES",
    "$stream = [IO.File]::Open($env:AGENT_ASSET_ZIP_OUTPUT, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
    "$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)",
    "try { foreach ($item in $entries) { $entry = $archive.CreateEntry([string]$item.path); $target = $entry.Open(); try { $bytes = [Convert]::FromBase64String([string]$item.contentsBase64); $target.Write($bytes, 0, $bytes.Length) } finally { $target.Dispose() } } } finally { $archive.Dispose(); $stream.Dispose() }",
  ].join("; ");
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    AGENT_ASSET_ZIP_OUTPUT: outputPath,
    AGENT_ASSET_ZIP_ENTRIES: JSON.stringify(entries),
  });
  if (result.exitCode !== 0) throw new Error(`asset.fixture_zip_failed: ${result.stderr || result.stdout}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
