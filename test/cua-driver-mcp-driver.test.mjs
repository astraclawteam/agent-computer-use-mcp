import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CuaDriverMcpClient, CuaDriverMcpDriver } from "../src/cua-driver-mcp-driver.mjs";

test("CuaDriverMcpDriver forwards cancellation into the admitted native MCP action", async () => {
  let clickOptions;
  const client = {
    async start() {},
    async callTool(name, _args, options) {
      if (name === "start_session" || name === "end_session") return { status: "ok" };
      if (name !== "click") return { status: "ok" };
      clickOptions = options;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ status: "ok" }), 100);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("native MCP call aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    async close() {},
  };
  const driver = new CuaDriverMcpDriver({ client });
  const controller = new AbortController();
  const action = driver.click({
    window: { pid: 100, windowId: 200 },
    x: 30,
    y: 40,
    deliveryMode: "background",
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort("turn-stopped");

  await assert.rejects(action, (error) => error?.name === "AbortError");
  assert.equal(clickOptions.signal, controller.signal);
  await driver.close();
});

test("CuaDriverMcpDriver delivers related-surface clicks to the exact HWND in screen coordinates", async (t) => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    foregroundWindowProbe: async () => "42",
    foregroundWindowActivator: async () => ({ status: "ok" }),
    relatedSurfaceClick: async (input) => {
      calls.push({ method: "relatedSurfaceClick", input });
      return { status: "ok", effect: "applied", verified: false };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ method: "callTool", name, args });
        return { status: "ok" };
      },
      async close() {},
    },
  });
  t.after(() => driver.close());

  const result = await driver.click({
    window: {
      pid: 1234,
      windowId: "42",
      bounds: { x: 452, y: 100, width: 954, height: 724 },
    },
    relatedWindowId: "77",
    x: 132,
    y: 135,
    deliveryMode: "foreground",
  });

  assert.equal(result.verified, false);
  const nativeClick = calls.find(({ method }) => method === "relatedSurfaceClick");
  assert.deepEqual(nativeClick.input, {
    controllerWindowId: "42",
    relatedWindowId: "77",
    processId: 1234,
    screenX: 584,
    screenY: 235,
    signal: nativeClick.input.signal,
  });
  assert.equal(calls.some(({ name }) => name === "click"), false);
});

test("CuaDriverMcpDriver suspends its agent cursor while physically clicking an owned surface", async (t) => {
  const enabled = [];
  const sessions = [];
  let nativeClickCalled = false;
  const driver = new CuaDriverMcpDriver({
    foregroundWindowProbe: async () => "42",
    relatedSurfaceClick: async () => {
      nativeClickCalled = true;
      assert.equal(enabled.at(-1), false);
      return { status: "ok", effect: "applied", verified: false };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        if (name === "set_agent_cursor_enabled") enabled.push(args.enabled);
        if (name === "start_session" || name === "end_session") sessions.push(name);
        return { status: "ok" };
      },
      async close() {},
    },
  });
  t.after(() => driver.close());
  await driver.startCursor();

  await driver.click({
    window: {
      pid: 1234,
      windowId: "42",
      bounds: { x: 452, y: 100, width: 954, height: 724 },
    },
    relatedWindowId: "77",
    x: 132,
    y: 135,
    deliveryMode: "foreground",
  });

  assert.equal(nativeClickCalled, true);
  assert.deepEqual(enabled, [true, false, true]);
  assert.deepEqual(sessions, ["start_session", "end_session", "start_session"]);
});

test("CuaDriverMcpDriver replaces the inner driver process before an owned-surface click", async (t) => {
  const calls = [];
  let clientGeneration = 0;
  const driver = new CuaDriverMcpDriver({
    foregroundWindowProbe: async () => "42",
    clientFactory() {
      const generation = ++clientGeneration;
      return {
        async start() {
          calls.push(`start:${generation}`);
        },
        async callTool(name) {
          calls.push(`${name}:${generation}`);
          return { status: "ok" };
        },
        async close() {
          calls.push(`close:${generation}`);
        },
      };
    },
    relatedSurfaceClick: async () => {
      calls.push("native-click");
      assert.equal(calls.includes("close:1"), true);
      assert.equal(calls.includes("start:2"), false);
      return { status: "ok", effect: "applied", verified: false };
    },
  });
  t.after(() => driver.close());
  await driver.ensureStarted();

  await driver.click({
    window: {
      pid: 1234,
      windowId: "42",
      bounds: { x: 452, y: 100, width: 954, height: 724 },
    },
    relatedWindowId: "77",
    x: 132,
    y: 135,
    deliveryMode: "foreground",
  });

  assert.deepEqual(calls, [
    "start:1",
    "start_session:1",
    "end_session:1",
    "close:1",
    "native-click",
    "start:2",
    "start_session:2",
  ]);
});

test("CuaDriverMcpDriver maps request/capture/action to cua-driver MCP tools", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "test-session",
    foregroundWindowProbe: async () => "42",
    client: {
      async start() {
        calls.push({ method: "start" });
      },
      async callTool(name, args) {
        calls.push({ method: "callTool", name, args });
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 42,
                title: "Agent Computer Use Native Lab",
                pid: 1234,
                bounds: { x: 10, y: 20, width: 320, height: 240 },
              },
            ],
          };
        }
        if (name === "get_window_state") {
          return {
            window: { id: 42, title: "Agent Computer Use Native Lab", pid: 1234 },
            focused_element_index: 0,
            truncation: {
              truncated: true,
              depth_limit_reached: true,
            },
            elements: [
              { element_index: 0, role: "Edit", label: "Name", bounds: { x: 10, y: 20, w: 120, h: 24 } },
              { element_index: 1, role: "Button", label: "Save" },
              { element_index: 2, role: "Document", label: "Text editor" },
            ],
          };
        }
        return { status: "ok", name, args };
      },
      async close() {
        calls.push({ method: "close" });
      },
    },
  });

  const window = await driver.findWindow({ titlePart: "Agent Computer Use Native Lab" });
  assert.deepEqual(window, {
    windowId: 42,
    title: "Agent Computer Use Native Lab",
    pid: 1234,
    bounds: { x: 10, y: 20, width: 320, height: 240 },
  });
  assert.deepEqual(calls, [
    { method: "start" },
    { method: "callTool", name: "start_session", args: { session: "test-session" } },
    { method: "callTool", name: "list_windows", args: { on_screen_only: false } },
  ]);

  await driver.startCursor();
  await driver.startCursor();

  const observation = await driver.capture({ window, mode: "semantic" });
  assert.equal(observation.source, "cua-driver");
  assert.equal(observation.includeUserOverlay, false);
  assert.deepEqual(observation.elements.map((element) => [element.elementIndex, element.name]), [
    [0, "Name"],
    [1, "Save"],
    [2, "Text editor"],
  ]);
  assert.deepEqual(observation.elements[0].bounds, { x: 10, y: 20, width: 120, height: 24 });
  assert.deepEqual(observation.elements.map(({ actions }) => actions), [["set_value"], ["click"], ["type_text"]]);
  assert.deepEqual(observation.focusedElement, {
    elementToken: "1",
    elementIndex: 0,
    role: "edit",
    name: "Name",
    source: "cua-driver",
  });
  assert.deepEqual(observation.truncation, {
    truncated: true,
    elementLimitReached: false,
    depthLimitReached: true,
    returnedElements: 3,
    maxElements: 500,
    maxDepth: 20,
  });

  await driver.setValue({ window, elementIndex: 0, elementToken: "name", value: "agent-computer-use" });
  await driver.typeText({ window, elementIndex: 2, elementToken: "document", value: "Notepad text" });
  await driver.click({ window, elementIndex: 1, elementToken: "save", deliveryMode: "background" });
  await driver.typeText({ window, x: 160, y: 180, value: "Pixel text", deliveryMode: "foreground" });
  await driver.click({ window, x: 280, y: 210, deliveryMode: "background" });
  await driver.pressKey({ window, x: 160, y: 180, key: "return", deliveryMode: "foreground" });
  await driver.stopCursor();
  await driver.stopCursor();
  await driver.close();
  await driver.close();

  assert.deepEqual(calls, [
    { method: "start" },
    { method: "callTool", name: "start_session", args: { session: "test-session" } },
    { method: "callTool", name: "list_windows", args: { on_screen_only: false } },
    {
      method: "callTool",
      name: "set_agent_cursor_style",
      args: {
        cursor_id: "default",
        gradient_colors: ["#D97757", "#F7D2C3"],
        bloom_color: "#D97757",
      },
    },
    { method: "callTool", name: "set_agent_cursor_enabled", args: { enabled: true, cursor_id: "default" } },
    {
      method: "callTool",
      name: "get_window_state",
      args: {
        pid: 1234,
        window_id: 42,
        include_screenshot: false,
        max_elements: 500,
        max_depth: 20,
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "set_value",
      args: {
        pid: 1234,
        window_id: 42,
        element_index: 0,
        element_token: "name",
        value: "agent-computer-use",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "type_text",
      args: {
        pid: 1234,
        window_id: 42,
        element_index: 2,
        element_token: "document",
        text: "Notepad text",
        delivery_mode: "background",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "click",
      args: {
        pid: 1234,
        window_id: 42,
        element_index: 1,
        element_token: "save",
        delivery_mode: "background",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "click",
      args: {
        pid: 1234,
        window_id: 42,
        x: 160,
        y: 180,
        delivery_mode: "foreground",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "type_text",
      args: {
        pid: 1234,
        window_id: 42,
        text: "Pixel text",
        delivery_mode: "foreground",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "click",
      args: {
        pid: 1234,
        window_id: 42,
        x: 280,
        y: 210,
        delivery_mode: "background",
        session: "test-session",
      },
    },
    {
      method: "callTool",
      name: "press_key",
      args: {
        pid: 1234,
        window_id: 42,
        x: 160,
        y: 180,
        key: "return",
        delivery_mode: "foreground",
        session: "test-session",
      },
    },
    { method: "callTool", name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: "default" } },
    { method: "callTool", name: "end_session", args: { session: "test-session" } },
    { method: "close" },
  ]);
});

test("CuaDriverMcpDriver projects proven screen-space semantic bounds into the controller window", async () => {
  const window = {
    windowId: 42,
    title: "Desktop app",
    pid: 1234,
    bounds: { x: 420, y: 109, width: 1378, height: 820 },
  };
  const driver = new CuaDriverMcpDriver({
    session: "screen-bounds-session",
    client: {
      async start() {},
      async callTool(name) {
        if (name !== "get_window_state") return { status: "ok" };
        return {
          window: { id: 42, title: "Desktop app", pid: 1234, bounds: window.bounds },
          elements: [
            {
              element_index: 0,
              role: "Document",
              label: "Desktop app",
              bounds: { ...window.bounds },
            },
            {
              element_index: 1,
              parent_element_index: 0,
              role: "Button",
              label: "Usage",
              bounds: { x: 428, y: 531, width: 244, height: 29 },
            },
            {
              element_index: 2,
              role: "Button",
              label: "Other window action",
              bounds: { x: 763, y: 27, width: 244, height: 29 },
            },
          ],
        };
      },
      async close() {},
    },
  });

  const observation = await driver.capture({ window, mode: "semantic" });

  assert.equal(observation.coordinateSpace, "window-local");
  assert.deepEqual(observation.elements[0].bounds, { x: 0, y: 0, width: 1378, height: 820 });
  assert.deepEqual(observation.elements[1].bounds, { x: 8, y: 422, width: 244, height: 29 });
  assert.deepEqual(observation.elements[2].actions, []);
  assert.equal(observation.elements[2].evidenceConsistency, "conflict");
  assert.deepEqual(observation.elements[2].conflicts, ["semantic-bounds-outside-controller-window"]);
  await driver.close();
});

test("CuaDriverMcpDriver fails closed when coordinate replace-all lacks the native text primitive", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "unicode-session",
    foregroundWindowProbe: async () => "42",
    client: {
      async start() {
        calls.push({ method: "start" });
      },
      async callTool(name, args) {
        calls.push({ method: "callTool", name, args });
        return { status: "ok" };
      },
    },
  });
  const window = { windowId: 42, pid: 1234 };

  await assert.rejects(driver.typeText({
    window,
    x: 160,
    y: 55,
    value: "张三",
    textMode: "replace-all",
    deliveryMode: "foreground",
  }), (error) => error.code === "unicode_input.unavailable");

  assert.deepEqual(calls, [
    { method: "start" },
    { method: "callTool", name: "start_session", args: { session: "unicode-session" } },
    {
      method: "callTool",
      name: "click",
      args: {
        pid: 1234,
        window_id: 42,
        x: 160,
        y: 55,
        delivery_mode: "foreground",
        session: "unicode-session",
      },
    },
  ]);
});

