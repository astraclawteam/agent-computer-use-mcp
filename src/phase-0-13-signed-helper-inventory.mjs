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
    id: "cua-driver-windows-x64",
    kind: "windows-helper",
    path: "cua-driver/cua-driver.exe",
    sha256: "b".repeat(64),
    signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
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
  reservedHelperCount: validation.reservedHelperCount,
  verificationCommand: inventory.verificationCommand,
  unsignedDistributionBlocked: inventory.unsignedDistributionBlocked,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
