import assert from "node:assert/strict";
import { test } from "node:test";

import { SOAK_GATES, resolveSoakGate } from "../src/soak-gate-policy.mjs";
import {
  parseRuntimeSoakArgs,
  validateRuntimeSoakOptions,
} from "../src/runtime-soak-evidence.mjs";

test("commercial soak gates freeze exact durations workloads thresholds and checkpoints", () => {
  assert.equal(resolveSoakGate("pull-request", 900_000).minimumCheckpointCount, 1);
  assert.equal(resolveSoakGate("nightly", 7_200_000).durationMs, 7_200_000);
  assert.equal(resolveSoakGate("nightly", 7_200_000).minimumCheckpointCount, 12);
  assert.equal(resolveSoakGate("release-candidate", 28_800_000).durationMs, 28_800_000);
  assert.equal(resolveSoakGate("release-candidate", 28_800_000).minimumCheckpointCount, 48);
  assert.equal(SOAK_GATES.nightly.sampleIntervalMs, 10_000);
  assert.equal(SOAK_GATES.nightly.checkpointIntervalMs, 600_000);
  assert.equal(SOAK_GATES.nightly.clientCount, 4);
  assert.equal(SOAK_GATES.nightly.concurrency, 3);
  assert.equal(SOAK_GATES.nightly.faultEveryRounds, 100);
  assert.equal(SOAK_GATES.nightly.thresholds.maxRssGrowthBytes, 128 * 1024 * 1024);
  assert.equal(SOAK_GATES.nightly.thresholds.maxHandleGrowth, 128);
  assert.equal(SOAK_GATES.nightly.thresholds.maxFailureRate, 0.001);
  assert.equal(Object.isFrozen(SOAK_GATES), true);
  assert.equal(Object.isFrozen(SOAK_GATES.nightly), true);
  assert.equal(Object.isFrozen(SOAK_GATES.nightly.thresholds), true);
});

test("named gates reject unknown names wrong durations and weakened workloads", () => {
  assert.throws(() => resolveSoakGate("release-candidate", 60_000), /runtime.soak_duration_mismatch/);
  assert.throws(() => resolveSoakGate("unknown", 60_000), /runtime.soak_gate_unknown/);
  assert.throws(
    () => validateRuntimeSoakOptions({
      gate: "nightly",
      durationMs: 7_200_000,
      evidenceRoot: "evidence/nightly",
      clientCount: 1,
    }),
    /runtime.soak_gate_parameter_mismatch/,
  );
  assert.throws(
    () => parseRuntimeSoakArgs([
      "--gate", "nightly",
      "--duration-ms", "7200000",
      "--evidence-root", "evidence/nightly",
    ], { AGENT_COMPUTER_USE_SOAK_CONCURRENCY: "1" }),
    /runtime.soak_gate_parameter_mismatch/,
  );
});

test("named gates supply every immutable runner parameter when no override is present", () => {
  const options = parseRuntimeSoakArgs([
    "--gate", "release-candidate",
    "--duration-ms", "28800000",
    "--evidence-root", "evidence/release-candidate",
  ], {});

  assert.deepEqual(options, {
    gate: "release-candidate",
    durationMs: 28_800_000,
    evidenceRoot: "evidence/release-candidate",
    seed: 20260713,
    clientCount: 4,
    concurrency: 3,
    faultEveryRounds: 100,
    sampleIntervalMs: 10_000,
    checkpointIntervalMs: 600_000,
    minimumCheckpointCount: 48,
    maxRssGrowthBytes: 128 * 1024 * 1024,
    maxHandleGrowth: 128,
    maxFailureRate: 0.001,
  });
});