test("CuaDriverMcpDriver activates a window and verifies the foreground result", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "activate-window-session",
    foregroundWindowProbe: async () => "0x2a",
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "bring_to_front") {
          return {
            landed_on_target: true,
            previous_fg_hwnd: "0x7",
            now_fg_hwnd: "0x2a",
            target_hwnd: "0x2a",
          };
        }
        return { status: "ok" };
      },
    },
  });

  const result = await driver.activateWindow({
    window: { windowId: 42, title: "Target App", pid: 1234 },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.verified, true);
  assert.equal(result.foregroundWindow.windowId, 42);
  assert.deepEqual(calls, [
    { name: "start_session", args: { session: "activate-window-session" } },
    { name: "bring_to_front", args: { pid: 1234, window_id: 42 } },
  ]);
});

test("CuaDriverMcpDriver never treats z-order as foreground confirmation", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "activate-window-failure-session",
    foregroundWindowActivator: async (args) => {
      calls.push({ name: "foregroundWindowActivator", args });
      return {
        landed_on_target: false,
        previous_fg_hwnd: "0x303a4",
        now_fg_hwnd: "0x303a4",
        target_hwnd: "0x2f90b8e",
      };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "bring_to_front") {
          return {
            landed_on_target: false,
            previous_fg_hwnd: "0x303a4",
            now_fg_hwnd: "0x303a4",
            target_hwnd: "0x2f90b8e",
            raised: true,
          };
        }
        return { status: "ok" };
      },
    },
  });

  const result = await driver.activateWindow({
    window: { windowId: 49875854, title: "Target App", pid: 1234 },
  });

  assert.equal(result.status, "indeterminate");
  assert.equal(result.verified, false);
  assert.equal(result.foregroundWindow, null);
  assert.equal(calls.filter((call) => call.name === "bring_to_front").length, 3);
  assert.equal(calls.some((call) => call.name === "list_windows"), false);
  assert.equal(calls.filter((call) => call.name === "foregroundWindowActivator").length, 1);
});

test("CuaDriverMcpDriver uses the bounded Windows bridge after the driver cannot land", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "activate-window-fallback-session",
    foregroundWindowActivator: async (args) => {
      calls.push({ name: "foregroundWindowActivator", args });
      return {
        status: "ok",
        path: "windows-foreground-bridge",
        landed_on_target: true,
        previous_fg_hwnd: "0x303a4",
        now_fg_hwnd: "0x2f90b8e",
        target_hwnd: "0x2f90b8e",
      };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "bring_to_front") {
          return {
            landed_on_target: false,
            previous_fg_hwnd: "0x303a4",
            now_fg_hwnd: "0x303a4",
            target_hwnd: "0x2f90b8e",
          };
        }
        return { status: "ok" };
      },
    },
  });

  const result = await driver.activateWindow({
    window: { windowId: 49875854, title: "Target App", pid: 1234 },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.verified, true);
  assert.equal(result.activation.path, "windows-foreground-bridge");
  assert.equal(result.driverActivation.landed_on_target, false);
  assert.equal(result.foregroundWindow.windowId, 49875854);
  assert.equal(calls.filter((call) => call.name === "bring_to_front").length, 3);
  assert.equal(calls.filter((call) => call.name === "foregroundWindowActivator").length, 1);
});

test("CuaDriverMcpDriver keeps semantic Unicode text on the cua-driver path", async () => {
  const calls = [];
  const unicodeCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "semantic-unicode-session",
    unicodeInput: async (args) => {
      unicodeCalls.push(args);
      return { status: "ok" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        return { status: "ok", verified: true };
      },
    },
  });
  const window = { windowId: 42, pid: 1234 };

  const result = await driver.typeText({
    window,
    elementToken: "semantic-edit",
    elementIndex: 7,
    value: "张三",
    deliveryMode: "background",
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(unicodeCalls, []);
  assert.deepEqual(calls.at(-1), {
    name: "type_text",
    args: {
      pid: 1234,
      window_id: 42,
      element_index: 7,
      element_token: "semantic-edit",
      text: "张三",
      delivery_mode: "background",
      session: "semantic-unicode-session",
    },
  });
});

test("CuaDriverMcpDriver commits coordinate Unicode text after exact native read-back", async () => {
  const calls = [];
  const unicodeCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "coordinate-unicode-native-session",
    foregroundWindowProbe: async () => "42",
    unicodeInput: async (args) => {
      unicodeCalls.push(args);
      return {
        status: "ok",
        utf16CodeUnits: args.text.length,
        clipboardRestored: true,
        changeSignalDelivered: true,
        focusVerified: true,
        exactValueVerified: true,
        deliveryPath: "windows_sendinput_unicode_ime_neutral",
      };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "bring_to_front") {
          return { landed_on_target: true, target_hwnd: "42", now_fg_hwnd: "42" };
        }
        return { status: "ok", verified: true };
      },
    },
  });

  const result = await driver.typeText({
    window: { windowId: 42, pid: 1234 },
    x: 102,
    y: 56,
    value: "张三",
    textMode: "replace-all",
    inputBehavior: "commit",
    deliveryMode: "foreground",
  });

  assert.equal(unicodeCalls.length, 1);
  assert.equal(unicodeCalls[0].inputBehavior, "commit");
  assert.equal(unicodeCalls[0].replaceAll, true);
  assert.equal(result.providerPath, "windows_sendinput_unicode_ime_neutral");
  assert.equal(result.changeSignalDelivered, true);
  assert.equal(result.focusVerified, true);
  assert.equal(result.verified, true);
  assert.deepEqual(calls.filter((call) => call.name === "type_text"), []);
});

