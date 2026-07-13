import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { DEFAULT_AGENT_CURSOR_STYLE } from "../overlay-theme-cursor-tokens.mjs";

export function createNativeFixtureAdapter(options) {
  const mcp = options.mcp;
  const session = options.session ?? `agent-app-native-${process.pid}`;
  const expectedText = options.expectedText ?? "agent-computer-use-native-fixture";
  const spawnApp = options.spawnApp ?? ((path, args) => spawn(path, args, { stdio: "ignore", windowsHide: false }));
  let root;
  let filePath;
  let child;
  let sessionStarted = false;

  return {
    async discover() { return { executable: options.executable }; },
    async prepare() {
      root = await createTemporaryWorkspace("agent-app-native-");
      filePath = join(root, `${basename(root)}-saved.txt`);
      return { fixture: { filePath, expectedText } };
    },
    async launch() {
      await startDriverSession(mcp, session);
      sessionStarted = true;
      await mcp.callTool("set_agent_cursor_style", DEFAULT_AGENT_CURSOR_STYLE);
      await mcp.callTool("set_agent_cursor_enabled", { enabled: true, cursor_id: "default" });
      child = spawnApp(options.executable.path, [filePath]);
      const window = await waitForWindow(mcp, (item) => item.title?.includes(basename(filePath)) || item.pid === child.pid, { sleep: options.sleep });
      await publishOverlayTargetRect(options.overlayTargetRectFile, window);
      return { app: { window } };
    },
    async observe(context, app) {
      const state = structured(await mcp.callTool("get_window_state", {
        pid: app.window.pid, window_id: app.window.window_id, include_screenshot: false, max_elements: 500, max_depth: 20, session,
      }));
      const input = (state.elements ?? []).find((element) => element.role === "Edit" && element.actions?.includes("set_value"))
        ?? (state.elements ?? []).find((element) => element.role === "Edit");
      const save = (state.elements ?? []).find((element) => element.role === "Button" && element.label === "Save");
      if (!input || !save) throw codedError("element.not_found_native_fixture");
      return { observation: { window: app.window, input, save } };
    },
    async act(context, observation) {
      const target = { pid: observation.window.pid, window_id: observation.window.window_id, session };
      await mcp.callTool("set_value", { ...target, element_index: observation.input.element_index, value: expectedText });
      await mcp.callTool("click", { ...target, element_index: observation.save.element_index, delivery_mode: "background" });
      return { action: { kind: "element-actions", inputToken: observation.input.element_token, saveToken: observation.save.element_token } };
    },
    async verify() {
      await (options.sleep?.(300) ?? Promise.resolve());
      const bytes = await readFile(filePath);
      if (bytes.toString("utf8") !== expectedText) throw codedError("app.final_state_mismatch");
      return { finalState: { kind: "file-bytes", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
    },
    async cleanup() {
      child?.kill();
      if (sessionStarted) await mcp.callTool("set_agent_cursor_enabled", { enabled: false, cursor_id: "default" }).catch(() => {});
      if (sessionStarted) await stopDriverSession(mcp, session);
      else await mcp.close();
      await removeTemporaryWorkspace(root);
    },
  };
}
