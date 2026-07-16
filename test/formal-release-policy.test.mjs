import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateFormalReleaseIdentity,
  validatePlatformReleasePlan,
} from "../src/formal-release-policy.mjs";

const identity = {
  tag: "v0.0.1",
  packageName: "agent-computer-use-mcp",
  packageVersion: "0.0.1",
  commit: "a".repeat(40),
  mainCommits: ["a".repeat(40)],
  changelog: "# Changelog\n\n## 0.0.1 - 2026-07-11\n",
};

test("formal release identity requires exact v-tag main commit and changelog", () => {
  assert.deepEqual(validateFormalReleaseIdentity(identity), { status: "passed", violations: [] });
  for (const [input, code] of [
    [{ ...identity, tag: "0.0.1" }, "release.tag_invalid"],
    [{ ...identity, tag: "v0.0.2" }, "release.version_mismatch"],
    [{ ...identity, mainCommits: [] }, "release.commit_not_on_main"],
    [{ ...identity, changelog: "# Changelog\n" }, "release.changelog_missing"],
  ]) {
    assert.equal(validateFormalReleaseIdentity(input).violations.some((item) => item.code === code), true);
  }
});

test("formal release plan keeps CI artifact-only and npm publication explicit", () => {
  const plan = {
    version: "0.0.1",
    assets: [
      "agent-computer-use-mcp-0.0.1.tgz",
      "agent-computer-use-win32-x64-0.0.1.tgz",
    ],
    npmPublishOrder: ["@xiaozhiclaw/agent-computer-use-win32-x64", "agent-computer-use-mcp"],
    ciPublishesNpm: false,
    manualPublishRequiresFlag: true,
    runtimeDownloadAllowed: false,
  };
  assert.deepEqual(validatePlatformReleasePlan(plan), { status: "passed", violations: [] });
  assert.equal(validatePlatformReleasePlan({ ...plan, ciPublishesNpm: true }).status, "failed");
  assert.equal(validatePlatformReleasePlan({ ...plan, manualPublishRequiresFlag: false }).status, "failed");
});
