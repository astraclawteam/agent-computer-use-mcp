import assert from "node:assert/strict";
import { test } from "node:test";

import { createObservationCapturePlan, shouldIncludeOverlayInObservation } from "../src/observation-policy.mjs";

test("Computer Use overlay is a user-only affordance and never part of agent observation", () => {
  assert.equal(shouldIncludeOverlayInObservation(), false);
});

test("observation capture plan hides the Computer Use overlay before screenshot capture", () => {
  const plan = createObservationCapturePlan();

  assert.equal(plan.includeUserOverlay, false);
  assert.deepEqual(plan.hideSelectorsBeforeCapture, ["[data-computer-use-frame]"]);
  assert.deepEqual(plan.restoreSelectorsAfterCapture, ["[data-computer-use-frame]"]);
  assert.equal(plan.primaryObservation, "ax-som");
});
