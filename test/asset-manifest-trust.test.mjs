import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  ensureWindowsInstallerBuilt,
  runWindowsInstaller,
} from "../src/windows-installer-host.mjs";
import {
  createSignedAssetFixture,
  driverAsset,
} from "./helpers/asset-fixture.mjs";

const fixtureRoots = [];

before(async () => {
  await ensureWindowsInstallerBuilt();
});

after(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("native installer verifies exact signed asset manifest bytes", async () => {
  const harness = await createHarness();
  const fixture = await createSignedAssetFixture({ root: harness.root });

  const result = await harness.verify(fixture);

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.equal(result.report.status, "verified");
  assert.equal(result.report.operation, "asset-verify-manifest");
  assert.equal(result.report.releaseId, fixture.manifest.releaseId);
  assert.equal(result.report.assetCount, 1);
  assert.match(result.report.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.startsDesktopControl, false);
  assert.equal(result.report.includeUserOverlay, false);
});

test("native installer rejects a manifest changed after signing", async () => {
  const harness = await createHarness();
  const fixture = await createSignedAssetFixture({ root: harness.root });
  await writeFile(fixture.manifestPath, `${await readFile(fixture.manifestPath, "utf8")} `, "utf8");

  const result = await harness.verify(fixture, 2);

  assert.equal(result.report.status, "failed");
  assert.equal(result.report.error.code, "asset.manifest_signature_invalid");
});

test("native installer rejects unknown keys and expired manifests", async () => {
  const harness = await createHarness();
  const unknownKey = await createSignedAssetFixture({
    root: harness.root,
    mutateSignature(envelope) {
      envelope.keyId = "not-in-keyring";
    },
  });
  const expired = await createSignedAssetFixture({
    root: harness.root,
    generatedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal((await harness.verify(unknownKey, 2)).report.error.code, "asset.manifest_key_unknown");
  assert.equal((await harness.verify(expired, 2)).report.error.code, "asset.manifest_expired");
});

test("native installer validates asset identity source and provenance", async () => {
  const harness = await createHarness();
  const cases = [
    {
      code: "asset.id_duplicate",
      options: { assets: [driverAsset(), driverAsset()] },
    },
    {
      code: "asset.source_forbidden",
      options: {
        assets: [driverAsset({
          source: {
            ...driverAsset().source,
            urls: ["https://user:secret@example.com/driver.zip"],
          },
        })],
      },
    },
    {
      code: "asset.source_forbidden",
      options: {
        assets: [driverAsset({
          source: {
            ...driverAsset().source,
            urls: ["http://example.com/driver.zip"],
          },
        })],
      },
    },
    {
      code: "asset.vendor_provenance_mismatch",
      options: {
        assets: [driverAsset({
          provenance: {
            ...driverAsset().provenance,
            upstreamSha256: "0".repeat(64),
          },
        })],
      },
    },
    {
      code: "asset.platform_unsupported",
      options: {
        assets: [driverAsset({ platform: { os: "win32", arch: "mips64" } })],
      },
    },
  ];

  for (const [index, item] of cases.entries()) {
    const fixture = await createSignedAssetFixture({
      root: harness.root,
      fixtureId: `invalid-${index}`,
      ...item.options,
    });
    const result = await harness.verify(fixture, 2);
    assert.equal(result.report.error.code, item.code);
  }
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-asset-trust-"));
  fixtureRoots.push(root);
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  return {
    root,
    async verify(fixture, expectedExitCode = 0) {
      const result = await runWindowsInstaller("asset-verify-manifest", {
        programRoot,
        dataRoot,
        manifestPath: fixture.manifestPath,
        signaturePath: fixture.signaturePath,
        keyringPath: fixture.keyringPath,
      });
      assert.equal(result.exitCode, expectedExitCode, result.stderr || result.stdout);
      return result;
    },
  };
}
