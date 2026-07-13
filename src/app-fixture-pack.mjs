import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export const REQUIRED_FIXTURE_CATEGORIES = Object.freeze([
  "wpf",
  "qt",
  "skia-imgui",
  "cad-like",
  "timeline",
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SPDX_PATTERN = /^[A-Za-z0-9-.+]+$/u;

export async function resolveFixturePack(options = {}) {
  const lock = validateFixturePackLock(options.lock);
  const root = resolve(options.root ?? process.env.AGENT_COMPUTER_USE_FIXTURE_PACK
    ?? "artifacts/app-fixtures/current");
  const physicalRoot = await realpath(root).catch(() => {
    throw fixtureError("app.fixture_pack_missing");
  });
  await assertNoLinkedPath(root, "", options.lstat ?? lstat);

  const fixtures = [];
  for (const fixture of lock.fixtures) {
    const executable = await verifyLockedFile({
      root,
      physicalRoot,
      identity: fixture.executable,
      lstat: options.lstat ?? lstat,
      realpath: options.realpath ?? realpath,
    });
    const license = await verifyLockedFile({
      root,
      physicalRoot,
      identity: fixture.license,
      lstat: options.lstat ?? lstat,
      realpath: options.realpath ?? realpath,
    });
    fixtures.push(Object.freeze({
      id: fixture.id,
      category: fixture.category,
      executable,
      license: Object.freeze({ ...license, spdx: fixture.license.spdx }),
    }));
  }

  return Object.freeze({
    status: "verified",
    schemaVersion: 1,
    packId: lock.packId,
    version: lock.version,
    platform: lock.platform,
    fixtures: Object.freeze(fixtures),
  });
}

export function validateFixturePackLock(lock) {
  if (!isRecord(lock) || lock.schemaVersion !== 1) {
    throw fixtureError("app.fixture_lock_schema_unsupported");
  }
  requiredString(lock.packId, "app.fixture_pack_id_required");
  requiredString(lock.version, "app.fixture_pack_version_required");
  if (lock.platform !== "win32-x64") throw fixtureError("app.fixture_platform_unsupported");
  if (!Array.isArray(lock.fixtures)) throw fixtureError("app.fixture_list_required");

  const categories = new Set();
  const ids = new Set();
  const targets = new Set();
  for (const fixture of lock.fixtures) {
    if (!isRecord(fixture)) throw fixtureError("app.fixture_entry_invalid");
    const id = requiredString(fixture.id, "app.fixture_id_required");
    const category = requiredString(fixture.category, "app.fixture_category_required");
    if (ids.has(id)) throw fixtureError("app.fixture_id_duplicate", id);
    if (categories.has(category)) throw fixtureError("app.fixture_category_duplicate", category);
    ids.add(id);
    categories.add(category);
    if (fixture.identityStatus !== "locked") {
      throw fixtureError("app.fixture_identity_pending", id);
    }
    validateIdentity(fixture.executable, "app.fixture_executable_required", targets);
    if (!isRecord(fixture.license) || !SPDX_PATTERN.test(fixture.license.spdx ?? "")) {
      throw fixtureError("app.fixture_license_required", id);
    }
    validateIdentity(fixture.license, "app.fixture_license_required", targets);
  }
  for (const category of REQUIRED_FIXTURE_CATEGORIES) {
    if (!categories.has(category)) throw fixtureError("app.fixture_category_missing", category);
  }
  if (categories.size !== REQUIRED_FIXTURE_CATEGORIES.length) {
    throw fixtureError("app.fixture_category_unknown");
  }
  return Object.freeze({ ...lock, fixtures: Object.freeze([...lock.fixtures]) });
}

async function verifyLockedFile({ root, physicalRoot, identity, lstat: lstatFile, realpath: realpathFile }) {
  await assertNoLinkedPath(root, identity.target, lstatFile);
  const fullPath = join(root, ...identity.target.split("/"));
  const fileStat = await lstatFile(fullPath).catch(() => null);
  if (!fileStat?.isFile()) throw fixtureError("app.fixture_file_missing", identity.target);
  if (fileStat.isSymbolicLink()) throw fixtureError("app.fixture_linked_path_forbidden", identity.target);
  const physicalPath = await realpathFile(fullPath).catch(() => null);
  if (!physicalPath || !isWithinRoot(physicalRoot, physicalPath)) {
    throw fixtureError("app.fixture_path_escape", identity.target);
  }
  if (fileStat.size !== identity.sizeBytes) {
    throw fixtureError("app.fixture_size_mismatch", identity.target);
  }
  const sha256 = await sha256File(fullPath);
  if (sha256 !== identity.sha256) throw fixtureError("app.fixture_hash_mismatch", identity.target);
  return Object.freeze({ target: identity.target, sizeBytes: fileStat.size, sha256 });
}

async function assertNoLinkedPath(root, target, lstatFile) {
  const segments = target === "" ? [] : target.split("/");
  let current = root;
  const rootStat = await lstatFile(current).catch(() => null);
  if (!rootStat) throw fixtureError("app.fixture_pack_missing");
  if (rootStat.isSymbolicLink()) throw fixtureError("app.fixture_linked_path_forbidden");
  for (const segment of segments) {
    current = join(current, segment);
    const entry = await lstatFile(current).catch(() => null);
    if (!entry) break;
    if (entry.isSymbolicLink()) throw fixtureError("app.fixture_linked_path_forbidden", target);
  }
}

function validateIdentity(identity, missingCode, targets) {
  if (!isRecord(identity)) throw fixtureError(missingCode);
  const target = requiredString(identity.target, missingCode);
  if (isUnsafeTarget(target)) throw fixtureError("app.fixture_target_unsafe", target);
  const key = target.toLowerCase();
  if (targets.has(key)) throw fixtureError("app.fixture_target_duplicate", target);
  targets.add(key);
  if (!Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes <= 0
    || !HASH_PATTERN.test(identity.sha256 ?? "")) {
    throw fixtureError("app.fixture_identity_invalid", target);
  }
}

function isUnsafeTarget(target) {
  return target.includes("\\")
    || target.startsWith("/")
    || /^[A-Za-z]:/u.test(target)
    || target.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[\0\r\n]/u.test(target);
}

function isWithinRoot(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (process.platform === "win32") {
    return normalizedCandidate.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}${sep}`);
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw fixtureError(code);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fixtureError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
