import { createPolicyDenyProof } from "./policy-deny-proof.mjs";

const proof = createPolicyDenyProof();
const passed = proof.status === "passed"
  && proof.deniedSurfaceIds.length === 5
  && proof.actionExecutionBlocked === true
  && proof.includeUserOverlay === false
  && proof.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "1.11",
  benchmark: "policy-deny-proof",
  deniedSurfaceCount: proof.deniedSurfaceIds.length,
  denialCodes: proof.denials.map((denial) => denial.code),
  violations: proof.violations,
  actionExecutionBlocked: proof.actionExecutionBlocked,
  startsDesktopControl: proof.startsDesktopControl,
  includeUserOverlay: proof.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
