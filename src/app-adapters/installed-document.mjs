import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  codedError,
  createTemporaryWorkspace,
  publishOverlayTargetRect,
  removeTemporaryWorkspace,
  startDriverSession,
  stopDriverSession,
  structured,
  terminateOwnedProcessTree,
  waitForWindow,
} from "./shared.mjs";

export function createInstalledDocumentAdapter(options) {
  const mcp = options.mcp;
  const session = options.session ?? `agent-installed-document-${process.pid}`;
  const expectedText = options.expectedText ?? "agent computer use installed application fixture";
  const spawnApp = options.spawnApp ?? ((path, args) => spawn(path, args, { stdio: "ignore", windowsHide: false }));
  const ownsNativeProcessTree = options.spawnApp === undefined;
  const ownedPids = new Set();
  let root;
  let filePath;
  let child;
  let sessionStarted = false;

  return {
    async discover() {
      return options.executable
        ? { executable: options.executable }
        : { status: "not-installed", reason: "app.executable_missing" };
    },
    async prepare() {
      root = await createTemporaryWorkspace(options.workspacePrefix ?? "agent-installed-app-");
      filePath = join(root, "fixture.txt");
      await writeFile(filePath, "", "utf8");
      options.onFixture?.(filePath, expectedText);
      return { fixture: { root, filePath, expectedText } };
    },
    async launch(context, fixture) {
      await startDriverSession(mcp, session);
      sessionStarted = true;
      child = spawnApp(options.executable.path, options.buildArguments(fixture));
      if (Number.isInteger(child.pid)) ownedPids.add(child.pid);
      const window = await waitForWindow(mcp, (item) => options.windowPredicate?.(item, fixture)
        ?? item.title?.includes("fixture"), { sleep: options.sleep, timeoutMs: options.windowTimeoutMs ?? 20_000 });
      if (Number.isInteger(window.pid)) ownedPids.add(window.pid);
      await publishOverlayTargetRect(options.overlayTargetRectFile, window);
      return { app: { window } };
    },
    async observe(context, app) {
      const state = structured(await mcp.callTool("get_window_state", stateArgs(app.window, session, 30)));
      const editor = (state.elements ?? []).find((element) => ["Edit", "Document", "TextArea"].includes(element.role)
        && element.actions?.includes("set_value"))
        ?? (state.elements ?? []).find((element) => ["Edit", "Document", "TextArea"].includes(element.role));
      const fileMenu = (state.elements ?? []).find((element) => /^(File|文件)$/iu.test(element.label ?? ""));
      if (!editor) throw codedError("element.not_found_document_editor");
      if (!fileMenu) throw codedError("element.not_found_file_menu");
      return { observation: { window: app.window, editor, fileMenu } };
    },
    async act(context, observation) {
      const target = { pid: observation.window.pid, window_id: observation.window.window_id, session };
      await mcp.callTool("set_value", { ...target, element_index: observation.editor.element_index, value: expectedText });
      await mcp.callTool("click", { ...target, element_index: observation.fileMenu.element_index, delivery_mode: "background" });
      await (options.sleep?.(150) ?? Promise.resolve());
      const menu = structured(await mcp.callTool("get_window_state", stateArgs(observation.window, session, 31)));
      const save = (menu.elements ?? []).find((element) => /^(Save|保存)$/iu.test(element.label ?? ""));
      if (!save) throw codedError("element.not_found_save_action");
      await mcp.callTool("click", { ...target, element_index: save.element_index, delivery_mode: "background" });
      return { action: { kind: "element-actions", editorToken: observation.editor.element_token, saveToken: save.element_token } };
    },
    async verify() {
      await (options.sleep?.(300) ?? Promise.resolve());
      const bytes = await readFile(filePath);
      const normalized = bytes.toString("utf8").replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
      if (normalized !== expectedText) throw codedError("app.final_state_mismatch");
      const normalizedBytes = Buffer.from(normalized, "utf8");
      return { finalState: { kind: "file-bytes", sizeBytes: normalizedBytes.length, sha256: createHash("sha256").update(normalizedBytes).digest("hex") } };
    },
    async cleanup() {
      for (const pid of ownedPids) await mcp.callTool("kill_app", { pid }).catch(() => {});
      if (ownsNativeProcessTree) await terminateOwnedProcessTree(child?.pid);
      else child?.kill();
      if (sessionStarted) await stopDriverSession(mcp, session);
      else await mcp.close();
      await (options.sleep?.(500) ?? new Promise((resolvePromise) => setTimeout(resolvePromise, 500)));
      await removeTemporaryWorkspace(root);
    },
  };
}

function stateArgs(window, session, maxDepth) {
  return { pid: window.pid, window_id: window.window_id, include_screenshot: false, max_elements: 1500, max_depth: maxDepth, session };
}
