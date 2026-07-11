import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  platformRepairDiagnostic,
  resolveVerifiedPlatform,
} from "../src/platform-package-resolver.mjs";
import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("resolver returns native paths only after exact-version verification", async () => {
  const platformRoot = await platformFixture();
  const resolved = await resolveVerifiedPlatform({
    platform: "win32",
    arch: "x64",
    coreVersion: "1.2.3",
    resolvePackageJson: () => join(platformRoot, "package.json"),
    realpath,
  });

  assert.equal(resolved.packageName, "@agent-computer-use/win32-x64");
  assert.equal(resolved.packageRoot, platformRoot);
  assert.equal(resolved.manifest.version, "1.2.3");
  assert.equal(resolved.paths.cuaDriverRoot, join(platformRoot, "cua-driver"));
  assert.equal(resolved.paths.overlayRoot, join(platformRoot, "overlay"));
  assert.equal(resolved.paths.ocrRuntimeRoot, join(platformRoot, "ocr-runtime"));
  assert.equal(resolved.paths.ocrModelRoot, join(platformRoot, "models", "pp-ocr-v6"));
});

test("resolver accepts a Windows short-path alias for the same unlinked directory", async () => {
  const platformRoot = await platformFixture();
  const canonicalAlias = `${platformRoot}-canonical-alias`;
  const platformStat = await stat(platformRoot, { bigint: true });
  const resolved = await resolveVerifiedPlatform({
    platform: "win32",
    arch: "x64",
    coreVersion: "1.2.3",
    resolvePackageJson: () => join(platformRoot, "package.json"),
    realpath: async (path) => path === platformRoot ? canonicalAlias : realpath(path),
    lstat,
    stat: async (path, options) => path === canonicalAlias ? platformStat : stat(path, options),
  });

  assert.equal(resolved.packageRoot, platformRoot);
  assert.equal(resolved.status, "verified");
});

test("resolver rejects a linked ancestor even when realpath preserves its spelling", async () => {
  const platformRoot = await platformFixture();
  const linkedAncestor = dirname(platformRoot);
  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.3",
      resolvePackageJson: () => join(platformRoot, "package.json"),
      realpath,
      lstat: async (path) => path === linkedAncestor
        ? { isSymbolicLink: () => true }
        : lstat(path),
      stat,
    }),
    /platform\.linked_root/,
  );
});

test("resolver rejects a real Windows junction package root", { skip: process.platform !== "win32" }, async () => {
  const platformRoot = await platformFixture();
  const linkParent = await fixtureRoot();
  const linkedRoot = join(linkParent, "linked-platform");
  await symlink(platformRoot, linkedRoot, "junction");

  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.3",
      resolvePackageJson: () => join(linkedRoot, "package.json"),
      realpath,
      lstat,
      stat,
    }),
    /platform\.linked_root/,
  );
});

test("resolver fails closed on core and platform version mismatch", async () => {
  const platformRoot = await platformFixture();
  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.4",
      resolvePackageJson: () => join(platformRoot, "package.json"),
      realpath,
    }),
    /platform\.version_mismatch/,
  );
});

test("resolver rejects missing linked corrupt and unsupported platform packages", async () => {
  await assert.rejects(
    resolveVerifiedPlatform({ platform: "linux", arch: "x64", coreVersion: "1.2.3" }),
    /platform\.unsupported/,
  );
  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.3",
      resolvePackageJson: () => { throw Object.assign(new Error("missing"), { code: "MODULE_NOT_FOUND" }); },
    }),
    /platform\.package_missing/,
  );

  const linkedRoot = await platformFixture();
  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.3",
      resolvePackageJson: () => join(linkedRoot, "package.json"),
      realpath: async (path) => path === linkedRoot ? `${linkedRoot}-physical` : realpath(path),
    }),
    /platform\.linked_root/,
  );

  const corruptRoot = await platformFixture();
  await writeFile(join(corruptRoot, "cua-driver", "cua-driver.exe"), "changed");
  await assert.rejects(
    resolveVerifiedPlatform({
      platform: "win32",
      arch: "x64",
      coreVersion: "1.2.3",
      resolvePackageJson: () => join(corruptRoot, "package.json"),
      realpath,
    }),
    /platform\.integrity_failed/,
  );
});

test("platform repair diagnostic is read-only and pins the reinstall version", () => {
  const error = Object.assign(new Error("platform.package_missing"), { code: "platform.package_missing" });
  assert.deepEqual(platformRepairDiagnostic(error, "1.2.3"), {
    status: "degraded",
    code: "platform.package_missing",
    packageVersion: "1.2.3",
    reinstallCommand: "npm install agent-computer-use-mcp@1.2.3",
    executesImmediately: false,
    networkAccessed: false,
    packageFilesModified: false,
  });
});

async function platformFixture() {
  const root = await fixtureRoot();
  const outputRoot = join(root, "platform");
  await buildWindowsPlatformPackage({
    outputRoot,
    version: "1.2.3",
    sourceCommit: "a".repeat(40),
    materialize: async (stageRoot) => {
      await writeFixture(stageRoot, "cua-driver/cua-driver.exe", "driver");
      await writeFixture(stageRoot, "overlay/GatewayComputerUseOverlay.exe", "overlay");
      await writeFixture(stageRoot, "ocr-runtime/onnxruntime.dll", "runtime");
      await writeFixture(stageRoot, "models/pp-ocr-v6/det.onnx", "det");
    },
  });
  return outputRoot;
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-platform-resolver-"));
  roots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}
