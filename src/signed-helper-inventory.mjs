import { getSigningPolicy } from "./package-foundation.mjs";

export const SIGNED_HELPER_RELEASE_MAP = {
  "gateway-overlay": {
    id: "gateway-overlay-windows",
    path: "gateway-overlay/GatewayComputerUseOverlay.exe",
    required: true,
  },
  "windows-installer": {
    id: "windows-installer-win-x64",
    path: "windows-installer/AgentComputerUse.Installer.exe",
    required: true,
  },
  "future-native-sidecars": {
    id: "future-native-sidecars",
    path: "future-native-sidecars",
    required: false,
    reserved: true,
  },
};

export const THIRD_PARTY_WINDOWS_ASSET_MAP = {
  "cua-driver": {
    id: "cua-driver-windows-x64",
    path: "cua-driver-rs-0.7.1-windows-x86_64.zip",
    required: true,
  },
};

export function buildSignedHelperInventory(options = {}) {
  const signingPolicy = options.signingPolicy ?? getSigningPolicy();
  const releaseArtifacts = options.releaseArtifacts ?? [];
  const helperRecords = signingPolicy.windowsHelpers.firstPartyFiles
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
  const thirdPartyRecords = signingPolicy.windowsHelpers.thirdPartyUnsigned.files
    .map((policyId) => {
      const mapping = THIRD_PARTY_WINDOWS_ASSET_MAP[policyId] ?? {
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
        artifact,
        provenance: artifact?.provenance ?? null,
      };
    });

  const requiredHelpers = helperRecords.filter((helper) => helper.required);
  const reservedHelpers = helperRecords.filter((helper) => helper.reserved);
  const requiredThirdPartyAssets = thirdPartyRecords.filter((asset) => asset.required);
  const signedRequiredHelperCount = requiredHelpers
    .filter((helper) => helper.signature?.status === "valid")
    .length;
  const timestampedRequiredHelperCount = requiredHelpers
    .filter((helper) => helper.signature?.timestamped === true)
    .length;
  const verifiedThirdPartyAssetCount = requiredThirdPartyAssets
    .filter((asset) => hasValidThirdPartyProvenance(asset))
    .length;

  const inventory = {
    phase: "0.13",
    status: "passed",
    benchmark: "signed-helper-inventory",
    signingPolicyWindowsHelperCount:
      signingPolicy.windowsHelpers.firstPartyFiles.length
      + signingPolicy.windowsHelpers.thirdPartyUnsigned.files.length,
    requiredHelpers,
    reservedHelpers,
    requiredThirdPartyAssets,
    requiredHelperCount: requiredHelpers.length,
    reservedHelperCount: reservedHelpers.length,
    signedRequiredHelperCount,
    timestampedRequiredHelperCount,
    verifiedThirdPartyAssetCount,
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
  for (const asset of inventory.requiredThirdPartyAssets ?? []) {
    if (!asset.artifact) {
      violations.push({
        code: "missing-required-third-party-artifact",
        id: asset.id,
        policyId: asset.policyId,
      });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(asset.artifact.sha256 ?? "")) {
      violations.push({ code: "missing-third-party-artifact-hash", id: asset.id });
    }
    if (!hasValidThirdPartyProvenance(asset)) {
      violations.push({ code: "third-party-provenance-invalid", id: asset.id });
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
    verifiedThirdPartyAssetCount: inventory.verifiedThirdPartyAssetCount ?? 0,
    reservedHelperCount: inventory.reservedHelperCount ?? 0,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function hasValidThirdPartyProvenance(asset) {
  const provenance = asset.provenance;
  return provenance?.status === "valid"
    && provenance.manifestSignature === "valid"
    && provenance.extractedFilesVerified === true
    && provenance.authenticodeMode === "vendor-unsigned"
    && /^[a-f0-9]{64}$/.test(provenance.upstreamSha256 ?? "")
    && provenance.upstreamSha256 === asset.artifact?.sha256;
}
