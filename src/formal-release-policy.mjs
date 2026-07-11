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

export function validateAuthenticodeEvidence({ evidence = [], expectedPublisher, requiredPaths = [] } = {}) {
  const violations = [];
  const byPath = new Map(evidence.map((item) => [normalizePath(item.path), item]));
  for (const requiredPath of requiredPaths) {
    if (!byPath.has(normalizePath(requiredPath))) {
      violations.push(violation("release.signature_missing", `Missing Authenticode evidence: ${requiredPath}`, requiredPath));
    }
  }
  for (const item of evidence) {
    if (/candidate|test|development/iu.test(`${item.path} ${item.profileType ?? ""}`)) {
      violations.push(violation("release.candidate_signature_forbidden", "Candidate or test signing evidence is not distributable.", item.path));
    }
    if (item.status !== "Valid") {
      violations.push(violation("release.authenticode_invalid", "Authenticode status is not Valid.", item.path));
    }
    if (item.profileType !== "PublicTrust") {
      violations.push(violation("release.public_trust_required", "Production signing must use a PublicTrust profile.", item.path));
    }
    if (item.timestamped !== true || item.timestampStatus !== "Valid") {
      violations.push(violation("release.timestamp_required", "A valid trusted timestamp is required.", item.path));
    }
    if (!expectedPublisher || item.publisher !== expectedPublisher) {
      violations.push(violation("release.publisher_mismatch", "Authenticode publisher does not match policy.", item.path));
    }
  }
  return result(violations);
}

function result(violations) {
  return { status: violations.length === 0 ? "passed" : "failed", violations };
}

function violation(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