test("CuaDriverMcpDriver uses foreground cua-driver typing for coordinate Unicode insertion", async () => {
  const calls = [];
  const nativeInputCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "coordinate-unicode-insert-session",
    foregroundWindowProbe: async () => "42",
    unicodeInput: async (args) => {
      nativeInputCalls.push(args);
      return { status: "ok" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        return { status: "ok", verified: true };
      },
    },
  });

  const result = await driver.typeText({
    window: { windowId: 42, pid: 1234 },
    x: 102,
    y: 56,
    value: "张三",
    textMode: "insert",
    inputBehavior: "incremental",
    deliveryMode: "foreground",
  });

  assert.deepEqual(nativeInputCalls, []);
  assert.deepEqual(calls.filter((call) => call.name === "type_text"), [{
    name: "type_text",
    args: {
      pid: 1234,
      window_id: 42,
      text: "张三",
      delivery_mode: "foreground",
      session: "coordinate-unicode-insert-session",
    },
  }]);
  assert.equal(result.focusVerified, true);
});

test("CuaDriverMcpDriver refocuses the approved coordinate before native replace-all", async () => {
  const calls = [];
  const nativeInputCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "coordinate-ascii-replace-all-session",
    foregroundWindowProbe: async () => "42",
    unicodeInput: async (args) => {
      nativeInputCalls.push(args);
      return {
        status: "ok",
        clipboardRestored: true,
        changeSignalDelivered: true,
        focusVerified: true,
        deliveryPath: "windows_sendinput_unicode_ime_neutral",
      };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        return { status: "ok", verified: true };
      },
    },
  });

  const result = await driver.typeText({
    window: { windowId: 42, pid: 1234 },
    x: 102,
    y: 56,
    value: "message-123",
    textMode: "replace-all",
    inputBehavior: "incremental",
    deliveryMode: "foreground",
    focusVerified: true,
  });

  assert.equal(nativeInputCalls.length, 1);
  assert.equal(nativeInputCalls[0].text, "message-123");
  assert.equal(nativeInputCalls[0].replaceAll, true);
  assert.equal(result.providerPath, "windows_sendinput_unicode_ime_neutral");
  assert.deepEqual(calls.filter((call) => call.name === "click").map((call) => call.args), [{
    pid: 1234,
    window_id: 42,
    x: 102,
    y: 56,
    delivery_mode: "foreground",
    session: "coordinate-ascii-replace-all-session",
  }]);
  assert.deepEqual(calls.filter((call) => call.name === "press_key"), []);
  assert.deepEqual(calls.filter((call) => call.name === "type_text"), []);
});

test("CuaDriverMcpDriver verifies foreground immediately before a pixel click", async () => {
  const calls = [];
  let foregroundWindowId = "999";
  const driver = new CuaDriverMcpDriver({
    session: "foreground-pixel-click-session",
    foregroundWindowProbe: async () => foregroundWindowId,
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "bring_to_front") foregroundWindowId = String(args.window_id);
        return { status: "ok" };
      },
    },
  });

  await driver.click({
    window: { windowId: 42, pid: 1234 },
    x: 160,
    y: 100,
    deliveryMode: "foreground",
  });

  assert.deepEqual(calls, [
    { name: "start_session", args: { session: "foreground-pixel-click-session" } },
    { name: "bring_to_front", args: { pid: 1234, window_id: 42 } },
    {
      name: "click",
      args: {
        pid: 1234,
        window_id: 42,
        x: 160,
        y: 100,
        delivery_mode: "foreground",
        session: "foreground-pixel-click-session",
      },
    },
  ]);
});

test("CuaDriverMcpDriver verifies an editable focus click without entering text", async () => {
  const focusCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "focus-editable-click-session",
    foregroundWindowProbe: async () => "42",
    focusVerifier: async (args) => {
      focusCalls.push(args);
      return {
        status: "ok",
        focusVerified: true,
        verificationPath: "windows-focused-process-boundary",
      };
    },
    client: {
      async start() {},
      async callTool() { return { status: "ok", path: "pixel" }; },
    },
  });

  const result = await driver.click({
    window: { windowId: 42, pid: 1234 },
    x: 160,
    y: 100,
    deliveryMode: "foreground",
    interactionIntent: "focus-editable",
  });

  assert.equal(result.focusVerified, true);
  assert.deepEqual(focusCalls, [{
    windowId: 42,
    processId: 1234,
    signal: focusCalls[0].signal,
  }]);
  assert.equal("text" in focusCalls[0], false);
});

test("CuaDriverMcpDriver uses verified foreground fallback before delivering a pixel click", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "foreground-pixel-click-fallback-session",
    foregroundWindowProbe: async () => "999",
    foregroundWindowActivator: async ({ windowId }) => ({
      landed_on_target: true,
      now_fg_hwnd: String(windowId),
    }),
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        return name === "bring_to_front"
          ? { landed_on_target: false }
          : { status: "ok" };
      },
    },
  });

  await driver.click({
    window: { windowId: 42, pid: 1234 },
    x: 160,
    y: 100,
    deliveryMode: "foreground",
  });

  assert.equal(calls.filter(({ name }) => name === "bring_to_front").length, 3);
  assert.equal(calls.at(-1).name, "click");
});

test("CuaDriverMcpDriver captures the exact screenshot coordinate source used by pixel actions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-coordinate-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-coordinate-session",
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "get_window_state") {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(954, 16);
          header.writeUInt32BE(704, 20);
          await writeFile(args.screenshot_out_file, header);
          return {
            screenshot_file_path: args.screenshot_out_file,
            window: {
              id: 42,
              title: "微信",
              pid: 1234,
              bounds: { x: 447, y: 144, width: 954, height: 704 },
            },
          };
        }
        return { status: "ok" };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    },
    outputPath,
  });

  assert.deepEqual(calls, [
    { name: "start_session", args: { session: "screenshot-coordinate-session" } },
    {
      name: "get_window_state",
      args: {
        pid: 1234,
        window_id: 42,
        include_screenshot: true,
        screenshot_out_file: outputPath,
        max_elements: 1,
        max_depth: 1,
        session: "screenshot-coordinate-session",
      },
    },
  ]);
  assert.deepEqual(capture, {
    status: "ok",
    provider: "cua-driver",
    source: "cua-driver-window-state",
    title: "微信",
    path: outputPath,
    method: "cua-driver-get_window_state",
    hwnd: 42,
    x: 447,
    y: 144,
    width: 954,
    height: 704,
    nativeWindowBounds: { x: 447, y: 144, width: 954, height: 704 },
    surfaceProvenance: {
      schemaVersion: 1,
      requestedWindowId: "42",
      reportedWindowId: "42",
      requestedProcessId: 1234,
      reportedProcessId: 1234,
      identityVerified: true,
      binding: "reported-window",
    },
    coordinateScale: {
      schemaVersion: 1,
      sourceSpace: "screenshot-pixel",
      actionSpace: "window-local",
      actionTransform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
      observationPixels: { width: 954, height: 704 },
      nativeWindowUnits: { width: 954, height: 704 },
      nativeToObservation: { scaleX: 1, scaleY: 1 },
    },
    window: {
      id: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 447, y: 144, width: 954, height: 704 },
    },
  });
});

test("CuaDriverMcpDriver reports the PNG pixel bounds rather than the outer window frame", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-png-size-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-pixel-bounds-session",
    client: {
      async start() {},
      async callTool(name, args) {
        if (name === "get_window_state") {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(952, 16);
          header.writeUInt32BE(702, 20);
          await writeFile(args.screenshot_out_file, header);
          return {
            screenshot_file_path: args.screenshot_out_file,
            window: {
              id: 42,
              title: "微信",
              pid: 1234,
              bounds: { x: 447, y: 144, width: 954, height: 704 },
            },
          };
        }
        return { status: "ok" };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 447, y: 144, width: 954, height: 704 },
    },
    outputPath,
  });

  assert.equal(capture.width, 952);
  assert.equal(capture.height, 702);
  assert.deepEqual(capture.window.bounds, { x: 447, y: 144, width: 952, height: 702 });
  assert.deepEqual(capture.nativeWindowBounds, { x: 447, y: 144, width: 954, height: 704 });
  assert.deepEqual(capture.coordinateScale, {
    schemaVersion: 1,
    sourceSpace: "screenshot-pixel",
    actionSpace: "window-local",
    actionTransform: { scaleX: 954 / 952, scaleY: 704 / 702, offsetX: 0, offsetY: 0 },
    observationPixels: { width: 952, height: 702 },
    nativeWindowUnits: { width: 954, height: 704 },
    nativeToObservation: { scaleX: 952 / 954, scaleY: 702 / 704 },
  });
  assert.equal(Buffer.isBuffer(capture.artifactBytes), true);
  assert.equal(capture.artifactBytes.byteLength, 24);
  assert.equal(Object.keys(capture).includes("artifactBytes"), false);
});

