import { buildReleaseReadinessGate, validateReleaseReadinessGate } from "./release-readiness-gate.mjs";

const gate = buildReleaseReadinessGate();
const validation = validateReleaseReadinessGate(gate);
const passed = validation.status === "passed";

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "0.11",
  benchmark: "release-readiness-gate",
  releaseGate: gate.releaseGate,
  executionMode: gate.executionMode,
  commandCount: validation.commandCount,
  evidenceCount: validation.evidenceCount,
  invariantCount: validation.invariantCount,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
