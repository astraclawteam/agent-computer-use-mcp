import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  WINDOWS_X64_ONNX_REQUIRED_FILES,
  selectProductionRuntime,
} from "../src/release-runtime-selector.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "../src/release-target.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows x64 runtime selection removes known foreign native targets", async () => {
  const fixture = await runtimeFixture();

  const report = await selectProductionRuntime({
    packageRoot: fixture.packageRoot,
    target: WINDOWS_X64_RELEASE_TARGET,
  });

  assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
  assert.equal(report.packageVersion, "1.27.0");
  assert.deepEqual(report.retainedNativeFiles, WINDOWS_X64_ONNX_REQUIRED_FILES);
  assert.equal(await exists(join(fixture.nativeRoot, "win32/x64/onnxruntime.dll")), true);
  assert.equal(await exists(join(fixture.nativeRoot, "win32/arm64")), false);
  assert.equal(await exists(join(fixture.nativeRoot, "linux")), false);
  assert.equal(await exists(join(fixture.nativeRoot, "darwin")), false);
  assert.ok(report.retainedNativeBytes > 0);
  assert.ok(report.removedNativeBytes > 0);
});

test("runtime selection rejects an unknown native target before pruning", async () => {
  const fixture = await runtimeFixture();
  await fixtureFile(join(fixture.nativeRoot, "freebsd/x64/onnxruntime.so"), "unknown");

  await assert.rejects(
    () => selectProductionRuntime({ packageRoot: fixture.packageRoot, target: WINDOWS_X64_RELEASE_TARGET }),
    (error) => error?.code === "release.runtime_layout_unsupported",
  );
  assert.equal(await exists(join(fixture.nativeRoot, "linux/x64/libonnxruntime.so.1")), true);
});

test("runtime selection rejects a missing required Windows x64 file", async () => {
  const fixture = await runtimeFixture();
  await rm(join(fixture.nativeRoot, "win32/x64/DirectML.dll"));

  await assert.rejects(
    () => selectProductionRuntime({ packageRoot: fixture.packageRoot, target: WINDOWS_X64_RELEASE_TARGET }),
    (error) => error?.code === "release.runtime_required_file_missing",
  );
});

test("runtime selection rejects an unsupported onnxruntime-node version", async () => {
  const fixture = await runtimeFixture({ version: "1.28.0" });

  await assert.rejects(
    () => selectProductionRuntime({ packageRoot: fixture.packageRoot, target: WINDOWS_X64_RELEASE_TARGET }),
    (error) => error?.code === "release.runtime_package_version_unsupported",
  );
});

test("runtime selection rejects linked entries under the native root", async (t) => {
  const fixture = await runtimeFixture();
  const external = join(fixture.root, "external-native");
  await mkdir(external, { recursive: true });
  try {
    await symlink(external, join(fixture.nativeRoot, "linked"), "junction");
  } catch (error) {
    if (error?.code === "EPERM") return t.skip("Windows symlink privilege is unavailable");
    throw error;
  }

  await assert.rejects(
    () => selectProductionRuntime({ packageRoot: fixture.packageRoot, target: WINDOWS_X64_RELEASE_TARGET }),
    (error) => error?.code === "release.runtime_link_forbidden",
  );
});

async function runtimeFixture({ version = "1.27.0" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-release-runtime-"));
  roots.push(root);
  const packageRoot = join(root, "package");
  const moduleRoot = join(packageRoot, "node_modules/onnxruntime-node");
  const nativeRoot = join(moduleRoot, "bin/napi-v6");
  await fixtureFile(join(moduleRoot, "package.json"), `${JSON.stringify({ name: "onnxruntime-node", version })}\n`);
  await fixtureFile(join(moduleRoot, "dist/index.js"), "export const runtime = true;\n");
  for (const fileName of WINDOWS_X64_ONNX_REQUIRED_FILES) {
    await fixtureFile(join(nativeRoot, "win32/x64", fileName), `win32-x64-${fileName}`);
  }
  await fixtureFile(join(nativeRoot, "win32/arm64/onnxruntime.dll"), "win32-arm64");
  await fixtureFile(join(nativeRoot, "linux/x64/libonnxruntime.so.1"), "linux-x64");
  await fixtureFile(join(nativeRoot, "linux/arm64/libonnxruntime.so.1"), "linux-arm64");
  await fixtureFile(join(nativeRoot, "darwin/arm64/libonnxruntime.1.dylib"), "darwin-arm64");
  return { root, packageRoot, moduleRoot, nativeRoot };
}

async function fixtureFile(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
