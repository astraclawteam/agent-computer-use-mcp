import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createEvidenceRun } from "../src/commercial-evidence.mjs";
import { createQualificationEvidenceRun } from "../src/agent-e2e/qualification-evidence.mjs";
import { evaluateCommercialPromotion } from "../src/commercial-promotion.mjs";

const HASH = "a".repeat(64);
const IDENTITY = Object.freeze({
  gitCommit: "1".repeat(40),
  corePackage: { name: "agent-computer-use-mcp", version: "1.0.0", sha256: HASH },
  platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "1.0.0", sha256: "b".repeat(64) },
  driver: { id: "cua-driver", version: "0.7.1", sha256: "c".repeat(64) },
  overlay: { id: "gateway-overlay", sha256: "d".repeat(64) },
  ocrRuntime: { id: "onnxruntime-node", version: "1.27.0", sha256: "e".repeat(64) },
  modelPack: { id: "pp-ocr-v6-small", sha256: "f".repeat(64) },
});

test("promotion is eligible only for one fully verified candidate identity", async (t) => {
  const fixture = await evidenceFixture(t);
  const report = await evaluateCommercialPromotion({ evidenceDirectories: fixture.paths, agentE2eEvidenceDirectories: fixture.agentPaths, expected: IDENTITY });

  assert.equal(report.eligible, true);
  assert.equal(report.status, "passed");
  assert.equal(report.candidateGroups.length, 1);
  assert.equal(report.releaseTag, "v1.0.0");
  assert.deepEqual(report.candidateIdentity, IDENTITY);
  assert.deepEqual(report.failedRunIds, []);
  assert.deepEqual(report.violations, []);
});

test("stable promotion fails closed when Agent E2E evidence is missing", async (t) => {
  const fixture = await evidenceFixture(t);
  const report = await evaluateCommercialPromotion({ evidenceDirectories: fixture.paths, expected: IDENTITY });
  assert.equal(report.eligible, false);
  assert.equal(report.agentE2eEligible, false);
  assert.equal(report.violations.some((entry) => entry.code === "promotion.agent_e2e_missing"), true);
});

test("promotion rejects missing short failed or identity-mismatched soak evidence", async (t) => {
  const missing = await evidenceFixture(t);
  assert.equal((await evaluateCommercialPromotion({ evidenceDirectories: missing.paths.slice(1), agentE2eEvidenceDirectories: missing.agentPaths, expected: IDENTITY })).eligible, false);

  const short = await evidenceFixture(t, { soakOverrides: { nightly: { durationMs: 60_000 } } });
  const shortReport = await evaluateCommercialPromotion({ evidenceDirectories: short.paths, agentE2eEvidenceDirectories: short.agentPaths, expected: IDENTITY });
  assert.equal(shortReport.eligible, false);
  assert.equal(shortReport.violations.some((entry) => entry.code === "promotion.soak_duration_short"), true);

  const mismatched = await evidenceFixture(t, { identityOverrides: { gitCommit: "2".repeat(40) }, mismatchKind: "perception" });
  const mismatchReport = await evaluateCommercialPromotion({ evidenceDirectories: mismatched.paths, agentE2eEvidenceDirectories: mismatched.agentPaths, expected: IDENTITY });
  assert.equal(mismatchReport.eligible, false);
  assert.equal(mismatchReport.violations.some((entry) => entry.code === "promotion.identity_mismatch"), true);

  const incomplete = await evidenceFixture(t, { identityOverridesAll: { ocrRuntime: undefined } });
  const incompleteReport = await evaluateCommercialPromotion({ evidenceDirectories: incomplete.paths, agentE2eEvidenceDirectories: incomplete.agentPaths });
  assert.equal(incompleteReport.eligible, false);
  assert.equal(incompleteReport.violations.some((entry) => entry.code === "promotion.candidate_identity_incomplete"), true);
});

test("promotion rejects app coverage cleanup perception and privacy failures", async (t) => {
  const apps = await evidenceFixture(t, { appOverrides: { omitCategory: "Office", cleanupFailed: true } });
  const appReport = await evaluateCommercialPromotion({ evidenceDirectories: apps.paths, agentE2eEvidenceDirectories: apps.agentPaths, expected: IDENTITY });
  assert.equal(appReport.eligible, false);
  assert.equal(appReport.violations.some((entry) => entry.code === "promotion.app_category_missing" && entry.category === "Office"), true);
  assert.equal(appReport.violations.some((entry) => entry.code === "promotion.cleanup_failed"), true);

  const perception = await evidenceFixture(t, { perceptionOverrides: { proposalPrecision: 0.97, privacyStatus: "failed" } });
  const perceptionReport = await evaluateCommercialPromotion({ evidenceDirectories: perception.paths, agentE2eEvidenceDirectories: perception.agentPaths, expected: IDENTITY });
  assert.equal(perceptionReport.eligible, false);
  assert.equal(perceptionReport.violations.some((entry) => entry.code === "promotion.perception_target_failed"), true);
  assert.equal(perceptionReport.violations.some((entry) => entry.code === "promotion.privacy_failed"), true);

  const missingPrivacy = await evidenceFixture(t, { perceptionOverrides: { omitPrivacyStatus: true } });
  const missingPrivacyReport = await evaluateCommercialPromotion({ evidenceDirectories: missingPrivacy.paths, agentE2eEvidenceDirectories: missingPrivacy.agentPaths, expected: IDENTITY });
  assert.equal(missingPrivacyReport.eligible, false);
  assert.equal(missingPrivacyReport.violations.some((entry) => entry.code === "promotion.privacy_failed"), true);
});

