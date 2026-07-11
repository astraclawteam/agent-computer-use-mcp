import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  createPlatformInventory,
  verifyPlatformInventory,
} from "../src/platform-payload-inventory.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("platform inventory sorts and hashes every immutable payload file", async () => {
  const root = await fixtureRoot();
  await writeFixture(root, "models/pp-ocr-v6/rec.onnx", "recognition");
  await writeFixture(root, "cua-driver/driver.exe", "driver");

  const inventory = await createPlatformInventory(root, {
    version: "1.2.3",
    sourceCommit: "a".repeat(40),
    target: { platform: "win32", arch: "x64", id: "windows-x64" },
  });

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.version, "1.2.3");
  assert.equal(inventory.sourceCommit, "a".repeat(40));
  assert.deepEqual(inventory.files.map(({ path }) => path), [
    "cua-driver/driver.exe",
    "models/pp-ocr-v6/rec.onnx",
  ]);
  assert.match(inventory.files[0].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(inventory.files[0].sizeBytes, 6);
  assert.equal(inventory.files[0].mediaType, "application/vnd.microsoft.portable-executable");
});

test("platform inventory verification rejects missing extra and corrupt files", async () => {
  const root = await fixtureRoot();
  await writeFixture(root, "overlay/overlay.exe", "overlay");
  const inventory = await createPlatformInventory(root, fixtureMetadata());

  await writeFixture(root, "overlay/overlay.exe", "changed");
  await assert.rejects(verifyPlatformInventory(root, inventory), /platform\.integrity_failed/);

  await writeFixture(root, "overlay/overlay.exe", "overlay");
  await writeFixture(root, "overlay/unlisted.dll", "extra");
  await assert.rejects(verifyPlatformInventory(root, inventory), /platform\.inventory_extra/);
});

test("platform inventory rejects Windows case-fold collisions", async () => {
  const root = await fixtureRoot();
  await writeFixture(root, "models/model.onnx", "model");
  const inventory = await createPlatformInventory(root, fixtureMetadata());
  const collision = {
    ...inventory.files[0],
    path: "Models/MODEL.onnx",
  };

  await assert.rejects(
    verifyPlatformInventory(root, {
      ...inventory,
      files: [inventory.files[0], collision],
    }),
    /platform\.path_case_collision/,
  );
});

test("platform inventory rejects unsorted duplicate and wrong identity manifests", async () => {
  const root = await fixtureRoot();
  await writeFixture(root, "a.bin", "a");
  await writeFixture(root, "b.bin", "b");
  const inventory = await createPlatformInventory(root, fixtureMetadata());

  await assert.rejects(
    verifyPlatformInventory(root, { ...inventory, files: [...inventory.files].reverse() }),
    /platform\.manifest_unsorted/,
  );
  await assert.rejects(
    verifyPlatformInventory(root, { ...inventory, files: [inventory.files[0], inventory.files[0]] }),
    /platform\.manifest_duplicate/,
  );
  await assert.rejects(
    verifyPlatformInventory(root, { ...inventory, version: "1.2.4" }, { version: "1.2.3" }),
    /platform\.version_mismatch/,
  );
});

function fixtureMetadata() {
  return {
    version: "1.2.3",
    sourceCommit: "a".repeat(40),
    target: { platform: "win32", arch: "x64", id: "windows-x64" },
  };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-platform-inventory-"));
  roots.push(root);
  return root;
}

async function writeFixture(root, path, contents) {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, contents);
}
