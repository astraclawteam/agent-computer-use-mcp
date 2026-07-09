import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const labExe = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const session = "agent-computer-use-phase-0-6-winforms";
const expectedText = "agent-computer-use-native-winforms";
const overlayTargetRectFile = process.env.AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE
  ?? process.env.XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE;
const mcp = new CuaDriverMcpClient({ driverPath });

const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-winforms-"));
const filePath = join(dir, `${basename(dir)}-saved.txt`);
let sessionStarted = false;

function getStructured(result) {
  return result.structuredContent ?? result;
}

function textFromResult(result) {
  return (result.content ?? []).map((item) => item.text ?? "").join("\n");
}

async function publishOverlayTargetRect(window) {
  if (!overlayTargetRectFile || !window.bounds) return;
  await writeFile(overlayTargetRectFile, JSON.stringify({
    windowId: window.window_id,
    x: window.bounds.x,
    y: window.bounds.y,
    width: window.bounds.width,
    height: window.bounds.height,
    title: window.title ?? "",
  }), "utf8");
}

async function waitForWindow(titlePart) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const windowsResult = await mcp.callTool("list_windows", { on_screen_only: false });
    const windows = getStructured(windowsResult).windows ?? [];
    const window = windows.find((item) => item.title?.includes(titlePart));
    if (window) return window;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`window.not_found: ${titlePart}`);
}

try {
  await mcp.start();
  await mcp.callTool("start_session", { session });
  sessionStarted = true;
  await mcp.callTool("set_agent_cursor_enabled", { enabled: true, cursor_id: "default" });
  await mcp.callTool("set_agent_cursor_style", {
    cursor_id: "default",
    gradient_colors: ["#D97757", "#F7D2C3"],
    bloom_color: "#D97757",
  });
  let cursorState = null;

  const lab = spawn(labExe, [filePath], {
    stdio: "ignore",
    windowsHide: false,
  });

  const window = await waitForWindow(basename(filePath));
  await publishOverlayTargetRect(window);
  const beforeResult = await mcp.callTool("get_window_state", {
    pid: window.pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 500,
    max_depth: 20,
    session,
  });
  const before = getStructured(beforeResult);
  const name = before.elements.find((element) => element.role === "Edit" && element.label === "Name")
    ?? before.elements.find((element) => element.role === "Edit");
  const save = before.elements.find((element) => element.role === "Button" && element.label === "Save");
  if (!name) throw new Error("element.not_found: Name TextBox");
  if (!save) throw new Error("element.not_found: Save Button");

  if (name.frame) {
    await mcp.callTool("move_cursor", {
      session,
      cursor_id: "default",
      x: name.frame.x + name.frame.w / 2,
      y: name.frame.y + name.frame.h / 2,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    cursorState = getStructured(await mcp.callTool("get_agent_cursor_state", {}));
  }

  const setValueResult = await mcp.callTool("set_value", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: name.element_index,
    value: expectedText,
    session,
  });

  const clickResult = await mcp.callTool("click", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: save.element_index,
    delivery_mode: "background",
    session,
  });

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const diskText = await readFile(filePath, "utf8");
  const passed = diskText === expectedText;

  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    filePath,
    window: { pid: window.pid, window_id: window.window_id, title: window.title },
    name: { element_index: name.element_index, element_token: name.element_token, label: name.label },
    save: { element_index: save.element_index, element_token: save.element_token, label: save.label },
    cursor: cursorState,
    setValueText: textFromResult(setValueResult),
    clickText: textFromResult(clickResult),
    diskText,
  }, null, 2));
  process.exitCode = passed ? 0 : 1;

  lab.kill();
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    filePath,
    error: error instanceof Error ? error.message : String(error),
    stderr: mcp.stderrText().slice(-4000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (sessionStarted) {
    await mcp.callTool("end_session", { session }).catch(() => {});
  }
  await mcp.close();
}