test("CuaDriverMcpDriver rejects stale driver geometry in favor of the same-capture native HWND bounds", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-native-main-bounds-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const driver = new CuaDriverMcpDriver({
    session: "native-main-bounds-session",
    windowRelationshipProbe: async () => [{
      windowId: "42",
      ownerWindowId: null,
      visible: true,
      enabled: true,
      processId: 1234,
      sameRequestedProcess: true,
      ownedByRequestedWindow: false,
      bounds: { x: 452, y: 100, width: 954, height: 724 },
    }],
    client: {
      async start() {},
      async callTool(name, args) {
        if (name === "get_window_state") {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(952, 16);
          header.writeUInt32BE(722, 20);
          await writeFile(args.screenshot_out_file, header);
          return {
            screenshot_file_path: args.screenshot_out_file,
            window: {
              id: 42,
              title: "Fixture",
              pid: 1234,
              bounds: { x: 0, y: 0, width: 1920, height: 1032 },
            },
          };
        }
        return { status: "ok" };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Fixture",
      pid: 1234,
      bounds: { x: 0, y: 0, width: 1920, height: 1032 },
    },
    outputPath,
  });

  assert.deepEqual(capture.nativeWindowBounds, { x: 452, y: 100, width: 954, height: 724 });
  assert.deepEqual(capture.driverReportedWindowBounds, { x: 0, y: 0, width: 1920, height: 1032 });
  assert.equal(capture.surfaceProvenance.boundsAuthority, "windows-window-relationship-probe");
  assert.deepEqual(capture.window.bounds, { x: 452, y: 100, width: 952, height: 722 });
  assert.deepEqual(capture.coordinateScale.actionTransform, {
    scaleX: 954 / 952,
    scaleY: 724 / 722,
    offsetX: 0,
    offsetY: 0,
  });
});

test("CuaDriverMcpDriver preserves only relationship-proven related screenshots", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-related-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = (width, height) => {
    const header = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
  };
  const primary = png(954, 704);
  const related = png(368, 352);
  let relationshipRequest;
  const driver = new CuaDriverMcpDriver({
    session: "related-screenshot-session",
    windowRelationshipProbe: async (request) => {
      relationshipRequest = request;
      return [{
        windowId: "77",
        ownerWindowId: "42",
        enabled: true,
        visible: true,
        processId: 1234,
        title: "",
        ownedByRequestedWindow: true,
        sameRequestedProcess: true,
        bounds: { x: 501, y: 163, width: 368, height: 554 },
      }];
    },
    client: {
      async start() {},
      async callTool(name, args) {
        if (name !== "get_window_state") return { status: "ok" };
        await writeFile(args.screenshot_out_file, primary);
        return {
          window: {
            id: 42,
            title: "微信",
            pid: 1234,
            bounds: { x: 452, y: 100, width: 954, height: 704 },
          },
          screenshots: [
            { id: "screenshot-0", originX: 452, originY: 100, width: 954, height: 704, zIndex: 0 },
            { id: "screenshot-1", originX: 501, originY: 163, width: 368, height: 352, zIndex: 1 },
          ],
          screenshotImages: [
            { data: primary.toString("base64"), mimeType: "image/png", metadata: {} },
            { data: related.toString("base64"), mimeType: "image/png", metadata: {} },
          ],
        };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 452, y: 100, width: 954, height: 704 },
    },
    outputPath,
  });

  assert.deepEqual(relationshipRequest, {
    windowIds: [42],
    includeOwnedWindows: true,
    processIds: [1234],
  });
  assert.equal(capture.relatedSurfaces.length, 1);
  const [surface] = capture.relatedSurfaces;
  assert.equal(surface.screenshotId, "screenshot-1");
  assert.equal(surface.hwnd, "77");
  assert.equal(surface.ownerWindowId, "42");
  assert.equal(surface.relationship, "owned-window");
  assert.deepEqual(surface.coordinateScale.actionTransform, {
    scaleX: 1,
    scaleY: 1,
    offsetX: 49,
    offsetY: 63,
  });
  assert.deepEqual(await readFile(surface.path), related);
  assert.equal(Buffer.isBuffer(surface.artifactBytes), true);
  assert.equal(Object.keys(surface).includes("artifactBytes"), false);
});

test("CuaDriverMcpDriver captures proven owned windows when the pinned driver returns only the main PNG", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-native-related-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = (width, height) => {
    const header = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
  };
  const primary = png(954, 704);
  const related = png(368, 554);
  let captureRequest;
  const driver = new CuaDriverMcpDriver({
    session: "native-related-screenshot-session",
    windowRelationshipProbe: async () => [{
      windowId: "77",
      ownerWindowId: "42",
      enabled: true,
      visible: true,
      processId: 1234,
      ownedByRequestedWindow: true,
      sameRequestedProcess: true,
      bounds: { x: 501, y: 163, width: 368, height: 554 },
    }],
    relatedWindowCapture: async (windowId, path, options) => {
      captureRequest = { windowId, path, options };
      await writeFile(path, related);
      return {
        status: "ok",
        method: "PrintWindow",
        hwnd: 77,
        processId: 1234,
        x: 501,
        y: 163,
        width: 368,
        height: 554,
      };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        if (name !== "get_window_state") return { status: "ok" };
        await writeFile(args.screenshot_out_file, primary);
        return {
          window: {
            id: 42,
            title: "Window",
            pid: 1234,
            bounds: { x: 452, y: 100, width: 954, height: 704 },
          },
        };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Window",
      pid: 1234,
      bounds: { x: 452, y: 100, width: 954, height: 704 },
    },
    outputPath,
    timeoutMs: 4_000,
  });

  assert.deepEqual(captureRequest, {
    windowId: "77",
    path: join(directory, "window.related-1.png"),
    options: { expectedProcessId: 1234, timeoutMs: 4_000 },
  });
  assert.equal(capture.relatedSurfaces.length, 1);
  assert.equal(capture.relatedSurfaces[0].source, "windows-owned-window-capture");
  assert.equal(capture.relatedSurfaces[0].method, "PrintWindow");
  assert.deepEqual(capture.relatedSurfaces[0].coordinateScale.actionTransform, {
    scaleX: 1,
    scaleY: 1,
    offsetX: 49,
    offsetY: 63,
  });
  assert.deepEqual(await readFile(capture.relatedSurfaces[0].path), related);
});

test("CuaDriverMcpClient keeps MCP ImageContent only for the bounded screenshot selector", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-image-content-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = (width, height) => {
    const header = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
  };
  const primary = png(954, 704);
  const related = png(368, 352);
  const sdkClient = {
    async connect() {},
    async close() {},
    async callTool(request) {
      if (request.name !== "get_window_state") {
        return { structuredContent: { status: "ok" }, content: [] };
      }
      await writeFile(request.arguments.screenshot_out_file, primary);
      return {
        structuredContent: {
          window: {
            id: 42,
            title: "微信",
            pid: 1234,
            bounds: { x: 452, y: 100, width: 954, height: 704 },
          },
          screenshots: [
            { id: "screenshot-0", originX: 452, originY: 100, width: 954, height: 704, zIndex: 0 },
            { id: "screenshot-1", originX: 501, originY: 163, width: 368, height: 352, zIndex: 1 },
          ],
        },
        content: [
          { type: "image", mimeType: "image/png", data: primary.toString("base64") },
          { type: "image", mimeType: "image/png", data: related.toString("base64") },
        ],
      };
    },
  };
  const transport = { async close() {} };
  const client = new CuaDriverMcpClient({
    client: sdkClient,
    transportFactory: () => transport,
  });
  const driver = new CuaDriverMcpDriver({
    client,
    windowRelationshipProbe: async () => [{
      windowId: "77",
      ownerWindowId: "42",
      enabled: true,
      visible: true,
      processId: 1234,
      title: "",
      ownedByRequestedWindow: true,
      sameRequestedProcess: true,
      bounds: { x: 501, y: 163, width: 368, height: 352 },
    }],
  });
  t.after(() => driver.close());

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 452, y: 100, width: 954, height: 704 },
    },
    outputPath,
  });

  assert.equal(capture.relatedSurfaces.length, 1);
  assert.equal(capture.relatedSurfaces[0].screenshotId, "screenshot-1");
  assert.deepEqual(await readFile(capture.relatedSurfaces[0].path), related);
});

test("CuaDriverMcpDriver rejects semantic and screenshot surfaces reported for an auxiliary window", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-window-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const requestedWindow = {
    windowId: 42,
    title: "Primary window",
    pid: 1234,
    bounds: { x: 463, y: 123, width: 954, height: 704 },
  };
  const driver = new CuaDriverMcpDriver({
    session: "window-identity-session",
    client: {
      async start() {},
      async callTool(name, args) {
        if (name !== "get_window_state") return { status: "ok" };
        if (args.include_screenshot) {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(952, 16);
          header.writeUInt32BE(702, 20);
          await writeFile(args.screenshot_out_file, header);
        }
        return {
          window: {
            id: 99,
            title: "Auxiliary window",
            pid: 1234,
            bounds: { x: -31993, y: -31993, width: 146, height: 21 },
          },
          elements: [],
        };
      },
    },
  });

  await assert.rejects(
    driver.capture({ window: requestedWindow, mode: "semantic" }),
    (error) => (
      error.code === "capture.surface_identity_mismatch"
      && error.detail?.requestedWindowId === "42"
      && error.detail?.reportedWindowId === "99"
    ),
  );

  await assert.rejects(
    driver.captureScreenshot({ window: requestedWindow, outputPath }),
    (error) => (
      error.code === "capture.surface_identity_mismatch"
      && error.detail?.requestedWindowId === "42"
      && error.detail?.reportedWindowId === "99"
    ),
  );
});

