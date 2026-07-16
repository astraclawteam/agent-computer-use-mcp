import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_PACKAGES = new Set([
  "agent-computer-use-mcp",
  "@xiaozhiclaw/agent-computer-use-win32-x64",
]);
const REGISTRY = "https://registry.npmjs.org/";

export async function runNpmPackageRelease(args, operations = createNpmReleaseOperations()) {
  const options = parseArgs(args);
  const inspected = await operations.inspect(options.packagePath);
  if (!PUBLIC_PACKAGES.has(inspected.name)) {
    throw new Error(`release.package_unexpected: ${inspected.name}`);
  }
  if (typeof inspected.version !== "string" || inspected.version.length === 0) {
    throw new Error("release.version_missing");
  }

  const registryVersion = await operations.registryVersion(inspected.name, inspected.version);
  const base = {
    packageName: inspected.name,
    packageVersion: inspected.version,
    packagePath: options.packagePath,
    publishRequested: options.publish,
  };
  if (registryVersion === inspected.version) {
    return { ...base, status: "already-published" };
  }
  if (registryVersion !== null) {
    throw new Error(`release.registry_identity_invalid: ${registryVersion}`);
  }
  if (!options.publish) return { ...base, status: "ready" };

  await operations.publish(options.packagePath);
  return { ...base, status: "published" };
}

function parseArgs(args) {
  let packagePath;
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--package") {
      if (packagePath !== undefined) throw new Error("release.package_repeated");
      packagePath = args[++index];
      if (!packagePath) throw new Error("release.package_required");
    } else if (value === "--publish") {
      publish = true;
    } else {
      throw new Error(`release.argument_unknown: ${value}`);
    }
  }
  if (!packagePath) throw new Error("release.package_required");
  if (!packagePath.endsWith(".tgz")) throw new Error("release.package_tarball_required");
  return { packagePath: resolve(packagePath), publish };
}

export function createNpmReleaseOperations(run = runNpm) {
  return {
    async inspect(packagePath) {
      const result = await run([
        "pack",
        packagePath,
        "--dry-run",
        "--json",
      ]);
      if (result.exitCode !== 0) throw commandError("release.package_preflight_failed", result);
      const [report] = JSON.parse(result.stdout);
      return { name: report.name, version: report.version };
    },
    async registryVersion(name, version) {
      const result = await run([
        "view",
        `${name}@${version}`,
        "version",
        "--json",
        "--registry",
        REGISTRY,
      ]);
      if (result.exitCode === 0) return JSON.parse(result.stdout);
      if (/\bE404\b|404 Not Found/iu.test(result.stderr)) return null;
      throw commandError("release.registry_preflight_failed", result);
    },
    async publish(packagePath) {
      const result = await run([
        "publish",
        packagePath,
        "--access",
        "public",
        "--ignore-scripts",
        "--registry",
        REGISTRY,
      ]);
      if (result.exitCode !== 0) throw commandError("release.publish_failed", result);
    },
  };
}

function runNpm(args) {
  const npm = resolveNpmCli();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npm.command, [...npm.prefixArgs, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
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

function commandError(code, result) {
  return new Error(`${code}: ${(result.stderr || result.stdout).trim()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runNpmPackageRelease(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
