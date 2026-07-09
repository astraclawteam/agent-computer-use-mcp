import { getSigningPolicy } from "./package-foundation.mjs";

export const SIGNED_HELPER_RELEASE_MAP = {
  "gateway-overlay": {
    id: "gateway-overlay-windows",
    path: "gateway-overlay/GatewayComputerUseOverlay.exe",
    required: true,
  },
  "cua-driver": {
    id: "cua-driver-windows-x64",
    path: "cua-driver/cua-driver.exe",
    required: true,
  },
  "future-native-sidecars": {
    id: "future-native-sidecars",
    path: "future-native-sidecars",
    required: false,
    reserved: true,
  },
};

export function buildSignedHelperInventory(options = {}) {
  const signingPolicy = options.signingPolicy ?? getSigningPolicy();
  const releaseArtifacts = options.releaseArtifacts ?? [];
  const helperRecords = signingPolicy.windowsHelpers.files
    .map((policyId) => {
      const mapping = SIGNED_HELPER_RELEASE_MAP[policyId] ?? {
        id: policyId,
        path: policyId,
        required: true,
      };
      const artifact = releaseArtifacts.find((candidate) => candidate.id === mapping.id) ?? null;
      return {
        policyId,
        id: mapping.id,
        path: mapping.path,
        required: mapping.required !== false,
        reserved: mapping.reserved === true,
        artifact,
        signature: artifact?.signature ?? null,
      };
    });

  const requiredHelpers = helperRecords.filter((helper) => helper.required);
  const reservedHelpers = helperRecords.filter((helper) => helper.reserved);
  const signedRequiredHelperCount = requiredHelpers
    .filter((helper) => helper.signature?.status === "valid")
    .length;
  const timestampedRequiredHelperCount = requiredHelpers
    .filter((helper) => helper.signature?.timestamped === true)
    .length;

  const inventory = {
    phase: "0.13",
    status: "passed",
    benchmark: "signed-helper-inventory",
    signingPolicyWindowsHelperCount: signingPolicy.windowsHelpers.files.length,
    requiredHelpers,
    reservedHelpers,
    requiredHelperCount: requiredHelpers.length,
    reservedHelperCount: reservedHelpers.length,
    signedRequiredHelperCount,
    timestampedRequiredHelperCount,
    verificationCommand: signingPolicy.windowsHelpers.verification,
    unsignedDistributionBlocked: signingPolicy.unsignedDevelopmentBuilds.distribution === "blocked",
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
  const validation = validateSignedHelperInventory(inventory);
  return {
    ...inventory,
    status: validation.status,
    violations: validation.violations,
  };
}

export function validateSignedHelperInventory(inventory) {
  const violations = [];
  for (const helper of inventory.requiredHelpers ?? []) {
    if (!helper.artifact) {
      violations.push({
        code: "missing-required-helper-artifact",
        id: helper.id,
        policyId: helper.policyId,
      });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(helper.artifact.sha256 ?? "")) {
      violations.push({ code: "missing-required-helper-hash", id: helper.id });
    }
    if (helper.signature?.status !== "valid") {
      violations.push({
        code: "required-helper-signature-invalid",
        id: helper.id,
        status: helper.signature?.status ?? "missing",
      });
    }
    if (helper.signature?.timestamped !== true) {
      violations.push({ code: "required-helper-signature-not-timestamped", id: helper.id });
    }
  }
  if (inventory.unsignedDistributionBlocked !== true) {
    violations.push({ code: "unsigned-distribution-not-blocked" });
  }
  if (inventory.startsDesktopControl !== false) {
    violations.push({ code: "signed-helper-inventory-starts-desktop-control" });
  }
  if (inventory.includeUserOverlay !== false) {
    violations.push({ code: "signed-helper-inventory-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.13",
    requiredHelperCount: inventory.requiredHelperCount ?? 0,
    signedRequiredHelperCount: inventory.signedRequiredHelperCount ?? 0,
    timestampedRequiredHelperCount: inventory.timestampedRequiredHelperCount ?? 0,
    reservedHelperCount: inventory.reservedHelperCount ?? 0,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}
