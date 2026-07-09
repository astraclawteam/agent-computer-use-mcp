import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createSignedAssetFixture(options = {}) {
  const root = options.root;
  const fixtureId = options.fixtureId ?? `fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixtureRoot = join(root, fixtureId);
  await mkdir(fixtureRoot, { recursive: true });

  const keyId = options.keyId ?? "test-release-key";
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const assets = options.assets ?? [driverAsset()];
  const manifest = {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    releaseId: options.releaseId ?? "0.0.1-windows-x64",
    generatedAt: options.generatedAt ?? "2026-07-10T00:00:00.000Z",
    expiresAt: options.expiresAt ?? "2026-10-08T00:00:00.000Z",
    developmentOnly: options.developmentOnly === true,
    signing: {
      algorithm: "ecdsa-p256-sha256",
      keyId,
    },
    assets,
  };
  if (options.mutateManifest) options.mutateManifest(manifest);

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signatureEnvelope = {
    schemaVersion: 1,
    algorithm: "ecdsa-p256-sha256",
    keyId,
    signature: sign("sha256", manifestBytes, privateKey).toString("base64"),
  };
  if (options.mutateSignature) options.mutateSignature(signatureEnvelope);
  const keyring = {
    schemaVersion: 1,
    keys: [
      {
        keyId,
        algorithm: "ecdsa-p256-sha256",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        status: "trusted",
      },
    ],
  };
  if (options.mutateKeyring) options.mutateKeyring(keyring);

  const manifestPath = join(fixtureRoot, "asset-manifest.json");
  const signaturePath = join(fixtureRoot, "asset-manifest.sig");
  const keyringPath = join(fixtureRoot, "asset-keyring.json");
  await writeFile(manifestPath, manifestBytes);
  await writeJson(signaturePath, signatureEnvelope);
  await writeJson(keyringPath, keyring);

  return {
    root: fixtureRoot,
    manifest,
    manifestBytes,
    manifestPath,
    signaturePath,
    keyringPath,
    paths: {
      manifestPath,
      signaturePath,
      keyringPath,
    },
  };
}

export function driverAsset(overrides = {}) {
  const bytes = Buffer.from("driver-fixture", "utf8");
  const sha256 = hash(bytes);
  return {
    id: "cua-driver-windows-x64",
    kind: "driver",
    version: "0.7.1",
    platform: { os: "win32", arch: "x64" },
    requiredBeforeFirstEnable: true,
    source: {
      kind: "https-or-offline",
      urls: ["https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.7.1/cua-driver-rs-0.7.1-windows-x86_64.zip"],
      fileName: "cua-driver-rs-0.7.1-windows-x86_64.zip",
      sizeBytes: bytes.length,
      sha256,
    },
    content: {
      format: "raw",
      files: [
        {
          path: "cua-driver.exe",
          installPath: "bin/cua-driver.exe",
          sizeBytes: bytes.length,
          sha256,
          executable: true,
        },
      ],
    },
    provenance: {
      class: "third-party",
      repository: "trycua/cua",
      tag: "cua-driver-rs-v0.7.1",
      assetName: "cua-driver-rs-0.7.1-windows-x86_64.zip",
      upstreamSha256: sha256,
    },
    authenticode: { mode: "vendor-unsigned" },
    install: {
      view: "cua-driver",
      entryPoint: "bin/cua-driver.exe",
    },
    ...overrides,
  };
}

export function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
