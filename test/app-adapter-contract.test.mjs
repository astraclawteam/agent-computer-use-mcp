import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAppAdapterRegistry,
  runAppAdapter,
} from "../src/app-adapters/index.mjs";

const EXECUTABLE = {
  path: "C:/private/path/Fixture.exe",
  fileName: "Fixture.exe",
  version: "1.2.3",
  sizeBytes: 42,
  sha256: "a".repeat(64),
};

test("adapter runs the exact lifecycle and sanitizes executable identity", async () => {
  const calls = [];
  const adapter = lifecycleAdapter(calls);
  const result = await runAppAdapter(adapter, activeContext());

  assert.deepEqual(calls, ["discover", "prepare", "launch", "observe", "act", "verify", "cleanup"]);
  assert.equal(result.status, "pass");
  assert.deepEqual(result.finalState, { kind: "file-bytes", sha256: "b".repeat(64), sizeBytes: 8 });
  assert.deepEqual(result.executable, {
    fileName: "Fixture.exe",
    version: "1.2.3",
    sizeBytes: 42,
    sha256: "a".repeat(64),
  });
  assert.equal(result.executable.path, undefined);
});

test("adapter cleanup runs after a failure in every lifecycle method and preserves the first error", async () => {
  for (const failingMethod of ["discover", "prepare", "launch", "observe", "act", "verify"]) {
    const calls = [];
    const adapter = lifecycleAdapter(calls, {
      [failingMethod]: async () => {
        calls.push(failingMethod);
        throw codedError(`app.${failingMethod}_failed`);
      },
      cleanup: async () => {
        calls.push("cleanup");
        throw codedError("app.cleanup_failed");
      },
    });

    const result = await runAppAdapter(adapter, activeContext());
    assert.equal(calls.at(-1), "cleanup", failingMethod);
    assert.equal(result.status, "product-failure", failingMethod);
    assert.equal(result.reason, `app.${failingMethod}_failed`, failingMethod);
    assert.equal(result.cleanup.status, "failed", failingMethod);
    assert.equal(result.cleanup.reason, "app.cleanup_failed", failingMethod);
  }
});

test("adapter never acts without an active control lease", async () => {
  const calls = [];
  const adapter = lifecycleAdapter(calls);
  const result = await runAppAdapter(adapter, { controlLease: { id: "lease-1", status: "revoked" } });

  assert.deepEqual(calls, ["discover", "prepare", "launch", "observe", "cleanup"]);
  assert.equal(result.status, "product-failure");
  assert.equal(result.reason, "app.control_lease_required");
});

test("adapter rejects a successful click without final state evidence", async () => {
  const calls = [];
  const adapter = lifecycleAdapter(calls, {
    verify: async () => {
      calls.push("verify");
      return { clicked: true };
    },
  });
  const result = await runAppAdapter(adapter, activeContext());

  assert.equal(result.status, "product-failure");
  assert.equal(result.reason, "app.final_state_required");
  assert.equal(calls.at(-1), "cleanup");
});

test("adapter accepts only approved final state kinds and all six result statuses", async () => {
  for (const kind of ["file-bytes", "accessibility-value", "window-state", "policy-event"]) {
    const result = await runAppAdapter(lifecycleAdapter([], {
      verify: async () => ({ finalState: { kind, value: "verified" } }),
    }), activeContext());
    assert.equal(result.status, "pass", kind);
  }

  const insufficient = await runAppAdapter(lifecycleAdapter([], {
    observe: async () => ({ status: "insufficient-perception", reason: "observation.insufficient" }),
  }), activeContext());
  assert.equal(insufficient.status, "insufficient-perception");

  const absent = await runAppAdapter(lifecycleAdapter([], {
    discover: async () => ({ status: "not-installed", reason: "app.executable_missing" }),
  }), activeContext());
  assert.equal(absent.status, "not-installed");

  const blocked = await runAppAdapter(lifecycleAdapter([], {
    verify: async () => ({
      status: "policy-blocked",
      reason: "policy.capture_denied",
      finalState: { kind: "policy-event", code: "policy.capture_denied" },
    }),
  }), activeContext());
  assert.equal(blocked.status, "policy-blocked");

  const infrastructure = await runAppAdapter(lifecycleAdapter([], {
    launch: async () => { throw codedError("runner.desktop_unavailable", "infrastructure-error"); },
  }), activeContext());
  assert.equal(infrastructure.status, "infrastructure-error");
});

test("adapter registry rejects incomplete or duplicate adapters", () => {
  assert.throws(
    () => createAppAdapterRegistry({ broken: { discover() {} } }),
    /app\.adapter_method_required/u,
  );

  const adapter = lifecycleAdapter([]);
  const registry = createAppAdapterRegistry({ fixture: adapter });
  assert.equal(registry.get("fixture"), adapter);
  assert.throws(() => registry.get("missing"), /app\.adapter_not_registered/u);
});

function lifecycleAdapter(calls, overrides = {}) {
  return {
    async discover() {
      calls.push("discover");
      return { executable: EXECUTABLE };
    },
    async prepare() {
      calls.push("prepare");
      return { fixture: { path: "temporary.txt" } };
    },
    async launch() {
      calls.push("launch");
      return { app: { pid: 123 } };
    },
    async observe() {
      calls.push("observe");
      return { observation: { token: "element-1" } };
    },
    async act() {
      calls.push("act");
      return { action: { token: "element-1" } };
    },
    async verify() {
      calls.push("verify");
      return { finalState: { kind: "file-bytes", sha256: "b".repeat(64), sizeBytes: 8 } };
    },
    async cleanup() {
      calls.push("cleanup");
    },
    ...overrides,
  };
}

function activeContext() {
  return { controlLease: { id: "lease-1", status: "active" } };
}

function codedError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}
