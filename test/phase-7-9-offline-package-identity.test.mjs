import assert from "node:assert/strict";
import { test } from "node:test";

import { runOfflinePackageIdentityPhase } from "../src/phase-7-9-offline-package-identity.mjs";

test("Phase 7.9 proves npm and ZIP identity plus network-free MCP start", async () => {
  const report = await runOfflinePackageIdentityPhase({
    compare: async () => ({ status: "identical", files: [{ path: "driver.exe" }] }),
    smoke: async () => ({ status: "passed", networkDisabled: true, desktopControlStarted: false }),
  });
  assert.equal(report.status, "passed");
  assert.equal(report.platformInventoryIdentical, true);
  assert.equal(report.offlineMcpStarted, true);
  assert.equal(report.networkDisabled, true);
  assert.equal(report.startsDesktopControl, false);
});
