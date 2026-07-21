import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import { WINDOWS_X64_TARGET } from "./windows-payload-contract.mjs";

const MANIFEST_PATH = "platform-manifest.json";
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

export async function createPlatformInventory(root, options = {}) {
  const metadata = validateMetadata(options);
  const files = await scanPlatformFiles(root);
  return {
    schemaVersion: 1,
    version: metadata.version,
    sourceCommit: metadata.sourceCommit,
    target: metadata.target,
    files,
  };
}

export async function verifyPlatformInventory(root, manifest, expected = {}) {
  validateManifestShape(manifest);
  if (expected.version !== undefined && manifest.version !== expected.version) {
    throw platformError("platform.version_mismatch", `${manifest.version} != ${expected.version}`);
  }
  if (expected.sourceCommit !== undefined && manifest.sourceCommit !== expected.sourceCommit) {
    throw platformError("platform.commit_mismatch", `${manifest.sourceCommit} != ${expected.sourceCommit}`);
  }
  if (expected.target !== undefined && !sameTarget(manifest.target, expected.target)) {
    throw platformError("platform.target_mismatch", JSON.stringify(manifest.target));
  }

  const actual = await scanPlatformFiles(root);
  const declaredByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  for (const file of manifest.files) {
    const found = actualByPath.get(file.path);
    if (!found) throw platformError("platform.inventory_missing", file.path);
    if (found.sizeBytes !== file.sizeBytes || found.sha256 !== file.sha256 || found.mediaType !== file.mediaType) {
      throw platformError("platform.integrity_failed", file.path);
    }
  }
  for (const file of actual) {
    if (!declaredByPath.has(file.path)) throw platformError("platform.inventory_extra", file.path);
  }
  return { status: "passed", files: actual };
}

async function scanPlatformFiles(root) {
  const absoluteRoot = resolve(root);
  const rootStat = await lstat(absoluteRoot).catch(() => null);
  if (!rootStat?.isDirectory()) throw platformError("platform.root_missing", absoluteRoot);
  if (rootStat.isSymbolicLink()) throw platformError("platform.linked_root", absoluteRoot);

  const files = [];
  const caseFolded = new Map();
  const pending = [absoluteRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(directory, entry.name);
      const fileStat = await lstat(fullPath);
      if (fileStat.isSymbolicLink()) throw platformError("platform.link_forbidden", normalizeRelative(absoluteRoot, fullPath));
      if (fileStat.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!fileStat.isFile()) throw platformError("platform.entry_type_forbidden", normalizeRelative(absoluteRoot, fullPath));
      const path = normalizeRelative(absoluteRoot, fullPath);
      if (path === MANIFEST_PATH) continue;
      const folded = path.toLocaleLowerCase("en-US");
      const previous = caseFolded.get(folded);
      if (previous !== undefined && previous !== path) {
        throw platformError("platform.path_case_collision", `${previous} <> ${path}`);
      }
      caseFolded.set(folded, path);
      files.push({
        path,
        sizeBytes: fileStat.size,
        sha256: await sha256File(fullPath),
        mediaType: mediaTypeFor(path),
      });
    }
  }
  return files.sort((left, right) => ordinalCompare(left.path, right.path));
}

function validateMetadata(options) {
  if (typeof options.version !== "string" || options.version.length === 0) {
    throw platformError("platform.version_invalid", String(options.version));
  }
  if (typeof options.sourceCommit !== "string" || !COMMIT_PATTERN.test(options.sourceCommit)) {
    throw platformError("platform.commit_invalid", String(options.sourceCommit));
  }
  const target = options.target ?? WINDOWS_X64_TARGET;
  if (!sameTarget(target, WINDOWS_X64_TARGET)) {
    throw platformError("platform.target_mismatch", JSON.stringify(target));
  }
  return { version: options.version, sourceCommit: options.sourceCommit, target: { ...target } };
}

function validateManifestShape(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw platformError("platform.manifest_invalid", "shape");
  }
  validateMetadata(manifest);
  let previous;
  const exact = new Set();
  const folded = new Set();
  for (const file of manifest.files) {
    validateManifestFile(file);
    if (exact.has(file.path)) throw platformError("platform.manifest_duplicate", file.path);
    const foldedPath = file.path.toLocaleLowerCase("en-US");
    if (folded.has(foldedPath)) throw platformError("platform.path_case_collision", file.path);
    if (previous !== undefined && ordinalCompare(previous, file.path) >= 0) {
      throw platformError("platform.manifest_unsorted", `${previous} >= ${file.path}`);
    }
    exact.add(file.path);
    folded.add(foldedPath);
    previous = file.path;
  }
}

function validateManifestFile(file) {
  if (typeof file?.path !== "string" || file.path === MANIFEST_PATH || file.path.includes("\\")
    || file.path.startsWith("/") || file.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw platformError("platform.manifest_path_invalid", String(file?.path));
  }
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0
    || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256)
    || typeof file.mediaType !== "string" || file.mediaType.length === 0) {
    throw platformError("platform.manifest_file_invalid", file.path);
  }
}

function normalizeRelative(root, path) {
  const normalized = relative(root, path).split(sep).join("/");
  if (normalized.length === 0 || normalized.startsWith("/")
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw platformError("platform.path_invalid", normalized);
  }
  return normalized;
}

function mediaTypeFor(path) {
  switch (extname(path).toLowerCase()) {
    case ".exe": return "application/vnd.microsoft.portable-executable";
    case ".dll": return "application/vnd.microsoft.portable-executable";
    case ".json": return "application/json";
    case ".onnx": return "application/vnd.onnx";
    case ".txt": return "text/plain";
    case ".yml":
    case ".yaml": return "application/yaml";
    default: return "application/octet-stream";
  }
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function sameTarget(left, right) {
  return left?.platform === right?.platform && left?.arch === right?.arch && left?.id === right?.id;
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function platformError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
