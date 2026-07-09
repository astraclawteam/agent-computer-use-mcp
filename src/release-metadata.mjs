import { readFileSync } from "node:fs";
import { getVersionPolicy } from "./package-foundation.mjs";

export function buildReleaseMetadata(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const versionPolicy = getVersionPolicy();
  return {
    phase: "0.10",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    releaseTag: `v${packageJson.version}`,
    channel: versionPolicy.channel,
    publicContract: versionPolicy.publicContract,
    upgradeStrategy: versionPolicy.upgradeStrategy,
    rollbackStrategy: versionPolicy.rollbackStrategy,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    changelog: {
      path: "CHANGELOG.md",
      requiredHeading: `## ${packageJson.version}`,
    },
    artifacts: [
      {
        name: "npm-pack-tarball",
        command: "npm pack --dry-run --json",
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
    ],
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

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
