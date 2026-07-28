import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPhase14ServerEnvironment,
  resolvePhase14Driver,
} from "../src/phase-1-4-driver.mjs";

test("Phase 1.4 keeps an explicit healthy driver authoritative", async () => {
  const result = await resolvePhase14Driver({
    env: { AGENT_COMPUTER_USE_CUA_DRIVER: "C:\\tools\\cua-driver.exe" },
    healthProbe: async ({ env }) => ({
      status: "healthy",
      driverPath: env.AGENT_COMPUTER_USE_CUA_DRIVER,
      version: "cua-driver 0.7.1",
    }),
  });

  assert.deepEqual(result, {
    path: "C:\\tools\\cua-driver.exe",
    source: "configured",
    version: "cua-driver 0.7.1",
  });
});

test("Phase 1.4 accepts only the exact checked development artifact", async () => {
  const expectedHash = "a".repeat(64);
  const result = await resolvePhase14Driver({
    env: {},
    packageRoot: "C:\\repo",
    packageVersion: "0.0.3",
    platform: "win32",
    arch: "x64",
    healthProbe: async ({ env }) => env.AGENT_COMPUTER_USE_CUA_DRIVER
      ? {
          status: "healthy",
          driverPath: env.AGENT_COMPUTER_USE_CUA_DRIVER,
          version: "cua-driver 0.7.1",
        }
      : { status: "unavailable", reason: "not-found" },
    pathExists: () => true,
    readText: async () => JSON.stringify({
      "driver/cua-driver.exe": expectedHash,
    }),
    hashFile: async () => expectedHash,
  });

  assert.equal(result.source, "verified-dev-artifact");
  assert.match(result.path, /artifacts[\\/]mcp-executable[\\/]0\.0\.3[\\/]win32-x64[\\/]artifact[\\/]driver[\\/]cua-driver\.exe$/u);
});

test("Phase 1.4 fails closed when the development artifact hash differs", async () => {
  await assert.rejects(
    resolvePhase14Driver({
      env: {},
      packageRoot: "C:\\repo",
      packageVersion: "0.0.3",
      platform: "win32",
      arch: "x64",
      healthProbe: async () => ({ status: "unavailable", reason: "not-found" }),
      pathExists: () => true,
      readText: async () => JSON.stringify({
        "driver/cua-driver.exe": "a".repeat(64),
      }),
      hashFile: async () => "b".repeat(64),
    }),
    /phase1\.4\.driver_artifact_checksum_mismatch/u,
  );
});

test("Phase 1.4 forwards the resolved driver through the SDK child environment", () => {
  const env = createPhase14ServerEnvironment({
    PATH: "C:\\Windows",
    OMIT: undefined,
  }, "C:\\tools\\cua-driver.exe");

  assert.deepEqual(env, {
    PATH: "C:\\Windows",
    AGENT_COMPUTER_USE_CUA_DRIVER: "C:\\tools\\cua-driver.exe",
  });
});
