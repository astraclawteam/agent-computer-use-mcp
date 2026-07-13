import { verifyEvidenceDirectory } from "../src/commercial-evidence.mjs";
import { resolveRuntimeSoakIdentity } from "../src/runtime-soak-evidence.mjs";

const path = process.argv[2];
if (!path) throw new Error("evidence.verify_path_required");
const identity = await resolveRuntimeSoakIdentity();
const verification = await verifyEvidenceDirectory(path, {
  gitCommit: identity.gitCommit,
  dirtyWorktree: false,
  corePackage: identity.corePackage,
  platformPackage: identity.platformPackage,
  driver: identity.driver,
  overlay: identity.overlay,
  modelPack: identity.modelPack,
});
process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
process.exitCode = verification.status === "passed" ? 0 : 1;
