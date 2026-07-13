import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const TITLE = "Agent Computer Use Browser Fixture";

export function createBrowserFixtureAdapter(options) {
  const mcp = options.mcp;
  const session = options.session ?? `agent-app-browser-${process.pid}`;
  const spawnApp = options.spawnApp ?? ((path, args) => spawn(path, args, { stdio: "ignore", windowsHide: false }));
  let root;
  let child;
  let sessionStarted = false;
  const ownedPids = new Set();

  return {
    async discover() { return { executable: options.executable }; },
    async prepare() {
      root = await createTemporaryWorkspace("agent-app-browser-");
      const htmlPath = join(root, "fixture.html");
      const profilePath = join(root, "profile");
      await writeFile(htmlPath, fixtureHtml(), "utf8");
      return { fixture: { htmlPath, profilePath } };
    },
    async launch(context, fixture) {
      await startDriverSession(mcp, session);
      sessionStarted = true;
      child = spawnApp(options.executable.path, [
        "--new-window", "--force-renderer-accessibility", "--disable-extensions", "--no-first-run",
        `--user-data-dir=${fixture.profilePath}`, pathToFileURL(fixture.htmlPath).href,
      ]);
      if (Number.isInteger(child.pid)) ownedPids.add(child.pid);
      const window = await waitForWindow(mcp, (item) => item.title?.includes(TITLE) || item.pid === child.pid, { sleep: options.sleep });
      if (Number.isInteger(window.pid)) ownedPids.add(window.pid);
      await publishOverlayTargetRect(options.overlayTargetRectFile, window);
      return { app: { window } };
    },
    async observe(context, app) {
      const { element: button } = await waitForElement(
        mcp,
        app.window,
        session,
        (element) => /^Button$/iu.test(element.role ?? "") && element.label === "Safe fixture button",
        options.sleep,
      );
      if (!button) throw codedError("element.not_found_browser_fixture_button");
      return { observation: { window: app.window, button } };
    },
    async act(context, observation) {
      await mcp.callTool("click", {
        pid: observation.window.pid, window_id: observation.window.window_id,
        element_index: observation.button.element_index, delivery_mode: "background", session,
      });
      return { action: { kind: "element-action", token: observation.button.element_token } };
    },
    async verify(context) {
      const { element: complete } = await waitForElement(
        mcp,
        context.lifecycle.app.window,
        session,
        (element) => element.label === "Fixture action complete",
        options.sleep,
      );
      if (!complete) throw codedError("app.final_state_mismatch");
      return { finalState: { kind: "accessibility-value", label: complete.label } };
    },
    async cleanup() {
      for (const pid of ownedPids) await mcp.callTool("kill_app", { pid }).catch(() => {});
      child?.kill();
      if (sessionStarted) await stopDriverSession(mcp, session);
      else await mcp.close();
      await removeTemporaryWorkspace(root);
    },
  };
}

async function waitForElement(mcp, window, session, predicate, sleepOverride) {
  const sleep = sleepOverride ?? ((duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration)));
  const deadline = Date.now() + 10_000;
  let lastState = { elements: [] };
  while (Date.now() <= deadline) {
    lastState = await captureState(mcp, window, session);
    const element = lastState.elements.find(predicate);
    if (element) return { state: lastState, element };
    await sleep(250);
  }
  return { state: lastState, element: null };
}

async function captureState(mcp, window, session) {
  const state = structured(await mcp.callTool("get_window_state", {
    pid: window.pid, window_id: window.window_id, include_screenshot: false, max_elements: 1000, max_depth: 30, session,
  }));
  return { ...state, elements: state.elements ?? [] };
}

function fixtureHtml() {
  return `<!doctype html><html><head><title>${TITLE}</title></head><body><main><button onclick="document.getElementById('status').textContent='Fixture action complete'">Safe fixture button</button><output id="status" aria-live="polite">Waiting</output></main></body></html>`;
}
