import { resolveRuntimeSoakIdentity } from "../src/runtime-soak-evidence.mjs";
import { importVerifiedEvidence } from "../src/commercial-evidence-import.mjs";

const source = process.argv[2];
if (!source || process.argv.length > 3) throw new Error("commercial.evidence_source_argument_required");
const identity = await resolveRuntimeSoakIdentity();
const imported = await importVerifiedEvidence({
  source,
  store: process.env.AGENT_COMPUTER_USE_EVIDENCE_STORE ?? "evidence/imported",
  expected: {
    gitCommit: identity.gitCommit,
    dirtyWorktree: false,
    corePackage: identity.corePackage,
    platformPackage: identity.platformPackage,
    driver: identity.driver,
    overlay: identity.overlay,
    modelPack: identity.modelPack,
  },
});
process.stdout.write(`${JSON.stringify(imported, null, 2)}\n`);
