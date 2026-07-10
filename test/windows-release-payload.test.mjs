import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  buildWindowsReleasePayload,
  expandVerifiedZip,
} from "../src/windows-release-payload.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows release payload contains portable protected runtime and native helpers", { timeout: 120_000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows release payload requires Windows");
  const root = await fixtureRoot();
  const nodeArchivePath = join(root, "node.zip");
  await createZip(nodeArchivePath, [
    { path: "node-v24.12.0-win-x64/node.exe", contents: "portable-node-fixture" },
    { path: "node-v24.12.0-win-x64/LICENSE", contents: "MIT fixture" },
    { path: "node-v24.12.0-win-x64/node_modules/npm/node_modules/dependency/index.ts", contents: "export {};" },
    { path: "node-v24.12.0-win-x64/node_modules/npm/node_modules/dependency/index.js.map", contents: "{}" },
  ]);

  const report = await buildWindowsReleasePayload({
    outputRoot: join(root, "output"),
    nodeArchivePath,
    generatedAt: "2026-07-10T00:00:00.000Z",
  });

  assert.equal(report.status, "ready");
  assert.equal(report.distributionStatus, "blocked_unsigned");
  assert.equal(report.sourceEntryCount, 0);
  assert.equal(report.sourceMapCount, 0);
  assert.equal(await exists(join(report.bundleRoot, "payload/runtime/node/node.exe")), true);
  assert.equal(await exists(join(report.bundleRoot, "payload/runtime/node/node_modules/npm/node_modules/dependency/index.ts")), false);
  assert.equal(await exists(join(report.bundleRoot, "payload/runtime/node/node_modules/npm/node_modules/dependency/index.js.map")), false);
  assert.equal(await exists(join(report.bundleRoot, "payload/package/dist/launcher.mjs")), true);
  assert.equal(await exists(join(report.bundleRoot, "payload/helpers/overlay/GatewayComputerUseOverlay.exe")), true);
  assert.equal(await exists(join(report.bundleRoot, "payload/bin/AgentComputerUse.Installer.exe")), true);

  const descriptor = JSON.parse(await readFile(
    join(report.bundleRoot, "payload/runtime-entrypoints.json"),
    "utf8",
  ));
  assert.deepEqual(descriptor.mcp, {
    command: "runtime/node/node.exe",
    args: ["package/dist/launcher.mjs"],
  });
  assert.equal(JSON.stringify(descriptor).includes(resolve(".")), false);
  assert.equal(report.files.some((file) => file.path.endsWith(".pdb")), false);
  assert.equal(report.files.some((file) => file.path.includes("node_modules/yaml/")), false);
});

test("verified ZIP expansion rejects path traversal before writing", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows ZIP expansion requires PowerShell");
  const root = await fixtureRoot();
  const archivePath = join(root, "unsafe.zip");
  await createZip(archivePath, [{ path: "../escape.txt", contents: "blocked" }]);

  await assert.rejects(
    () => expandVerifiedZip({ archivePath, destinationPath: join(root, "expanded") }),
    (error) => error?.code === "release.zip_entry_invalid",
  );
  assert.equal(await exists(join(root, "escape.txt")), false);
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-windows-payload-"));
  roots.push(root);
  return root;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createZip(outputPath, entries) {
  await mkdir(join(outputPath, ".."), { recursive: true });
  const script = [
    "Add-Type -AssemblyName System.IO.Compression",
    "$items=ConvertFrom-Json $env:AGENT_RELEASE_ZIP_ITEMS",
    "$stream=[IO.File]::Open($env:AGENT_RELEASE_ZIP_PATH,[IO.FileMode]::Create)",
    "$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)",
    "try { foreach($item in $items) { $entry=$zip.CreateEntry([string]$item.path); $target=$entry.Open(); try { $bytes=[Text.Encoding]::UTF8.GetBytes([string]$item.contents); $target.Write($bytes,0,$bytes.Length) } finally { $target.Dispose() } } } finally { $zip.Dispose(); $stream.Dispose() }",
  ].join("; ");
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    AGENT_RELEASE_ZIP_PATH: outputPath,
    AGENT_RELEASE_ZIP_ITEMS: JSON.stringify(entries),
  });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}
