import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const session = "agent-computer-use-phase-0-6-notepad";
const overlayTargetRectFile = process.env.AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE
  ?? process.env.XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE;
const expectedText = `agent computer use native desktop file test\nSaved through cua-driver MCP at ${new Date().toISOString()}\n`;
const mcp = new CuaDriverMcpClient({ driverPath });

const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-notepad-"));
const filePath = join(dir, `${basename(dir)}-native-file.txt`);
await writeFile(filePath, "", "utf8");

function getStructured(result) {
  return result.structuredContent ?? result;
}

function textFromResult(result) {
  return (result.content ?? []).map((item) => item.text ?? "").join("\n");
}

async function waitForWindow(titlePart, pid = null) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const args = pid == null ? { on_screen_only: false } : { pid, on_screen_only: false };
    const windowsResult = await mcp.callTool("list_windows", args);
    const windows = getStructured(windowsResult).windows ?? [];
    const window = windows.find((item) => item.title?.includes(titlePart));
    if (window) return window;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`window.not_found: ${titlePart}`);
}

function findEditor(elements) {
  return elements.find((element) => element.role === "Edit" && /Text editor|鏂囨湰缂栬緫鍣▅cua-native-file|缂栬緫/.test(element.label ?? ""))
    ?? elements.find((element) => element.role === "Document" && element.actions?.includes("set_value"))
    ?? elements.find((element) => element.role === "Document" && element.frame?.h > 200 && element.frame?.w > 300)
    ?? elements.find((element) => element.role === "Edit");
}

try {
  await mcp.start();
  const notepad = spawn("notepad.exe", [filePath], {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const window = await waitForWindow(basename(filePath));
  const pid = window.pid;
  if (overlayTargetRectFile && window.bounds) {
    await writeFile(overlayTargetRectFile, JSON.stringify({
      windowId: window.window_id,
      x: window.bounds.x,
      y: window.bounds.y,
      width: window.bounds.width,
      height: window.bounds.height,
      title: window.title ?? "",
    }), "utf8");
  }

  const beforeResult = await mcp.callTool("get_window_state", {
    pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 1000,
    max_depth: 30,
    session,
  });
  const before = getStructured(beforeResult);
  const editor = findEditor(before.elements ?? []);
  if (!editor) throw new Error("element.not_found: Notepad editor");

  const typeResult = await mcp.callTool("set_value", {
    pid,
    window_id: window.window_id,
    element_index: editor.element_index,
    value: expectedText,
    session,
  });

  const saveResult = await saveNotepadByElement({ pid, windowId: window.window_id, elements: before.elements ?? [] });

  await new Promise((resolve) => setTimeout(resolve, 700));
  const diskText = await readFile(filePath, "utf8");
  const normalizedDiskText = diskText.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  const passed = normalizedDiskText === expectedText;

  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    evidenceKind: "real-app",
    observationProvider: "uia-som",
    usedGuessedCoordinates: false,
    includeUserOverlay: false,
    fixtureFileName: basename(filePath),
    window: { pid, window_id: window.window_id, title: window.title },
    editor: { element_index: editor.element_index, element_token: editor.element_token, label: editor.label },
    typeText: textFromResult(typeResult),
    save: textFromResult(saveResult),
    normalizedDiskTextVerified: passed,
  }, null, 2));
  process.exitCode = passed ? 0 : 1;

  await mcp.callTool("hotkey", {
    pid,
    window_id: window.window_id,
    keys: ["alt", "f4"],
    delivery_mode: "background",
    session,
  }).catch(() => {});
  notepad.kill();
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    evidenceKind: "real-app",
    observationProvider: "uia-som",
    usedGuessedCoordinates: false,
    includeUserOverlay: false,
    fixtureFileName: basename(filePath),
    error: error instanceof Error ? error.message : String(error),
    stderr: mcp.stderrText().slice(-4000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await mcp.close();
}

async function saveNotepadByElement({ pid, windowId, elements }) {
  const fileMenu = elements.find((element) => /^(File|文件)$/iu.test(element.label ?? ""));
  if (!fileMenu) throw new Error("element.not_found: Notepad File menu");
  await mcp.callTool("click", {
    pid,
    window_id: windowId,
    element_index: fileMenu.element_index,
    delivery_mode: "background",
    session,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  const menuResult = await mcp.callTool("get_window_state", {
    pid,
    window_id: windowId,
    include_screenshot: false,
    max_elements: 1000,
    max_depth: 30,
    session,
  });
  const menu = getStructured(menuResult);
  const save = (menu.elements ?? []).find((element) => /^(Save|保存)$/iu.test(element.label ?? ""));
  if (!save) throw new Error("element.not_found: Notepad Save menu item");
  return mcp.callTool("click", {
    pid,
    window_id: windowId,
    element_index: save.element_index,
    delivery_mode: "background",
    session,
  });
}