test("CuaDriverMcpDriver waits for a bounded delayed screenshot handoff", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-delayed-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  let delayedWrite;
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-delayed-handoff-session",
    client: {
      async start() {},
      async callTool(name, args) {
        if (name === "get_window_state") {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(640, 16);
          header.writeUInt32BE(480, 20);
          delayedWrite = new Promise((resolve, reject) => {
            setTimeout(() => writeFile(args.screenshot_out_file, header).then(resolve, reject), 600);
          });
          return {
            screenshot_file_path: args.screenshot_out_file,
            window: {
              id: 42,
              title: "Delayed",
              pid: 1234,
              bounds: { x: 10, y: 20, width: 642, height: 482 },
            },
          };
        }
        return { status: "ok" };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Delayed",
      pid: 1234,
      bounds: { x: 10, y: 20, width: 642, height: 482 },
    },
    outputPath,
  });
  await delayedWrite;

  assert.equal(capture.width, 640);
  assert.equal(capture.height, 480);
  assert.equal(Buffer.isBuffer(capture.artifactBytes), true);
});

test("CuaDriverMcpDriver retries once when the driver omits the screenshot artifact", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-retry-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  let screenshotCalls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-retry-session",
    client: {
      async start() {},
      async callTool(name, args) {
        if (name !== "get_window_state") return { status: "ok" };
        screenshotCalls += 1;
        if (screenshotCalls === 2) {
          const header = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
          header.write("IHDR", 12, "ascii");
          header.writeUInt32BE(640, 16);
          header.writeUInt32BE(480, 20);
          await writeFile(args.screenshot_out_file, header);
        }
        return {
          screenshot_file_path: args.screenshot_out_file,
          window: {
            id: 42,
            title: "Retry",
            pid: 1234,
            bounds: { x: 10, y: 20, width: 642, height: 482 },
          },
        };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Retry",
      pid: 1234,
      bounds: { x: 10, y: 20, width: 642, height: 482 },
    },
    outputPath,
  });

  assert.equal(screenshotCalls, 2);
  assert.equal(capture.width, 640);
  assert.equal(capture.height, 480);
  assert.equal(Buffer.isBuffer(capture.artifactBytes), true);
});

test("CuaDriverMcpDriver materializes an identity-bound main image when file handoff is missing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-image-handoff-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  let screenshotCalls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-image-handoff-session",
    client: {
      async start() {},
      async callTool(name) {
        if (name !== "get_window_state") return { status: "ok" };
        screenshotCalls += 1;
        return {
          window: {
            id: 42,
            title: "Image handoff",
            pid: 1234,
            bounds: { x: 10, y: 20, width: 642, height: 482 },
          },
          screenshots: [{ windowId: "42", x: 10, y: 20, width: 640, height: 480 }],
          screenshotImages: [{ data: png.toString("base64"), mimeType: "image/png" }],
        };
      },
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Image handoff",
      pid: 1234,
      bounds: { x: 10, y: 20, width: 642, height: 482 },
    },
    outputPath,
  });

  assert.equal(screenshotCalls, 1);
  assert.deepEqual(await readFile(outputPath), png);
  assert.equal(capture.width, 640);
  assert.equal(capture.height, 480);
});

test("CuaDriverMcpDriver falls back to exact-HWND PrintWindow capture after bounded driver handoff failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-native-main-fallback-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(642, 16);
  png.writeUInt32BE(482, 20);
  let screenshotCalls = 0;
  let nativeCalls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "screenshot-native-main-fallback-session",
    client: {
      async start() {},
      async callTool(name) {
        if (name !== "get_window_state") return { status: "ok" };
        screenshotCalls += 1;
        return {
          window: {
            id: 42,
            title: "Native fallback",
            pid: 1234,
            bounds: { x: 10, y: 20, width: 642, height: 482 },
          },
        };
      },
    },
    async mainWindowCapture(windowId, path, options) {
      nativeCalls += 1;
      assert.equal(String(windowId), "42");
      assert.equal(options.expectedProcessId, 1234);
      await writeFile(path, png);
      return {
        status: "ok",
        hwnd: 42,
        processId: 1234,
        method: "PrintWindow",
        x: 10,
        y: 20,
        width: 642,
        height: 482,
      };
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Native fallback",
      pid: 1234,
      bounds: { x: 10, y: 20, width: 642, height: 482 },
    },
    outputPath,
  });

  assert.equal(screenshotCalls, 2);
  assert.equal(nativeCalls, 1);
  assert.equal(capture.method, "PrintWindow");
  assert.equal(capture.source, "windows-window-capture");
  assert.deepEqual(await readFile(outputPath), png);
});

test("CuaDriverMcpDriver can prefer exact-HWND capture for a main-window-only verification", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-native-main-preferred-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "window.png");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(642, 16);
  png.writeUInt32BE(482, 20);
  let screenshotCalls = 0;
  let nativeCalls = 0;
  const driver = new CuaDriverMcpDriver({
    client: {
      async start() {},
      async callTool(name) {
        if (name === "get_window_state") screenshotCalls += 1;
        return { status: "ok" };
      },
    },
    async mainWindowCapture(_windowId, path) {
      nativeCalls += 1;
      await writeFile(path, png);
      return {
        status: "ok",
        hwnd: 42,
        processId: 1234,
        method: "PrintWindow",
        x: 10,
        y: 20,
        width: 642,
        height: 482,
      };
    },
  });

  const capture = await driver.captureScreenshot({
    window: {
      windowId: 42,
      title: "Native preferred",
      pid: 1234,
      bounds: { x: 10, y: 20, width: 642, height: 482 },
    },
    outputPath,
    includeRelatedSurfaces: false,
    preferNativeMainCapture: true,
  });

  assert.equal(screenshotCalls, 0);
  assert.equal(nativeCalls, 1);
  assert.equal(capture.method, "PrintWindow");
  assert.equal(capture.relatedSurfaces, undefined);
  assert.deepEqual(await readFile(outputPath), png);
});

test("CuaDriverMcpDriver reports a capture error instead of exposing a missing path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-missing-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let screenshotCalls = 0;
  const driver = new CuaDriverMcpDriver({
    mainWindowCapture: false,
    session: "screenshot-missing-session",
    client: {
      async start() {},
      async callTool(name, args) {
        if (name !== "get_window_state") return { status: "ok" };
        screenshotCalls += 1;
        return {
          screenshot_file_path: args.screenshot_out_file,
          window: {
            id: 42,
            title: "Missing",
            pid: 1234,
            bounds: { x: 10, y: 20, width: 642, height: 482 },
          },
        };
      },
    },
  });

  await assert.rejects(
    driver.captureScreenshot({
      window: {
        windowId: 42,
        title: "Missing",
        pid: 1234,
        bounds: { x: 10, y: 20, width: 642, height: 482 },
      },
      outputPath: join(directory, "window.png"),
    }),
    (error) => error.code === "capture.artifact_missing"
      && error.detail?.attempts === 2
      && error.detail?.retryable === true,
  );
  assert.equal(screenshotCalls, 2);
});

test("CuaDriverMcpDriver lists launchable apps and restores one through its private launch path", async () => {
  const calls = [];
  let windowPolls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "application-restore-session",
    processApplicationProbe: async () => [],
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_apps") {
          return {
            apps: [{
              name: "Restorable App",
              kind: "desktop",
              running: false,
              active: false,
              pid: 0,
              last_used: "2026-07-30T00:00:00Z",
              launch_path: "\"C:\\Program Files\\Restorable\\restorable.exe\" --desktop",
            }],
            processes: [{ name: "restorable.exe", pid: 404 }],
          };
        }
        if (name === "launch_app") return { pid: 404, name: "Restorable App", windows: [] };
        if (name === "list_windows") {
          windowPolls += 1;
          return {
            windows: [{
              window_id: 77,
              title: "Restored App",
              app_name: "restorable.exe",
              pid: 404,
              bounds: { x: 20, y: 30, width: 640, height: 480 },
              z_index: 1,
            }],
          };
        }
        return { status: "ok" };
      },
    },
  });

  const apps = await driver.listApps();
  assert.equal(apps[0].running, true);
  assert.equal(apps[0].pid, 404);
  const launch = await driver.launchApp({ launchPath: apps[0].launchPath });
  assert.equal(launch.windows[0].windowId, 77);
  assert.equal(windowPolls, 1);
  assert.deepEqual(calls.find(({ name }) => name === "launch_app"), {
    name: "launch_app",
    args: {
      launch_path: "\"C:\\Program Files\\Restorable\\restorable.exe\" --desktop",
      start_minimized: false,
    },
  });
});

