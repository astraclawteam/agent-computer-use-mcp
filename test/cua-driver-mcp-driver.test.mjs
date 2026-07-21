import assert from "node:assert/strict";
import { test } from "node:test";
import { CuaDriverMcpClient, CuaDriverMcpDriver } from "../src/cua-driver-mcp-driver.mjs";

test("CuaDriverMcpDriver maps request/capture/action to cua-driver MCP tools", async () => {
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "test-session",
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

  await driver.setValue({ window, elementIndex: 0, elementToken: "name", value: "agent-computer-use" });
  await driver.typeText({ window, elementIndex: 2, elementToken: "document", value: "Notepad text" });
  await driver.click({ window, elementIndex: 1, elementToken: "save", deliveryMode: "background" });
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
    { method: "callTool", name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: "default" } },
    { method: "callTool", name: "end_session", args: { session: "test-session" } },
    { method: "close" },
  ]);
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
