import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const windowTitle = "Computer Use Lab";
const session = "agent-computer-use-phase-0-6";
const mcp = new CuaDriverMcpClient({ driverPath });

function getStructured(result) {
  return result.structuredContent ?? result;
}

function textFromResult(result) {
  return (result.content ?? []).map((item) => item.text ?? "").join("\n");
}

try {
  await mcp.start();
  const windowsResult = await mcp.callTool("list_windows", { on_screen_only: true });
  const windows = getStructured(windowsResult).windows ?? [];
  const window = windows.find((item) => item.title?.includes(windowTitle));
  if (!window) throw new Error(`window.not_found: ${windowTitle}`);

  const beforeResult = await mcp.callTool("get_window_state", {
    pid: window.pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 1000,
    max_depth: 30,
    session,
  });
  const before = getStructured(beforeResult);
  const name = before.elements.find((element) => element.label === "Name" && element.role === "Edit");
  const save = before.elements.find((element) => element.label === "Save" && element.role === "Button");
  if (!name) throw new Error("element.not_found: Name Edit");
  if (!save) throw new Error("element.not_found: Save Button");

  const setValueResult = await mcp.callTool("set_value", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: name.element_index,
    value: "agent-computer-use",
    session,
  });

  const clickResult = await mcp.callTool("click", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: save.element_index,
    delivery_mode: "background",
    session,
  });

  const afterResult = await mcp.callTool("get_window_state", {
    pid: window.pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 1000,
    max_depth: 30,
    session,
  });
  const after = getStructured(afterResult);
  const status = after.elements.find((element) => element.label?.includes("Saved: agent-computer-use"));
  const report = {
    status: status ? "passed" : "failed",
    window: { pid: window.pid, window_id: window.window_id, title: window.title },
    name: { element_index: name.element_index, element_token: name.element_token },
    save: { element_index: save.element_index, element_token: save.element_token },
    setValueText: textFromResult(setValueResult),
    clickText: textFromResult(clickResult),
    finalStatus: status?.label ?? null,
    elementCountBefore: before.element_count,
    elementCountAfter: after.element_count,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "passed" ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    stderr: mcp.stderrText().slice(-4000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await mcp.close();
}
