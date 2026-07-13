import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";

import { runAppAdapter } from "../src/app-adapters/adapter-contract.mjs";
import { createBrowserFixtureAdapter } from "../src/app-adapters/browser-fixture.mjs";
import { TIER_A_ADAPTER_FACTORIES } from "../src/app-adapters/index.mjs";
import { createNativeFixtureAdapter } from "../src/app-adapters/native-fixture.mjs";
import { createNotepadAdapter } from "../src/app-adapters/notepad.mjs";
import { createVisualFixtureAdapter } from "../src/app-adapters/visual-fixture.mjs";

const IDENTITY = {
  path: "C:/fixtures/app.exe",
  fileName: "app.exe",
  version: "1.0.0",
  sizeBytes: 10,
  sha256: "a".repeat(64),
};

test("Notepad adapter uses element actions and verifies exact temporary file bytes", async () => {
  const calls = [];
  let fixturePath;
  const expectedText = "adapter-notepad-evidence\n";
  const mcp = fakeMcp(async (name, args) => {
    calls.push({ name, args });
    if (name === "launch_app") {
      [fixturePath] = args.additional_arguments;
      return structured({ pid: 101, windows: [window(101, "fixture.txt - Notepad")] });
    }
    if (name === "get_window_state") {
      return structured({ elements: args.max_depth === 31
        ? [element(3, "MenuItem", "Save")]
        : [element(1, "Edit", "Text editor", ["set_value"]), element(2, "MenuItem", "File")] });
    }
    if (name === "click" && args.element_index === 3) await writeFile(fixturePath, expectedText, "utf8");
    return structured({ ok: true });
  });
  const result = await runAppAdapter(createNotepadAdapter({
    mcp,
    executable: IDENTITY,
    expectedText,
    sleep: async () => {},
  }), activeContext());

  assert.equal(result.status, "pass");
  assert.equal(result.finalState.kind, "file-bytes");
  assert.equal(calls.some(({ name }) => name === "set_value"), true);
  assert.equal(calls.filter(({ name }) => name === "click").every(({ args }) => !Object.hasOwn(args, "x")), true);
  assert.equal(calls.filter(({ name }) => name === "get_window_state").every(({ args }) => args.include_screenshot === false), true);
  assert.equal(calls.some(({ name, args }) => name === "kill_app" && args.pid === 101), true);
  assert.equal(mcp.closed, true);
});

test("native form adapter verifies saved bytes and terminates every launched PID", async () => {
  const calls = [];
  let fixturePath;
  let childKilled = false;
  const expectedText = "native-adapter-evidence";
  const mcp = fakeMcp(async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") return structured({ windows: [window(202, "saved.txt Native Lab")] });
    if (name === "get_window_state") return structured({
      elements: [element(1, "Edit", "Name", ["set_value"]), element(2, "Button", "Save", ["click"])],
    });
    if (name === "click") await writeFile(fixturePath, expectedText, "utf8");
    return structured({ ok: true });
  });
  const result = await runAppAdapter(createNativeFixtureAdapter({
    mcp,
    executable: IDENTITY,
    expectedText,
    sleep: async () => {},
    spawnApp(_path, args) {
      [fixturePath] = args;
      return { pid: 202, kill() { childKilled = true; } };
    },
  }), activeContext());

  assert.equal(result.status, "pass");
  assert.equal(childKilled, true);
  assert.equal(calls.some(({ name }) => name === "end_session"), true);
  assert.equal(calls.filter(({ name }) => name === "click").every(({ args }) => !Object.hasOwn(args, "x")), true);
});

test("browser adapter uses a local file fixture, isolated profile, and accessibility final state", async () => {
  const calls = [];
  let launchArgs = [];
  let activated = false;
  let childKilled = false;
  const mcp = fakeMcp(async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") return structured({ windows: [window(303, "Agent Computer Use Browser Fixture")] });
    if (name === "get_window_state") return structured({ elements: activated
      ? [element(4, "Text", "Fixture action complete")]
      : [element(3, "Button", "Safe fixture button", ["click"])] });
    if (name === "click") activated = true;
    return structured({ ok: true });
  });
  const result = await runAppAdapter(createBrowserFixtureAdapter({
    mcp,
    executable: IDENTITY,
    sleep: async () => {},
    spawnApp(_path, args) {
      launchArgs = args;
      return { pid: 303, kill() { childKilled = true; } };
    },
  }), activeContext());

  assert.equal(result.status, "pass");
  assert.equal(result.finalState.kind, "accessibility-value");
  assert.equal(launchArgs.some((arg) => arg.startsWith("--user-data-dir=")), true);
  assert.equal(launchArgs.some((arg) => arg.startsWith("file:")), true);
  assert.equal(calls.filter(({ name }) => name === "get_window_state").every(({ args }) => args.include_screenshot === false), true);
  assert.equal(childKilled, true);
});

test("visual adapter refuses to guess when no trusted proposal exists", async () => {
  let childKilled = false;
  const calls = [];
  const mcp = fakeMcp(async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") return structured({ windows: [window(404, "Visual Fixture")] });
    if (name === "get_window_state") return structured({ elements: [] });
    return structured({ ok: true });
  });
  const result = await runAppAdapter(createVisualFixtureAdapter({
    mcp,
    executable: IDENTITY,
    sleep: async () => {},
    proposalProvider: async () => null,
    spawnApp() { return { pid: 404, kill() { childKilled = true; } }; },
  }), activeContext());

  assert.equal(result.status, "insufficient-perception");
  assert.equal(result.reason, "observation.insufficient");
  assert.equal(calls.some(({ name }) => name === "click"), false);
  assert.equal(childKilled, true);
});

test("Tier A adapter factories are registered by stable catalog names", () => {
  assert.deepEqual(Object.keys(TIER_A_ADAPTER_FACTORIES).sort(), [
    "browser-local",
    "native-form",
    "notepad-file",
    "visual-fixture",
  ]);
});

function fakeMcp(handler) {
  return {
    closed: false,
    async start() {},
    async callTool(name, args) { return handler(name, args); },
    async close() { this.closed = true; },
  };
}

function structured(value) {
  return { structuredContent: value };
}

function window(pid, title) {
  return { pid, window_id: `window-${pid}`, title, bounds: { x: 0, y: 0, width: 800, height: 600 } };
}

function element(elementIndex, role, label, actions = ["click"]) {
  return { element_index: elementIndex, element_token: `token-${elementIndex}`, role, label, actions };
}

function activeContext() {
  return { controlLease: { id: "lease-tier-a", status: "active" } };
}
