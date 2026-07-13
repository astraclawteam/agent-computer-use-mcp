import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { runRealAppSmokeCatalog } from "../src/real-app-smoke-runner.mjs";

test("schema v2 runner retains every attempt and promotes repeated transient failure", async () => {
  let callCount = 0;
  const report = await runRealAppSmokeCatalog({
    catalog: catalogOf([
      appEntry("installed-missing", "installed-evidence"),
      appEntry("transient-app", "required-fixture", { requiredCategory: "transient" }),
    ]),
    executeAdapter: async (entry) => {
      if (entry.appId === "installed-missing") {
        return { status: "not-installed", reason: "app.executable_missing", cleanup: { status: "passed" } };
      }
      callCount += 1;
      return { status: "infrastructure-error", reason: "driver.transport_interrupted", cleanup: { status: "passed" } };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(report.results[0].status, "not-installed");
  assert.equal(report.results[0].attempts.length, 1);
  assert.equal(report.results[1].status, "product-failure");
  assert.equal(report.results[1].attempts.length, 2);
  assert.deepEqual(report.results[1].attempts.map((attempt) => attempt.status), [
    "infrastructure-error",
    "infrastructure-error",
  ]);
});

test("schema v2 runner counts every status and never accepts required false", async () => {
  const statuses = ["pass", "product-failure", "insufficient-perception", "policy-blocked", "not-installed", "infrastructure-error"];
  const report = await runRealAppSmokeCatalog({
    catalog: catalogOf(statuses.map((status, index) => appEntry(`app-${index}`, status === "policy-blocked" ? "policy-only" : "installed-evidence", {
      expectedStatus: status === "policy-blocked" ? "policy-blocked" : "pass",
    }))),
    executeAdapter: async (entry) => ({
      status: statuses[Number(entry.appId.slice(4))],
      reason: "test.result",
      ...(entry.role === "policy-only" ? { finalState: { kind: "policy-event", code: "test.result" } } : {}),
      cleanup: { status: "passed" },
    }),
  });
  assert.deepEqual(report.counts, Object.fromEntries(statuses.map((status) => [status, 1])));
  await assert.rejects(
    runRealAppSmokeCatalog({ catalog: { schemaVersion: 2, apps: [{ appId: "hidden", required: false }] } }),
    /app\.catalog_role_required/u,
  );
});

test("schema v2 runner exposes filters and filtered evidence cannot claim a full matrix", async () => {
  const report = await runRealAppSmokeCatalog({
    catalog: catalogOf([
      appEntry("tier-a", "required-fixture", { requiredCategory: "tier-a" }),
      appEntry("installed", "installed-evidence"),
    ]),
    filters: { roles: ["installed-evidence"], appIds: [] },
    executeAdapter: async () => ({ status: "pass", finalState: { kind: "window-state" }, cleanup: { status: "passed" } }),
  });
  assert.equal(report.fullMatrix, false);
  assert.deepEqual(report.filters.roles, ["installed-evidence"]);
  assert.deepEqual(report.results.map((result) => result.appId), ["installed"]);
});

test("real app workflow verifies fixtures and uploads sealed evidence only even on failure", async () => {
  const workflow = parse(await readFile(".github/workflows/real-app-smoke.yml", "utf8"));
  const source = JSON.stringify(workflow.jobs["real-app-smoke"]);
  assert.match(source, /verify-app-fixture-pack/u);
  assert.match(source, /events\.jsonl/u);
  assert.match(source, /report\.json/u);
  assert.match(source, /run-manifest\.json/u);
  assert.match(source, /checksums\.txt/u);
  assert.match(source, /always\(\)/u);
  assert.doesNotMatch(source, /png|jpe?g|screenshot/iu);
});

test("real app smoke requires executable identity and runtime evidence before pass", async () => {
  const report = await runRealAppSmokeCatalog({
    catalog: [{
      appId: "win32-notepad",
      appName: "Notepad",
      category: "Win32",
      executableCandidates: ["C:/Windows/notepad.exe"],
      script: "src/notepad-smoke.mjs",
      capabilitySources: ["uia-som"],
      flow: "write safe temporary fixture",
    }],
    resolveExecutable: async () => ({ path: "C:/Windows/notepad.exe", sha256: "a".repeat(64), sizeBytes: 10 }),
    execute: async () => ({
      exitCode: 0,
      report: { status: "passed", evidenceKind: "real-app", observationProvider: "uia-som", includeUserOverlay: false },
    }),
  });
  assert.equal(report.status, "passed");
  assert.equal(report.results[0].status, "pass");
  assert.equal(report.results[0].executable.sha256, "a".repeat(64));
  assert.equal(report.results[0].executable.path, undefined);
  assert.equal(report.results[0].evidenceKind, "real-app");
  assert.deepEqual(report.results[0].artifacts, []);
});

test("real app lab workflow uses a dedicated Windows runner and uploads sanitized JSON only", async () => {
  const workflow = parse(await readFile(".github/workflows/real-app-smoke.yml", "utf8"));
  const job = workflow.jobs["real-app-smoke"];
  assert.deepEqual(job["runs-on"], ["self-hosted", "windows", "x64", "computer-use-app-lab"]);
  const source = JSON.stringify(job);
  assert.match(source, /phase:6\.2/);
  assert.match(source, /real-app-smoke-evidence/u);
  assert.doesNotMatch(source, /png|jpe?g|screenshot/iu);

  const catalog = JSON.parse(await readFile("docs/productization/real-app-smoke-catalog.json", "utf8"));
  const categories = new Set(catalog.apps.map((entry) => entry.category));
  for (const category of ["Win32", "Browser", "Electron", "WPF", "WinForms", "Qt", "Office", "Terminal", "Canvas", "Industrial"]) {
    assert.equal(categories.has(category), true, category);
  }
});

test("real app smoke blocks missing software and rejects declaration-only or guessed-coordinate evidence", async () => {
  const catalog = [
    { appId: "missing-qt", appName: "Qt", category: "Qt", executableCandidates: ["missing.exe"], script: "x", capabilitySources: ["uia-som"], flow: "click safe button" },
    { appId: "declared-browser", appName: "Browser", category: "Browser", executableCandidates: ["browser.exe"], script: "x", capabilitySources: ["uia-som"], flow: "observe fixture" },
    { appId: "unsafe-canvas", appName: "Canvas", category: "Canvas", executableCandidates: ["canvas.exe"], script: "x", capabilitySources: ["cv"], flow: "find control" },
  ];
  const report = await runRealAppSmokeCatalog({
    catalog,
    resolveExecutable: async (entry) => entry.appId === "missing-qt" ? null : ({ path: `${entry.appId}.exe`, sha256: "b".repeat(64), sizeBytes: 20 }),
    execute: async (entry) => entry.appId === "declared-browser"
      ? { exitCode: 0, report: { status: "passed", evidenceKind: "declared", includeUserOverlay: false } }
      : { exitCode: 0, report: { status: "passed", evidenceKind: "real-app", usedGuessedCoordinates: true, includeUserOverlay: false } },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.results[0].status, "blocked");
  assert.equal(report.results[0].reason, "app.executable_missing");
  assert.equal(report.results[1].status, "insufficient");
  assert.equal(report.results[1].reason, "observation.insufficient");
  assert.equal(report.results[2].status, "insufficient");
  assert.equal(report.results[2].reason, "observation.guessed_coordinates_forbidden");
});

test("real app evidence is exposed through the standard health phase catalog", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["6.2"], "real-app-perception-smoke");
});

test("real app smoke retries one transport timeout but never weakens evidence validation", async () => {
  let attempts = 0;
  const report = await runRealAppSmokeCatalog({
    catalog: [{
      appId: "win32-notepad",
      appName: "Notepad",
      category: "Win32",
      executableCandidates: ["notepad.exe"],
      script: "x",
      capabilitySources: ["uia-som"],
      flow: "safe fixture",
      maxAttempts: 2,
    }],
    resolveExecutable: async () => ({ path: "notepad.exe", sha256: "c".repeat(64), sizeBytes: 1 }),
    execute: async () => ++attempts === 1
      ? { exitCode: null, timedOut: true, report: { status: "failed", reason: "app.smoke_timeout" } }
      : { exitCode: 0, timedOut: false, report: { status: "passed", evidenceKind: "real-app", observationProvider: "uia-som", includeUserOverlay: false } },
  });
  assert.equal(report.status, "passed");
  assert.equal(report.results[0].attemptCount, 2);
  assert.equal(attempts, 2);
});

test("Notepad smoke owns and terminates every process it creates", async () => {
  const entrypoint = await readFile("src/real-cua-notepad-file-sequence.mjs", "utf8");
  const source = await readFile("src/app-adapters/notepad.mjs", "utf8");
  assert.match(entrypoint, /createNotepadAdapter/u);
  assert.match(entrypoint, /runAppAdapter/u);
  assert.match(source, /callTool\("launch_app", \{/u);
  assert.match(source, /Microsoft\.WindowsNotepad_8wekyb3d8bbwe!App/u);
  assert.match(source, /waitForWindow/u);
  assert.match(source, /Number\.isInteger\(item\.pid\)/u);
  assert.match(source, /const ownedPids = new Set\(\);/u);
  assert.match(source, /ownedPids\.add\(window\.pid\)/u);
  assert.match(source, /callTool\("kill_app", \{ pid \}\)/u);
  assert.doesNotMatch(source, /spawn\("notepad\.exe"/u);
});

function catalogOf(apps) {
  return { schemaVersion: 2, apps };
}

function appEntry(appId, role, overrides = {}) {
  const policy = role === "policy-only";
  return {
    appId,
    appName: appId,
    category: "Test",
    role,
    adapter: policy ? "privacy-window-policy" : "test-adapter",
    requiredCategory: role === "required-fixture" ? (overrides.requiredCategory ?? appId) : null,
    executableCandidates: ["fixtures/app.exe"],
    expectedStatus: policy ? "policy-blocked" : "pass",
    privacyClass: policy ? "private-window-policy" : "public-fixture",
    ...overrides,
  };
}
