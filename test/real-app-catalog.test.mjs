import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  REAL_APP_RESULT_STATUSES,
  parseRealAppCatalog,
} from "../src/real-app-catalog.mjs";

const rawCatalog = JSON.parse(
  await readFile("docs/productization/real-app-smoke-catalog.json", "utf8"),
);

const TIER_A_CATEGORIES = new Set([
  "notepad",
  "native-lab",
  "wpf",
  "qt",
  "edge",
  "chrome",
  "canvas",
  "skia-imgui",
  "cad-like",
  "timeline",
]);

const TIER_B_APPS = new Set([
  "installed-vscode",
  "installed-libreoffice-writer",
  "installed-libreoffice-calc",
  "installed-libreoffice-impress",
  "installed-libreoffice-draw",
  "installed-wps-office",
  "installed-edge",
  "installed-chrome",
]);

test("catalog requires explicit evidence roles and never hides missing coverage", () => {
  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 2, apps: [{ appId: "x", required: false }] }),
    /app\.catalog_role_required/u,
  );
  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 1, apps: [] }),
    /app\.catalog_schema_unsupported/u,
  );
});

test("catalog freezes the six approved result statuses", () => {
  assert.deepEqual(REAL_APP_RESULT_STATUSES, [
    "pass",
    "product-failure",
    "insufficient-perception",
    "policy-blocked",
    "not-installed",
    "infrastructure-error",
  ]);
});

test("catalog contains every approved Tier A and installed Tier B target", () => {
  const catalog = parseRealAppCatalog(rawCatalog);
  const tierA = catalog.apps.filter((entry) => entry.role === "required-fixture");
  const tierB = catalog.apps.filter((entry) => entry.role === "installed-evidence");
  const policyOnly = catalog.apps.filter((entry) => entry.role === "policy-only");

  assert.deepEqual(new Set(tierA.map((entry) => entry.requiredCategory)), TIER_A_CATEGORIES);
  assert.deepEqual(new Set(tierB.map((entry) => entry.appId)), TIER_B_APPS);
  assert.equal(policyOnly.some((entry) => entry.appId === "policy-wechat"), true);
  assert.equal(policyOnly.some((entry) => entry.appId === "policy-wecom"), true);
  assert.equal(tierA.every((entry) => entry.expectedStatus === "pass"), true);
  assert.equal(policyOnly.every((entry) => entry.expectedStatus === "policy-blocked"), true);
});

test("catalog rejects ambiguous roles, unsafe candidates, duplicates, and invalid role policy", () => {
  const base = {
    appId: "fixture",
    appName: "Fixture",
    category: "WPF",
    role: "required-fixture",
    adapter: "native-form",
    requiredCategory: "wpf",
    executableCandidates: ["artifacts/app-fixtures/wpf/fixture.exe"],
    expectedStatus: "pass",
    privacyClass: "public-fixture",
  };

  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 2, apps: [{ ...base, role: "optional" }] }),
    /app\.catalog_role_invalid/u,
  );
  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 2, apps: [{ ...base, executableCandidates: ["../fixture.exe"] }] }),
    /app\.catalog_executable_candidate_unsafe/u,
  );
  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 2, apps: [base, { ...base }] }),
    /app\.catalog_app_id_duplicate/u,
  );
  assert.throws(
    () => parseRealAppCatalog({ schemaVersion: 2, apps: [{ ...base, expectedStatus: "insufficient-perception" }] }),
    /app\.catalog_required_fixture_must_pass/u,
  );
  assert.throws(
    () => parseRealAppCatalog({
      schemaVersion: 2,
      apps: [{
        ...base,
        role: "policy-only",
        requiredCategory: null,
        expectedStatus: "pass",
        privacyClass: "private-window-policy",
      }],
    }),
    /app\.catalog_policy_status_invalid/u,
  );
});

test("catalog candidates are portable declarations and never contain user paths", () => {
  const catalog = parseRealAppCatalog(rawCatalog);
  for (const entry of catalog.apps) {
    assert.equal(Object.hasOwn(entry, "required"), false, entry.appId);
    for (const candidate of entry.executableCandidates) {
      assert.doesNotMatch(candidate, /^[A-Za-z]:[\\/]/u, entry.appId);
      assert.doesNotMatch(candidate, /^\\\\/u, entry.appId);
      assert.doesNotMatch(candidate, /(?:^|[\\/])\.\.(?:[\\/]|$)/u, entry.appId);
    }
  }
});