test("CuaDriverMcpDriver restores an existing process window before launching another instance", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "existing-process-window-session",
    foregroundWindowProbe: async () => "77",
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [{
              window_id: 77,
              title: "Existing App",
              app_name: "existing.exe",
              pid: 404,
              is_on_screen: false,
              bounds: { x: -32000, y: -32000, width: 952, height: 702 },
              z_index: 1,
            }],
          };
        }
        if (name === "bring_to_front") {
          return {
            landed_on_target: true,
            now_fg_hwnd: "77",
          };
        }
        if (name === "launch_app") throw new Error("must not launch a running app with a restorable window");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Existing\\existing.exe",
    pid: 404,
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.windows[0].windowId, 77);
  assert.equal(result.windows[0].isForeground, true);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
  assert.deepEqual(calls.filter(({ name }) => name === "bring_to_front"), [{
    name: "bring_to_front",
    args: { pid: 404, window_id: 77 },
  }]);
});

test("CuaDriverMcpDriver restores a same-package owner window for a headless child process", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "same-package-owner-window-session",
    foregroundWindowProbe: async () => "91",
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [{
              window_id: 91,
              title: "Owning Desktop Shell",
              app_name: "owner.exe",
              pid: 700,
              is_on_screen: true,
              bounds: { x: 20, y: 30, width: 1000, height: 760 },
              z_index: 1,
            }],
          };
        }
        if (name === "bring_to_front") return { landed_on_target: true, now_fg_hwnd: "91" };
        if (name === "launch_app") throw new Error("must not launch a child process when its trusted owner window exists");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Owning App\\resources\\child.exe",
    name: "Child Surface",
    pid: 701,
    processIds: [701],
    ownerProcessIds: [700],
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.windows[0].windowId, 91);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver prefers the identity-matched main window and independently verifies foreground", async () => {
  const calls = [];
  let foregroundWindowId = "999";
  const driver = new CuaDriverMcpDriver({
    session: "primary-window-identity-session",
    foregroundWindowProbe: async () => foregroundWindowId,
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 80,
                title: "Auxiliary Surface",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 10, y: 20, width: 1200, height: 900 },
                z_index: 2,
              },
              {
                window_id: 81,
                title: "Tray App",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: -32000, y: -32000, width: 146, height: 21 },
                z_index: 1,
              },
            ],
          };
        }
        if (name === "bring_to_front") {
          if (args.window_id === 81) foregroundWindowId = "81";
          return {
            landed_on_target: true,
            now_fg_hwnd: String(args.window_id),
          };
        }
        if (name === "launch_app") throw new Error("must not launch after restoring the primary window");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    name: "Tray App",
    pid: 505,
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.windows[0].windowId, 81);
  assert.deepEqual(calls.filter(({ name }) => name === "bring_to_front"), [{
    name: "bring_to_front",
    args: { pid: 505, window_id: 81 },
  }]);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver restores a tray-only process by exact application identity before launching", async () => {
  const calls = [];
  let windowPolls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "tray-identity-restore-session",
    trayApplicationActivator: async ({ name }) => {
      assert.equal(name, "Tray App");
      return { status: "invoked" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          windowPolls += 1;
          return windowPolls === 1
            ? { windows: [] }
            : {
                windows: [{
                  window_id: 88,
                  title: "Tray App",
                  app_name: "tray-app.exe",
                  pid: 506,
                  is_on_screen: true,
                  bounds: { x: 10, y: 20, width: 900, height: 700 },
                  z_index: 1,
                }],
              };
        }
        if (name === "launch_app") throw new Error("must not launch a restored tray process");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    name: "Tray App",
    pid: 505,
    processIds: [505, 506],
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.method, "tray-accessibility-invoke");
  assert.equal(result.pid, 506);
  assert.equal(result.windows[0].windowId, 88);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver never launches a second instance when a running tray process cannot be restored", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "tray-restore-failed-session",
    trayApplicationActivator: async ({ name }) => {
      assert.equal(name, "Tray App");
      return { status: "not-found" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") return { windows: [] };
        if (name === "launch_app") throw new Error("must not launch a running tray process");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    name: "Tray App",
    pid: 505,
    running: true,
  });

  assert.deepEqual(result, {
    status: "not-applied",
    reason: "running-application-window-unavailable",
    pid: 505,
    name: "Tray App",
    windows: [],
  });
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver ignores an open auxiliary window until tray restoration exposes the main window", async () => {
  const calls = [];
  let trayInvoked = false;
  const driver = new CuaDriverMcpDriver({
    session: "tray-main-window-session",
    trayApplicationActivator: async ({ name }) => {
      assert.equal(name, "Tray App");
      trayInvoked = true;
      return { status: "invoked" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 90,
                title: "Auxiliary History",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 10, y: 20, width: 1200, height: 900 },
                z_index: 2,
              },
              ...(trayInvoked ? [{
                window_id: 91,
                title: "Tray App",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 30, y: 40, width: 900, height: 700 },
                z_index: 1,
              }] : []),
            ],
          };
        }
        if (name === "bring_to_front") throw new Error("must not activate an auxiliary window");
        if (name === "launch_app") throw new Error("must not launch a restored tray process");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    name: "Tray App",
    pid: 505,
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.method, "tray-accessibility-invoke");
  assert.equal(result.windows[0].windowId, 91);
  assert.equal(calls.some(({ name }) => name === "bring_to_front"), false);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver does not promote a same-process auxiliary through a duplicate owner pid", async () => {
  const calls = [];
  let trayInvoked = false;
  const driver = new CuaDriverMcpDriver({
    session: "tray-duplicate-owner-pid-session",
    trayApplicationActivator: async ({ name }) => {
      assert.equal(name, "Tray App");
      trayInvoked = true;
      return { status: "invoked" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 90,
                title: "Auxiliary History",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 10, y: 20, width: 1200, height: 900 },
                z_index: 2,
              },
              ...(trayInvoked ? [{
                window_id: 91,
                title: "Tray App",
                app_name: "tray-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 30, y: 40, width: 900, height: 700 },
                z_index: 1,
              }] : []),
            ],
          };
        }
        if (name === "bring_to_front") throw new Error("must not activate an auxiliary window");
        if (name === "launch_app") throw new Error("must not launch a restored tray process");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    name: "Tray App",
    pid: 505,
    processIds: [505],
    ownerProcessIds: [505],
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.method, "tray-accessibility-invoke");
  assert.equal(result.windows[0].windowId, 91);
  assert.equal(calls.some(({ name }) => name === "bring_to_front"), false);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver selects an enabled owned modal before its disabled application window", async () => {
  const calls = [];
  let foregroundWindowId = "999";
  let trayInvoked = false;
  const driver = new CuaDriverMcpDriver({
    session: "blocking-owned-modal-session",
    foregroundWindowProbe: async () => foregroundWindowId,
    windowRelationshipProbe: async ({ windowIds }) => {
      assert.deepEqual(windowIds, [92, 93]);
      return [
        { windowId: "92", ownerWindowId: null, enabled: false },
        { windowId: "93", ownerWindowId: "92", enabled: true },
      ];
    },
    trayApplicationActivator: async () => {
      trayInvoked = true;
      return { status: "invoked" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 93,
                title: "Account notice",
                app_name: "target-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 790, y: 390, width: 330, height: 219 },
                z_index: 2,
              },
              {
                window_id: 92,
                title: "Target App",
                app_name: "target-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 811, y: 325, width: 296, height: 388 },
                z_index: 1,
              },
            ],
          };
        }
        if (name === "bring_to_front") {
          foregroundWindowId = String(args.window_id);
          return {
            landed_on_target: true,
            now_fg_hwnd: String(args.window_id),
          };
        }
        if (name === "launch_app") throw new Error("must not launch while a blocking modal exists");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Target App\\target-app.exe",
    name: "Target App",
    pid: 505,
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.method, "blocking-owned-window");
  assert.equal(result.windows[0].windowId, 93);
  assert.equal(trayInvoked, false);
  assert.deepEqual(calls.filter(({ name }) => name === "bring_to_front"), [{
    name: "bring_to_front",
    args: { pid: 505, window_id: 93 },
  }]);
});

test("CuaDriverMcpDriver restores the primary window before accepting a same-title compact launcher", async () => {
  const calls = [];
  let trayInvoked = false;
  let windowPollsAfterTray = 0;
  const driver = new CuaDriverMcpDriver({
    session: "tray-compact-launcher-session",
    trayApplicationActivator: async ({ name }) => {
      assert.equal(name, "Target App");
      trayInvoked = true;
      return { status: "invoked" };
    },
    client: {
      async start() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_windows") {
          if (trayInvoked) windowPollsAfterTray += 1;
          return {
            windows: [
              {
                window_id: 92,
                title: "Target App",
                app_name: "target-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 811, y: 325, width: 296, height: 388 },
                z_index: 2,
              },
              {
                window_id: 93,
                title: "Transfer",
                app_name: "target-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 790, y: 390, width: 330, height: 219 },
                z_index: 1,
              },
              ...(trayInvoked && windowPollsAfterTray >= 2 ? [{
                window_id: 94,
                title: "Target App",
                app_name: "target-app.exe",
                pid: 505,
                is_on_screen: true,
                bounds: { x: 180, y: 90, width: 952, height: 722 },
                z_index: 3,
              }] : []),
            ],
          };
        }
        if (name === "bring_to_front") {
          throw new Error("must not activate a compact launcher while a primary window is restorable");
        }
        if (name === "launch_app") throw new Error("must not launch a restored tray process");
        return { status: "ok" };
      },
    },
  });

  const result = await driver.launchApp({
    launchPath: "C:\\Program Files\\Target App\\target-app.exe",
    name: "Target App",
    pid: 505,
    running: true,
  });

  assert.equal(result.status, "restored");
  assert.equal(result.method, "tray-accessibility-invoke");
  assert.equal(result.windows[0].windowId, 94);
  assert.equal(windowPollsAfterTray, 2);
  assert.equal(calls.some(({ name }) => name === "bring_to_front"), false);
  assert.equal(calls.some(({ name }) => name === "launch_app"), false);
});

