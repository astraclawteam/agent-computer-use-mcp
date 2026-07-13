import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { fusePerceptionProposals } from "../src/perception-proposal-fusion.mjs";

test("fusion clusters independent providers and attaches the OCR label", () => {
  const result = fusePerceptionProposals({
    som: [proposal("som-proposal", box(28, 45, 92, 38), 0.94)],
    ocr: [proposal("ocr", box(24, 41, 108, 49), 0.99, { label: "Apply" })],
    template: [],
    ignored: [],
  });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.observationProposals.length, 0);
  assert.equal(result.proposals[0].label, "Apply");
  assert.deepEqual(result.proposals[0].box, box(28, 45, 92, 38));
  assert.deepEqual(result.proposals[0].support.map((entry) => entry.provider), ["ocr", "som-proposal"]);
  assert.equal(result.proposals[0].confidence >= 0.98, true);
  assert.equal(result.proposals[0].actionEligible, true);
  assert.deepEqual(result.proposals[0].sourceRegion, result.proposals[0].box);
  assert.deepEqual(result.proposals[0].modelIdentity, { provider: "local-proposal-fusion", model: "som-ocr-v1" });
  assert.deepEqual(result.proposals[0].actions, ["click"]);
});

test("fusion uses one contribution per provider and suppresses duplicate boxes", () => {
  const target = box(10, 10, 80, 30);
  const result = fusePerceptionProposals({
    som: [
      proposal("som-proposal", target, 0.94),
      proposal("som-proposal", box(11, 10, 80, 30), 0.91),
    ],
    ocr: [proposal("ocr", box(8, 8, 86, 34), 0.99, { label: "Save" })],
    template: [],
    ignored: [],
  });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].support.length, 2);
});

test("exact approved templates may act alone while other single-source boxes remain observation only", () => {
  const result = fusePerceptionProposals({
    template: [
      proposal("template", box(10, 10, 30, 30), 0.996, { exact: true, approvedActionLabel: true, label: "Undo" }),
      proposal("template", box(60, 10, 30, 30), 0.999, { exact: true, approvedActionLabel: false, label: "Unknown" }),
    ],
    som: [proposal("som-proposal", box(110, 10, 30, 30), 0.99)],
    ocr: [proposal("ocr", box(160, 10, 30, 30), 0.999, { label: "Text" })],
    ignored: [],
  });

  assert.deepEqual(result.proposals.map((entry) => entry.label), ["Undo"]);
  assert.equal(result.proposals[0].source, "template");
  assert.equal(result.proposals[0].exact, true);
  assert.equal(result.proposals[0].approvedActionLabel, true);
  assert.equal(result.observationProposals.length, 3);
  assert.equal(result.observationProposals.every((entry) => entry.actionEligible === false), true);
});

test("ignored decorative regions and low-confidence support never become action proposals", () => {
  const decorative = box(300, 20, 20, 20);
  const low = box(20, 20, 80, 30);
  const result = fusePerceptionProposals({
    som: [proposal("som-proposal", decorative, 0.99), proposal("som-proposal", low, 0.84)],
    ocr: [proposal("ocr", decorative, 0.999, { label: "dot" }), proposal("ocr", low, 0.89, { label: "Apply" })],
    template: [],
    ignored: [{ box: decorative, reason: "decoration" }],
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(result.observationProposals.length, 1);
  assert.equal(result.ignoredClusters, 1);
});

test("regression corpus keeps accurate SOM targets and refuses every SOM-only false positive", async () => {
  const manifest = JSON.parse(await readFile("test/fixtures/perception/regressions/manifest.json", "utf8"));
  for (const sample of manifest.samples) {
    const target = sample.annotation.targets[0].box;
    const result = fusePerceptionProposals({
      som: [
        proposal("som-proposal", target, 0.94),
        proposal("som-proposal", box(13, 13, 334, 194), 0.71),
      ],
      ocr: [proposal("ocr", expand(target, 10), 0.99, { label: sample.annotation.targets[0].label })],
      template: [],
      ignored: sample.annotation.ignored,
    });
    assert.equal(result.proposals.length, 1, sample.id);
    assert.equal(result.proposals[0].label, sample.annotation.targets[0].label, sample.id);
    assert.equal(result.observationProposals.every((entry) => entry.actionEligible === false), true, sample.id);
  }
});

function proposal(provider, proposalBox, confidence, extra = {}) {
  return { provider, box: proposalBox, confidence, proposalId: `${provider}-${proposalBox.x}`, ...extra };
}

function box(x, y, width, height) {
  return { x, y, width, height };
}

function expand(value, amount) {
  return {
    x: Math.max(0, value.x - amount),
    y: Math.max(0, value.y - amount),
    width: value.width + amount * 2,
    height: value.height + amount * 2,
  };
}
