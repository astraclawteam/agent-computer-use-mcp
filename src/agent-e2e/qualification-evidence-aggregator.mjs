import { evaluateAgentE2eQualification } from "./qualification-aggregator.mjs";
import { verifyQualificationEvidence } from "./qualification-evidence.mjs";

export async function evaluateQualificationEvidenceDirectories(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return Object.freeze({
      status: "failed",
      agentE2eEligible: false,
      violations: Object.freeze([{ code: "promotion.agent_e2e_missing" }]),
      verified: Object.freeze([]),
    });
  }
  const verified = await Promise.all(paths.map((path) => verifyQualificationEvidence(path)));
  const violations = verified
    .filter((entry) => entry.status !== "passed")
    .map((entry) => ({ code: "promotion.agent_e2e_invalid", runId: entry.runId }));
  const valid = verified.filter((entry) => entry.status === "passed");
  const candidateIdentity = valid[0]?.manifest?.candidateIdentity ?? null;
  const tasks = new Map();
  const attempts = valid.map((entry) => {
    const manifest = entry.manifest;
    if (!tasks.has(manifest.taskId)) tasks.set(manifest.taskId, { taskId: manifest.taskId, promptSha256: manifest.promptSha256 });
    return {
      runId: entry.runId,
      taskId: manifest.taskId,
      lane: manifest.lane,
      repetition: manifest.repetition,
      retry: manifest.retry ?? 0,
      status: entry.verification?.status === "passed" && entry.cleanup?.status === "passed" ? "passed" : "failed",
      failureClass: entry.cleanup?.status !== "passed"
        ? "cleanup-failure"
        : entry.verification?.failureClass ?? null,
      evidenceKind: manifest.evidenceKind,
      promptSha256: manifest.promptSha256,
      candidateIdentity: manifest.candidateIdentity,
    };
  });
  const aggregate = evaluateAgentE2eQualification({
    tasks: [...tasks.values()],
    candidateIdentity,
    attempts,
  });
  violations.push(...aggregate.violations);
  return Object.freeze({
    ...aggregate,
    status: violations.length === 0 ? "passed" : "failed",
    agentE2eEligible: violations.length === 0 && aggregate.agentE2eEligible,
    candidateIdentity,
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
    verified: Object.freeze(verified),
  });
}
