import assert from "node:assert/strict";
import test from "node:test";

import { HOST_DRIVER_METHODS, assertHostDriver } from "../src/agent-e2e/host-driver.mjs";

test("host driver exposes agent-host session methods only", () => {
  assert.deepEqual(HOST_DRIVER_METHODS, [
    "discover",
    "createSession",
    "configureMcp",
    "submitPrompt",
    "waitForTerminal",
    "collectEvidence",
    "cancel",
    "close",
  ]);
  assert.equal(assertHostDriver(validDriver()), true);
});

test("host driver rejects target control and observation authority", () => {
  for (const method of [
    "callTool",
    "clickTarget",
    "typeTarget",
    "injectToolResult",
    "observeTarget",
    "alterObservation",
  ]) {
    assert.throws(
      () => assertHostDriver({ ...validDriver(), [method]() {} }),
      new RegExp(`agent_e2e\\.host_method_forbidden: ${method}`, "u"),
    );
  }
});

test("host driver rejects an incomplete session surface", () => {
  const driver = validDriver();
  delete driver.cancel;
  assert.throws(() => assertHostDriver(driver), /agent_e2e\.host_method_required: cancel/u);
});

function validDriver() {
  return {
    async discover() {},
    async createSession() {},
    async configureMcp() {},
    async submitPrompt() {},
    async waitForTerminal() {},
    async collectEvidence() {},
    async cancel() {},
    async close() {},
  };
}
