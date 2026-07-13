import { readFileSync } from "node:fs";
import { buildReleaseMetadata, validateReleaseMetadata } from "./release-metadata.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const metadata = buildReleaseMetadata({
  packageJson,
  generatedAt: "2026-07-10T00:00:00.000Z",
});
const validation = validateReleaseMetadata(metadata, {
  packageJson,
  changelogText: readFileSync("CHANGELOG.md", "utf8"),
});
const passed = validation.status === "passed"
  && metadata.releaseTag === `v${packageJson.version}`
  && validation.changelogEntryPresent === true
  && validation.artifactCount === metadata.artifacts.length
  && metadata.artifacts.every((artifact) => artifact.command && artifact.required === true)
  && metadata.includeUserOverlay === false
  && metadata.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "0.10",
  benchmark: "release-metadata-changelog",
  packageName: metadata.packageName,
  packageVersion: metadata.packageVersion,
  releaseTag: metadata.releaseTag,
  commercialRequired: metadata.commercialRequired,
  commercialEligible: metadata.commercialEligible,
  changelogEntryPresent: validation.changelogEntryPresent,
  artifactCount: validation.artifactCount,
  violations: validation.violations,
  includeUserOverlay: metadata.includeUserOverlay,
  startsDesktopControl: metadata.startsDesktopControl,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