test("a newer pass never hides an earlier failed run for the same candidate", async (t) => {
  const fixture = await evidenceFixture(t, { addFailedPullRequestRun: true });
  const report = await evaluateCommercialPromotion({ evidenceDirectories: fixture.paths, agentE2eEvidenceDirectories: fixture.agentPaths, expected: IDENTITY });

  assert.equal(report.eligible, false);
  assert.equal(report.failedRunIds.length, 1);
  assert.equal(report.violations.some((entry) => entry.code === "promotion.failed_evidence_present"), true);
});

test("Phase 9.0 is a read-only evidence CLI and health contract", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:9.0"], "node src/phase-9-0-commercial-promotion.mjs");
  const source = readFileSync("src/phase-9-0-commercial-promotion.mjs", "utf8");
  assert.doesNotMatch(source, /child_process|\bfetch\b|https?:|computer\.request_access/u);

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["9.0"], "commercial-promotion-evidence");

  const result = await runNode(["src/phase-9-0-commercial-promotion.mjs"]);
  assert.notEqual(result.exitCode, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.eligible, false);
  assert.equal(report.startsDesktopControl, false);
});

async function evidenceFixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "acu-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = [];
  for (const [gate, durationMs] of [["pull-request", 900_000], ["nightly", 7_200_000], ["release-candidate", 28_800_000]]) {
    const override = options.soakOverrides?.[gate] ?? {};
    paths.push(await seal(root, `soak-${gate}`, "runtime", {
      schemaVersion: 2,
      phase: "8.0",
      benchmark: "runtime-soak",
      status: override.status ?? "passed",
      gate,
      requestedDurationMs: durationMs,
      durationMs: override.durationMs ?? durationMs,
      violations: override.violations ?? [],
    }, identityFor(options, "runtime")));
  }
  paths.push(await seal(root, "real-app", "real-app", appReport(options.appOverrides), identityFor(options, "apps")));
  paths.push(await seal(root, "perception", "perception", perceptionReport(options.perceptionOverrides), identityFor(options, "perception")));
  if (options.addFailedPullRequestRun) {
    paths.push(await seal(root, "soak-pull-request-failed", "runtime", {
      schemaVersion: 2,
      phase: "8.0",
      benchmark: "runtime-soak",
      status: "failed",
      gate: "pull-request",
      requestedDurationMs: 900_000,
      durationMs: 900_000,
      violations: [{ code: "runtime.failure_rate" }],
    }, IDENTITY));
  }
  const agentPaths = await agentEvidenceFixture(root, identityFor(options, "agent-e2e"));
  return { root, paths, agentPaths };
}

async function agentEvidenceFixture(root, candidateIdentity) {
  const paths = [];
  const lanes = ["codex", "claude-desktop", "xiaozhi-deepseek-v4-flash", "xiaozhi-claude-sonnet-5"];
  for (const lane of lanes) {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const runId = `agent-e2e-${lane}-${repetition}`;
      const run = await createQualificationEvidenceRun({
        root,
        runId,
        manifest: {
          schemaVersion: 1,
          evidenceKind: "real-agent-e2e",
          campaignId: "commercial-1-0",
          taskId: "text-save-001",
          lane,
          repetition,
          retry: 0,
          initialStateSeed: `seed-${repetition}`,
          promptSha256: "9".repeat(64),
          candidateIdentity,
          hostIdentity: { hostId: lane.startsWith("xiaozhi") ? "xiaozhi-web" : lane, version: "qualified" },
          modelIdentity: { provider: lane, modelId: `${lane}-qualified` },
        },
      });
      await run.seal({
        verification: { status: "passed", verifierId: "exact-file-bytes", invariantKind: "file-bytes" },
        cleanup: { status: "passed", ownedProcessesRemaining: 0, temporaryPathsRemaining: 0 },
      });
      paths.push(run.path);
    }
  }
  return paths;
}

function appReport(options = {}) {
  const categories = ["Browser", "Electron", "Office", "Complex Canvas", "CAD-like", "Timeline"]
    .filter((category) => category !== options.omitCategory);
  return {
    schemaVersion: 2,
    phase: "6.2",
    benchmark: "real-app-perception-smoke",
    status: "passed",
    fullMatrix: true,
    results: categories.map((category) => ({
      appId: `installed-${category.toLowerCase().replaceAll(" ", "-")}`,
      category,
      role: "installed-core",
      status: "pass",
      expectedStatus: "pass",
      cleanup: { status: options.cleanupFailed && category === "Browser" ? "failed" : "passed" },
      metrics: ["CAD-like", "Timeline"].includes(category) ? { proposalPrecision: 0.99, proposalRecall: 0.95 } : undefined,
    })),
    privacyStatus: "passed",
    includeUserOverlay: false,
  };
}

function perceptionReport(options = {}) {
  const report = {
    status: "passed",
    phase: "3.5",
    benchmark: "perception-corpus-gate",
    quality: {
      ocrCharacterAccuracy: 0.99,
      criticalLabelRecall: 0.98,
      proposalPrecision: options.proposalPrecision ?? 0.99,
      proposalRecall: 0.95,
      guessedActionCount: 0,
    },
    violations: [],
    includeUserOverlay: false,
  };
  if (!options.omitPrivacyStatus) report.privacyStatus = options.privacyStatus ?? "passed";
  return report;
}

function identityFor(options, kind) {
  if (options.identityOverridesAll) return { ...IDENTITY, ...options.identityOverridesAll };
  return options.mismatchKind === kind ? { ...IDENTITY, ...(options.identityOverrides ?? {}) } : IDENTITY;
}

async function seal(root, runId, evidenceKind, report, candidateIdentity) {
  const run = await createEvidenceRun({
    root,
    runId,
    manifest: { schemaVersion: 1, evidenceKind, candidateIdentity },
  });
  await run.checkpoint({ stage: "complete", status: report.status });
  await run.seal(report);
  return run.path;
}

function runNode(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}
