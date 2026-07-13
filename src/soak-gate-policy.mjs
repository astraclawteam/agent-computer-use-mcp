import { COMMERCIAL_RUNTIME_TARGETS } from "./commercial-runtime-metrics.mjs";

const THRESHOLDS = Object.freeze({ ...COMMERCIAL_RUNTIME_TARGETS });

export const SOAK_GATES = Object.freeze({
  "pull-request": gate({
    id: "pull-request",
    durationMs: 900_000,
    clientCount: 2,
    concurrency: 2,
    faultEveryRounds: 20,
    minimumCheckpointCount: 1,
  }),
  nightly: gate({
    id: "nightly",
    durationMs: 7_200_000,
    clientCount: 4,
    concurrency: 3,
    faultEveryRounds: 100,
    minimumCheckpointCount: 12,
  }),
  "release-candidate": gate({
    id: "release-candidate",
    durationMs: 28_800_000,
    clientCount: 4,
    concurrency: 3,
    faultEveryRounds: 100,
    minimumCheckpointCount: 48,
  }),
});

export function resolveSoakGate(name, durationMs) {
  const soakGate = SOAK_GATES[String(name ?? "")];
  if (!soakGate) throw new Error(`runtime.soak_gate_unknown: ${name}`);
  if (durationMs !== soakGate.durationMs) {
    throw new Error(`runtime.soak_duration_mismatch: expected ${soakGate.durationMs}`);
  }
  return soakGate;
}

function gate(options) {
  return Object.freeze({
    ...options,
    sampleIntervalMs: 10_000,
    thresholds: THRESHOLDS,
  });
}
