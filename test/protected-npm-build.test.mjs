import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";

const fixtureRoots = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("protected npm build emits only release staging with no source maps", async () => {
  const outputRoot = await fixtureRoot();
  const report = await buildProtectedNpmPackage({ outputRoot });

  assert.equal(report.status, "passed");
  assert.equal(report.inventory.status, "passed");
  assert.deepEqual(report.inventory.violations, []);
  assert.equal(report.runtime.status, "passed");
  assert.deepEqual(report.runtime.violations, []);
  assert.deepEqual(report.runtimeFiles, [
    "dist/computer-use-mcp-server.mjs",
    "dist/ocr-sidecar.mjs",
  ]);
  assert.equal(report.protection.bundle, "esbuild@0.28.1");
  assert.equal(report.protection.obfuscator, "javascript-obfuscator@5.4.6");
  assert.equal(report.protection.minify, true);
  assert.equal(report.protection.sourceMap, false);
  assert.equal(report.protection.selfDefending, true);
  assert.equal(report.protection.identifierNamesGenerator, "hexadecimal");
  assert.equal(report.protection.stringArray, true);
  assert.equal(report.protection.stringArrayEncoding, "base64");
  assert.equal(report.protection.stringArrayThreshold, 0.75);
  assert.equal(report.protection.renameGlobals, false);
  assert.equal(report.protection.renameProperties, false);
  assert.equal(report.protection.controlFlowFlattening, false);
  assert.equal(report.protection.deadCodeInjection, false);
  assert.equal(report.protection.debugProtection, false);
});

test("maintainer package is non-publishable and pins build-only protection tools", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.scripts.prepublishOnly, "node scripts/block-source-publish.mjs");
  assert.equal(packageJson.scripts["release:npm:build"], "node scripts/build-protected-npm-package.mjs");
  assert.deepEqual(packageJson.devDependencies, {
    esbuild: "0.28.1",
    "javascript-obfuscator": "5.4.6",
    postject: "1.0.0-alpha.6",
    yaml: "2.9.0",
  });
});

test("protected npm staging package has a release-only manifest", async () => {
  const outputRoot = await fixtureRoot();
  await buildProtectedNpmPackage({ outputRoot });
  const packageJson = JSON.parse(await readFile(join(outputRoot, "package.json"), "utf8"));

  assert.equal(packageJson.name, "agent-computer-use-mcp");
  assert.equal(packageJson.version, "0.0.1");
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.bin, {
    "agent-computer-use-mcp": "dist/launcher.mjs",
  });
  assert.deepEqual(packageJson.files, [
    "dist",
    "release-integrity.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  assert.equal(Object.hasOwn(packageJson, "scripts"), false);
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  assert.deepEqual(packageJson.dependencies, {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "onnxruntime-node": "^1.27.0",
    "ppu-paddle-ocr": "^6.0.0",
  });
  assert.deepEqual(packageJson.optionalDependencies, {
    "@xiaozhiclaw/agent-computer-use-win32-x64": "0.0.1",
  });
  assert.equal(packageJson.files.some((entry) => /cua-driver|overlay|ocr-runtime|models/u.test(entry)), false);
});

test("protected runtime removes first-party module names and Source Map references", async () => {
  const outputRoot = await fixtureRoot();
  await buildProtectedNpmPackage({ outputRoot });
  const server = await readFile(join(outputRoot, "dist/computer-use-mcp-server.mjs"), "utf8");
  const sidecar = await readFile(join(outputRoot, "dist/ocr-sidecar.mjs"), "utf8");

  assert.equal(server.includes("closeAndExit"), false);
  assert.equal(server.includes("./computer-use-provider-router.mjs"), false);
  assert.equal(sidecar.includes("runRecognition"), false);
  assert.equal(server.includes("sourceMappingURL"), false);
  assert.equal(sidecar.includes("sourceMappingURL"), false);
  assert.equal(server.split(/\r?\n/).length <= 3, true);
  assert.equal(sidecar.split(/\r?\n/).length <= 3, true);
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-protected-npm-"));
  fixtureRoots.push(root);
  return root;
}
