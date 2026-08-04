import { readFile } from "node:fs/promises";

import {
  PHASE_6_RELEASE_EVIDENCE_PATH,
  computePhase6SourceIdentity,
  verifyPhase6ReleaseEvidence,
} from "../src/phase-6-release-evidence.mjs";

const sourceIdentity = await computePhase6SourceIdentity(process.cwd());
let manifest;
try {
  manifest = JSON.parse(await readFile(PHASE_6_RELEASE_EVIDENCE_PATH, "utf8"));
} catch (error) {
  throw Object.assign(new Error(`phase6.release_evidence_missing: ${error.message}`), {
    code: "phase6.release_evidence_missing",
  });
}
const result = verifyPhase6ReleaseEvidence(manifest, { sourceIdentity });
if (result.status !== "passed" || result.candidateArtifactAllowed !== true) {
  throw Object.assign(new Error(result.violation), { code: result.violation });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
