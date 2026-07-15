import { lstat } from "node:fs/promises";
import { extname, resolve } from "node:path";

export async function validateCampaignInputs(options = {}) {
  const releasePackage = await validateReleasedPackage(options.releasePackage);
  const platformPackage = await validateReleasedPackage(options.platformPackage);
  if (releasePackage === platformPackage) throw preflightError("agent_e2e.released_package_identity_invalid");
  if (typeof options.evidenceRoot !== "string" || options.evidenceRoot.trim() === "") {
    throw preflightError("agent_e2e.evidence_root_required");
  }
  return Object.freeze({ releasePackage, platformPackage, evidenceRoot: resolve(options.evidenceRoot) });
}

export function evaluateHostDiscovery(lanes = []) {
  const requiredKeys = new Set([
    "codex",
    "claude-desktop",
    "xiaozhi-deepseek-v4-flash",
    "xiaozhi-claude-sonnet-5",
  ]);
  const actualKeys = new Set(lanes.map((lane) => lane.lane ?? lane.hostId));
  const blockers = lanes.filter((lane) => !lane.available).map((lane) => lane.blocker ?? "agent_e2e.host_unavailable");
  for (const key of requiredKeys) if (!actualKeys.has(key)) blockers.push(`agent_e2e.host_lane_missing:${key}`);
  const unique = [...new Set(blockers)];
  return Object.freeze({
    status: unique.length === 0 ? "ready" : "blocked",
    qualificationClaim: false,
    blockers: Object.freeze(unique),
    lanes: Object.freeze(lanes.map((lane) => Object.freeze({ ...lane }))),
  });
}

async function validateReleasedPackage(path) {
  if (typeof path !== "string" || extname(path).toLowerCase() !== ".tgz") {
    throw preflightError("agent_e2e.released_package_required");
  }
  const resolved = resolve(path);
  let stat;
  try { stat = await lstat(resolved); }
  catch { throw preflightError("agent_e2e.released_package_required"); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw preflightError("agent_e2e.released_package_required");
  return resolved;
}

function preflightError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
