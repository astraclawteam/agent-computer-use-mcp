import {
  lstat as fsLstat,
  readFile,
  realpath as fsRealpath,
  stat as fsStat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { WINDOWS_X64_TARGET, platformPackageName } from "./platform-package-contract.mjs";
import { verifyPlatformInventory } from "./platform-payload-inventory.mjs";

export async function resolveVerifiedPlatform(options = {}) {
  const target = runtimeTarget(options.platform ?? process.platform, options.arch ?? process.arch);
  const packageName = platformPackageName(target);
  const coreVersion = required(options.coreVersion, "platform.version_invalid");
  const resolvePackageJson = options.resolvePackageJson ?? defaultPackageResolver(packageName);
  const realpath = options.realpath ?? fsRealpath;
  const lstat = options.lstat ?? fsLstat;
  const stat = options.stat ?? fsStat;

  let packageJsonPath;
  try {
    packageJsonPath = resolve(resolvePackageJson(packageName));
  } catch (cause) {
    throw platformError("platform.package_missing", packageName, cause);
  }
  const packageRoot = dirname(packageJsonPath);
  const physicalRoot = await realpath(packageRoot).catch((cause) => {
    throw platformError("platform.package_missing", packageName, cause);
  });
  if (await containsLinkedPath(packageRoot, lstat)
    || (!samePath(packageRoot, physicalRoot)
      && !await sameFileIdentity(packageRoot, physicalRoot, stat))) {
    throw platformError("platform.linked_root", packageRoot);
  }

  const packageJson = await readJson(packageJsonPath, "platform.package_invalid");
  if (packageJson.name !== packageName
    || packageJson.version !== coreVersion
    || !arraysEqual(packageJson.os, [target.platform])
    || !arraysEqual(packageJson.cpu, [target.arch])) {
    const code = packageJson.version !== coreVersion
      ? "platform.version_mismatch"
      : "platform.package_invalid";
    throw platformError(code, `${packageJson.name}@${packageJson.version}`);
  }

  const manifest = await readJson(join(packageRoot, "platform-manifest.json"), "platform.manifest_invalid");
  await verifyPlatformInventory(packageRoot, manifest, {
    version: coreVersion,
    target,
  });
  const components = validateComponents(manifest.components);
  const paths = {
    cuaDriverRoot: join(packageRoot, ...components.cuaDriver.split("/")),
    overlayRoot: join(packageRoot, ...components.overlay.split("/")),
    ocrRuntimeRoot: join(packageRoot, ...components.ocrRuntime.split("/")),
    ocrModelRoot: join(packageRoot, ...components.ocrModels.split("/")),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!(await stat(path).catch(() => null))?.isDirectory()) {
      throw platformError("platform.component_missing", name);
    }
  }
  paths.cuaDriverExecutable = resolveManifestExecutable(packageRoot, manifest.files, "cua-driver/", /cua-driver(?:-rs)?\.exe$/iu);
  paths.overlayExecutable = resolveManifestExecutable(packageRoot, manifest.files, "overlay/", /GatewayComputerUseOverlay\.exe$/iu);
  return {
    status: "verified",
    packageName,
    packageRoot,
    packageVersion: packageJson.version,
    manifest,
    paths,
  };
}

function resolveManifestExecutable(packageRoot, files, prefix, pattern) {
  const file = files.find(({ path }) => path.startsWith(prefix) && pattern.test(path));
  if (!file) throw platformError("platform.component_missing", prefix.slice(0, -1));
  return join(packageRoot, ...file.path.split("/"));
}

export function platformRepairDiagnostic(error, coreVersion) {
  return {
    status: "degraded",
    code: typeof error?.code === "string" ? error.code : "platform.integrity_failed",
    packageVersion: coreVersion,
    reinstallCommand: `npm install agent-computer-use-mcp@${coreVersion}`,
    executesImmediately: false,
    networkAccessed: false,
    packageFilesModified: false,
  };
}

function runtimeTarget(platform, arch) {
  if (platform === WINDOWS_X64_TARGET.platform && arch === WINDOWS_X64_TARGET.arch) {
    return WINDOWS_X64_TARGET;
  }
  throw platformError("platform.unsupported", `${platform}-${arch}`);
}

function defaultPackageResolver(packageName) {
  const require = createRequire(import.meta.url);
  return () => require.resolve(`${packageName}/package.json`);
}

function validateComponents(components) {
  const expected = {
    cuaDriver: "cua-driver",
    overlay: "overlay",
    ocrRuntime: "ocr-runtime",
    ocrModels: "models/pp-ocr-v6",
  };
  for (const [name, path] of Object.entries(expected)) {
    if (components?.[name] !== path) throw platformError("platform.manifest_invalid", `components.${name}`);
  }
  return expected;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw platformError(code, path, cause);
  }
}

function arraysEqual(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

async function containsLinkedPath(path, lstat) {
  let current = resolve(path);
  while (true) {
    const entry = await lstat(current).catch(() => null);
    if (!entry || entry.isSymbolicLink()) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function sameFileIdentity(left, right, stat) {
  const [leftStat, rightStat] = await Promise.all([
    stat(left, { bigint: true }).catch(() => null),
    stat(right, { bigint: true }).catch(() => null),
  ]);
  return leftStat !== null && rightStat !== null
    && leftStat.dev === rightStat.dev
    && leftStat.ino === rightStat.ino;
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw platformError(code, String(value));
  return value;
}

function platformError(code, detail, cause) {
  const error = new Error(`${code}: ${detail}`, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}
