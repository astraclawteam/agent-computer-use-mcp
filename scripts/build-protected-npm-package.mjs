import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import JavaScriptObfuscator from "javascript-obfuscator";
import { build } from "esbuild";

import {
  validateProtectedNpmEntries,
  validateProtectedRuntime,
} from "../src/npm-release-policy.mjs";
import { assertBrowserKernelBoundaryInRoots } from "../src/browser-kernel-boundary.mjs";
import { createCoreOptionalDependencies } from "../src/platform-package-contract.mjs";

export const DEFAULT_PROTECTED_NPM_ROOT = resolve("artifacts/npm-release/package");

export const NPM_PROTECTION_PROFILE = Object.freeze({
  bundle: "esbuild@0.28.1",
  obfuscator: "javascript-obfuscator@5.4.6",
  minify: true,
  sourceMap: false,
  selfDefending: true,
  identifierNamesGenerator: "hexadecimal",
  stringArray: true,
  stringArrayEncoding: "base64",
  stringArrayThreshold: 0.75,
  renameGlobals: false,
  renameProperties: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
});

const RUNTIME_ENTRIES = Object.freeze([
  {
    source: "src/computer-use-mcp-server.mjs",
    target: "dist/computer-use-mcp-server.mjs",
  },
  {
    source: "ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs",
    target: "dist/ocr-sidecar.mjs",
  },
]);

export async function buildProtectedNpmPackage(options = {}) {
  const outputRoot = resolve(options.outputRoot ?? DEFAULT_PROTECTED_NPM_ROOT);
  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  await rm(stageRoot, { recursive: true, force: true });
  try {
    await mkdir(join(stageRoot, "dist"), { recursive: true });
    for (const entry of RUNTIME_ENTRIES) {
      const protectedCode = await buildProtectedRuntime(entry.source);
      const targetPath = join(stageRoot, entry.target);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, protectedCode, "utf8");
      await chmod(targetPath, 0o755);
    }

    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    await writeJson(join(stageRoot, "package.json"), createReleasePackageJson(packageJson));
    for (const file of ["LICENSE", "README.md", "CHANGELOG.md"]) {
      await copyFile(file, join(stageRoot, file));
    }

    const runtimeFiles = RUNTIME_ENTRIES.map((entry) => entry.target);
    const integrity = await createIntegrityManifest(stageRoot, packageJson, runtimeFiles);
    await writeJson(join(stageRoot, "release-integrity.json"), integrity);

    const launcher = await buildProtectedRuntime("scripts/npm-release-launcher-template.mjs");
    await writeFile(join(stageRoot, "dist/launcher.mjs"), launcher, "utf8");
    await chmod(join(stageRoot, "dist/launcher.mjs"), 0o755);

    await assertBrowserKernelBoundaryInRoots({
      roots: [
        ...RUNTIME_ENTRIES.map((entry) => entry.source),
        "scripts/npm-release-launcher-template.mjs",
        stageRoot,
      ],
      lockPath: "package-lock.json",
    });

    const runtime = validateProtectedRuntime({
      files: await Promise.all([
        "dist/launcher.mjs",
        ...runtimeFiles,
      ].map(async (path) => ({
        path,
        contents: await readFile(join(stageRoot, path), "utf8"),
      }))),
      protection: NPM_PROTECTION_PROFILE,
    });
    const inventory = validateProtectedNpmEntries(await listRelativeFiles(stageRoot));
    const status = runtime.status === "passed" && inventory.status === "passed"
      ? "passed"
      : "failed";
    if (status !== "passed") {
      throw new Error(`release.protected_build_failed: ${JSON.stringify({ runtime, inventory })}`);
    }

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
    return {
      status,
      packageRoot: outputRoot,
      runtimeFiles,
      protection: NPM_PROTECTION_PROFILE,
      integrity,
      runtime,
      inventory,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

async function buildProtectedRuntime(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    packages: "external",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    write: false,
    charset: "ascii",
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error(`release.bundle_output_missing: ${entryPoint}`);
  return obfuscateRuntime(output.text);
}

function obfuscateRuntime(source) {
  return JavaScriptObfuscator.obfuscate(source, {
    target: "node",
    compact: true,
    seed: 20260710,
    sourceMap: false,
    selfDefending: true,
    simplify: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    renameProperties: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode();
}

function createReleasePackageJson(packageJson) {
  return {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    license: packageJson.license,
    type: "module",
    private: false,
    repository: packageJson.repository,
    bugs: packageJson.bugs,
    homepage: packageJson.homepage,
    keywords: packageJson.keywords,
    engines: packageJson.engines,
    bin: {
      "agent-computer-use-mcp": "dist/launcher.mjs",
    },
    files: [
      "dist",
      "release-integrity.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
    ],
    dependencies: packageJson.dependencies,
    optionalDependencies: createCoreOptionalDependencies(packageJson.version),
    publishConfig: {
      access: "public",
      provenance: true,
    },
  };
}

async function createIntegrityManifest(packageRoot, packageJson, files) {
  return {
    schemaVersion: 1,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    protection: NPM_PROTECTION_PROFILE,
    files: await Promise.all(files.map(async (path) => {
      const fullPath = join(packageRoot, path);
      const contents = await readFile(fullPath);
      const fileStat = await stat(fullPath);
      return {
        path,
        bytes: fileStat.size,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    })),
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listRelativeFiles(root) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await buildProtectedNpmPackage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

