import assert from "node:assert/strict";
import { test } from "node:test";

import { ComputerUseHarness } from "../src/computer-use-harness.mjs";

function createFakeBackend() {
  const calls = [];
  const elements = [
    {
      elementToken: "textbox-name",
      role: "textbox",
      name: "Name",
      value: "",
      state: { editable: true },
      actions: ["set_value", "type_text"],
      bounds: { x: 24, y: 80, width: 260, height: 32 },
    },
    {
      elementToken: "button-save",
      role: "button",
      name: "Save",
      value: "",
      state: { enabled: true },
      actions: ["click"],
      bounds: { x: 304, y: 80, width: 90, height: 32 },
    },
    {
      elementToken: "label-status",
      role: "text",
      name: "Status",
      value: "Idle",
      state: {},
      actions: [],
      bounds: { x: 24, y: 132, width: 320, height: 24 },
    },
    {
      elementToken: "list-events",
      role: "list",
      name: "Events",
      value: "",
      state: { scrollable: true },
      actions: ["scroll"],
      bounds: { x: 24, y: 168, width: 400, height: 120 },
    },
  ];

  return {
    calls,
    async doctor() {
      return { status: "healthy", driverPath: "C:\\tools\\cua-driver.exe", version: "cua-driver 0.7.1" };
    },
    async findWindow() {
      calls.push({ tool: "findWindow" });
      return { windowId: "lab-window", title: "Computer Use Lab", pid: 1234 };
    },
    async capture() {
      calls.push({ tool: "capture" });
      return { elements, text: 'Status="Idle"' };
    },
    async setValue(target, value) {
      calls.push({ tool: "setValue", target, value });
      elements[0].value = value;
      elements[2].value = `Saved: ${value}`;
      return { ok: true };
    },
    async click(target) {
      calls.push({ tool: "click", target });
      return { ok: true };
    },
  };
}

test("Gateway-like harness completes the Lab task with element actions and audit events", async () => {
  const backend = createFakeBackend();
  const harness = new ComputerUseHarness({
    backend,
    agentId: "deepseek-text",
    sessionId: "session-1",
    handle: "member-1",
    turnId: "turn-1",
  });

  const access = await harness.requestAccess({ windowTitle: "Computer Use Lab", tier: "full" });
  const capture = await harness.capture({ mode: "som", app: "Computer Use Lab" });
  const name = capture.elements.find((element) => element.name === "Name");
  const save = capture.elements.find((element) => element.name === "Save");

  await harness.type({ element: name.elementToken, text: "xiaozhi", captureAfter: false });
  const afterClick = await harness.click({ element: save.elementToken, captureAfter: true });
  const state = harness.listState();

  assert.equal(access.status, "approved");
  assert.equal(capture.provider, "gateway-managed");
  assert.equal(capture.source, "cua-driver");
  assert.equal(capture.includeUserOverlay, false);
  assert.equal(afterClick.text, 'Status="Saved: xiaozhi"');
  assert.equal(state.activeController.provider, "gateway-managed");
  assert.deepEqual(
    backend.calls.map((call) => call.tool),
    ["findWindow", "capture", "setValue", "click", "capture"],
  );
  assert.equal(backend.calls.find((call) => call.tool === "click").target.coordinate, undefined);
  assert.deepEqual(
    harness.audit.map((event) => event.type),
    [
      "computer.approval.request",
      "computer.approval.resolved",
      "computer.lock.acquired",
      "computer.capture.created",
      "computer.action.started",
      "computer.action.completed",
      "computer.action.started",
      "computer.action.completed",
      "computer.capture.created",
    ],
  );
  assert.ok(harness.audit.every((event) => event.provider === "gateway-managed"));
});

test("Gateway-like harness fail-louds when the backend cannot provide required Lab elements", async () => {
  const backend = createFakeBackend();
  backend.capture = async () => ({ elements: [], text: "" });
  const harness = new ComputerUseHarness({
    backend,
    agentId: "deepseek-text",
    sessionId: "session-1",
    handle: "member-1",
    turnId: "turn-1",
  });

  await harness.requestAccess({ windowTitle: "Computer Use Lab", tier: "full" });

  await assert.rejects(
    () => harness.capture({ mode: "som", app: "Computer Use Lab" }),
    /observation\.insufficient/,
  );
});