test("CuaDriverMcpDriver projects a restorable token source for tray-only processes", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "tray-process-discovery-session",
    processApplicationProbe: async () => [{
      name: "Tray App",
      kind: "desktop",
      running: true,
      active: false,
      pid: 505,
      processIds: [505, 506],
      lastUsed: null,
      launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
    }],
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") {
          return {
            apps: [],
            processes: [],
          };
        }
        return { status: "ok" };
      },
    },
  });

  assert.deepEqual(await driver.listApps(), [{
    name: "Tray App",
    kind: "desktop",
    running: true,
    active: false,
    pid: 505,
    processIds: [505, 506],
    lastUsed: null,
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
  }]);
});

test("CuaDriverMcpDriver retries transient process discovery without losing a tray application", async () => {
  let probeCalls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "tray-process-discovery-retry-session",
    processApplicationProbe: async () => {
      probeCalls += 1;
      if (probeCalls === 1) throw new Error("cold process probe unavailable");
      return [{
        name: "Tray App",
        kind: "desktop",
        running: true,
        active: false,
        pid: 505,
        processIds: [505],
        lastUsed: null,
        launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
      }];
    },
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") return { apps: [], processes: [] };
        return { status: "ok" };
      },
    },
  });

  const applications = await driver.listApps();
  assert.equal(probeCalls, 2);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].name, "Tray App");
  assert.equal(applications[0].running, true);
});

test("CuaDriverMcpDriver does not report an authoritative empty inventory when process discovery failed", async () => {
  let probeCalls = 0;
  const driver = new CuaDriverMcpDriver({
    session: "tray-process-discovery-failed-session",
    processApplicationProbe: async () => {
      probeCalls += 1;
      throw new Error("process probe unavailable");
    },
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") return { apps: [], processes: [] };
        return { status: "ok" };
      },
    },
  });

  await assert.rejects(() => driver.listApps(), /process probe unavailable/u);
  assert.equal(probeCalls, 2);
});

test("CuaDriverMcpDriver keeps driver inventory when process enrichment fails", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "driver-inventory-fallback-session",
    processApplicationProbe: async () => {
      throw new Error("process probe unavailable");
    },
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") {
          return {
            apps: [{
              name: "Driver App",
              launch_path: "C:\\Program Files\\Driver App\\driver-app.exe",
              running: true,
              pid: 707,
            }],
            processes: [],
          };
        }
        return { status: "ok" };
      },
    },
  });

  const applications = await driver.listApps();
  assert.equal(applications.length, 1);
  assert.equal(applications[0].name, "Driver App");
  assert.equal(applications[0].running, true);
});

test("CuaDriverMcpDriver keeps process inventory when driver discovery fails", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "process-inventory-fallback-session",
    processApplicationProbe: async () => [{
      name: "Process App",
      kind: "desktop",
      running: true,
      active: false,
      pid: 808,
      processIds: [808],
      lastUsed: null,
      launchPath: "C:\\Program Files\\Process App\\process-app.exe",
    }],
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") throw new Error("driver inventory unavailable");
        return { status: "ok" };
      },
    },
  });

  const applications = await driver.listApps();
  assert.equal(applications.length, 1);
  assert.equal(applications[0].name, "Process App");
  assert.equal(applications[0].running, true);
});

test("CuaDriverMcpDriver merges native process evidence into an installed app", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "running-installed-app-session",
    processApplicationProbe: async () => [{
      name: "Installed App",
      kind: "desktop",
      running: true,
      active: false,
      pid: 606,
      lastUsed: null,
      launchPath: "C:\\Program Files\\Installed\\installed.exe",
    }],
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") {
          return {
            apps: [{
              name: "Installed App",
              launch_path: "C:\\Program Files\\Installed\\installed.exe",
              running: false,
              pid: 0,
            }],
            processes: [],
          };
        }
        return { status: "ok" };
      },
    },
  });

  const applications = await driver.listApps();
  assert.equal(applications.length, 1);
  assert.equal(applications[0].running, true);
  assert.equal(applications[0].pid, 606);
});

test("CuaDriverMcpDriver keeps distinct unquoted executable paths containing spaces", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "spaced-process-path-session",
    processApplicationProbe: async () => [
      {
        name: "First App",
        kind: "desktop",
        running: true,
        active: false,
        pid: 701,
        lastUsed: null,
        launchPath: "C:\\Program Files\\First App\\first.exe",
      },
      {
        name: "Second App",
        kind: "desktop",
        running: true,
        active: false,
        pid: 702,
        lastUsed: null,
        launchPath: "C:\\Program Files\\Second App\\second.exe",
      },
    ],
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_apps") return { apps: [], processes: [] };
        return { status: "ok" };
      },
    },
  });

  assert.deepEqual((await driver.listApps()).map(({ name }) => name), [
    "First App",
    "Second App",
  ]);
});

test("CuaDriverMcpDriver discovers the foreground window from the native foreground handle", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "foreground-discovery",
    foregroundWindowProbe: async () => {
      calls.push({ method: "foregroundWindowProbe" });
      return "91";
    },
    client: {
      async start() {
        calls.push({ method: "start" });
      },
      async callTool(name, args) {
        calls.push({ method: "callTool", name, args });
        if (name === "list_windows") {
          const windows = [
            {
              window_id: 90,
              title: "Offscreen Utility",
              app_name: "hidden.exe",
              pid: 900,
              z_index: 99,
              is_on_screen: false,
              bounds: { x: 0, y: 0, width: 1, height: 1 },
            },
            {
              window_id: 91,
              title: "Foreground App",
              app_name: "foreground.exe",
              pid: 901,
              z_index: 8,
              is_on_screen: true,
              bounds: { x: 1, y: 2, width: 800, height: 600 },
            },
            {
              window_id: 92,
              title: "Background App",
              app_name: "background.exe",
              pid: 902,
              z_index: 2,
              is_on_screen: true,
              bounds: { x: 20, y: 30, width: 640, height: 480 },
            },
            {
              window_id: 93,
              title: "Gateway-managed Computer Use",
              app_name: "GatewayComputerUseOverlay.exe",
              pid: 903,
              z_index: 50,
              is_on_screen: true,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            },
          ];
          return {
            windows: args.on_screen_only
              ? windows.filter((window) => window.is_on_screen !== false)
              : windows,
          };
        }
        return { status: "ok" };
      },
    },
  });

  const windows = await driver.listWindows({ onScreenOnly: true });
  assert.deepEqual(windows, [
    {
      windowId: 91,
      title: "Foreground App",
      appName: "foreground.exe",
      pid: 901,
      zIndex: 8,
      isOnScreen: true,
      isForeground: true,
      bounds: { x: 1, y: 2, width: 800, height: 600 },
    },
    {
      windowId: 92,
      title: "Background App",
      appName: "background.exe",
      pid: 902,
      zIndex: 2,
      isOnScreen: true,
      isForeground: false,
      bounds: { x: 20, y: 30, width: 640, height: 480 },
    },
  ]);
  assert.deepEqual(await driver.findWindow({ target: "foreground" }), {
    windowId: 91,
    title: "Foreground App",
    pid: 901,
    bounds: { x: 1, y: 2, width: 800, height: 600 },
  });
  assert.deepEqual(await driver.findWindow({ titlePart: "*" }), {
    windowId: 91,
    title: "Foreground App",
    pid: 901,
    bounds: { x: 1, y: 2, width: 800, height: 600 },
  });
  assert.deepEqual(await driver.findWindow({ windowId: 92 }), {
    windowId: 92,
    title: "Background App",
    pid: 902,
    bounds: { x: 20, y: 30, width: 640, height: 480 },
  });
  assert.deepEqual(await driver.findWindow({ titlePart: "background app" }), {
    windowId: 92,
    title: "Background App",
    pid: 902,
    bounds: { x: 20, y: 30, width: 640, height: 480 },
  });
  assert.deepEqual(
    calls.filter((call) => call.name === "list_windows").map((call) => call.args),
    [
      { on_screen_only: true },
      { on_screen_only: true },
      { on_screen_only: true },
      { on_screen_only: false },
      { on_screen_only: false },
    ],
  );
});

