import assert from "node:assert/strict";
import { test } from "node:test";

import { createPhase06Report } from "../src/phase-0-6-report.mjs";

test("Phase 0.6 report blocks real execution when cua-driver is unavailable", () => {
  const report = createPhase06Report({
    doctor: {
      status: "unavailable",
      reason: "not-found",
      detail: "cua-driver was not found",
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.steps[0].name, "Backend doctor");
  assert.equal(report.steps[0].status, "blocked");
  assert.match(report.nextAction, /install or configure cua-driver/);
});

test("Phase 0.6 report allows Lab execution only after healthy driver doctor", () => {
  const report = createPhase06Report({
    doctor: {
      status: "healthy",
      driverPath: "C:\\tools\\cua-driver.exe",
      version: "cua-driver 0.7.1",
    },
  });

  assert.equal(report.status, "ready");
  assert.equal(report.steps[0].status, "passed");
  assert.equal(report.steps[1].name, "Computer Use Lab");
  assert.equal(report.steps[1].status, "pending");
  assert.match(report.nextAction, /open Computer Use Lab/);
});
