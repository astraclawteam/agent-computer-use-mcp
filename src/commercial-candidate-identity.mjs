const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export function matchesCommercialCandidateIdentity(identity, packageJson) {
  return GIT_COMMIT_PATTERN.test(identity?.gitCommit ?? "")
    && identity?.corePackage?.name === packageJson.name
    && identity?.corePackage?.version === packageJson.version
    && hasSha256(identity.corePackage)
    && hasNonEmptyString(identity?.platformPackage?.name)
    && identity.platformPackage.version === packageJson.version
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
