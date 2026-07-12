import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GITEE_PART_SIZE_BYTES = 90 * 1024 * 1024;
const MANIFEST_NAME = "gitee-mirror-manifest.json";
const RECOVERY_SCRIPT_NAME = "restore-gitee-release.ps1";
const DEFAULT_RECOVERY_SCRIPT = fileURLToPath(new URL(`../scripts/${RECOVERY_SCRIPT_NAME}`, import.meta.url));

export async function prepareGiteeReleaseAssets(options = {}) {
  const context = validateOptions(options);
  await mkdir(context.outputRoot, { recursive: true });
  const originals = [];
  const deliveryAssets = [];

  for (const asset of [...context.assets].sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    await verifyLocalAsset(asset);
    const attachments = asset.sizeBytes <= context.chunkSize
      ? [identity(asset)]
      : await splitAsset(asset, context.outputRoot, context.chunkSize);
    originals.push({
      ...identity(asset),
      representation: attachments.length === 1 && attachments[0].name === asset.name ? "exact" : "chunked",
      attachments: attachments.map(identity),
    });
    if (attachments[0]?.name === asset.name) deliveryAssets.push(asset);
    else deliveryAssets.push(...attachments);
  }

  const manifest = {
    schemaVersion: 1,
    tag: context.tag,
    sourceCommit: context.sourceCommit,
    partSizeBytes: context.chunkSize,
    originals,
  };
  const manifestPath = join(context.outputRoot, MANIFEST_NAME);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const recoveryPath = join(context.outputRoot, RECOVERY_SCRIPT_NAME);
  await copyFile(context.recoveryScriptPath, recoveryPath);
  deliveryAssets.push(
    await describeFile(MANIFEST_NAME, manifestPath),
    await describeFile(RECOVERY_SCRIPT_NAME, recoveryPath),
  );

  return {
    assets: deliveryAssets,
    manifest,
    originals: originals.map(({ name, sizeBytes, sha256, representation }) => ({
      name,
      sizeBytes,
      sha256,
      representation,
    })),
  };
}

async function splitAsset(asset, outputRoot, chunkSize) {
  const source = await open(asset.path, "r");
  const parts = [];
  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < asset.sizeBytes) {
      const length = Math.min(chunkSize, asset.sizeBytes - offset);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await source.read(bytes, 0, length, offset);
      if (bytesRead !== length) throw releaseError("gitee.local_asset_read_failed", asset.name);
      const name = `${asset.name}.part${String(partNumber).padStart(3, "0")}`;
      const path = join(outputRoot, name);
      await writeFile(path, bytes);
      parts.push({
        name,
        path,
        sizeBytes: length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      offset += length;
      partNumber += 1;
    }
  } finally {
    await source.close();
  }
  return parts;
}

async function verifyLocalAsset(asset) {
  if (!asset || basename(asset.name ?? "") !== asset.name || typeof asset.path !== "string") {
    throw releaseError("gitee.local_asset_invalid", asset?.name ?? "unknown");
  }
  const actual = await describeFile(asset.name, asset.path);
  if (actual.sizeBytes !== asset.sizeBytes || actual.sha256 !== asset.sha256) {
    throw releaseError("gitee.local_asset_identity_mismatch", asset.name);
  }
}

async function describeFile(name, path) {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw releaseError("gitee.local_asset_missing", name);
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  let sizeBytes = 0;
  for await (const chunk of stream) {
    sizeBytes += chunk.length;
    hash.update(chunk);
  }
  return {
    name,
    path,
    sizeBytes,
    sha256: hash.digest("hex"),
  };
}

function validateOptions(options) {
  if (!Array.isArray(options.assets)) throw releaseError("gitee.assets_invalid", "assets");
  for (const value of [options.outputRoot, options.tag, options.sourceCommit]) {
    if (typeof value !== "string" || value.trim() === "") throw releaseError("gitee.config_missing", "parts");
  }
  if (!/^[a-f0-9]{40}$/u.test(options.sourceCommit)) throw releaseError("gitee.config_invalid", "sourceCommit");
  const chunkSize = options.chunkSize ?? GITEE_PART_SIZE_BYTES;
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw releaseError("gitee.config_invalid", "chunkSize");
  const sourceNames = new Set();
  for (const asset of options.assets) {
    if (!asset || basename(asset.name ?? "") !== asset.name || sourceNames.has(asset.name)) {
      throw releaseError("gitee.local_asset_invalid", asset?.name ?? "unknown");
    }
    if (asset.name === MANIFEST_NAME || asset.name === RECOVERY_SCRIPT_NAME) {
      throw releaseError("gitee.local_asset_reserved", asset.name);
    }
    sourceNames.add(asset.name);
  }
  return {
    assets: options.assets,
    outputRoot: options.outputRoot,
    tag: options.tag,
    sourceCommit: options.sourceCommit,
    chunkSize,
    recoveryScriptPath: options.recoveryScriptPath ?? DEFAULT_RECOVERY_SCRIPT,
  };
}

function identity({ name, sizeBytes, sha256 }) {
  return { name, sizeBytes, sha256 };
}

function releaseError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
