import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("CuaDriverMcpDriver keeps coordinate Unicode text on the native driver path", async () => {
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

  const result = await driver.typeText({
    window,
    x: 160,
    y: 55,
    value: "宋鹏",
    textMode: "replace-all",
    deliveryMode: "foreground",
  });

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
    {
      method: "callTool",
      name: "press_key",
      args: {
        pid: 1234,
        window_id: 42,
        key: "a",
        modifiers: ["ctrl"],
        delivery_mode: "foreground",
        session: "unicode-session",
      },
    },
    {
      method: "callTool",
      name: "press_key",
      args: {
        pid: 1234,
        window_id: 42,
        key: "backspace",
        delivery_mode: "foreground",
        session: "unicode-session",
      },
    },
    {
      method: "callTool",
      name: "type_text",
      args: {
        pid: 1234,
        window_id: 42,
        text: "宋鹏",
        delivery_mode: "foreground",
        session: "unicode-session",
      },
    },
  ]);
  assert.deepEqual(result, { status: "ok", focusVerified: true });
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
    value: "宋鹏",
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
      text: "宋鹏",
      delivery_mode: "background",
      session: "semantic-unicode-session",
    },
  });
});

test("CuaDriverMcpDriver uses the verified clipboard change boundary for coordinate Unicode text", async () => {
  const calls = [];
  const unicodeCalls = [];
  const driver = new CuaDriverMcpDriver({
    session: "coordinate-unicode-clipboard-session",
    foregroundWindowProbe: async () => "42",
    unicodeInput: async (args) => {
      unicodeCalls.push(args);
      return {
        status: "ok",
        utf16CodeUnits: args.text.length,
        clipboardRestored: true,
        changeSignalDelivered: true,
        focusVerified: true,
        deliveryPath: "windows_clipboard_transaction",
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
    value: "宋鹏",
    textMode: "replace-all",
    inputBehavior: "incremental",
    deliveryMode: "foreground",
  });

  assert.equal(unicodeCalls.length, 1);
  assert.equal(unicodeCalls[0].inputBehavior, "incremental");
  assert.equal(unicodeCalls[0].replaceAll, true);
  assert.equal(result.providerPath, "windows-native-clipboard-change-boundary");
  assert.equal(result.changeSignalDelivered, true);
  assert.equal(result.focusVerified, true);
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
    value: "宋鹏",
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
      text: "宋鹏",
      delivery_mode: "foreground",
      session: "coordinate-unicode-insert-session",
    },
  }]);
  assert.equal(result.focusVerified, true);
});

test("CuaDriverMcpDriver uses the native clipboard transaction for coordinate ASCII replace-all", async () => {
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
  });

  assert.equal(nativeInputCalls.length, 1);
  assert.equal(nativeInputCalls[0].text, "message-123");
  assert.equal(nativeInputCalls[0].replaceAll, true);
  assert.equal(result.providerPath, "windows-native-clipboard-change-boundary");
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

test("CuaDriverMcpDriver reports a capture error instead of exposing a missing path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-driver-missing-png-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let screenshotCalls = 0;
  const driver = new CuaDriverMcpDriver({
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
