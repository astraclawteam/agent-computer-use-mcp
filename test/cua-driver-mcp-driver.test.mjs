import assert from "node:assert/strict";
import { test } from "node:test";
import { CuaDriverMcpDriver } from "../src/cua-driver-mcp-driver.mjs";

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
              { element_index: 0, role: "Edit", label: "Name", actions: ["set_value"] },
              { element_index: 1, role: "Button", label: "Save", actions: ["click"] },
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

  const observation = await driver.capture({ window, mode: "semantic" });
  assert.equal(observation.source, "cua-driver");
  assert.equal(observation.includeUserOverlay, false);
  assert.deepEqual(observation.elements.map((element) => [element.elementIndex, element.name]), [
    [0, "Name"],
    [1, "Save"],
  ]);

  await driver.setValue({ window, elementIndex: 0, elementToken: "name", value: "agent-computer-use" });
  await driver.click({ window, elementIndex: 1, elementToken: "save", deliveryMode: "background" });
  await driver.close();

  assert.deepEqual(calls, [
    { method: "start" },
    { method: "callTool", name: "start_session", args: { session: "test-session" } },
    { method: "callTool", name: "set_agent_cursor_enabled", args: { enabled: true, cursor_id: "default" } },
    {
      method: "callTool",
      name: "set_agent_cursor_style",
      args: {
        cursor_id: "default",
        gradient_colors: ["#D97757", "#F7D2C3"],
        bloom_color: "#D97757",
      },
    },
    { method: "callTool", name: "list_windows", args: { on_screen_only: false } },
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
    { method: "callTool", name: "end_session", args: { session: "test-session" } },
    { method: "close" },
  ]);
});
