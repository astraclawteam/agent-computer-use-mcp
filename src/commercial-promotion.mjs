import { verifyEvidenceDirectory } from "./commercial-evidence.mjs";

const SOAK_REQUIREMENTS = Object.freeze({
  "pull-request": 900_000,
  nightly: 7_200_000,
  "release-candidate": 28_800_000,
});
const REQUIRED_APP_CATEGORIES = Object.freeze(["Browser", "Electron", "Office", "Complex Canvas"]);
const REQUIRED_COMPLEX_METRICS = Object.freeze(["CAD-like", "Timeline"]);

export async function evaluateCommercialPromotion({ evidenceDirectories, expected } = {}) {
  if (!Array.isArray(evidenceDirectories) || evidenceDirectories.length === 0) {
    return promotionReport([], [{ code: "promotion.evidence_missing" }], []);
  }
  const verified = await Promise.all(evidenceDirectories.map((path) => verifyEvidenceDirectory(path)));
  const invalid = verified.filter((entry) => entry.status !== "passed");
  const groups = new Map();
  for (const evidence of verified.filter((entry) => entry.status === "passed")) {
    const identity = evidence.manifest?.candidateIdentity;
    if (!isRecord(identity)) {
      addGroup(groups, "missing-identity", null, evidence);
      continue;
    }
    addGroup(groups, stableStringify(identity), identity, evidence);
  }
  const expectedKey = expected ? stableStringify(expected) : null;
  const summaries = [...groups.entries()].map(([key, group]) => evaluateGroup(key, group));
  const selected = expectedKey
    ? summaries.find((group) => group.identityKey === expectedKey)
    : summaries.find((group) => group.violations.length === 0);
  const violations = [];
  for (const evidence of invalid) violations.push({ code: "promotion.evidence_invalid", runId: evidence.runId });
  if (expectedKey && summaries.some((group) => group.identityKey !== expectedKey)) {
    violations.push({ code: "promotion.identity_mismatch" });
  }
  if (!selected) violations.push({ code: "promotion.candidate_identity_incomplete" });
  else violations.push(...selected.violations);
  const failedRunIds = summaries.flatMap((group) => group.failedRunIds).sort();
  const eligible = violations.length === 0 && summaries.length === 1 && selected?.violations.length === 0;
  return Object.freeze({
    status: eligible ? "passed" : "failed",
    phase: "9.0",
    benchmark: "commercial-promotion-evidence",
    eligible,
    candidateGroups: Object.freeze(summaries),
    failedRunIds: Object.freeze(failedRunIds),
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
    includeUserOverlay: false,
    startsDesktopControl: false,
  });
}

function evaluateGroup(identityKey, group) {
  const violations = [];
  const failed = group.evidence.filter((entry) => entry.report?.status !== "passed");
  const failedRunIds = failed.map((entry) => entry.runId).sort();
  if (failedRunIds.length > 0) violations.push({ code: "promotion.failed_evidence_present", runIds: failedRunIds });

  const soak = group.evidence.filter((entry) => entry.report?.benchmark === "runtime-soak");
  for (const [gate, minimum] of Object.entries(SOAK_REQUIREMENTS)) {
    const runs = soak.filter((entry) => entry.report?.gate === gate);
    if (runs.length === 0) {
      violations.push({ code: "promotion.soak_missing", gate });
      continue;
    }
    for (const run of runs.filter((entry) => entry.report?.status === "passed")) {
      if (!Number.isFinite(run.report.durationMs) || run.report.durationMs < minimum
        || run.report.requestedDurationMs !== minimum) {
        violations.push({ code: "promotion.soak_duration_short", gate, runId: run.runId });
      }
    }
  }

  const appEvidence = group.evidence.filter((entry) => entry.report?.benchmark === "real-app-perception-smoke");
  const appReports = appEvidence.map((entry) => entry.report).filter((report) => report.status === "passed" && report.fullMatrix === true);
  if (appReports.length === 0) violations.push({ code: "promotion.real_app_matrix_missing" });
  const appResults = appReports.flatMap((report) => report.results ?? []);
  for (const result of appResults) {
    if (result.expectedStatus === "pass" && result.status !== "pass") {
      violations.push({ code: "promotion.tier_a_failed", appId: result.appId });
    }
    if (cleanupFailed(result)) violations.push({ code: "promotion.cleanup_failed", appId: result.appId });
  }
  for (const category of REQUIRED_APP_CATEGORIES) {
    if (!appResults.some((result) => result.category === category && result.status === "pass" && result.role === "installed-core")) {
      violations.push({ code: "promotion.app_category_missing", category });
    }
  }
  for (const category of REQUIRED_COMPLEX_METRICS) {
    const result = appResults.find((entry) => entry.category === category && entry.status === "pass");
    if (!result || result.metrics?.proposalPrecision < 0.98 || result.metrics?.proposalRecall < 0.90) {
      violations.push({ code: "promotion.complex_metric_missing", category });
    }
  }

  const perception = group.evidence.filter((entry) => entry.report?.benchmark === "perception-corpus-gate");
  if (perception.length === 0) violations.push({ code: "promotion.perception_missing" });
  for (const entry of perception) {
    const quality = entry.report.quality ?? {};
    if (entry.report.status !== "passed" || quality.ocrCharacterAccuracy < 0.97 || quality.criticalLabelRecall < 0.95
      || quality.proposalPrecision < 0.98 || quality.proposalRecall < 0.90 || quality.guessedActionCount !== 0) {
      violations.push({ code: "promotion.perception_target_failed", runId: entry.runId });
    }
  }
  for (const entry of group.evidence) {
    if (entry.report?.privacyStatus && entry.report.privacyStatus !== "passed") {
      violations.push({ code: "promotion.privacy_failed", runId: entry.runId });
    }
  }
  return Object.freeze({
    identityKey,
    candidateIdentity: group.identity,
    evidenceCount: group.evidence.length,
    failedRunIds: Object.freeze(failedRunIds),
    status: violations.length === 0 ? "passed" : "failed",
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
  });
}

function cleanupFailed(result) {
  if (result.cleanup?.status === "failed") return true;
  return (result.attempts ?? []).some((attempt) => attempt.cleanup?.status !== "passed");
}

function addGroup(groups, key, identity, evidence) {
  if (!groups.has(key)) groups.set(key, { identity, evidence: [] });
  groups.get(key).evidence.push(evidence);
}

function promotionReport(candidateGroups, violations, failedRunIds) {
  return Object.freeze({
    status: "failed",
    phase: "9.0",
    benchmark: "commercial-promotion-evidence",
    eligible: false,
    candidateGroups: Object.freeze(candidateGroups),
    failedRunIds: Object.freeze(failedRunIds),
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
    includeUserOverlay: false,
    startsDesktopControl: false,
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
