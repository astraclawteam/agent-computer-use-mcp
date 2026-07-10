import { buildSignedHelperInventory, validateSignedHelperInventory } from "./signed-helper-inventory.mjs";

const releaseArtifacts = [
  {
    id: "gateway-overlay-windows",
    kind: "windows-helper",
    path: "gateway-overlay/GatewayComputerUseOverlay.exe",
    sha256: "a".repeat(64),
    signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
  },
  {
    id: "windows-installer-win-x64",
    kind: "windows-helper",
    path: "windows-installer/AgentComputerUse.Installer.exe",
    sha256: "b".repeat(64),
    signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
  },
  {
    id: "cua-driver-windows-x64",
    kind: "third-party-windows-asset",
    path: "cua-driver-rs-0.7.1-windows-x86_64.zip",
    sha256: "c".repeat(64),
    provenance: {
      status: "valid",
      manifestSignature: "valid",
      upstreamSha256: "c".repeat(64),
      extractedFilesVerified: true,
      authenticodeMode: "vendor-unsigned",
    },
  },
];

const inventory = buildSignedHelperInventory({ releaseArtifacts });
const validation = validateSignedHelperInventory(inventory);

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "0.13",
  benchmark: "signed-helper-inventory",
  signingPolicyWindowsHelperCount: inventory.signingPolicyWindowsHelperCount,
  requiredHelperCount: validation.requiredHelperCount,
  signedRequiredHelperCount: validation.signedRequiredHelperCount,
  timestampedRequiredHelperCount: validation.timestampedRequiredHelperCount,
  verifiedThirdPartyAssetCount: validation.verifiedThirdPartyAssetCount,
  reservedHelperCount: validation.reservedHelperCount,
  verificationCommand: inventory.verificationCommand,
  unsignedDistributionBlocked: inventory.unsignedDistributionBlocked,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
