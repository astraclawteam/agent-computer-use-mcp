import { buildReleaseArtifactVerification, validateReleaseArtifactVerification } from "./release-artifact-verification.mjs";
import { releaseAssetNames } from "./platform-package-contract.mjs";

const report = buildReleaseArtifactVerification({
  generatedAt: "2026-07-11T00:00:00.000Z",
  artifacts: releaseAssetNames("0.0.1").map((name) => ({ name, bytes: `fixture:${name}` })),
});
const validation = validateReleaseArtifactVerification(report);
process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "0.12",
  benchmark: "release-artifact-verification",
  artifactCount: validation.artifactCount,
  hashVerifiedArtifactCount: validation.hashVerifiedArtifactCount,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
