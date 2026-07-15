import assert from "node:assert/strict";
import test from "node:test";

import { assertHostDriver } from "../src/agent-e2e/host-driver.mjs";
import { createClaudeDesktopDriver } from "../src/agent-e2e/host-drivers/claude-desktop.mjs";
import { createCodexDesktopDriver } from "../src/agent-e2e/host-drivers/codex-desktop.mjs";
import { createXiaozhiWebDriver } from "../src/agent-e2e/host-drivers/xiaozhi-web.mjs";
import { normalizeWindowsDesktopProbe } from "../src/agent-e2e/host-drivers/windows-host-discovery.mjs";

test("Codex driver binds a real Desktop package and host-only bridge", async () => {
  const calls = [];
  const driver = createCodexDesktopDriver({
    desktopProbe: async () => desktopIdentity("OpenAI.Codex", "26.707.3748.0", "Codex.exe"),
    sessionBridge: bridge(calls),
  });
  assert.equal(assertHostDriver(driver), true);
  const discovery = await driver.discover();
  assert.deepEqual(discovery, {
    available: true,
    hostId: "codex",
    hostKind: "desktop-msix",
    packageName: "OpenAI.Codex",
    version: "26.707.3748.0",
    executableName: "Codex.exe",
    sessionBridge: "qualification-host-v1",
  });
  const session = await driver.createSession({ lane: "codex" });
  await driver.configureMcp(session, { packageIdentity: { version: "0.0.1" }, scope: {} });
  await driver.submitPrompt(session, Buffer.from("task", "utf8"));
  await driver.waitForTerminal(session, { timeoutMs: 1000 });
  await driver.collectEvidence(session);
  await driver.cancel(session);
  await driver.close(session);
  assert.deepEqual(calls, ["createSession", "configureMcp", "submitPrompt", "waitForTerminal", "collectEvidence", "cancel", "close"]);
});

test("Claude Desktop never accepts Claude Code or npm CLI as its host", async () => {
  const driver = createClaudeDesktopDriver({
    desktopProbe: async () => ({
      installed: true,
      packageName: "Claude",
      version: "2.1.205",
      executableName: "claude.exe",
      executableKind: "claude-code",
    }),
    sessionBridge: bridge([]),
  });
  const discovery = await driver.discover();
  assert.equal(discovery.available, false);
  assert.equal(discovery.blocker, "agent_e2e.claude_desktop_not_found");
});

test("installed Desktop app without a host session bridge reports a precise blocker", async () => {
  const driver = createClaudeDesktopDriver({
    desktopProbe: async () => desktopIdentity("Claude", "1.20186.1.0", "Claude.exe"),
  });
  const discovery = await driver.discover();
  assert.equal(discovery.installed, true);
  assert.equal(discovery.available, false);
  assert.equal(discovery.blocker, "agent_e2e.host_session_bridge_unavailable");
  await assert.rejects(driver.createSession({ lane: "claude-desktop" }), /agent_e2e\.host_session_bridge_unavailable/u);
});

test("Xiaozhi driver pins backend session provider and actual model identity", async () => {
  const calls = [];
  const sessionBridge = bridge(calls, {
    evidence: {
      modelIdentity: { provider: "deepseek", modelId: "deepseek-v4-flash-202607" },
      mcpIdentity: { core: { version: "0.0.1" }, platform: { version: "0.0.1" } },
      backendSessionIdentity: "backend-session-1",
      transcript: [],
      mcpEvents: [],
    },
  });
  const driver = createXiaozhiWebDriver({
    lane: "xiaozhi-deepseek-v4-flash",
    url: "http://127.0.0.1:5174/",
    pageProbe: async () => ({ reachable: true, buildId: "dev-20260713" }),
    sessionBridge,
  });
  const discovery = await driver.discover();
  assert.equal(discovery.available, true);
  assert.equal(discovery.urlOrigin, "http://127.0.0.1:5174");
  const evidence = await driver.collectEvidence({ sessionId: "session-1" });
  assert.equal(evidence.modelIdentity.modelId, "deepseek-v4-flash-202607");
  assert.equal(evidence.backendSessionIdentity, "backend-session-1");
});

test("Xiaozhi driver rejects raw CDP ownership and non-loopback insecure URLs", () => {
  assert.throws(
    () => createXiaozhiWebDriver({
      lane: "xiaozhi-claude-sonnet-5",
      url: "http://127.0.0.1:5174/",
      cdpEndpoint: "http://127.0.0.1:9222",
    }),
    /agent_e2e\.raw_cdp_forbidden/u,
  );
  assert.throws(
    () => createXiaozhiWebDriver({ lane: "xiaozhi-claude-sonnet-5", url: "http://example.com/" }),
    /agent_e2e\.xiaozhi_url_insecure/u,
  );
});

test("Windows discovery normalization keeps package identity but removes executable paths", () => {
  const identity = normalizeWindowsDesktopProbe({
    packageName: "Claude",
    packageFullName: "Claude_1.20186.1.0_x64__publisher",
    version: "1.20186.1.0",
    installLocation: "C:\\Program Files\\WindowsApps\\Claude_1.20186.1.0_x64__publisher",
    executablePath: "C:\\Program Files\\WindowsApps\\Claude_1.20186.1.0_x64__publisher\\app\\Claude.exe",
    executableName: "Claude.exe",
  });
  assert.deepEqual(identity, desktopIdentity("Claude", "1.20186.1.0", "Claude.exe"));
  assert.equal("installLocation" in identity, false);
  assert.equal("executablePath" in identity, false);
});

function desktopIdentity(packageName, version, executableName) {
  return {
    installed: true,
    packageName,
    packageFullName: `${packageName}_${version}_x64__publisher`,
    version,
    executableName,
    executableKind: "desktop-msix",
  };
}

function bridge(calls, overrides = {}) {
  return {
    protocol: "qualification-host-v1",
    async createSession() { calls.push("createSession"); return { sessionId: "session-1" }; },
    async configureMcp() { calls.push("configureMcp"); },
    async submitPrompt() { calls.push("submitPrompt"); },
    async waitForTerminal() { calls.push("waitForTerminal"); return { status: "completed" }; },
    async collectEvidence() {
      calls.push("collectEvidence");
      return overrides.evidence ?? { modelIdentity: {}, mcpIdentity: {}, transcript: [], mcpEvents: [] };
    },
    async cancel() { calls.push("cancel"); },
    async close() { calls.push("close"); },
  };
}
