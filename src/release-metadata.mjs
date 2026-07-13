import { readFileSync } from "node:fs";
import { matchesCommercialCandidateIdentity } from "./commercial-candidate-identity.mjs";
import { getVersionPolicy } from "./package-foundation.mjs";

export function buildReleaseMetadata(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const versionPolicy = getVersionPolicy();
  const commercialRequired = isStableVersion(packageJson.version);
  const commercialEligible = commercialEvidenceMatches(options.commercialPromotion, packageJson);
  const artifacts = [
    {
      name: "npm-pack-tarball",
      command: "npm run release:npm:pack",
      required: true,
    },
    {
      name: "offline-asset-manifest",
      command: "npm run assets:manifest",
      required: true,
    },
    {
      name: "package-foundation-report",
      command: "npm run package:foundation",
      required: true,
    },
    {
      name: "release-readiness-gate",
      command: "npm run release:readiness",
      required: true,
    },
    {
      name: "release-artifact-verification",
      command: "npm run release:artifacts",
      required: true,
    },
    {
      name: "platform-native-inventory",
      command: "npm run phase:0.13",
      required: true,
    },
    {
      name: "protected-npm-release",
      command: "npm run phase:0.14",
      required: true,
    },
    {
      name: "real-release-assembly",
      command: "npm run phase:0.15",
      required: true,
    },
    {
      name: "offline-install-proof",
      command: "npm run phase:7.4",
      required: true,
    },
    {
      name: "first-enable-safety",
      command: "npm run phase:7.5",
      required: true,
    },
    {
      name: "repair-entrypoint-catalog",
      command: "npm run phase:7.6",
      required: true,
    },
    {
      name: "clean-install-degraded-proof",
      command: "npm run phase:7.7",
      required: true,
    },
    {
      name: "trusted-asset-cache-materializer",
      command: "npm run phase:7.9",
      required: true,
    },
    {
      name: "policy-deny-proof",
      command: "npm run phase:1.11",
      required: true,
    },
    {
      name: "control-approval-state",
      command: "npm run phase:1.12",
      required: true,
    },
    {
      name: "mcp-approval-compatibility",
      command: "npm run phase:5.5",
      required: true,
    },
    {
      name: "mcp-multi-client-stress",
      command: "npm run phase:5.6",
      required: true,
    },
    {
      name: "public-mcp-contract-review",
      command: "npm run phase:5.7",
      required: true,
    },
    {
      name: "daemon-session",
      command: "npm run phase:2.10",
      required: true,
    },
    {
      name: "daemon-session-doctor-repair",
      command: "npm run phase:2.11",
      required: true,
    },
    {
      name: "runtime-cleanup",
      command: "npm run phase:2.12",
      required: true,
    },
    {
      name: "runtime-cleanup-doctor-repair",
      command: "npm run phase:2.13",
      required: true,
    },
    {
      name: "perception-latency-budget",
      command: "npm run phase:3.5",
      required: true,
    },
  ];
  if (commercialRequired) artifacts.push({ name: "commercial-promotion-evidence", command: "npm run phase:9.0", required: true });
  return {
    phase: "0.10",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    releaseTag: `v${packageJson.version}`,
    channel: commercialRequired ? "stable" : versionPolicy.channel,
    commercialRequired,
    commercialEligible: commercialRequired ? commercialEligible : false,
    commercialPromotion: commercialEligible ? {
      releaseTag: options.commercialPromotion.releaseTag,
      candidateIdentity: options.commercialPromotion.candidateIdentity,
    } : null,
    publicContract: versionPolicy.publicContract,
    upgradeStrategy: versionPolicy.upgradeStrategy,
    rollbackStrategy: versionPolicy.rollbackStrategy,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    changelog: {
      path: "CHANGELOG.md",
      requiredHeading: `## ${packageJson.version}`,
    },
    artifacts,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function validateReleaseMetadata(metadata, options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const changelogText = options.changelogText ?? readFileSync("CHANGELOG.md", "utf8");
  const violations = [];
  if (metadata.packageName !== packageJson.name) {
    violations.push({
      code: "package-name-mismatch",
      expected: packageJson.name,
      actual: metadata.packageName,
    });
  }
  if (metadata.packageVersion !== packageJson.version) {
    violations.push({
      code: "package-version-mismatch",
      expected: packageJson.version,
      actual: metadata.packageVersion,
    });
  }
  if (metadata.releaseTag !== `v${packageJson.version}`) {
    violations.push({
      code: "release-tag-mismatch",
      expected: `v${packageJson.version}`,
      actual: metadata.releaseTag,
    });
  }
  if (!changelogText.includes(`## ${packageJson.version}`)) {
    violations.push({
      code: "changelog-entry-missing",
      expected: `## ${packageJson.version}`,
      path: metadata.changelog?.path ?? "CHANGELOG.md",
    });
  }
  if (!metadata.artifacts?.every((artifact) => artifact.command && artifact.required === true)) {
    violations.push({
      code: "release-artifacts-incomplete",
    });
  }
  if (isStableVersion(packageJson.version) && (metadata.commercialRequired !== true || metadata.commercialEligible !== true
    || metadata.commercialPromotion?.releaseTag !== `v${packageJson.version}`
    || !matchesCommercialCandidateIdentity(metadata.commercialPromotion?.candidateIdentity, packageJson))) {
    violations.push({ code: "commercial-evidence-required" });
  }
  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.10",
    releaseTag: metadata.releaseTag,
    changelogEntryPresent: changelogText.includes(`## ${packageJson.version}`),
    artifactCount: metadata.artifacts?.length ?? 0,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function commercialEvidenceMatches(report, packageJson) {
  return report?.status === "passed" && report?.eligible === true && report?.phase === "9.0"
    && report?.benchmark === "commercial-promotion-evidence" && report?.releaseTag === `v${packageJson.version}`
    && report?.candidateIdentity?.corePackage?.name === packageJson.name
    && matchesCommercialCandidateIdentity(report?.candidateIdentity, packageJson)
    && Array.isArray(report?.violations) && report.violations.length === 0;
}

function isStableVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ""));
  return Boolean(match && Number(match[1]) >= 1);
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
