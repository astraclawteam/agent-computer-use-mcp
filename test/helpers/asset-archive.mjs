import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createSignedAssetFixture, driverAsset } from "./asset-fixture.mjs";

export async function createOfflineDriverFixture(options = {}) {
  const fixtureId = options.fixtureId ?? `driver-${options.version ?? "0.7.1"}`;
  const sourceRoot = join(options.root, `${fixtureId}-source`);
  const zipPath = join(sourceRoot, "cua-driver.zip");
  const driverBytes = Buffer.from(options.driverContents ?? `driver-${options.version ?? "0.7.1"}`, "utf8");
  const uiaBytes = Buffer.from(options.uiaContents ?? `uia-${options.version ?? "0.7.1"}`, "utf8");
  const archiveEntries = options.archiveEntries ?? [
    { path: "cua-driver/cua-driver.exe", contentsBase64: driverBytes.toString("base64") },
    { path: "cua-driver/cua-driver-uia.exe", contentsBase64: uiaBytes.toString("base64") },
  ];
  await mkdir(sourceRoot, { recursive: true });
  await createZip(zipPath, archiveEntries);
  const zipBytes = await readFile(zipPath);
  const archiveSha256 = sha256(zipBytes);
  const offlineRoot = join(options.root, `${fixtureId}-offline`);
  const offlineBlobPath = join(offlineRoot, "blobs", "sha256", archiveSha256);
  await mkdir(join(offlineRoot, "blobs", "sha256"), { recursive: true });
  await writeFile(offlineBlobPath, zipBytes);

  const asset = driverAsset({
    version: options.version ?? "0.7.1",
    source: {
      ...driverAsset().source,
      fileName: "cua-driver.zip",
      sizeBytes: zipBytes.length,
      sha256: archiveSha256,
      urls: options.urls ?? ["https://downloads.example.com/cua-driver.zip"],
    },
    content: {
      format: "zip",
      files: options.contentFiles ?? [
        {
          path: "cua-driver/cua-driver.exe",
          installPath: "bin/cua-driver.exe",
          sizeBytes: driverBytes.length,
          sha256: sha256(driverBytes),
          executable: true,
        },
        {
          path: "cua-driver/cua-driver-uia.exe",
          installPath: "bin/cua-driver-uia.exe",
          sizeBytes: uiaBytes.length,
          sha256: sha256(uiaBytes),
          executable: true,
        },
      ],
    },
    provenance: {
      ...driverAsset().provenance,
      assetName: "cua-driver.zip",
      upstreamSha256: archiveSha256,
    },
  });
  const signed = await createSignedAssetFixture({
    root: options.root,
    fixtureId,
    releaseId: options.releaseId ?? `release-${options.version ?? "0.7.1"}`,
    assets: [asset],
    developmentOnly: options.developmentOnly === true,
  });
  return {
    ...signed,
    asset,
    zipPath,
    zipBytes,
    archiveSha256,
    offlineRoot,
    offlineBlobPath,
    driverBytes,
    uiaBytes,
  };
}

export async function createZip(outputPath, entries) {
  await mkdir(join(outputPath, ".."), { recursive: true }).catch(() => {});
  const script = [
    "Add-Type -AssemblyName System.IO.Compression",
    "$entries = ConvertFrom-Json $env:AGENT_ASSET_ZIP_ENTRIES",
    "$stream = [IO.File]::Open($env:AGENT_ASSET_ZIP_OUTPUT, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
    "$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)",
    "try {",
    "  foreach ($item in $entries) {",
    "    $entry = $archive.CreateEntry([string]$item.path)",
    "    $target = $entry.Open()",
    "    try {",
    "      $bytes = [Convert]::FromBase64String([string]$item.contentsBase64)",
    "      $target.Write($bytes, 0, $bytes.Length)",
    "    } finally { $target.Dispose() }",
    "  }",
    "} finally { $archive.Dispose(); $stream.Dispose() }",
  ].join("; ");
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    AGENT_ASSET_ZIP_OUTPUT: outputPath,
    AGENT_ASSET_ZIP_ENTRIES: JSON.stringify(entries),
  });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
