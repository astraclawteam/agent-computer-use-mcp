import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assertReleaseTarget } from "./release-target.mjs";

const SUPPORTED_ONNX_VERSION = "1.27.0";
const KNOWN_NATIVE_TARGETS = Object.freeze([
  "darwin/arm64",
  "linux/arm64",
  "linux/x64",
  "win32/arm64",
  "win32/x64",
]);

export const WINDOWS_X64_ONNX_REQUIRED_FILES = Object.freeze([
  "DirectML.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "onnxruntime_binding.node",
  "onnxruntime.dll",
]);

export async function selectProductionRuntime({ packageRoot, target } = {}) {
  const canonicalTarget = assertReleaseTarget(target);
  const moduleRoot = resolve(packageRoot, "node_modules/onnxruntime-node");
  const nativeRoot = join(moduleRoot, "bin", "napi-v6");
  const packageJson = await readPackageJson(join(moduleRoot, "package.json"));
  if (packageJson.name !== "onnxruntime-node" || packageJson.version !== SUPPORTED_ONNX_VERSION) {
    throw releaseError(
      "release.runtime_package_version_unsupported",
      `Unsupported onnxruntime-node package: ${packageJson.name}@${packageJson.version}`,
    );
  }

  const inventory = await inventoryNativeTargets(nativeRoot);
  const actualTargets = [...inventory.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (actualTargets.length !== KNOWN_NATIVE_TARGETS.length
    || actualTargets.some((entry, index) => entry !== KNOWN_NATIVE_TARGETS[index])) {
    throw releaseError(
      "release.runtime_layout_unsupported",
      `Unsupported onnxruntime-node native targets: ${actualTargets.join(", ")}`,
    );
  }

  const retained = inventory.get("win32/x64");
  const retainedFileNames = retained.files.map((file) => file.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (retainedFileNames.length !== WINDOWS_X64_ONNX_REQUIRED_FILES.length
    || retainedFileNames.some((entry, index) => entry !== WINDOWS_X64_ONNX_REQUIRED_FILES[index])) {
    throw releaseError(
      "release.runtime_required_file_missing",
      `Windows x64 ONNX Runtime files do not match the release contract: ${retainedFileNames.join(", ")}`,
    );
  }

  let removedNativeBytes = 0;
  for (const [nativeTarget, record] of inventory) {
    if (nativeTarget === "win32/x64") continue;
    removedNativeBytes += record.sizeBytes;
  }
  await rm(join(nativeRoot, "darwin"), { recursive: true, force: true });
  await rm(join(nativeRoot, "linux"), { recursive: true, force: true });
  await rm(join(nativeRoot, "win32", "arm64"), { recursive: true, force: true });

  return {
    target: canonicalTarget,
    packageVersion: packageJson.version,
    retainedNativeFiles: WINDOWS_X64_ONNX_REQUIRED_FILES,
    retainedNativeBytes: retained.sizeBytes,
    removedNativeBytes,
  };
}

async function readPackageJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    const error = releaseError("release.runtime_layout_unsupported", "onnxruntime-node package metadata is unavailable");
    error.cause = cause;
    throw error;
  }
}

async function inventoryNativeTargets(nativeRoot) {
  const inventory = new Map();
  let osEntries;
  try {
    osEntries = await readdir(nativeRoot, { withFileTypes: true });
  } catch (cause) {
    const error = releaseError("release.runtime_layout_unsupported", "onnxruntime-node native root is unavailable");
    error.cause = cause;
    throw error;
  }
  for (const osEntry of osEntries) {
    assertDirectoryEntry(osEntry, nativeRoot);
    const osRoot = join(nativeRoot, osEntry.name);
    for (const archEntry of await readdir(osRoot, { withFileTypes: true })) {
      assertDirectoryEntry(archEntry, osRoot);
      const targetRoot = join(osRoot, archEntry.name);
      const files = await inventoryFiles(targetRoot);
      inventory.set(`${osEntry.name}/${archEntry.name}`, {
        files,
        sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      });
    }
  }
  return inventory;
}

function assertDirectoryEntry(entry, parent) {
  if (entry.isSymbolicLink()) {
    throw releaseError("release.runtime_link_forbidden", `Linked runtime entry is forbidden: ${join(parent, entry.name)}`);
  }
  if (!entry.isDirectory()) {
    throw releaseError("release.runtime_layout_unsupported", `Unexpected runtime entry: ${join(parent, entry.name)}`);
  }
}

async function inventoryFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw releaseError("release.runtime_link_forbidden", `Linked runtime entry is forbidden: ${join(root, entry.name)}`);
    }
    if (!entry.isFile()) {
      throw releaseError("release.runtime_layout_unsupported", `Unexpected nested runtime entry: ${join(root, entry.name)}`);
    }
    const fileStat = await stat(join(root, entry.name));
    files.push({ name: entry.name, sizeBytes: fileStat.size });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
