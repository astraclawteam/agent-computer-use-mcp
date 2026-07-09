import { buildReleaseArtifactVerification, validateReleaseArtifactVerification } from "./release-artifact-verification.mjs";

const report = buildReleaseArtifactVerification({
  generatedAt: "2026-07-10T00:00:00.000Z",
  artifacts: [
    {
      id: "npm-pack-tarball",
      kind: "npm-tarball",
      path: "agent-computer-use-mcp-0.0.1.tgz",
      bytes: "package-bytes",
    },
    {
      id: "gateway-overlay-windows",
      kind: "windows-helper",
      path: "gateway-overlay/GatewayComputerUseOverlay.exe",
      bytes: "overlay-helper",
      signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
    },
    {
      id: "cua-driver-windows-x64",
      kind: "windows-helper",
      path: "cua-driver/cua-driver.exe",
      bytes: "driver-helper",
      signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
    },
  ],
});
const validation = validateReleaseArtifactVerification(report);

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "0.12",
  benchmark: "release-artifact-verification",
  artifactCount: validation.artifactCount,
  requiredHelperCount: validation.requiredHelperCount,
  validSignedHelperCount: validation.validSignedHelperCount,
  unsignedDistributionBlocked: report.unsignedDistributionBlocked,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
