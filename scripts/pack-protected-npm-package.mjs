import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateProtectedNpmEntries } from "../src/npm-release-policy.mjs";
import {
  DEFAULT_PROTECTED_NPM_ROOT,
  buildProtectedNpmPackage,
} from "./build-protected-npm-package.mjs";

export const DEFAULT_NPM_RELEASE_ROOT = resolve("artifacts/npm-release");

export async function packProtectedNpmPackage(options = {}) {
  const packageRoot = resolve(options.packageRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const releaseRoot = resolve(options.releaseRoot ?? DEFAULT_NPM_RELEASE_ROOT);
  const dryRun = options.dryRun === true;
  const build = await buildProtectedNpmPackage({ outputRoot: packageRoot });
  await mkdir(releaseRoot, { recursive: true });

  const npm = resolveNpmCli();
  const args = [
    ...npm.prefixArgs,
    "pack",
    packageRoot,
    "--json",
    "--pack-destination",
    releaseRoot,
  ];
  if (dryRun) args.push("--dry-run");
  const result = await runCommand(npm.command, args);
  if (result.exitCode !== 0) {
    throw new Error(`release.npm_pack_failed: ${result.stderr || result.stdout}`);
  }

  const packReport = JSON.parse(result.stdout)[0];
  const entries = packReport.files.map((file) => file.path);
  const inventory = validateProtectedNpmEntries(entries);
  if (inventory.status !== "passed") {
    throw new Error(`release.npm_inventory_failed: ${JSON.stringify(inventory.violations)}`);
  }

  const tarballPath = dryRun ? null : join(releaseRoot, packReport.filename);
  const tarballSha256 = tarballPath
    ? createHash("sha256").update(await readFile(tarballPath)).digest("hex")
    : null;
  return {
    status: "passed",
    packageName: packReport.name,
    packageVersion: packReport.version,
    filename: packReport.filename,
    tarballPath,
    tarballSha256,
    packedSize: packReport.size,
    unpackedSize: packReport.unpackedSize,
    entryCount: packReport.entryCount,
    inventory,
    protection: build.protection,
    sourceEntryCount: entries.filter(isSourceEntry).length,
    sourceMapCount: entries.filter((entry) => entry.endsWith(".map")).length,
    obfuscatedRuntimeCount: entries.filter((entry) => entry.startsWith("dist/") && entry.endsWith(".mjs")).length,
    dryRun,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function resolveNpmCli() {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }
  const adjacentCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(adjacentCli)) {
    return { command: process.execPath, prefixArgs: [adjacentCli] };
  }
  return {
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    prefixArgs: process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [],
  };
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function isSourceEntry(entry) {
  return /^(src|test|scripts|gateway-overlay|native-lab|ocr-sidecar)\//.test(entry)
    || /\.(?:cs|csproj|py|ts|tsx)$/.test(entry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await packProtectedNpmPackage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
