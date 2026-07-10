import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export async function writeReleaseOutputManifest({
  identity,
  evidence,
  artifacts,
  outputRoot,
  generatedAt = new Date().toISOString(),
} = {}) {
  const root = resolve(outputRoot);
  const records = [];
  const fileNames = new Set();
  for (const artifact of artifacts ?? []) {
    assertFileName(artifact.fileName);
    if (fileNames.has(artifact.fileName)) {
      throw releaseError("release.output_duplicate", `duplicate release artifact: ${artifact.fileName}`);
    }
    fileNames.add(artifact.fileName);
    const path = resolve(artifact.path);
    assertWithinRoot(root, path);
    if (path !== resolve(root, artifact.fileName)) {
      throw releaseError("release.output_path_mismatch", `artifact path does not match fileName: ${artifact.fileName}`);
    }
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw releaseError("release.output_not_file", artifact.fileName);
    records.push({
      id: artifact.id,
      fileName: artifact.fileName,
      mediaType: artifact.mediaType,
      distributionStatus: artifact.distributionStatus,
      sizeBytes: fileStat.size,
      sha256: await sha256File(path),
    });
  }
  records.sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));

  const prefix = `${identity.packageName}-${identity.version}`;
  const manifestFileName = `${prefix}-release-manifest.json`;
  const checksumsFileName = `${prefix}-checksums.txt`;
  const manifestPath = join(root, manifestFileName);
  const checksumsPath = join(root, checksumsFileName);
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    release: { ...identity },
    ...(evidence === undefined ? {} : { evidence }),
    artifacts: records,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const checksumRecords = [
    ...records.map((record) => ({ fileName: record.fileName, sha256: record.sha256 })),
    { fileName: manifestFileName, sha256: await sha256File(manifestPath) },
  ].sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
  const checksums = checksumRecords.map((record) => `${record.sha256}  ${record.fileName}`).join("\n");
  await writeFile(checksumsPath, `${checksums}\n`, "utf8");

  return {
    status: "passed",
    manifestPath,
    checksumsPath,
    artifactCount: records.length,
  };
}

export async function verifyReleaseOutputs({ manifestPath, checksumsPath, artifactRoot } = {}) {
  const violations = [];
  const root = resolve(artifactRoot);
  let manifest;
  let checksums;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    checksums = parseChecksums(await readFile(checksumsPath, "utf8"), violations);
  } catch (error) {
    return {
      status: "failed",
      violations: [{ code: "release.output_metadata_invalid", message: error.message }],
    };
  }

  for (const artifact of manifest.artifacts ?? []) {
    await verifyFile(root, artifact.fileName, artifact.sha256, artifact.sizeBytes, checksums, violations);
  }
  const manifestFileName = basename(manifestPath);
  await verifyFile(root, manifestFileName, checksums.get(manifestFileName), undefined, checksums, violations);

  return {
    status: violations.length === 0 ? "passed" : "failed",
    artifactCount: manifest.artifacts?.length ?? 0,
    violations,
  };
}

async function verifyFile(root, fileName, expectedHash, expectedSize, checksums, violations) {
  try {
    assertFileName(fileName);
    const path = resolve(root, fileName);
    assertWithinRoot(root, path);
    const fileStat = await stat(path);
    const actualHash = await sha256File(path);
    const checksumHash = checksums.get(fileName);
    if (!HASH_PATTERN.test(expectedHash ?? "") || actualHash !== expectedHash || checksumHash !== actualHash) {
      violations.push({ code: "release.output_hash_mismatch", fileName, expectedHash, actualHash });
    }
    if (expectedSize !== undefined && fileStat.size !== expectedSize) {
      violations.push({ code: "release.output_size_mismatch", fileName, expectedSize, actualSize: fileStat.size });
    }
  } catch (error) {
    violations.push({ code: "release.output_missing", fileName, message: error.message });
  }
}

function parseChecksums(contents, violations) {
  const checksums = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    if (line === "") continue;
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/u.exec(line);
    if (!match || checksums.has(match?.[2])) {
      violations.push({ code: "release.output_checksums_invalid", line });
      continue;
    }
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function assertFileName(fileName) {
  if (typeof fileName !== "string" || fileName === "" || basename(fileName) !== fileName) {
    throw releaseError("release.output_file_name_invalid", String(fileName));
  }
}

function assertWithinRoot(root, path) {
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw releaseError("release.output_path_escape", path);
  }
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
