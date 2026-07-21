import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const ENTRYPOINT = "bin/agent-computer-use-mcp.exe";
const PAYLOAD_ROOTS = ["bin", "driver", "licenses", "ocr", "overlay", "runtime"];
const RUNTIME_PACKAGE_NAMES = [
  "ppu-paddle-ocr",
  "ppu-ocv",
  "onnxruntime-node",
  "onnxruntime-common",
  "@napi-rs/canvas",
  "@napi-rs/canvas-win32-x64-msvc",
  "@techstark/opencv-js",
  "cross-spawn",
  "path-key",
  "shebang-command",
  "shebang-regex",
  "which",
  "isexe",
];
const RUNTIME_EXTERNALS = RUNTIME_PACKAGE_NAMES.flatMap((name) => [name, `${name}/*`]);

export async function buildWindowsSeaArtifact(options = {}) {
  const outputRoot = resolve(required(options.outputRoot, "sea.output_root_missing"));
  const version = required(options.version, "sea.version_missing");
  const sourceCommit = required(options.sourceCommit, "sea.source_commit_missing");
  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  const artifactRoot = join(stageRoot, "artifact");
  const platformRoot = join(stageRoot, "platform");
  const materializePlatform = options.materializePlatform ?? defaultMaterializePlatform;
  const buildRuntime = options.buildRuntime ?? defaultBuildRuntime;
  const buildExecutable = options.buildExecutable ?? defaultBuildExecutable;
  const archive = options.archive ?? defaultArchive;
  const archiveName = `agent-computer-use-mcp-${version}-win32-x64.tar.gz`;
  const archivePath = join(stageRoot, archiveName);

  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(artifactRoot, { recursive: true });
    await materializePlatform(platformRoot, options);
    await materializeNativeTree(platformRoot, artifactRoot);
    await buildRuntime(artifactRoot, options);
    await buildExecutable(artifactRoot, options);

    const manifest = {
      schemaVersion: 1,
      id: "agent-computer-use-mcp",
      version,
      sourceCommit,
      target: { platform: "win32", arch: "x64" },
      entrypoint: ENTRYPOINT,
      protocol: "stdio-mcp",
      startupNetworkAllowed: false,
      selfUpdateAllowed: false,
    };
    const inventory = { schemaVersion: 1, files: await payloadInventory(artifactRoot) };
    await writeJson(join(artifactRoot, "manifest.json"), manifest);
    await writeJson(join(artifactRoot, "inventory.json"), inventory);
    await writeFile(
      join(artifactRoot, "checksums.json"),
      `${JSON.stringify(Object.fromEntries(inventory.files.map((file) => [file.path, file.sha256])), null, 2)}\n`,
      "utf8",
    );
    await writeJson(join(artifactRoot, "sbom.cdx.json"), createSbom({ version, sourceCommit }));
    await verifyWindowsSeaArtifactTree(artifactRoot, inventory);
    await archive({ sourceRoot: stageRoot, artifactRoot, outputPath: archivePath });
    const archiveStat = await stat(archivePath);
    if (archiveStat.size >= MAX_ARCHIVE_BYTES) {
      throw seaError("sea.archive_too_large", `${archiveStat.size} >= ${MAX_ARCHIVE_BYTES}`);
    }

    const publisherInput = {
      id: "agent-computer-use-mcp",
      version,
      manifest: createHubManifest(),
      artifacts: [{
        path: archiveName,
        entrypoint: ENTRYPOINT,
        platform: "win32",
        arch: "x64",
        format: "tar.gz",
      }],
    };
    const publisherInputName = "hub-publisher-input.json";
    await writeJson(join(stageRoot, publisherInputName), publisherInput);

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
    return {
      status: "passed",
      outputRoot,
      artifactRoot: join(outputRoot, "artifact"),
      archivePath: join(outputRoot, archiveName),
      archiveSha256: await sha256File(join(outputRoot, archiveName)),
      archiveSizeBytes: archiveStat.size,
      publisherInputPath: join(outputRoot, publisherInputName),
      publisherInput,
      manifest,
      inventory,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function verifyWindowsSeaArtifactTree(artifactRoot, inventory) {
  const root = resolve(artifactRoot);
  if (!Array.isArray(inventory?.files) || inventory.files.length === 0) {
    throw seaError("sea.inventory_invalid", "files");
  }
  const foreignOnnxTarget = inventory.files.find(({ path }) => (
    /^runtime\/node_modules\/onnxruntime-node\/bin\/napi-v6\/(?!win32\/x64\/)/u.test(path)
  ));
  if (foreignOnnxTarget) throw seaError("sea.foreign_native_target", foreignOnnxTarget.path);
  for (const file of inventory.files) {
    const normalized = normalizeRelativePath(file.path);
    const fullPath = resolve(root, ...normalized.split("/"));
    if (!isWithin(root, fullPath)) throw seaError("sea.path_escape", normalized);
    const fileStat = await stat(fullPath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size !== file.sizeBytes || await sha256File(fullPath) !== file.sha256) {
      throw seaError("sea.integrity_mismatch", normalized);
    }
  }
  if (!inventory.files.some(({ path }) => path === ENTRYPOINT)) {
    throw seaError("sea.entrypoint_missing", ENTRYPOINT);
  }
  return { status: "verified", files: inventory.files.length };
}

async function defaultMaterializePlatform(platformRoot, options) {
  const { buildWindowsPlatformPackage } = await import("./windows-platform-package.mjs");
  await buildWindowsPlatformPackage({
    outputRoot: platformRoot,
    version: options.version,
    sourceCommit: options.sourceCommit,
    assetLockPath: options.assetLockPath,
    cacheRoot: options.cacheRoot,
    allowNetwork: options.allowNetwork === true,
  });
}

async function materializeNativeTree(platformRoot, artifactRoot) {
  const driverSourceRoot = dirname(await findNamedFile(join(platformRoot, "cua-driver"), "cua-driver.exe"));
  await Promise.all([
    cp(driverSourceRoot, join(artifactRoot, "driver"), { recursive: true }),
    cp(join(platformRoot, "overlay"), join(artifactRoot, "overlay"), { recursive: true }),
    cp(join(platformRoot, "ocr-runtime"), join(artifactRoot, "ocr", "runtime"), { recursive: true }),
    cp(join(platformRoot, "models", "pp-ocr-v6"), join(artifactRoot, "ocr", "models"), { recursive: true }),
  ]);
  await mkdir(join(artifactRoot, "licenses"), { recursive: true });
  await cp(
    join(platformRoot, "THIRD_PARTY_LICENSES.txt"),
    join(artifactRoot, "licenses", "THIRD_PARTY_LICENSES.txt"),
  );
}

async function findNamedFile(root, expectedName) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) {
      return join(root, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = await findNamedFile(join(root, entry.name), expectedName).catch(() => null);
    if (match) return match;
  }
  throw seaError("sea.driver_entrypoint_missing", expectedName);
}

async function defaultBuildRuntime(artifactRoot) {
  const esbuild = await import("esbuild");
  const runtimeRoot = join(artifactRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await esbuild.build({
    entryPoints: { server: "src/computer-use-mcp-server.mjs" },
    outdir: runtimeRoot,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    external: RUNTIME_EXTERNALS,
  });
  await esbuild.build({
    entryPoints: { "ocr-sidecar": "ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs" },
    outdir: runtimeRoot,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    external: RUNTIME_EXTERNALS,
  });
  await copyRuntimePackages(runtimeRoot);
}

async function copyRuntimePackages(runtimeRoot) {
  for (const packageName of RUNTIME_PACKAGE_NAMES) {
    const parts = packageName.split("/");
    const source = resolve("node_modules", ...parts);
    const destination = join(runtimeRoot, "node_modules", ...parts);
    const sourceStat = await stat(source).catch(() => null);
    if (!sourceStat?.isDirectory()) throw seaError("sea.runtime_package_missing", packageName);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      filter: (path) => shouldCopyRuntimePackagePath(source, path, packageName),
    });
  }
}

