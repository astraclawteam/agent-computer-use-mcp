import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { ensureWindowsInstallerBuilt, runWindowsInstaller } from "../src/windows-installer-host.mjs";
import { createOfflineDriverFixture } from "./helpers/asset-archive.mjs";
import { createSignedAssetFixture } from "./helpers/asset-fixture.mjs";

const fixtureRoots = [];

test("Authenticode verification retries transient file access without bypassing WinTrust", async () => {
  const source = await readFile("windows-installer/AuthenticodeVerifier.cs", "utf8");
  assert.match(source, /CryptFileError\s*=\s*unchecked\(\(int\)0x80092003\)/u);
  assert.match(source, /File\.OpenHandle\([\s\S]*FileShare\.Read\s*\|\s*FileShare\.Delete/u);
  assert.match(source, /FileHandle\s*=\s*fileHandle\.DangerousGetHandle\(\)/u);
  assert.match(source, /catch\s*\(TransientAuthenticodeFileException\)[\s\S]*Thread\.Sleep/u);
  assert.match(source, /throw new InstallerException\("asset\.authenticode_required"/u);
});

before(async () => {
  await ensureWindowsInstallerBuilt();
});

after(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("vendor unsigned cua-driver is accepted only with signed exact provenance", async () => {
  const harness = await createHarness();
  const fixture = await createOfflineDriverFixture({ root: harness.root, fixtureId: "vendor-driver" });

  const result = await harness.prepare(fixture);

  assert.equal(result.status, "prepared");
  assert.equal(result.assets[0].id, "cua-driver-windows-x64");
});

test("unsigned first-party overlay is never distributable", async () => {
  const harness = await createHarness();
  const fixture = await rawAssetFixture({
    root: harness.root,
    fixtureId: "unsigned-overlay",
    id: "gateway-overlay-windows-x64",
    kind: "overlay-shell",
    fileName: "GatewayComputerUseOverlay.exe",
    bytes: Buffer.from("unsigned-overlay", "utf8"),
    provenance: {
      class: "first-party",
      repository: "astraclawteam/agent-computer-use-mcp",
      tag: "v0.0.1",
      assetName: "GatewayComputerUseOverlay.exe",
      upstreamSha256: "",
    },
    authenticode: {
      mode: "required",
      publisher: "O=Astraclaw Team",
      timestampRequired: true,
    },
  });

  const result = await harness.prepare(fixture, 2);

  assert.equal(result.error.code, "asset.authenticode_required");
});

test("Microsoft signed Windows executable passes WinTrust and publisher validation", async () => {
  const harness = await createHarness();
  const microsoftPath = join(process.env.ProgramFiles, "dotnet", "dotnet.exe");
  const fixture = await rawAssetFixture({
    root: harness.root,
    fixtureId: "microsoft-runtime",
    id: "webview2-runtime-x64",
    kind: "system-runtime",
    fileName: "dotnet.exe",
    bytes: await readFile(microsoftPath),
    provenance: {
      class: "third-party",
      repository: "microsoft/windows",
      tag: "system-fixture",
      assetName: "dotnet.exe",
      upstreamSha256: "",
    },
    authenticode: {
      mode: "microsoft",
      publisher: "O=Microsoft Corporation",
      timestampRequired: true,
    },
  });

  const result = await harness.prepare(fixture);

  assert.equal(result.status, "prepared");
});

test("signed executable with the wrong allowed publisher is rejected", async () => {
  const harness = await createHarness();
  const microsoftPath = join(process.env.ProgramFiles, "dotnet", "dotnet.exe");
  const fixture = await rawAssetFixture({
    root: harness.root,
    fixtureId: "publisher-mismatch",
    id: "webview2-runtime-x64",
    kind: "system-runtime",
    fileName: "dotnet.exe",
    bytes: await readFile(microsoftPath),
    provenance: {
      class: "third-party",
      repository: "microsoft/windows",
      tag: "system-fixture",
      assetName: "dotnet.exe",
      upstreamSha256: "",
    },
    authenticode: {
      mode: "microsoft",
      publisher: "O=Not Microsoft",
      timestampRequired: false,
    },
  });

  const result = await harness.prepare(fixture, 2);

  assert.equal(result.error.code, "asset.authenticode_publisher_mismatch");
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-windows-trust-"));
  fixtureRoots.push(root);
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  return {
    root,
    async prepare(fixture, expectedExitCode = 0) {
      const result = await runWindowsInstaller("asset-prepare", {
        programRoot,
        dataRoot,
        manifestPath: fixture.manifestPath,
        signaturePath: fixture.signaturePath,
        keyringPath: fixture.keyringPath,
        offlineRoot: fixture.offlineRoot,
        assetIds: [fixture.asset.id],
        operationId: `trust-${fixture.manifest.releaseId}`,
      });
      assert.equal(result.exitCode, expectedExitCode, result.stderr || result.stdout);
      return result.report;
    },
  };
}

async function rawAssetFixture(options) {
  const sha256 = hash(options.bytes);
  const offlineRoot = join(options.root, `${options.fixtureId}-offline`);
  const blobPath = join(offlineRoot, "blobs", "sha256", sha256);
  await mkdir(join(offlineRoot, "blobs", "sha256"), { recursive: true });
  await writeFile(blobPath, options.bytes);
  const provenance = {
    ...options.provenance,
    upstreamSha256: options.provenance.upstreamSha256 || sha256,
  };
  const asset = {
    id: options.id,
    kind: options.kind,
    version: "1.0.0",
    platform: { os: "win32", arch: "x64" },
    requiredBeforeFirstEnable: true,
    source: {
      kind: "https-or-offline",
      urls: [`https://downloads.example.com/${options.fileName}`],
      fileName: options.fileName,
      sizeBytes: options.bytes.length,
      sha256,
    },
    content: {
      format: "raw",
      files: [
        {
          path: options.fileName,
          installPath: `bin/${options.fileName}`,
          sizeBytes: options.bytes.length,
          sha256,
          executable: true,
        },
      ],
    },
    provenance,
    authenticode: options.authenticode,
    install: {
      view: options.id,
      entryPoint: `bin/${options.fileName}`,
    },
  };
  const signed = await createSignedAssetFixture({
    root: options.root,
    fixtureId: options.fixtureId,
    releaseId: options.fixtureId,
    assets: [asset],
  });
  return { ...signed, asset, offlineRoot, blobPath };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
