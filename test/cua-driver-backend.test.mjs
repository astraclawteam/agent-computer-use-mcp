import assert from "node:assert/strict";
import { test } from "node:test";

import { CuaDriverBackend } from "../src/cua-driver-backend.mjs";

test("CuaDriverBackend maps capture to cua-driver window state and normalizes elements", async () => {
  const calls = [];
  const backend = new CuaDriverBackend({
    driverPath: "C:\\tools\\cua-driver.exe",
    runTool: async (tool, payload) => {
      calls.push({ tool, payload });
      if (tool === "get_window_state") {
        return {
          window: { id: "lab-window", title: "Computer Use Lab", pid: 1234 },
          elements: [
            { id: "1", role: "textbox", label: "Name", value: "", actions: ["set_value"] },
            { id: "2", role: "button", label: "Save", actions: ["click"] },
            { id: "3", role: "text", label: "Status", value: "Idle", actions: [] },
            { id: "4", role: "list", label: "Events", actions: ["scroll"] },
          ],
        };
      }
      throw new Error(`unexpected tool: ${tool}`);
    },
  });

  const result = await backend.capture({ windowId: "lab-window", mode: "som" });

  assert.deepEqual(calls, [
    { tool: "get_window_state", payload: { window_id: "lab-window", capture_mode: "ax", include_screenshot: false } },
  ]);
  assert.equal(result.source, "cua-driver");
  assert.deepEqual(
    result.elements.map((element) => [element.elementToken, element.role, element.name]),
    [
      ["1", "textbox", "Name"],
      ["2", "button", "Save"],
      ["3", "text", "Status"],
      ["4", "list", "Events"],
    ],
  );
});

test("CuaDriverBackend maps element setValue and click without coordinates", async () => {
  const calls = [];
  const backend = new CuaDriverBackend({
    driverPath: "C:\\tools\\cua-driver.exe",
    runTool: async (tool, payload) => {
      calls.push({ tool, payload });
      return { ok: true };
    },
  });

  await backend.setValue({ windowId: "lab-window", elementToken: "1" }, "xiaozhi");
  await backend.click({ windowId: "lab-window", elementToken: "2" });

  assert.deepEqual(calls, [
    { tool: "set_value", payload: { window_id: "lab-window", element_token: "1", value: "xiaozhi" } },
    { tool: "click", payload: { window_id: "lab-window", element_token: "2", delivery_mode: "background" } },
  ]);
});
