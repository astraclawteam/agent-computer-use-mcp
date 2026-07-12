const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

export function validateFormalReleaseIdentity(input = {}) {
  const violations = [];
  const tagMatch = TAG_PATTERN.exec(input.tag ?? "");
  if (!tagMatch) {
    violations.push(violation("release.tag_invalid", "Formal release tag must match vX.Y.Z."));
  } else if (input.tag !== `v${input.packageVersion}`) {
    violations.push(violation("release.version_mismatch", "Tag does not match package.json version."));
  }
  if (!COMMIT_PATTERN.test(input.commit ?? "")) {
    violations.push(violation("release.commit_invalid", "Release commit must be a full lowercase Git SHA."));
  } else if (!(input.mainCommits ?? []).includes(input.commit)) {
    violations.push(violation("release.commit_not_on_main", "Release commit is not reachable from main."));
  }
  const escapedVersion = escapeRegExp(input.packageVersion ?? "");
  if (!new RegExp(`^##\\s+(?:\\[)?${escapedVersion}(?:\\])?(?:\\s|$)`, "mu").test(input.changelog ?? "")) {
    violations.push(violation("release.changelog_missing", "CHANGELOG.md has no heading for the release version."));
  }
  if (input.packageName !== "agent-computer-use-mcp") {
    violations.push(violation("release.package_name_invalid", "Unexpected release package name."));
  }
  return result(violations);
}

export function validatePlatformReleasePlan(plan = {}) {
  const violations = [];
  const expectedAssets = [
    `agent-computer-use-mcp-${plan.version}.tgz`,
    `agent-computer-use-win32-x64-${plan.version}.tgz`,
    `agent-computer-use-mcp-${plan.version}-windows-x64.zip`,
    "checksums.txt",
    "release-manifest.json",
    "SBOM.cdx.json",
  ];
  if (JSON.stringify(plan.assets) !== JSON.stringify(expectedAssets)) {
    violations.push(violation("release.assets_invalid", "Release artifact inventory does not match the platform contract."));
  }
  if (JSON.stringify(plan.npmPublishOrder) !== JSON.stringify([
    "@xiaozhiclaw/agent-computer-use-win32-x64",
    "agent-computer-use-mcp",
  ])) {
    violations.push(violation("release.npm_order_invalid", "Platform npm package must publish before core."));
  }
  if (plan.provenance !== true) violations.push(violation("release.provenance_required", "npm provenance is required."));
  if (plan.githubDraftFirst !== true) violations.push(violation("release.github_draft_required", "GitHub draft must exist before npm publication."));
  if (plan.runtimeDownloadAllowed !== false) violations.push(violation("release.runtime_download_forbidden", "Runtime downloads are forbidden."));
  return result(violations);
}

function result(violations) {
  return { status: violations.length === 0 ? "passed" : "failed", violations };
}

function violation(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
