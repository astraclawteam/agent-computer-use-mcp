import { readFile } from "node:fs/promises";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SPDX_PATTERN = /^[A-Za-z0-9-.+]+$/;

export async function loadReleaseAssetLock(path) {
  const lock = JSON.parse(await readFile(path, "utf8"));
  const validation = validateReleaseAssetLock(lock);
  if (validation.status !== "passed") {
    const error = new Error(`release.asset_lock_invalid: ${JSON.stringify(validation.violations)}`);
    error.code = "release.asset_lock_invalid";
    error.violations = validation.violations;
    throw error;
  }
  return lock;
}

export function validateReleaseAssetLock(lock) {
  const violations = [];
  if (!lock || typeof lock !== "object") {
    return failed([{ code: "lock-invalid" }]);
  }
  if (lock.schemaVersion !== 1) violations.push({ code: "schema-version-unsupported" });
  if (lock.packageName !== "agent-computer-use-mcp") violations.push({ code: "package-name-invalid" });
  if (lock.platform !== "windows-x64") violations.push({ code: "platform-unsupported" });
  if (!Array.isArray(lock.assets) || lock.assets.length === 0) {
    violations.push({ code: "asset-list-empty" });
    return failed(violations);
  }

  const ids = new Set();
  for (const asset of lock.assets) {
    if (!nonEmpty(asset?.id)) {
      violations.push({ code: "asset-id-missing" });
    } else if (ids.has(asset.id)) {
      violations.push({ code: "duplicate-id", id: asset.id });
    } else {
      ids.add(asset.id);
    }
    if (!nonEmpty(asset?.kind)) violations.push({ code: "asset-kind-missing", id: asset?.id });
    if (!nonEmpty(asset?.version)) violations.push({ code: "asset-version-missing", id: asset?.id });
    validateSource(asset, violations);
    if (!nonEmpty(asset?.license?.spdx)
      || !SPDX_PATTERN.test(asset.license.spdx)
      || !validHttpsUrl(asset?.license?.sourceUrl)) {
      violations.push({ code: "asset-license-missing", id: asset?.id });
    }
    if (!nonEmpty(asset?.install?.role) || !nonEmpty(asset?.install?.fileName)) {
      violations.push({ code: "asset-install-role-missing", id: asset?.id });
    }
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    platform: lock.platform,
    assets: lock.assets,
    violations,
  };
}

function validateSource(asset, violations) {
  const source = asset?.source;
  let parsed;
  try {
    parsed = new URL(source?.url);
  } catch {
    violations.push({ code: "source-url-not-https", id: asset?.id });
    return;
  }
  if (parsed.protocol !== "https:") {
    violations.push({ code: "source-url-not-https", id: asset?.id });
  }
  if (parsed.username || parsed.password) {
    violations.push({ code: "source-url-has-credentials", id: asset?.id });
  }
  if (!HASH_PATTERN.test(source?.sha256 ?? "")) {
    violations.push({ code: "source-hash-invalid", id: asset?.id });
  }
  if (!Number.isSafeInteger(source?.sizeBytes) || source.sizeBytes <= 0) {
    violations.push({ code: "source-size-invalid", id: asset?.id });
  }
  if (!nonEmpty(source?.fileName)) {
    violations.push({ code: "source-file-name-missing", id: asset?.id });
  }
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function failed(violations) {
  return { status: "failed", platform: null, assets: [], violations };
}
