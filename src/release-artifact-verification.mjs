import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { releaseAssetNames } from "./platform-package-contract.mjs";

export function buildReleaseArtifactVerification(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const artifacts = (options.artifacts ?? []).map(normalizeArtifact);
  const report = {
    phase: "0.12",
    status: "passed",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    releaseTag: `v${packageJson.version}`,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    artifacts,
    expectedAssetNames: releaseAssetNames(packageJson.version),
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
  const validation = validateReleaseArtifactVerification(report, { packageJson });
  return { ...report, status: validation.status, violations: validation.violations };
}

export function validateReleaseArtifactVerification(report, options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const violations = [];
  if (report.packageName !== packageJson.name) violations.push({ code: "package-name-mismatch" });
  if (report.packageVersion !== packageJson.version) violations.push({ code: "package-version-mismatch" });
  if (report.releaseTag !== `v${packageJson.version}`) violations.push({ code: "release-tag-mismatch" });
  const names = (report.artifacts ?? []).map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(releaseAssetNames(packageJson.version))) {
    violations.push({ code: "release-asset-inventory-mismatch" });
  }
  for (const artifact of report.artifacts ?? []) {
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")) violations.push({ code: "missing-artifact-hash", name: artifact.name });
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) violations.push({ code: "invalid-artifact-size", name: artifact.name });
  }
  if (report.startsDesktopControl !== false) violations.push({ code: "artifact-verification-starts-desktop-control" });
  if (report.includeUserOverlay !== false) violations.push({ code: "artifact-verification-includes-user-overlay" });
  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.12",
    artifactCount: report.artifacts?.length ?? 0,
    hashVerifiedArtifactCount: (report.artifacts ?? []).filter(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256 ?? "")).length,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function normalizeArtifact(artifact) {
  return {
    name: artifact.name,
    sha256: Object.hasOwn(artifact, "sha256")
      ? artifact.sha256
      : createHash("sha256").update(artifact.bytes ?? "").digest("hex"),
    sizeBytes: artifact.sizeBytes ?? Buffer.byteLength(artifact.bytes ?? ""),
  };
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