function shouldCopyRuntimePackagePath(sourceRoot, path, packageName) {
  if (/\\(?:test|tests|script|docs?)\\|\.(?:map|md|ts)$/iu.test(path)) return false;
  if (packageName !== "onnxruntime-node") return true;
  const packagePath = relative(sourceRoot, path).replaceAll("\\", "/");
  const nativeRoot = "bin/napi-v6";
  if (packagePath === nativeRoot) return true;
  if (!packagePath.startsWith(`${nativeRoot}/`)) return true;
  return packagePath === `${nativeRoot}/win32`
    || packagePath === `${nativeRoot}/win32/x64`
    || packagePath.startsWith(`${nativeRoot}/win32/x64/`);
}

async function defaultBuildExecutable(artifactRoot) {
  const workRoot = `${artifactRoot}.sea-${randomUUID()}`;
  try {
    await mkdir(workRoot, { recursive: true });
    const bootstrapPath = join(workRoot, "bootstrap.cjs");
    const blobPath = join(workRoot, "sea-prep.blob");
    const executablePath = join(artifactRoot, ...ENTRYPOINT.split("/"));
    const bootstrap = `
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const artifactRoot = path.resolve(path.dirname(process.execPath), "..");
const load = (name) => import(pathToFileURL(path.join(artifactRoot, "runtime", name)).href);
(async () => {
  if (process.argv[2] === "--ocr-sidecar") {
    const sidecar = await load("ocr-sidecar.js");
    await sidecar.runOcrSidecar({ command: process.argv[3] ?? "doctor" });
    return;
  }
  const server = await load("server.js");
  await server.main({
    platformRuntime: {
      paths: {
        cuaDriverExecutable: path.join(artifactRoot, "driver", "cua-driver.exe"),
        overlayExecutable: path.join(artifactRoot, "overlay", "GatewayComputerUseOverlay.exe"),
        ocrRuntimeRoot: path.join(artifactRoot, "ocr", "runtime"),
        ocrModelRoot: path.join(artifactRoot, "ocr", "models"),
      },
      ocrProcess: { command: process.execPath, args: [], sidecarPath: "--ocr-sidecar" },
    },
  });
})().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  process.exitCode = 1;
});
`;
    await writeFile(bootstrapPath, bootstrap.trimStart(), "utf8");
    await writeJson(join(workRoot, "sea-config.json"), {
      main: bootstrapPath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    });
    await execFileAsync(process.execPath, ["--experimental-sea-config", join(workRoot, "sea-config.json")], {
      cwd: process.cwd(), windowsHide: true,
    });
    await mkdir(dirname(executablePath), { recursive: true });
    await cp(process.execPath, executablePath);
    await execFileAsync(process.execPath, [
      resolve("node_modules/postject/dist/cli.js"),
      executablePath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ], { cwd: process.cwd(), windowsHide: true });
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function defaultArchive({ sourceRoot, outputPath }) {
  await execFileAsync("tar", ["--format=ustar", "-czf", basename(outputPath), "artifact"], {
    cwd: sourceRoot, windowsHide: true,
  });
}

async function payloadInventory(artifactRoot) {
  const files = [];
  for (const rootName of PAYLOAD_ROOTS) {
    const root = join(artifactRoot, rootName);
    if (!(await stat(root).catch(() => null))?.isDirectory()) throw seaError("sea.payload_missing", rootName);
    for (const path of await listFiles(root)) {
      const fullPath = join(root, ...path.split("/"));
      const fileStat = await stat(fullPath);
      files.push({
        path: `${rootName}/${path}`,
        sizeBytes: fileStat.size,
        sha256: await sha256File(fullPath),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function listFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isSymbolicLink()) throw seaError("sea.link_forbidden", relative(root, fullPath));
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) result.push(relative(root, fullPath).replaceAll("\\", "/"));
      else throw seaError("sea.entry_type_forbidden", relative(root, fullPath));
    }
  }
  return result.sort();
}

function createHubManifest() {
  return {
    schema_version: 16,
    kind: "executable",
    catalogOrigin: "xiaozhiclaw-first-party",
    name: "Computer Use",
    summary: "XiaozhiClaw Windows computer control through the standard MCP Host.",
    description: "Observe and control the local Windows desktop with approval, OCR, overlay exclusion, cancellation, and process cleanup.",
    launch: { kind: "artifact", args: [], env: {}, inputs: [] },
    declaredPermissions: ["desktop.control", "filesystem.write", "screen.capture"],
    requires: [],
  };
}

function createSbom({ version, sourceCommit }) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "agent-computer-use-mcp",
        version,
        properties: [{ name: "source.commit", value: sourceCommit }],
      },
    },
    components: [
      { type: "application", name: "cua-driver", version: "0.7.1" },
      { type: "library", name: "onnxruntime-node", version: "1.27.0" },
      { type: "library", name: "ppu-paddle-ocr", version: "6.0.0" },
      { type: "application", name: "GatewayComputerUseOverlay", version },
    ],
  };
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") throw seaError("sea.path_invalid", String(value));
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) throw seaError("sea.path_escape", value);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw seaError("sea.path_escape", value);
  }
  return segments.join("/");
}

function isWithin(root, path) {
  const prefix = `${root.toLowerCase()}\\`;
  return path.toLowerCase().startsWith(prefix);
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw seaError(code, String(value));
  return value;
}

function seaError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
