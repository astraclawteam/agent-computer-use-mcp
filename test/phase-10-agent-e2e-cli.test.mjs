import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 10 scripts expose discovery campaign and evidence verification without private routers", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:10.2"], "node src/phase-10-2-host-discovery.mjs");
  assert.equal(packageJson.scripts["phase:10.3"], "node src/phase-10-3-agent-e2e-campaign.mjs");
  assert.equal(packageJson.scripts["phase:10.4"], "node src/phase-10-4-agent-e2e-evidence.mjs");
  const sources = await Promise.all([
    readFile("src/phase-10-3-agent-e2e-campaign.mjs", "utf8"),
    readFile("src/phase-10-4-agent-e2e-evidence.mjs", "utf8"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /computer-use-provider-router|CuaDriverMcp|cua-driver|cdpEndpoint|connectOverCDP/iu);
});

test("Phase 10 campaign preflight rejects workspace source and missing release tarballs", async () => {
  const { validateCampaignInputs } = await import("../src/agent-e2e/campaign-preflight.mjs");
  await assert.rejects(
    validateCampaignInputs({
      releasePackage: "package.json",
      platformPackage: "missing-platform.tgz",
      evidenceRoot: "evidence/agent-e2e",
    }),
    /agent_e2e\.released_package_required/u,
  );
});

test("Phase 10 campaign remains blocked when any real host bridge is unavailable", async () => {
  const { evaluateHostDiscovery } = await import("../src/agent-e2e/campaign-preflight.mjs");
  const report = evaluateHostDiscovery([
    { hostId: "codex", available: true },
    { hostId: "claude-desktop", available: false, blocker: "agent_e2e.host_session_bridge_unavailable" },
    { hostId: "xiaozhi-web", lane: "xiaozhi-deepseek-v4-flash", available: true },
    { hostId: "xiaozhi-web", lane: "xiaozhi-claude-sonnet-5", available: true },
  ]);
  assert.equal(report.status, "blocked");
  assert.equal(report.qualificationClaim, false);
  assert.deepEqual(report.blockers, ["agent_e2e.host_session_bridge_unavailable"]);
});
