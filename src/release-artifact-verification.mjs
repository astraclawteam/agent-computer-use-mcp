import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getSigningPolicy } from "./package-foundation.mjs";

export function buildReleaseArtifactVerification(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const artifacts = (options.artifacts ?? []).map(normalizeArtifact);
  const signingPolicy = options.signingPolicy ?? getSigningPolicy();
  const helperArtifacts = artifacts.filter((artifact) => artifact.kind === "windows-helper");
  const signedHelpers = helperArtifacts.filter((artifact) => artifact.signature?.status === "valid");
  const timestampedHelpers = helperArtifacts.filter((artifact) => artifact.signature?.timestamped === true);

  const report = {
    phase: "0.12",
    status: "passed",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    releaseTag: `v${packageJson.version}`,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    artifacts,
    signingPolicy,
    signingSummary: {
      requiredHelperCount: helperArtifacts.length,
      validSignedHelperCount: signedHelpers.length,
      timestampedHelperCount: timestampedHelpers.length,
      verificationCommand: signingPolicy.windowsHelpers.verification,
    },
    unsignedDistributionBlocked: signingPolicy.unsignedDevelopmentBuilds.distribution === "blocked",
    includeUserOverlay: false,
    startsDesktopControl: false,
  };

  const validation = validateReleaseArtifactVerification(report, { packageJson });
  return {
    ...report,
    status: validation.status,
    violations: validation.violations,
  };
}

export function validateReleaseArtifactVerification(report, options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const violations = [];
  if (report.packageName !== packageJson.name) {
    violations.push({ code: "package-name-mismatch", expected: packageJson.name, actual: report.packageName });
  }
  if (report.packageVersion !== packageJson.version) {
    violations.push({ code: "package-version-mismatch", expected: packageJson.version, actual: report.packageVersion });
  }
  if (report.releaseTag !== `v${packageJson.version}`) {
    violations.push({ code: "release-tag-mismatch", expected: `v${packageJson.version}`, actual: report.releaseTag });
  }

  for (const artifact of report.artifacts ?? []) {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
      violations.push({ code: "missing-artifact-hash", id: artifact.id, path: artifact.path });
    }
    if (artifact.kind === "windows-helper" && artifact.signature?.status !== "valid") {
      violations.push({ code: "invalid-helper-signature", id: artifact.id, status: artifact.signature?.status ?? "missing" });
    }
    if (artifact.kind === "windows-helper" && artifact.signature?.timestamped !== true) {
      violations.push({ code: "helper-signature-not-timestamped", id: artifact.id });
    }
  }

  if (report.unsignedDistributionBlocked !== true) {
    violations.push({ code: "unsigned-distribution-not-blocked" });
  }
  if (report.startsDesktopControl !== false) {
    violations.push({ code: "artifact-verification-starts-desktop-control" });
  }
  if (report.includeUserOverlay !== false) {
    violations.push({ code: "artifact-verification-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.12",
    artifactCount: report.artifacts?.length ?? 0,
    requiredHelperCount: report.signingSummary?.requiredHelperCount ?? 0,
    validSignedHelperCount: report.signingSummary?.validSignedHelperCount ?? 0,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function normalizeArtifact(artifact) {
  const sha256 = Object.hasOwn(artifact, "sha256") ? artifact.sha256 : hashBytes(artifact.bytes ?? "");
  return {
    id: artifact.id,
    kind: artifact.kind,
    path: artifact.path,
    sha256,
    sizeBytes: artifact.sizeBytes ?? Buffer.byteLength(String(artifact.bytes ?? "")),
    signature: artifact.signature ?? null,
  };
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
