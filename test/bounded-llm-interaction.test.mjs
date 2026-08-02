import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOUNDED_LLM_DECISION_KINDS,
  BoundedLlmInteraction,
} from "../src/bounded-llm-interaction.mjs";

test("LLM goal understanding returns only the two Host workflow slots", async () => {
  const calls = [];
  const decisions = new BoundedLlmInteraction({
    complete: async (request) => {
      calls.push(request);
      return { query: "林舟", message: "今晚七点见" };
    },
  });

  const goal = await decisions.understandGoal({ userGoal: "请找到林舟并告诉他今晚七点见" });

  assert.deepEqual(goal, { query: "林舟", message: "今晚七点见" });
  assert.equal(calls[0].kind, "understand-goal");
  assert.deepEqual(Object.keys(calls[0].input), ["userGoal"]);
  assert.equal(JSON.stringify(calls[0]).includes("coordinate"), false);
  assert.equal(JSON.stringify(calls[0]).includes("lifecycle"), false);
});

test("candidate selection exposes only Host-owned semantic candidates and accepts one opaque id", async () => {
  let received;
  const decisions = new BoundedLlmInteraction({
    complete: async (request) => {
      received = request;
      return { candidateId: "candidate:1" };
    },
  });
  const candidates = [
    hostCandidate("candidate:0", "林州"),
    hostCandidate("candidate:1", "林舟"),
  ];

  const selected = await decisions.selectCandidate({
    intent: "林先生",
    sceneId: "scene:8",
    observationVersion: 8,
    candidates,
  });

  assert.deepEqual(selected, { candidateId: "candidate:1" });
  assert.deepEqual(received.input.candidates, candidates);
  assert.equal(JSON.stringify(received).includes("elementId"), false);
  assert.equal(JSON.stringify(received).includes("bounds"), false);
  assert.equal(JSON.stringify(received).includes("chat"), false);
});

test("unknown or over-privileged model candidate output is rejected before Host action", async () => {
  const candidates = [hostCandidate("candidate:0", "林舟")];
  const unknown = new BoundedLlmInteraction({
    complete: async () => ({ candidateId: "candidate:99" }),
  });
  await assert.rejects(unknown.selectCandidate({
    intent: "林舟",
    sceneId: "scene:1",
    observationVersion: 1,
    candidates,
  }), { code: "llm.selection_unknown_candidate" });

  const coordinates = new BoundedLlmInteraction({
    complete: async () => ({ candidateId: "candidate:0", x: 10, y: 20 }),
  });
  await assert.rejects(coordinates.selectCandidate({
    intent: "林舟",
    sceneId: "scene:1",
    observationVersion: 1,
    candidates,
  }), { code: "llm.output_contract_violation" });
});

test("visual layout decisions require an explicit Host ambiguity and return only an option id", async () => {
  let received;
  const decisions = new BoundedLlmInteraction({
    complete: async (request) => {
      received = request;
      return { optionId: "layout:secondary" };
    },
  });
  const result = await decisions.resolveVisualAmbiguity({
    sceneId: "scene:12",
    observationVersion: 12,
    visualEvidenceId: "visual-evidence:12",
    hostAssessment: {
      kind: "layout",
      requiresVisualUnderstanding: true,
      evidenceConsistency: "ambiguous",
    },
    question: "Which owned surface contains the intended control?",
    options: [{ optionId: "layout:primary", role: "primary-pane", parentRole: "application" }, {
      optionId: "layout:secondary",
      role: "secondary-pane",
      parentRole: "application",
    }],
  });

  assert.deepEqual(result, { optionId: "layout:secondary" });
  assert.equal(received.kind, "resolve-visual-ambiguity");
  assert.equal(received.input.visualEvidenceId, "visual-evidence:12");
  assert.equal(JSON.stringify(received).includes("coordinate"), false);

  await assert.rejects(decisions.resolveVisualAmbiguity({
    sceneId: "scene:12",
    observationVersion: 12,
    visualEvidenceId: "visual-evidence:12",
    hostAssessment: {
      kind: "layout",
      requiresVisualUnderstanding: false,
      evidenceConsistency: "ambiguous",
    },
    question: "Choose",
    options: [{ optionId: "layout:primary", role: "pane", parentRole: "application" }],
  }), { code: "llm.visual_not_required" });
});

test("failure decisions are limited to reobserve or report and can never request replay", async () => {
  const decisions = new BoundedLlmInteraction({
    complete: async () => ({ decision: "reobserve" }),
  });
  assert.deepEqual(await decisions.decideFailure({
    failure: {
      code: "workflow.action_indeterminate",
      step: "select-result",
      outcome: "indeterminate",
    },
    canReobserve: true,
  }), { decision: "reobserve" });

  const replay = new BoundedLlmInteraction({
    complete: async () => ({ decision: "replay" }),
  });
  await assert.rejects(replay.decideFailure({
    failure: {
      code: "workflow.action_indeterminate",
      step: "select-result",
      outcome: "indeterminate",
    },
    canReobserve: true,
  }), { code: "llm.output_contract_violation" });

  const forcedReport = new BoundedLlmInteraction({
    complete: async () => ({ decision: "reobserve" }),
  });
  await assert.rejects(forcedReport.decideFailure({
    failure: {
      code: "workflow.invalid_scene",
      step: "wait-results-stable",
      outcome: "not-applied",
    },
    canReobserve: false,
  }), { code: "llm.reobserve_not_allowed" });
});

test("the four decision kinds are frozen and contain no action or lifecycle operation", () => {
  assert.deepEqual(BOUNDED_LLM_DECISION_KINDS, [
    "understand-goal",
    "select-candidate",
    "resolve-visual-ambiguity",
    "decide-failure",
  ]);
});

test("an already-cancelled Host signal prevents a model call", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort("operator-stop");
  const decisions = new BoundedLlmInteraction({
    complete: async () => {
      calls += 1;
      return { query: "林舟", message: "消息" };
    },
  });

  await assert.rejects(decisions.understandGoal({
    userGoal: "发送消息",
    signal: controller.signal,
  }), { code: "llm.decision_cancelled" });
  assert.equal(calls, 0);
});

function hostCandidate(candidateId, label) {
  return {
    candidateId,
    label,
    role: "search-result",
    parentRole: "search-results",
    evidenceSources: ["structure"],
  };
}
