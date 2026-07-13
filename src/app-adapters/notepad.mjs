import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  codedError,
  createTemporaryWorkspace,
  publishOverlayTargetRect,
  removeTemporaryWorkspace,
  startDriverSession,
  stopDriverSession,
  structured,
  waitForWindow,
} from "./shared.mjs";

export function createNotepadAdapter(options) {
  const mcp = options.mcp;
  const session = options.session ?? `agent-app-notepad-${process.pid}`;
  const expectedText = options.expectedText ?? "agent computer use Notepad fixture\n";
  const sleep = options.sleep;
  const ownedPids = new Set();
  let root;
  let filePath;
  let sessionStarted = false;

  return {
    async discover() {
      return { executable: options.executable };
    },
    async prepare() {
      root = await createTemporaryWorkspace("agent-app-notepad-");
      filePath = join(root, `${basename(root)}-fixture.txt`);
      await writeFile(filePath, "", "utf8");
      return { fixture: { filePath, expectedText } };
    },
    async launch() {
      await startDriverSession(mcp, session);
      sessionStarted = true;
      const launch = structured(await mcp.callTool("launch_app", {
        aumid: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App",
        additional_arguments: [filePath],
      }));
      if (Number.isInteger(launch.pid)) ownedPids.add(launch.pid);
      const window = launch.windows?.find((item) => Number.isInteger(item.pid) && item.title?.includes(basename(filePath)))
        ?? launch.windows?.find((item) => Number.isInteger(item.pid))
        ?? await waitForWindow(mcp, (item) => item.title?.includes(basename(filePath)), { sleep });
      if (Number.isInteger(window.pid)) ownedPids.add(window.pid);
      await publishOverlayTargetRect(options.overlayTargetRectFile, window);
      return { app: { window } };
    },
    async observe(context, app) {
      const state = structured(await mcp.callTool("get_window_state", stateArguments(app.window, session, 30)));
      const editor = findEditor(state.elements ?? []);
      const fileMenu = (state.elements ?? []).find((element) => /^(File|文件)$/iu.test(element.label ?? ""));
      if (!editor) throw codedError("element.not_found_notepad_editor");
      if (!fileMenu) throw codedError("element.not_found_notepad_file_menu");
      return { observation: { window: app.window, editor, fileMenu } };
    },
    async act(context, observation) {
      const window = observation.window;
      await mcp.callTool("set_value", {
        pid: window.pid,
        window_id: window.window_id,
        element_index: observation.editor.element_index,
        value: expectedText,
        session,
      });
      await mcp.callTool("click", elementClick(window, observation.fileMenu, session));
      await (sleep?.(150) ?? Promise.resolve());
      const menu = structured(await mcp.callTool("get_window_state", stateArguments(window, session, 31)));
      const save = (menu.elements ?? []).find((element) => /^(Save|保存)$/iu.test(element.label ?? ""));
      if (!save) throw codedError("element.not_found_notepad_save");
      await mcp.callTool("click", elementClick(window, save, session));
      return { action: { kind: "element-actions", editorToken: observation.editor.element_token, saveToken: save.element_token } };
    },
    async verify() {
      await (sleep?.(300) ?? Promise.resolve());
      const bytes = await readFile(filePath);
      const normalized = bytes.toString("utf8").replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
      if (normalized !== expectedText) throw codedError("app.final_state_mismatch");
      const normalizedBytes = Buffer.from(normalized, "utf8");
      return { finalState: fileState(normalizedBytes) };
    },
    async cleanup() {
      for (const pid of ownedPids) await mcp.callTool("kill_app", { pid }).catch(() => {});
      if (sessionStarted) await stopDriverSession(mcp, session);
      else await mcp.close();
      await removeTemporaryWorkspace(root);
    },
  };
}

function findEditor(elements) {
  return elements.find((element) => element.role === "Edit" && element.actions?.includes("set_value"))
    ?? elements.find((element) => element.role === "Document" && element.actions?.includes("set_value"))
    ?? elements.find((element) => element.role === "Document" && element.frame?.h > 200 && element.frame?.w > 300)
    ?? elements.find((element) => element.role === "Edit");
}

function stateArguments(window, session, maxDepth) {
  return { pid: window.pid, window_id: window.window_id, include_screenshot: false, max_elements: 1000, max_depth: maxDepth, session };
}

function elementClick(window, element, session) {
  return { pid: window.pid, window_id: window.window_id, element_index: element.element_index, delivery_mode: "background", session };
}

function fileState(bytes) {
  return { kind: "file-bytes", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
