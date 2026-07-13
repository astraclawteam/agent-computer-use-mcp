const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export function matchesCommercialCandidateIdentity(identity, packageJson) {
  return hasCommercialCandidateIdentityShape(identity)
    && identity?.corePackage?.name === packageJson.name
    && identity?.corePackage?.version === packageJson.version
    && identity.platformPackage.version === packageJson.version
    && identity.corePackage.version === identity.platformPackage.version;
}

export function normalizeCommercialCandidateIdentity(identity) {
  if (!hasCommercialCandidateIdentityShape(identity)) {
    throw new Error("commercial.candidate_identity_invalid");
  }
  return Object.freeze({
    gitCommit: identity.gitCommit,
    corePackage: freezeCopy(identity.corePackage),
    platformPackage: freezeCopy(identity.platformPackage),
    driver: freezeCopy(identity.driver),
    overlay: freezeCopy(identity.overlay),
    ocrRuntime: freezeCopy(identity.ocrRuntime),
    modelPack: freezeCopy(identity.modelPack),
  });
}

function hasCommercialCandidateIdentityShape(identity) {
  return GIT_COMMIT_PATTERN.test(identity?.gitCommit ?? "")
    && hasNonEmptyString(identity?.corePackage?.name)
    && hasNonEmptyString(identity.corePackage.version)
    && hasSha256(identity.corePackage)
    && hasNonEmptyString(identity?.platformPackage?.name)
    && hasNonEmptyString(identity.platformPackage.version)
    && hasSha256(identity.platformPackage)
    && hasNonEmptyString(identity?.driver?.id)
    && hasNonEmptyString(identity.driver.version)
    && hasSha256(identity.driver)
    && hasNonEmptyString(identity?.overlay?.id)
    && hasSha256(identity.overlay)
    && identity?.ocrRuntime?.id === "onnxruntime-node"
    && hasNonEmptyString(identity.ocrRuntime.version)
    && hasSha256(identity.ocrRuntime)
    && hasNonEmptyString(identity?.modelPack?.id)
    && hasSha256(identity.modelPack);
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function hasSha256(component) {
  return SHA256_PATTERN.test(component?.sha256 ?? "");
}

function freezeCopy(value) {
  return Object.freeze({ ...value });
}
