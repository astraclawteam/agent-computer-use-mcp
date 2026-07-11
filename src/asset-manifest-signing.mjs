import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeDevelopmentAssetTrustBundle(options) {
  const root = options.root;
  const manifest = options.manifest;
  const keyId = manifest.signing?.keyId;
  if (!manifest.developmentOnly || !keyId) {
    throw new Error("asset.development_manifest_required");
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signature = {
    schemaVersion: 1,
    algorithm: "ecdsa-p256-sha256",
    keyId,
    signature: sign("sha256", manifestBytes, privateKey).toString("base64"),
  };
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
  await mkdir(root, { recursive: true });
  const manifestPath = join(root, "asset-manifest.json");
  const signaturePath = join(root, "asset-manifest.sig");
  const keyringPath = join(root, "asset-keyring.json");
  await writeFile(manifestPath, manifestBytes);
  await writeFile(signaturePath, `${JSON.stringify(signature, null, 2)}\n`, "utf8");
  await writeFile(keyringPath, `${JSON.stringify(keyring, null, 2)}\n`, "utf8");
  return { manifestPath, signaturePath, keyringPath };
}

export async function writeProductionAssetTrustBundle(options) {
  const { root, manifest, privateKeyPem, publicKeyPem } = options;
  const keyId = manifest?.signing?.keyId;
  if (manifest?.developmentOnly !== false || !keyId) {
    throw new Error("asset.production_manifest_required");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(publicKeyPem);
  if (privateKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyType !== "ec"
    || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("asset.production_key_invalid");
  }
  const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const normalizedPublic = publicKey.export({ type: "spki", format: "pem" });
  if (derivedPublic !== normalizedPublic) throw new Error("asset.production_key_mismatch");

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signature = {
    schemaVersion: 1,
    algorithm: "ecdsa-p256-sha256",
    keyId,
    signature: sign("sha256", manifestBytes, privateKey).toString("base64"),
  };
  const keyring = {
    schemaVersion: 1,
    keys: [{
      keyId,
      algorithm: "ecdsa-p256-sha256",
      publicKeyPem: normalizedPublic,
      status: "trusted",
    }],
  };
  await mkdir(root, { recursive: true });
  const manifestPath = join(root, "asset-manifest.json");
  const signaturePath = join(root, "asset-manifest.sig");
  const keyringPath = join(root, "asset-keyring.json");
  await writeFile(manifestPath, manifestBytes);
  await writeFile(signaturePath, `${JSON.stringify(signature, null, 2)}\n`, "utf8");
  await writeFile(keyringPath, `${JSON.stringify(keyring, null, 2)}\n`, "utf8");
  return { manifestPath, signaturePath, keyringPath };
}
