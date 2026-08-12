import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildWindowsSeaArtifact,
  pruneOnnxRuntimeNativeTargets,
  verifyWindowsSeaArtifactTree,
} from "../src/windows-sea-artifact.mjs";

test("builds one Runtime-compatible win32-x64 artifact rooted at artifact/", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-sea-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await buildWindowsSeaArtifact({
    outputRoot: join(root, "out"),
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    materializePlatform: async (platformRoot) => {
      for (const path of ["cua-driver", "overlay", "ocr-runtime", "models/pp-ocr-v6"]) {
        await mkdir(join(platformRoot, path), { recursive: true });
      }
      await mkdir(join(platformRoot, "cua-driver", "cua-driver-rs-0.7.1-windows-x86_64"), { recursive: true });
      await writeFile(
        join(platformRoot, "cua-driver", "cua-driver-rs-0.7.1-windows-x86_64", "cua-driver.exe"),
        "driver",
      );
      await writeFile(join(platformRoot, "overlay", "GatewayComputerUseOverlay.exe"), "overlay");
      await writeFile(join(platformRoot, "ocr-runtime", "onnxruntime.dll"), "ort");
      await writeFile(join(platformRoot, "models", "pp-ocr-v6", "det.onnx"), "model");
      await writeFile(join(platformRoot, "THIRD_PARTY_LICENSES.txt"), "MIT\n");
    },
    buildRuntime: async (artifactRoot) => {
      await mkdir(join(artifactRoot, "runtime"), { recursive: true });
      await writeFile(join(artifactRoot, "runtime", "server.mjs"), "export const main = async () => {};\n");
      await writeFile(join(artifactRoot, "runtime", "ocr-sidecar.mjs"), "export const runOcrSidecar = async () => {};\n");
    },
    buildExecutable: async (artifactRoot) => {
      await mkdir(join(artifactRoot, "bin"), { recursive: true });
      await writeFile(join(artifactRoot, "bin", "agent-computer-use-mcp.exe"), "MZfixture");
    },
    archive: async ({ outputPath }) => writeFile(outputPath, "archive-fixture"),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.publisherInput.id, "agent-computer-use-mcp");
  assert.equal(result.publisherInput.artifacts[0].entrypoint, "bin/agent-computer-use-mcp.exe");
  assert.equal(result.publisherInput.artifacts[0].platform, "win32");
  assert.equal(result.publisherInput.artifacts[0].arch, "x64");
  assert.equal(result.publisherInput.artifacts[0].format, "tar.gz");
  assert.equal(
    result.publisherInput.manifest.summary,
    "Windows computer control for any standard stdio MCP Host.",
  );
  assert.match(result.publisherInput.manifest.description, /Any MCP Host can download/);
  assert.match(
    result.publisherInput.manifest.description,
    /https:\/\/github\.com\/astraclawteam\/agent-computer-use-mcp\/releases\/latest/,
  );
  assert.match(result.publisherInput.manifest.description, /bin\/agent-computer-use-mcp\.exe/);
  assert.doesNotMatch(result.publisherInput.manifest.summary, /AstraClaw|XiaozhiClaw/);
  assert.deepEqual(result.publisherInput.manifest.launch, {
    kind: "artifact",
    args: [],
    env: {},
    inputs: [],
  });
  assert.deepEqual(result.publisherInput.manifest.requires, []);
  assert.deepEqual(result.publisherInput.manifest.branding, {
    iconUrl: "https://xiaozhi.qlogicagent.com/assets/skills/mcp-computer-use.svg",
    color: "#4F46E5",
    vendor: "AstraClaw",
  });
  assert.deepEqual(result.manifest.target, { platform: "win32", arch: "x64" });
  assert.equal(result.inventory.files.some(({ path }) => path === "bin/agent-computer-use-mcp.exe"), true);
  assert.equal(result.inventory.files.some(({ path }) => path.startsWith("driver/")), true);
  assert.equal(result.inventory.files.some(({ path }) => path === "driver/cua-driver.exe"), true);
  assert.equal(result.inventory.files.some(({ path }) => path.startsWith("ocr/")), true);
  assert.equal(result.inventory.files.some(({ path }) => path.startsWith("overlay/")), true);
  assert.equal(result.inventory.files.some(({ path }) => path.startsWith("runtime/")), true);
  assert.equal(JSON.parse(await readFile(result.publisherInputPath, "utf8")).version, "0.0.1");
});

test("artifact tree verification rejects tampering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-sea-tamper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(join(root, "bin", "agent-computer-use-mcp.exe"), "first");
  const inventory = {
    files: [{ path: "bin/agent-computer-use-mcp.exe", sizeBytes: 5, sha256: "a".repeat(64) }],
  };
  await assert.rejects(verifyWindowsSeaArtifactTree(root, inventory), /checksum|integrity/i);
});

test("Windows SEA verification rejects foreign ONNX native targets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-sea-foreign-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = "runtime/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node";
  await assert.rejects(verifyWindowsSeaArtifactTree(root, {
    files: [{ path, sizeBytes: 1, sha256: "a".repeat(64) }],
  }), /foreign.*native|native.*target/i);
});

test("ONNX runtime pruning retains only the Windows x64 native target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-sea-onnx-prune-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const target of ["darwin/arm64", "linux/x64", "win32/arm64", "win32/x64"]) {
    const targetRoot = join(root, "bin", "napi-v6", ...target.split("/"));
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(targetRoot, "onnxruntime.native"), target);
  }

  await pruneOnnxRuntimeNativeTargets(root);

  assert.equal(
    await readFile(join(root, "bin", "napi-v6", "win32", "x64", "onnxruntime.native"), "utf8"),
    "win32/x64",
  );
  for (const target of ["darwin/arm64", "linux/x64", "win32/arm64"]) {
    await assert.rejects(
      readFile(join(root, "bin", "napi-v6", ...target.split("/"), "onnxruntime.native"), "utf8"),
      { code: "ENOENT" },
    );
  }
});
