import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  loadReleaseAssetLock,
  validateReleaseAssetLock,
} from "../src/release-asset-lock.mjs";

const LOCK_PATH = "release/windows-x64-assets.lock.json";

const EXPECTED_ASSETS = new Map([
  ["node-runtime-windows-x64", {
    version: "24.12.0",
    sizeBytes: 36_361_909,
    sha256: "9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812",
  }],
  ["cua-driver-windows-x64", {
    version: "0.7.1",
    sizeBytes: 7_762_316,
    sha256: "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab",
  }],
  ["ocr-model-pp-ocrv6-small-det", {
    version: "28fe5895c24fd108c19eb3e8479f4ab385fbfc62",
    sizeBytes: 9_880_512,
    sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
  }],
  ["ocr-model-pp-ocrv6-small-rec", {
    version: "b8f84f0b80c529de40b4fbb3544b84fa7233a513",
    sizeBytes: 21_159_378,
    sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
  }],
  ["ocr-model-pp-ocrv6-small-rec-metadata", {
    version: "b8f84f0b80c529de40b4fbb3544b84fa7233a513",
    sizeBytes: 150_579,
    sha256: "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1",
  }],
  ["webview2-evergreen-standalone-windows-x64", {
    version: "1.3.241.15",
    sizeBytes: 203_654_864,
    sha256: "3a08103bed8a3d9aefdfc9ac10a672ea69605163f2dcb08d76cfd3e0444511c9",
  }],
]);

test("Windows release asset lock pins exact real upstream bytes", async () => {
  const lock = await loadReleaseAssetLock(LOCK_PATH);

  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.packageName, "agent-computer-use-mcp");
  assert.equal(lock.platform, "windows-x64");
  assert.equal(lock.assets.length, EXPECTED_ASSETS.size);
  assert.deepEqual(new Set(lock.assets.map((asset) => asset.id)), new Set(EXPECTED_ASSETS.keys()));

  for (const asset of lock.assets) {
    const expected = EXPECTED_ASSETS.get(asset.id);
    assert.ok(expected, `unexpected asset: ${asset.id}`);
    assert.equal(asset.version, expected.version, asset.id);
    assert.equal(asset.source.sizeBytes, expected.sizeBytes, asset.id);
    assert.equal(asset.source.sha256, expected.sha256, asset.id);
    assert.match(asset.source.url, /^https:\/\/[^\s]+$/);
    assert.match(asset.license.spdx, /^[A-Za-z0-9-.+]+$/);
    assert.match(asset.license.sourceUrl, /^https:\/\/[^\s]+$/);
    assert.equal(typeof asset.install.role, "string");
    assert.notEqual(asset.install.role, "");
  }
});

test("release asset lock validation rejects mutable or unsafe identities", async () => {
  const valid = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  const cases = [
    ["duplicate-id", (lock) => lock.assets.push(structuredClone(lock.assets[0]))],
    ["source-url-not-https", (lock) => { lock.assets[0].source.url = "http://downloads.example.test/node.zip"; }],
    ["source-url-has-credentials", (lock) => { lock.assets[0].source.url = "https://user:secret@example.test/node.zip"; }],
    ["source-hash-invalid", (lock) => { lock.assets[0].source.sha256 = "latest"; }],
    ["source-size-invalid", (lock) => { lock.assets[0].source.sizeBytes = 0; }],
    ["asset-version-missing", (lock) => { lock.assets[0].version = ""; }],
    ["asset-license-missing", (lock) => { delete lock.assets[0].license; }],
    ["asset-install-role-missing", (lock) => { delete lock.assets[0].install.role; }],
    ["platform-unsupported", (lock) => { lock.platform = "windows-arm64"; }],
  ];

  for (const [code, mutate] of cases) {
    const lock = structuredClone(valid);
    mutate(lock);
    const result = validateReleaseAssetLock(lock);
    assert.equal(result.status, "failed", code);
    assert.ok(result.violations.some((violation) => violation.code === code), JSON.stringify(result.violations));
  }
});

test("release asset lock loader fails closed for an invalid lock", async () => {
  await assert.rejects(
    () => loadReleaseAssetLock(new URL("fixtures/invalid-release-assets.lock.json", import.meta.url)),
    (error) => error?.code === "release.asset_lock_invalid",
  );
});
