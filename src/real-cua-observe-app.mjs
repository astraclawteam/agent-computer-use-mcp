import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const appId = process.env.AGENT_COMPUTER_USE_SMOKE_APP_ID;
const appPath = process.env.AGENT_COMPUTER_USE_SMOKE_APP_PATH;
const targetRectFile = process.env.AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE;
const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const mcp = new CuaDriverMcpClient({ driverPath });
const root = await mkdtemp(join(tmpdir(), "agent-real-app-observe-"));
const session = `agent-real-app-${appId}`;
let child;

try {
  await mcp.start();
  const fixture = await createFixture(appId, root);
  child = spawn(appPath, fixture.args, { windowsHide: false, stdio: "ignore" });
  child.unref();
  const window = await waitForWindow(fixture.titlePart);
  if (targetRectFile && window.bounds) {
    await writeFile(targetRectFile, JSON.stringify({
      windowId: window.window_id,
      x: window.bounds.x,
      y: window.bounds.y,
      width: window.bounds.width,
      height: window.bounds.height,
      title: window.title ?? "",
    }), "utf8");
  }
  const stateResult = await mcp.callTool("get_window_state", {
    pid: window.pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 1200,
    max_depth: 40,
    session,
  });
  const state = stateResult.structuredContent ?? stateResult;
  const elements = state.elements ?? [];
  const matched = fixture.matches(elements);
  const passed = matched.length > 0;
  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    evidenceKind: "real-app",
    observationProvider: "uia-som",
    usedGuessedCoordinates: false,
    includeUserOverlay: false,
    appId,
    window: { title: window.title, elementCount: state.element_count ?? elements.length },
    matchedRoles: [...new Set(matched.map((element) => element.role))],
    observedRoles: [...new Set(elements.map((element) => element.role).filter(Boolean))],
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
  await mcp.callTool("hotkey", {
    pid: window.pid,
    window_id: window.window_id,
    keys: ["alt", "f4"],
    delivery_mode: "background",
    session,
  }).catch(() => {});
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    evidenceKind: "real-app",
    observationProvider: "uia-som",
    usedGuessedCoordinates: false,
    includeUserOverlay: false,
    appId,
    reason: "observation.insufficient",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  child?.kill();
  await mcp.close();
}

async function createFixture(id, directory) {
  if (id === "browser-edge-local-fixture") {
    const path = join(directory, "agent-browser-fixture.html");
    await writeFile(path, "<!doctype html><html><head><title>Agent Computer Use Browser Fixture</title></head><body><main><h1>Local Fixture</h1><button>Safe fixture button</button></main></body></html>", "utf8");
    return {
      titlePart: "Agent Computer Use Browser Fixture",
      args: [
        "--new-window",
        "--force-renderer-accessibility",
        "--disable-extensions",
        `--user-data-dir=${join(directory, "edge-profile")}`,
        pathToFileURL(path).href,
        "--no-first-run",
      ],
      matches: (elements) => elements.filter((element) => /Safe fixture button|Local Fixture/u.test(element.label ?? "") || element.role === "Document"),
    };
  }
  if (id === "canvas-edge-local-fixture") {
    const path = join(directory, "agent-canvas-fixture.html");
    await writeFile(path, "<!doctype html><html><head><title>Agent Computer Use Canvas Fixture</title></head><body><canvas width='640' height='360'></canvas><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#D97757';c.fillRect(80,80,180,64);c.fillStyle='white';c.font='20px sans-serif';c.fillText('Canvas control',100,120);</script></body></html>", "utf8");
    return {
      titlePart: "Agent Computer Use Canvas Fixture",
      args: [
        "--new-window",
        "--force-renderer-accessibility",
        "--disable-extensions",
        `--user-data-dir=${join(directory, "edge-canvas-profile")}`,
        pathToFileURL(path).href,
        "--no-first-run",
      ],
      matches: () => [],
    };
  }
  if (id === "electron-vscode-local-fixture") {
    const path = join(directory, "agent-vscode-fixture.txt");
    await writeFile(path, "agent computer use local fixture\n", "utf8");
    return {
      titlePart: basename(path),
      args: ["--new-window", "--force-renderer-accessibility", "--disable-extensions", path],
      matches: (elements) => elements.filter((element) => ["Document", "Edit", "TextArea"].includes(element.role)),
    };
  }
  throw new Error(`app.smoke_fixture_unsupported: ${id}`);
}

async function waitForWindow(titlePart) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const result = await mcp.callTool("list_windows", { on_screen_only: false });
    const windows = (result.structuredContent ?? result).windows ?? [];
    const window = windows.find((item) => item.title?.includes(titlePart));
    if (window) return window;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`window.not_found: ${titlePart}`);
}
