import assert from "node:assert/strict";
import { test } from "node:test";

import { checkCuaDriverHealth, resolveCuaDriverCandidate } from "../src/driver-health.mjs";

test("resolveCuaDriverCandidate prefers explicit environment variables", () => {
  assert.equal(
    resolveCuaDriverCandidate({ AGENT_COMPUTER_USE_CUA_DRIVER: "C:\\tools\\cua-driver.exe" }),
    "C:\\tools\\cua-driver.exe",
  );
});

test("checkCuaDriverHealth reports not-found without running a missing driver", async () => {
  const result = await checkCuaDriverHealth({
    env: {},
    lookupOnPath: async () => null,
    runDriver: async () => {
      throw new Error("should not run");
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "not-found");
  assert.equal(result.driverPath, undefined);
});

test("checkCuaDriverHealth treats PATH lookup failures as unavailable instead of throwing", async () => {
  const result = await checkCuaDriverHealth({
    env: {},
    lookupOnPath: async () => {
      throw new Error("cua-driver lookup timed out after 5000ms");
    },
    runDriver: async () => {
      throw new Error("should not run");
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "lookup-error");
  assert.match(result.detail, /lookup timed out/);
});

test("checkCuaDriverHealth reports healthy when the driver answers --version", async () => {
  const result = await checkCuaDriverHealth({
    env: {},
    lookupOnPath: async () => "C:\\tools\\cua-driver.exe",
    runDriver: async () => ({
      exitCode: 0,
      stdout: "cua-driver 0.7.1\n",
      stderr: "",
    }),
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.driverPath, "C:\\tools\\cua-driver.exe");
  assert.equal(result.version, "cua-driver 0.7.1");
});

test("checkCuaDriverHealth reports version-check-failed when the driver exits non-zero", async () => {
  const result = await checkCuaDriverHealth({
    env: {},
    lookupOnPath: async () => "C:\\tools\\cua-driver.exe",
    runDriver: async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "permission denied",
    }),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "version-check-failed");
  assert.match(result.detail, /permission denied/);
});
