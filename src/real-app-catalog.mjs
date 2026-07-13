const REAL_APP_ROLES = Object.freeze([
  "required-fixture",
  "installed-evidence",
  "policy-only",
]);

export const REAL_APP_RESULT_STATUSES = Object.freeze([
  "pass",
  "product-failure",
  "insufficient-perception",
  "policy-blocked",
  "not-installed",
  "infrastructure-error",
]);

const PRIVACY_CLASSES = new Set([
  "generated-temporary-document",
  "public-fixture",
  "private-window-policy",
  "dangerous-surface-policy",
]);

export function parseRealAppCatalog(value) {
  if (!isRecord(value) || value.schemaVersion !== 2) {
    fail("app.catalog_schema_unsupported");
  }
  if (!Array.isArray(value.apps)) fail("app.catalog_apps_required");

  const appIds = new Set();
  const requiredCategories = new Set();
  const apps = value.apps.map((entry, index) => {
    if (!isRecord(entry)) fail("app.catalog_entry_invalid", { index });
    const appId = requiredString(entry.appId, "app.catalog_app_id_required");
    const role = requiredString(entry.role, "app.catalog_role_required", appId);
    if (!REAL_APP_ROLES.includes(role)) fail("app.catalog_role_invalid", appId);
    if (appIds.has(appId)) fail("app.catalog_app_id_duplicate", appId);
    appIds.add(appId);
    if (Object.hasOwn(entry, "required")) fail("app.catalog_required_flag_forbidden", appId);

    const expectedStatus = requiredString(
      entry.expectedStatus,
      "app.catalog_expected_status_required",
      appId,
    );
    if (!REAL_APP_RESULT_STATUSES.includes(expectedStatus)) {
      fail("app.catalog_expected_status_invalid", appId);
    }

    const requiredCategory = entry.requiredCategory;
    if (role === "required-fixture") {
      requiredString(requiredCategory, "app.catalog_required_category_required", appId);
      if (requiredCategories.has(requiredCategory)) {
        fail("app.catalog_required_category_duplicate", appId);
      }
      requiredCategories.add(requiredCategory);
      if (expectedStatus !== "pass") fail("app.catalog_required_fixture_must_pass", appId);
    } else if (requiredCategory !== null) {
      fail("app.catalog_required_category_forbidden", appId);
    }

    if (role === "policy-only" && expectedStatus !== "policy-blocked") {
      fail("app.catalog_policy_status_invalid", appId);
    }
    if (role !== "policy-only" && expectedStatus === "policy-blocked") {
      fail("app.catalog_policy_role_required", appId);
    }

    const privacyClass = requiredString(
      entry.privacyClass,
      "app.catalog_privacy_class_required",
      appId,
    );
    if (!PRIVACY_CLASSES.has(privacyClass)) fail("app.catalog_privacy_class_invalid", appId);
    if (role === "policy-only" && !privacyClass.endsWith("-policy")) {
      fail("app.catalog_policy_privacy_class_invalid", appId);
    }

    if (!Array.isArray(entry.executableCandidates) || entry.executableCandidates.length === 0) {
      fail("app.catalog_executable_candidates_required", appId);
    }
    const candidateKeys = new Set();
    const executableCandidates = entry.executableCandidates.map((candidate) => {
      const portableCandidate = requiredString(
        candidate,
        "app.catalog_executable_candidate_invalid",
        appId,
      );
      if (isUnsafeCandidate(portableCandidate)) {
        fail("app.catalog_executable_candidate_unsafe", appId);
      }
      const key = portableCandidate.replaceAll("\\", "/").toLowerCase();
      if (candidateKeys.has(key)) fail("app.catalog_executable_candidate_duplicate", appId);
      candidateKeys.add(key);
      return portableCandidate;
    });

    return Object.freeze({
      ...entry,
      appId,
      appName: requiredString(entry.appName, "app.catalog_app_name_required", appId),
      category: requiredString(entry.category, "app.catalog_category_required", appId),
      role,
      adapter: requiredString(entry.adapter, "app.catalog_adapter_required", appId),
      requiredCategory,
      executableCandidates: Object.freeze(executableCandidates),
      expectedStatus,
      privacyClass,
    });
  });

  return Object.freeze({ schemaVersion: 2, apps: Object.freeze(apps) });
}

function isUnsafeCandidate(value) {
  return /^[A-Za-z]:[\\/]/u.test(value)
    || /^\\\\/u.test(value)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(value)
    || /[\0\r\n]/u.test(value);
}

function requiredString(value, code, appId) {
  if (typeof value !== "string" || value.trim() === "") fail(code, appId);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, detail) {
  const error = new Error(detail === undefined ? code : `${code}: ${String(detail)}`);
  error.code = code;
  throw error;
}
