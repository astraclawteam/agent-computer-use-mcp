import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WINDOWS_X64_TARGET,
  createCoreOptionalDependencies,
  createPlatformPackageJson,
  platformPackageName,
  releaseAssetNames,
} from "../src/platform-package-contract.mjs";

test("core and Windows platform manifests use one exact release version", () => {
  assert.deepEqual(WINDOWS_X64_TARGET, {
    platform: "win32",
    arch: "x64",
    id: "windows-x64",
  });
  assert.equal(platformPackageName(WINDOWS_X64_TARGET), "@xiaozhiclaw/agent-computer-use-win32-x64");
  assert.deepEqual(createCoreOptionalDependencies("1.2.3"), {
    "@xiaozhiclaw/agent-computer-use-win32-x64": "1.2.3",
  });
  assert.deepEqual(createPlatformPackageJson({ version: "1.2.3" }), {
    name: "@xiaozhiclaw/agent-computer-use-win32-x64",
    version: "1.2.3",
    private: false,
    license: "MIT",
    os: ["win32"],
    cpu: ["x64"],
    files: [
      "cua-driver",
      "overlay",
      "ocr-runtime",
      "models",
      "platform-manifest.json",
      "THIRD_PARTY_LICENSES.txt",
      "SBOM.cdx.json",
    ],
  });
});

test("generated package contracts reject tags ranges and unsupported targets", () => {
  for (const version of ["latest", "^1.2.3", "1.2", "v1.2.3", "1.2.3 || 2.0.0"]) {
    assert.throws(() => createCoreOptionalDependencies(version), /platform\.version_invalid/);
  }
  assert.throws(
    () => platformPackageName({ platform: "linux", arch: "x64", id: "linux-x64" }),
    /platform\.unsupported_target/,
  );
});

test("release assets contain core platform complete ZIP checksums SBOM and manifest only", () => {
  assert.deepEqual(releaseAssetNames("1.2.3"), [
    "agent-computer-use-mcp-1.2.3.tgz",
    "agent-computer-use-win32-x64-1.2.3.tgz",
    "agent-computer-use-mcp-1.2.3-windows-x64.zip",
    "checksums.txt",
    "release-manifest.json",
    "SBOM.cdx.json",
  ]);
});
