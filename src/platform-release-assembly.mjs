import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { releaseAssetNames } from "./platform-package-contract.mjs";
import { verifyPlatformInventory } from "./platform-payload-inventory.mjs";
import { createDeterministicZip } from "./windows-offline-bundle.mjs";

export async function assemblePlatformRelease(options = {}) {
  const version = required(options.version, "release.version_missing");
  const sourceCommit = required(options.sourceCommit, "release.commit_missing");
  const generatedAt = required(options.generatedAt, "release.generated_at_missing");
  const outputRoot = resolve(required(options.outputRoot, "release.output_root_missing"));
  const corePackageRoot = resolve(required(options.corePackageRoot, "release.core_package_missing"));
  const platformPackageRoot = resolve(required(options.platformPackageRoot, "release.platform_package_missing"));
  const installProductionDependencies = options.installProductionDependencies ?? defaultInstallProductionDependencies;
  const names = releaseAssetNames(version);
  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  const assetRoot = join(stageRoot, "assets");
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(assetRoot, { recursive: true });
    const coreTgz = await packPackage(corePackageRoot, assetRoot, names[0]);
    const platformTgz = await packPackage(platformPackageRoot, assetRoot, names[1]);

    const offlineName = `agent-computer-use-mcp-${version}-windows-x64`;
    const offlineRoot = join(stageRoot, "offline", offlineName);
    await cp(corePackageRoot, join(offlineRoot, "runtime", "core"), { recursive: true });
    await cp(platformPackageRoot, join(offlineRoot, "runtime", "platform"), { recursive: true });
    await mkdir(join(offlineRoot, "bin"), { recursive: true });
    await writeFile(
      join(offlineRoot, "bin", "agent-computer-use-mcp.mjs"),
      "#!/usr/bin/env node\nimport \"../runtime/core/dist/launcher.mjs\";\n",
      "utf8",
    );
    await installProductionDependencies(offlineRoot, { version, corePackageRoot, platformPackageRoot });
    await cp(join(platformPackageRoot, "platform-manifest.json"), join(offlineRoot, "platform-manifest.json"));
    await cp(join(platformPackageRoot, "THIRD_PARTY_LICENSES.txt"), join(offlineRoot, "THIRD_PARTY_LICENSES.txt"));
    await cp(join(platformPackageRoot, "SBOM.cdx.json"), join(offlineRoot, "SBOM.cdx.json"));
    await writeChecksums(join(offlineRoot, "checksums.txt"), offlineRoot);

    const inventoryComparison = await comparePlatformInventories(
      platformPackageRoot,
      join(offlineRoot, "runtime", "platform"),
    );
    const offlineZip = join(assetRoot, names[2]);
    await createDeterministicZip({
      sourceRoot: join(stageRoot, "offline"),
      outputPath: offlineZip,
      generatedAt,
    });

    const releaseSbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      metadata: {
        component: { type: "application", name: "agent-computer-use-mcp", version },
        timestamp: generatedAt,
      },
      components: [
        { type: "application", name: "agent-computer-use-mcp", version },
        { type: "application", name: "@agent-computer-use/win32-x64", version },
      ],
    };
    const sbomPath = join(assetRoot, names[5]);
    await writeJson(sbomPath, releaseSbom);
    const releaseManifest = {
      schemaVersion: 1,
      packageName: "agent-computer-use-mcp",
      version,
      tag: `v${version}`,
      sourceCommit,
      generatedAt,
      target: "windows-x64",
      platformInventory: inventoryComparison.files,
      artifacts: await Promise.all([
        [names[0], coreTgz],
        [names[1], platformTgz],
        [names[2], offlineZip],
        [names[5], sbomPath],
      ].map(async ([name, path]) => artifactIdentity(name, path))),
    };
    const manifestPath = join(assetRoot, names[4]);
    await writeJson(manifestPath, releaseManifest);
    const checksumsPath = join(assetRoot, names[3]);
    await writeChecksums(checksumsPath, assetRoot, new Set([names[3]]));

    const assets = await Promise.all(names.map(async (name) => artifactIdentity(name, join(assetRoot, name))));
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(assetRoot, outputRoot);
    return {
      status: "passed",
      outputRoot,
      assets: assets.map((asset) => ({ ...asset, path: join(outputRoot, asset.name) })),
      releaseManifest,
      inventoryComparison,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function comparePlatformInventories(leftRoot, rightRoot) {
  try {
    const leftManifest = JSON.parse(await readFile(join(leftRoot, "platform-manifest.json"), "utf8"));
    const rightManifest = JSON.parse(await readFile(join(rightRoot, "platform-manifest.json"), "utf8"));
    const left = await verifyPlatformInventory(leftRoot, leftManifest, {
      version: leftManifest.version,
      sourceCommit: leftManifest.sourceCommit,
      target: leftManifest.target,
    });
    const right = await verifyPlatformInventory(rightRoot, rightManifest, {
      version: leftManifest.version,
      sourceCommit: leftManifest.sourceCommit,
      target: leftManifest.target,
    });
    if (JSON.stringify(left.files) !== JSON.stringify(right.files)) {
      throw releaseError("release.platform_inventory_mismatch", "canonical inventories differ");
    }
    return { status: "identical", files: left.files };
  } catch (cause) {
    if (cause?.code === "release.platform_inventory_mismatch") throw cause;
    const error = releaseError("release.platform_inventory_mismatch", cause instanceof Error ? cause.message : String(cause));
    error.cause = cause;
    throw error;
  }
}

async function packPackage(packageRoot, destinationRoot, expectedName) {
  const result = await runCommand(resolveNpmCommand(), [
    ...resolveNpmPrefixArgs(),
    "pack",
    packageRoot,
    "--json",
    "--pack-destination",
    destinationRoot,
  ]);
  if (result.exitCode !== 0) throw releaseError("release.npm_pack_failed", result.stderr || result.stdout);
  const report = JSON.parse(result.stdout)[0];
  const source = join(destinationRoot, report.filename);
  const destination = join(destinationRoot, expectedName);
  if (resolve(source) !== resolve(destination)) await rename(source, destination);
  return destination;
}

async function defaultInstallProductionDependencies(offlineRoot) {
  const dependencyRoot = `${offlineRoot}.production-dependencies-${randomUUID()}`;
  try {
    await mkdir(dependencyRoot, { recursive: true });
    await cp("package.json", join(dependencyRoot, "package.json"));
    await cp("package-lock.json", join(dependencyRoot, "package-lock.json"));
    const cache = await runCommand(resolveNpmCommand(), [
      ...resolveNpmPrefixArgs(), "config", "get", "cache",
    ]);
    if (cache.exitCode !== 0 || cache.stdout.trim() === "") {
      throw releaseError("release.npm_cache_unavailable", cache.stderr || cache.stdout);
    }
    const install = await runCommand(resolveNpmCommand(), [
      ...resolveNpmPrefixArgs(),
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--cache", cache.stdout.trim(),
      "--prefix", dependencyRoot,
    ]);
    if (install.exitCode !== 0) throw releaseError("release.production_dependencies_failed", install.stderr || install.stdout);
    const { selectProductionRuntime } = await import("./release-runtime-selector.mjs");
    const { WINDOWS_X64_RELEASE_TARGET } = await import("./release-target.mjs");
    await selectProductionRuntime({ packageRoot: dependencyRoot, target: WINDOWS_X64_RELEASE_TARGET });
    for (const path of await listFiles(join(dependencyRoot, "node_modules"))) {
      if (path.endsWith(".map")) continue;
      const destination = join(offlineRoot, "node_modules", ...path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(dependencyRoot, "node_modules", ...path.split("/")), destination);
    }
  } finally {
    await rm(dependencyRoot, { recursive: true, force: true });
  }
}

async function writeChecksums(outputPath, root, excluded = new Set([relative(root, outputPath).replaceAll("\\", "/")])) {
  const files = (await listFiles(root)).filter((path) => !excluded.has(path));
  const lines = [];
  for (const path of files) lines.push(`${await sha256File(join(root, ...path.split("/")))}  ${path}`);
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function artifactIdentity(name, path) {
  const fileStat = await stat(path);
  return { name, path, sizeBytes: fileStat.size, sha256: await sha256File(path) };
}

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isSymbolicLink()) throw releaseError("release.link_forbidden", relative(root, fullPath));
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(relative(root, fullPath).replaceAll("\\", "/"));
      else throw releaseError("release.entry_type_forbidden", relative(root, fullPath));
    }
  }
  return files.sort();
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function resolveNpmCommand() {
  return process.platform === "win32" ? "cmd.exe" : "npm";
}

function resolveNpmPrefixArgs() {
  return process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [];
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, String(value));
  return value;
}

function releaseError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
