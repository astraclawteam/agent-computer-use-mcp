import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST_FILE = "release-manifest.json";
const PAYLOAD_DIRECTORY = "payload";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function buildReleaseManifest(options = {}) {
  const packageName = requireNonEmptyString(options.packageName, "bundle.package_name_invalid");
  const version = requireNonEmptyString(options.version, "bundle.version_invalid");
  if (!SEMVER_PATTERN.test(version)) {
    throw bundleError("bundle.version_invalid", `Invalid release version: ${version}`);
  }

  const sourceRoot = resolve(requireNonEmptyString(options.sourceRoot, "bundle.source_root_invalid"));
  const paths = normalizeFileInventory(options.files);
  const files = [];
  for (const path of paths) {
    const fullPath = resolveSafe(sourceRoot, path);
    const fileStat = await stat(fullPath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw bundleError("bundle.source_file_missing", `Release source file is missing: ${path}`);
    }
    files.push({
      path,
      bytes: fileStat.size,
      sha256: await sha256File(fullPath),
    });
  }

  return {
    schemaVersion: 1,
    packageName,
    version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    files,
  };
}

export async function materializeReleaseBundle(options = {}) {
  const outputRoot = resolve(requireNonEmptyString(options.outputRoot, "bundle.output_root_invalid"));
  const sourceRoot = resolve(requireNonEmptyString(options.sourceRoot, "bundle.source_root_invalid"));
  if (outputRoot === sourceRoot || sourceRoot.startsWith(`${outputRoot}${sep}`)) {
    throw bundleError("bundle.output_root_invalid", "Release bundle output cannot contain its source root");
  }

  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  await rm(stageRoot, { recursive: true, force: true });
  try {
    const manifest = await buildReleaseManifest(options);
    const payloadRoot = join(stageRoot, PAYLOAD_DIRECTORY);
    await mkdir(payloadRoot, { recursive: true });
    for (const file of manifest.files) {
      const target = resolveSafe(payloadRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveSafe(sourceRoot, file.path), target);
    }
    await writeFile(
      join(stageRoot, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const verification = await verifyReleaseBundle({ bundleRoot: stageRoot });
    if (verification.status !== "ready") {
      throw bundleError(
        "bundle.materialization_failed",
        `Materialized release bundle failed verification: ${verification.violations.map((item) => item.code).join(",")}`,
      );
    }

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
    return verification;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function verifyReleaseBundle(options = {}) {
  const bundleRoot = resolve(requireNonEmptyString(options.bundleRoot, "bundle.root_invalid"));
  const violations = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(bundleRoot, MANIFEST_FILE), "utf8"));
  } catch (error) {
    return failedVerification([{
      code: "bundle.manifest_unreadable",
      message: error instanceof Error ? error.message : String(error),
    }]);
  }

  const manifestValidation = validateManifest(manifest);
  violations.push(...manifestValidation.violations);
  if (manifestValidation.status === "failed") {
    return failedVerification(violations, manifest);
  }

  const payloadRoot = join(bundleRoot, PAYLOAD_DIRECTORY);
  for (const file of manifest.files) {
    const fullPath = resolveSafe(payloadRoot, file.path);
    const fileStat = await stat(fullPath).catch(() => null);
    if (!fileStat?.isFile()) {
      violations.push({ code: "bundle.payload_missing", path: file.path });
      continue;
    }
    if (fileStat.size !== file.bytes) {
      violations.push({
        code: "bundle.size_mismatch",
        path: file.path,
        expected: file.bytes,
        actual: fileStat.size,
      });
    }
    const actualHash = await sha256File(fullPath);
    if (actualHash !== file.sha256) {
      violations.push({
        code: "bundle.hash_mismatch",
        path: file.path,
        expected: file.sha256,
        actual: actualHash,
      });
    }
  }

  const expectedPaths = new Set(manifest.files.map((file) => file.path.toLowerCase()));
  for (const actualPath of await listRelativeFiles(payloadRoot)) {
    if (!expectedPaths.has(actualPath.toLowerCase())) {
      violations.push({ code: "bundle.unexpected_payload", path: actualPath });
    }
  }

  return {
    status: violations.length === 0 ? "ready" : "failed",
    packageName: manifest.packageName,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    fileCount: manifest.files.length,
    files: manifest.files,
    violations,
  };
}

function validateManifest(manifest) {
  const violations = [];
  if (!manifest || typeof manifest !== "object") {
    return failedVerification([{ code: "bundle.manifest_invalid" }]);
  }
  if (manifest.schemaVersion !== 1) {
    violations.push({ code: "bundle.schema_unsupported", actual: manifest.schemaVersion });
  }
  if (typeof manifest.packageName !== "string" || manifest.packageName.trim() === "") {
    violations.push({ code: "bundle.package_name_invalid" });
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    violations.push({ code: "bundle.version_invalid" });
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    violations.push({ code: "bundle.files_empty" });
    return { status: "failed", violations };
  }

  const seen = new Set();
  for (const file of manifest.files) {
    let normalized;
    try {
      normalized = normalizeBundlePath(file?.path);
    } catch (error) {
      violations.push({ code: error.code ?? "bundle.path_invalid", path: file?.path });
      continue;
    }
    if (normalized !== file.path) {
      violations.push({ code: "bundle.path_not_normalized", path: file.path });
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      violations.push({ code: "bundle.path_duplicate", path: normalized });
    }
    seen.add(key);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      violations.push({ code: "bundle.size_invalid", path: normalized });
    }
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      violations.push({ code: "bundle.hash_invalid", path: normalized });
    }
  }
  return { status: violations.length === 0 ? "ready" : "failed", violations };
}

function normalizeFileInventory(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw bundleError("bundle.files_empty", "Release bundle requires at least one file");
  }
  const normalized = files.map(normalizeBundlePath);
  const seen = new Set();
  for (const path of normalized) {
    const key = path.toLowerCase();
    if (seen.has(key)) {
      throw bundleError("bundle.path_duplicate", `Duplicate release bundle path: ${path}`);
    }
    seen.add(key);
  }
  return normalized.sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeBundlePath(value) {
  if (typeof value !== "string" || value.trim() === "" || isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw bundleError("bundle.path_invalid", `Invalid release bundle path: ${value}`);
  }
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw bundleError("bundle.path_invalid", `Invalid release bundle path: ${value}`);
  }
  return segments.join("/");
}

function resolveSafe(root, path) {
  const normalized = normalizeBundlePath(path);
  const target = resolve(root, ...normalized.split("/"));
  const rootPrefix = `${resolve(root)}${sep}`;
  const comparison = process.platform === "win32"
    ? [target.toLowerCase(), rootPrefix.toLowerCase()]
    : [target, rootPrefix];
  if (!comparison[0].startsWith(comparison[1])) {
    throw bundleError("bundle.path_invalid", `Release bundle path escapes root: ${path}`);
  }
  return target;
}

async function listRelativeFiles(root) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath).replace(/\\/g, "/"));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function requireNonEmptyString(value, code) {
  if (typeof value !== "string" || value.trim() === "") {
    throw bundleError(code, `${code}: expected a non-empty string`);
  }
  return value;
}

function failedVerification(violations, manifest = {}) {
  return {
    status: "failed",
    packageName: manifest.packageName ?? null,
    version: manifest.version ?? null,
    generatedAt: manifest.generatedAt ?? null,
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    files: Array.isArray(manifest.files) ? manifest.files : [],
    violations,
  };
}

function bundleError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
