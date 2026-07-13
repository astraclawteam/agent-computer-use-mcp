import {
  matchesCommercialCandidateIdentity,
  normalizeCommercialCandidateIdentity,
} from "./commercial-candidate-identity.mjs";

export function buildRealAppEvidenceManifest(options) {
  const candidateIdentity = normalizeCommercialCandidateIdentity(options.candidateIdentity);
  if (!matchesCommercialCandidateIdentity(candidateIdentity, options.packageJson)) {
    throw new Error("app.real_smoke_candidate_identity_mismatch");
  }
  return Object.freeze({
    schemaVersion: 1,
    phase: "6.2",
    package: Object.freeze({ name: options.packageJson.name, version: options.packageJson.version }),
    candidateIdentity,
    platform: options.platform,
    architecture: options.architecture,
    filters: Object.freeze({
      roles: Object.freeze([...(options.filters?.roles ?? [])]),
      appIds: Object.freeze([...(options.filters?.appIds ?? [])]),
    }),
  });
}