test("CuaDriverMcpDriver selects the controllable primary window over a same-title auxiliary surface", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "primary-window-selection",
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 101,
                title: "Target App",
                app_name: "target.exe",
                pid: 900,
                z_index: 20,
                is_on_screen: true,
                bounds: { x: 0, y: 0, width: 146, height: 21 },
              },
              {
                window_id: 102,
                title: "Target App",
                app_name: "target.exe",
                pid: 900,
                z_index: 5,
                is_on_screen: false,
                bounds: { x: 100, y: 100, width: 952, height: 702 },
              },
            ],
          };
        }
        return { status: "ok" };
      },
    },
  });

  assert.deepEqual(await driver.findWindow({ titlePart: "Target App" }), {
    windowId: 102,
    title: "Target App",
    pid: 900,
    bounds: { x: 100, y: 100, width: 952, height: 702 },
  });
});

test("CuaDriverMcpDriver omits a non-foreground process backdrop when an interactive sibling exists", async () => {
  const driver = new CuaDriverMcpDriver({
    session: "process-backdrop-filter",
    foregroundWindowProbe: async () => "999",
    client: {
      async start() {},
      async callTool(name) {
        if (name === "list_windows") {
          return {
            windows: [
              {
                window_id: 201,
                title: "Sample",
                app_name: "Sample.exe",
                pid: 901,
                z_index: 10,
                is_on_screen: true,
                bounds: { x: 0, y: 0, width: 2720, height: 1080 },
              },
              {
                window_id: 202,
                title: "Preferences",
                app_name: "Sample.exe",
                pid: 901,
                z_index: 9,
                is_on_screen: true,
                bounds: { x: 600, y: 180, width: 642, height: 561 },
              },
            ],
          };
        }
        return { status: "ok" };
      },
    },
  });

  assert.deepEqual(await driver.listWindows({ onScreenOnly: false }), [{
    windowId: 202,
    title: "Preferences",
    appName: "Sample.exe",
    pid: 901,
    zIndex: 9,
    isOnScreen: true,
    isForeground: false,
    bounds: { x: 600, y: 180, width: 642, height: 561 },
  }]);
});

test("CuaDriverMcpDriver leaves the cursor disabled when styling fails and still closes its session", async () => {
  const calls = [];
  const styleError = new Error("cursor style failed");
  const driver = new CuaDriverMcpDriver({
    session: "style-failure-session",
    client: {
      async start() {
        calls.push("client.start");
      },
      async callTool(name) {
        calls.push(name);
        if (name === "set_agent_cursor_style") throw styleError;
        return { status: "ok" };
      },
      async close() {
        calls.push("client.close");
      },
    },
  });

  await assert.rejects(
    () => driver.startCursor(),
    (error) => error === styleError,
  );
  await driver.close();

  assert.deepEqual(calls, [
    "client.start",
    "start_session",
    "set_agent_cursor_style",
    "end_session",
    "client.close",
  ]);
});

test("CuaDriverMcpDriver close attempts every cleanup stage and preserves the first error", async () => {
  const calls = [];
  const disableError = new Error("cursor disable failed");
  const endSessionError = new Error("session end failed");
  const clientCloseError = new Error("client close failed");
  let disableAttempts = 0;
  let endSessionAttempts = 0;
  let closeAttempts = 0;
  const driver = new CuaDriverMcpDriver({
    session: "cleanup-failure-session",
    client: {
      async start() {
        calls.push("client.start");
      },
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "set_agent_cursor_enabled" && args.enabled === false) {
          disableAttempts += 1;
          if (disableAttempts === 1) throw disableError;
        }
        if (name === "end_session") {
          endSessionAttempts += 1;
          if (endSessionAttempts === 1) throw endSessionError;
        }
        return { status: "ok" };
      },
      async close() {
        calls.push("client.close");
        closeAttempts += 1;
        if (closeAttempts === 1) throw clientCloseError;
      },
    },
  });

  await driver.startCursor();
  await assert.rejects(
    () => driver.close(),
    (error) => error === disableError,
  );
  await driver.close();

  assert.deepEqual(calls, [
    "client.start",
    { name: "start_session", args: { session: "cleanup-failure-session" } },
    {
      name: "set_agent_cursor_style",
      args: {
        cursor_id: "default",
        gradient_colors: ["#D97757", "#F7D2C3"],
        bloom_color: "#D97757",
      },
    },
    { name: "set_agent_cursor_enabled", args: { enabled: true, cursor_id: "default" } },
    { name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: "default" } },
    { name: "end_session", args: { session: "cleanup-failure-session" } },
    "client.close",
    { name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: "default" } },
    { name: "end_session", args: { session: "cleanup-failure-session" } },
    "client.close",
  ]);
});

test("CuaDriverMcpDriver retries cursor disable during close after a release failure", async () => {
  const calls = [];
  let disableAttempts = 0;
  const driver = new CuaDriverMcpDriver({
    session: "retry-disable-session",
    client: {
      async start() {
        calls.push("client.start");
      },
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "set_agent_cursor_enabled" && args.enabled === false) {
          disableAttempts += 1;
          if (disableAttempts === 1) throw new Error("transient disable failure");
        }
        return { status: "ok" };
      },
      async close() {
        calls.push("client.close");
      },
    },
  });

  await driver.startCursor();
  await assert.rejects(() => driver.stopCursor(), /transient disable failure/);
  await driver.close();

  assert.equal(disableAttempts, 2);
  assert.deepEqual(calls.slice(-3), [
    {
      name: "set_agent_cursor_enabled",
      args: { enabled: false, cursor_id: "default" },
    },
    { name: "end_session", args: { session: "retry-disable-session" } },
    "client.close",
  ]);
});

test("CuaDriverMcpClient retries SDK close after a transient close failure", async () => {
  let closeAttempts = 0;
  const sdkClient = {
    async connect() {},
    async close() {
      closeAttempts += 1;
      if (closeAttempts === 1) throw new Error("transient client close failure");
    },
  };
  const client = new CuaDriverMcpClient({ client: sdkClient, driverPath: "cua-driver" });
  client.transport = { close() {} };
  client.started = true;

  await assert.rejects(() => client.close(), /transient client close failure/);
  await client.close();

  assert.equal(closeAttempts, 2);
  assert.equal(client.started, false);
  assert.equal(client.transport, null);
});

test("CuaDriverMcpClient retains and closes its transport after connect fails", async () => {
  const connectError = new Error("connect failed");
  const calls = [];
  const transport = {
    async close() {
      calls.push("transport.close");
    },
  };
  const client = new CuaDriverMcpClient({
    driverPath: "cua-driver",
    client: {
      async connect(actualTransport) {
        calls.push("client.connect");
        assert.equal(actualTransport, transport);
        throw connectError;
      },
    },
    transportFactory: () => transport,
  });

  await assert.rejects(() => client.start(), (error) => error === connectError);
  assert.equal(client.transport, transport);
  await client.close();

  assert.deepEqual(calls, ["client.connect", "transport.close"]);
  assert.equal(client.transport, null);
  assert.equal(client.started, false);
});

test("CuaDriverMcpClient coalesces concurrent start and close around one transport", async () => {
  const calls = [];
  const connectGate = deferred();
  const connectEntered = deferred();
  const transport = { async close() { calls.push("transport.close"); } };
  const client = new CuaDriverMcpClient({
    driverPath: "cua-driver",
    client: {
      async connect() {
        calls.push("client.connect");
        connectEntered.resolve();
        await connectGate.promise;
      },
      async close() {
        calls.push("client.close");
      },
    },
    transportFactory: () => {
      calls.push("transport.create");
      return transport;
    },
  });

  const firstStart = client.start();
  const secondStart = client.start();
  await connectEntered.promise;
  const firstClose = client.close();
  const secondClose = client.close();
  connectGate.resolve();
  await assert.rejects(firstStart, { code: "lifecycle.closed" });
  await assert.rejects(secondStart, { code: "lifecycle.closed" });
  await Promise.all([firstClose, secondClose]);

  assert.deepEqual(calls, ["transport.create", "client.connect", "client.close"]);
  assert.equal(client.transport, null);
  assert.equal(client.started, false);
});

test("CuaDriverMcpDriver serializes cursor start, stop, and close", async () => {
  const calls = [];
  const enableGate = deferred();
  const enableEntered = deferred();
  const driver = new CuaDriverMcpDriver({
    session: "serialized-lifecycle",
    client: {
      async start() {
        calls.push("client.start");
      },
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "set_agent_cursor_enabled" && args.enabled === true) {
          enableEntered.resolve();
          await enableGate.promise;
        }
        return { status: "ok" };
      },
      async close() {
        calls.push("client.close");
      },
    },
  });

  const start = driver.startCursor();
  await enableEntered.promise;
  const stop = driver.stopCursor();
  const close = driver.close();
  enableGate.resolve();
  await assert.rejects(start, { code: "lifecycle.closed" });
  await assert.rejects(stop, { code: "lifecycle.closed" });
  await close;

  assert.deepEqual(calls.map((call) => typeof call === "string" ? call : `${call.name}:${call.args?.enabled ?? ""}`), [
    "client.start",
    "start_session:",
    "set_agent_cursor_style:",
    "set_agent_cursor_enabled:true",
    "set_agent_cursor_enabled:false",
    "end_session:",
    "client.close",
  ]);
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
