import assert from "node:assert/strict";
import { test } from "node:test";

import { runPlatformPackageIntegrityPhase } from "../src/phase-7-8-platform-package-integrity.mjs";

test("Phase 7.8 proves exact package integrity and read-only repair guidance", async () => {
  const report = await runPlatformPackageIntegrityPhase({
    coreVersion: "1.2.3",
    verify: async () => ({ status: "verified", packageVersion: "1.2.3" }),
    diagnose: () => ({
      reinstallCommand: "npm install agent-computer-use-mcp@1.2.3",
      executesImmediately: false,
      networkAccessed: false,
      packageFilesModified: false,
    }),
  });
  assert.equal(report.status, "passed");
  assert.equal(report.exactVersionVerified, true);
  assert.equal(report.repairIsReadOnly, true);
  assert.equal(report.startsDesktopControl, false);
});
