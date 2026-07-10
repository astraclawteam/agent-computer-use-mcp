import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { resolveActiveAssetEntryPoint } from "../src/active-asset-state.mjs";

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("active asset resolver returns a hash-verified entry point inside the product root", async () => {
  const fixture = await createActiveAssetFixture();

  const resolved = resolveActiveAssetEntryPoint("cua-driver-windows-x64", {
    programRoot: fixture.programRoot,
  });

  assert.equal(resolved, fixture.entryPoint);
});

test("active asset resolver fails closed for tampering and path escape", async () => {
  const fixture = await createActiveAssetFixture();
  await writeFile(fixture.entryPoint, "tampered", "utf8");
  assert.equal(resolveActiveAssetEntryPoint("cua-driver-windows-x64", {
    programRoot: fixture.programRoot,
  }), null);

  const escaped = join(fixture.root, "escaped.exe");
  await writeFile(escaped, "driver", "utf8");
  const state = JSON.parse(JSON.stringify(fixture.state));
  state.assets[0].root = fixture.root;
  state.assets[0].entryPoint = escaped;
  await writeFile(fixture.statePath, JSON.stringify(state), "utf8");
  assert.equal(resolveActiveAssetEntryPoint("cua-driver-windows-x64", {
    programRoot: fixture.programRoot,
  }), null);
});

test("active asset resolver rejects a linked asset root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-active-link-"));
  roots.push(root);
  const programRoot = join(root, "program");
  const outsideRoot = join(root, "outside");
  const outsideEntry = join(outsideRoot, "bin", "cua-driver.exe");
  const assetRoot = join(programRoot, "assets", "cua-driver-windows-x64", "0.7.1", "hash");
  const contents = Buffer.from("driver", "utf8");
  await mkdir(dirname(outsideEntry), { recursive: true });
  await writeFile(outsideEntry, contents);
  await mkdir(dirname(assetRoot), { recursive: true });
  await symlink(outsideRoot, assetRoot, process.platform === "win32" ? "junction" : "dir");
  const statePath = join(programRoot, "state", "asset-state.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    currentReleaseId: "assets-v1",
    assets: [{
      id: "cua-driver-windows-x64",
      root: assetRoot,
      entryPoint: join(assetRoot, "bin", "cua-driver.exe"),
      files: [{
        path: "bin/cua-driver.exe",
        sizeBytes: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      }],
    }],
  }), "utf8");

  assert.equal(resolveActiveAssetEntryPoint("cua-driver-windows-x64", { programRoot }), null);
});

async function createActiveAssetFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-active-asset-"));
  roots.push(root);
  const programRoot = join(root, "program");
  const assetRoot = join(programRoot, "assets", "cua-driver-windows-x64", "0.7.1", "hash");
  const entryPoint = join(assetRoot, "bin", "cua-driver.exe");
  const contents = Buffer.from("driver", "utf8");
  await mkdir(dirname(entryPoint), { recursive: true });
  await writeFile(entryPoint, contents);
  const state = {
    schemaVersion: 1,
    currentReleaseId: "assets-v1",
    previousReleaseId: null,
    revision: 1,
    assets: [{
      id: "cua-driver-windows-x64",
      version: "0.7.1",
      blobSha256: "0".repeat(64),
      root: assetRoot,
      entryPoint,
      files: [{
        path: "bin/cua-driver.exe",
        sizeBytes: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      }],
    }],
  };
  const statePath = join(programRoot, "state", "asset-state.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state), "utf8");
  return { root, programRoot, entryPoint, statePath, state };
}
