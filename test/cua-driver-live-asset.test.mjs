import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("live cua-driver asset contract pins official release identity and hashes", async () => {
  const {
    OFFICIAL_CUA_DRIVER_WINDOWS_X64,
    buildOfficialCuaDriverManifest,
  } = await import("../src/cua-driver-live-asset.mjs");

  assert.equal(OFFICIAL_CUA_DRIVER_WINDOWS_X64.version, "0.7.1");
  assert.equal(OFFICIAL_CUA_DRIVER_WINDOWS_X64.sizeBytes, 7762316);
  assert.equal(
    OFFICIAL_CUA_DRIVER_WINDOWS_X64.sha256,
    "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab",
  );
  assert.equal(OFFICIAL_CUA_DRIVER_WINDOWS_X64.files.length, 2);
  assert.deepEqual(
    OFFICIAL_CUA_DRIVER_WINDOWS_X64.files.map((file) => [file.installPath, file.sizeBytes, file.sha256]),
    [
      ["bin/cua-driver.exe", 11498496, "6ee5565a36692ee4f4413bbd7336c390d28c7cbdf5c2ec7428024a2e719a54f7"],
      ["bin/cua-driver-uia.exe", 7640576, "c6e6748f05fa74e68abbea53b8e8eff1fa981ab7085104f746dfb27a16baa5cd"],
    ],
  );

  const manifest = buildOfficialCuaDriverManifest({
    generatedAt: "2026-07-10T00:00:00.000Z",
    expiresAt: "2026-07-11T00:00:00.000Z",
    keyId: "live-test-key",
  });
  assert.equal(manifest.developmentOnly, true);
  assert.equal(manifest.assets[0].authenticode.mode, "vendor-unsigned");
  assert.equal(manifest.assets[0].provenance.repository, "trycua/cua");
  assert.equal(manifest.assets[0].provenance.upstreamSha256, OFFICIAL_CUA_DRIVER_WINDOWS_X64.sha256);
});

test("cua-driver acquisition occurs only inside the Windows SEA build", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(Object.hasOwn(packageJson.scripts, "assets:live:cua-driver"), false);
  assert.equal(packageJson.scripts["artifact:windows:build"], "node scripts/build-windows-sea-artifact.mjs");
  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith("release:npm:")), false);
});
