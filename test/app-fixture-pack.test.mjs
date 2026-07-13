import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  REQUIRED_FIXTURE_CATEGORIES,
  resolveFixturePack,
  validateFixturePackLock,
} from "../src/app-fixture-pack.mjs";

test("fixture pack verifies exact targets, sizes, hashes, and licenses", async (t) => {
  const fixture = await createFixturePack(t);
  const pack = await resolveFixturePack({ lock: fixture.lock, root: fixture.root });

  assert.equal(pack.status, "verified");
  assert.equal(pack.fixtures.length, REQUIRED_FIXTURE_CATEGORIES.length);
  assert.equal(pack.fixtures.every((entry) => entry.executable.sha256.length === 64), true);
  assert.equal(pack.fixtures.every((entry) => entry.license.spdx === "MIT"), true);
  assert.equal(JSON.stringify(pack).includes(fixture.root), false);
});

test("fixture pack rejects size and hash mismatches", async (t) => {
  const fixture = await createFixturePack(t);
  const wrongSize = structuredClone(fixture.lock);
  wrongSize.fixtures[0].executable.sizeBytes += 1;
  await assert.rejects(
    resolveFixturePack({ lock: wrongSize, root: fixture.root }),
    /app\.fixture_size_mismatch/u,
  );

  const wrongHash = structuredClone(fixture.lock);
  wrongHash.fixtures[0].executable.sha256 = "f".repeat(64);
  await assert.rejects(
    resolveFixturePack({ lock: wrongHash, root: fixture.root }),
    /app\.fixture_hash_mismatch/u,
  );
});

test("fixture lock rejects traversal, duplicate Windows paths, missing categories, and missing licenses", () => {
  const lock = validLockShape();
  lock.fixtures[0].executable.target = "../outside.exe";
  assert.throws(() => validateFixturePackLock(lock), /app\.fixture_target_unsafe/u);

  const duplicate = validLockShape();
  duplicate.fixtures[1].executable.target = duplicate.fixtures[0].executable.target.toUpperCase();
  assert.throws(() => validateFixturePackLock(duplicate), /app\.fixture_target_duplicate/u);

  const missingCategory = validLockShape();
  missingCategory.fixtures.pop();
  assert.throws(() => validateFixturePackLock(missingCategory), /app\.fixture_category_missing/u);

  const missingLicense = validLockShape();
  delete missingLicense.fixtures[0].license;
  assert.throws(() => validateFixturePackLock(missingLicense), /app\.fixture_license_required/u);
});

test("fixture pack rejects a junction or symlink anywhere in an asset path", async (t) => {
  const fixture = await createFixturePack(t);
  const outside = await mkdtemp(join(tmpdir(), "agent-computer-use-fixture-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const first = fixture.lock.fixtures[0];
  const linkedDirectory = join(fixture.root, first.category);
  await rm(linkedDirectory, { recursive: true, force: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "fixture.exe"), "fixture-wpf");
  await writeFile(join(outside, "LICENSE.txt"), "MIT fixture license");
  await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    resolveFixturePack({ lock: fixture.lock, root: fixture.root }),
    /app\.fixture_linked_path_forbidden/u,
  );
});

test("repository fixture lock names every category and fails closed while identities are pending", async () => {
  const lock = JSON.parse(await readFile("docs/productization/app-fixture-pack.lock.json", "utf8"));
  assert.deepEqual(new Set(lock.fixtures.map((entry) => entry.category)), new Set(REQUIRED_FIXTURE_CATEGORIES));
  assert.equal(lock.fixtures.every((entry) => entry.identityStatus === "pending"), true);
  assert.throws(() => validateFixturePackLock(lock), /app\.fixture_identity_pending/u);
});

async function createFixturePack(t) {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-fixture-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = [];
  for (const category of REQUIRED_FIXTURE_CATEGORIES) {
    const executableBytes = Buffer.from(`fixture-${category}`, "utf8");
    const licenseBytes = Buffer.from("MIT fixture license", "utf8");
    const executableTarget = `${category}/fixture.exe`;
    const licenseTarget = `${category}/LICENSE.txt`;
    await mkdir(dirname(join(root, executableTarget)), { recursive: true });
    await writeFile(join(root, executableTarget), executableBytes);
    await writeFile(join(root, licenseTarget), licenseBytes);
    fixtures.push({
      id: `fixture-${category}`,
      category,
      identityStatus: "locked",
      executable: identity(executableTarget, executableBytes),
      license: { spdx: "MIT", ...identity(licenseTarget, licenseBytes) },
    });
  }
  return {
    root,
    lock: {
      schemaVersion: 1,
      packId: "agent-computer-use-app-fixtures",
      version: "1.0.0-test",
      platform: "win32-x64",
      fixtures,
    },
  };
}

function validLockShape() {
  return {
    schemaVersion: 1,
    packId: "agent-computer-use-app-fixtures",
    version: "1.0.0-test",
    platform: "win32-x64",
    fixtures: REQUIRED_FIXTURE_CATEGORIES.map((category) => ({
      id: `fixture-${category}`,
      category,
      identityStatus: "locked",
      executable: { target: `${category}/fixture.exe`, sizeBytes: 1, sha256: "a".repeat(64) },
      license: { target: `${category}/LICENSE.txt`, sizeBytes: 1, sha256: "b".repeat(64), spdx: "MIT" },
    })),
  };
}

function identity(target, bytes) {
  return {
    target,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
