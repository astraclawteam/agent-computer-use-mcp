import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeCuaObservation } from "./computer-observation.mjs";
import { checkCuaDriverHealth, resolveCuaDriverCandidate } from "./driver-health.mjs";
import { DEFAULT_AGENT_CURSOR_STYLE } from "./overlay-theme-cursor-tokens.mjs";

const DEFAULT_DRIVER_PATH = `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;

export class CuaDriverMcpDriver {
  constructor(options = {}) {
    this.session = options.session ?? `agent-computer-use-${randomUUID()}`;
    this.client = options.client ?? new CuaDriverMcpClient({
      driverPath: options.driverPath,
    });
    this.started = false;
  }

  async ensureStarted() {
    if (this.started) return;
    await this.client.start();
    await this.client.callTool("start_session", { session: this.session });
    await this.client.callTool("set_agent_cursor_enabled", { enabled: true, cursor_id: "default" });
    await this.client.callTool("set_agent_cursor_style", DEFAULT_AGENT_CURSOR_STYLE);
    this.started = true;
  }

  async findWindow({ titlePart }) {
    await this.ensureStarted();
    const result = await this.client.callTool("list_windows", { on_screen_only: false });
    const windows = result.windows ?? result.structuredContent?.windows ?? [];
    const window = windows.find((item) => item.title?.includes(titlePart) || item.name?.includes(titlePart));
    if (!window) {
      throw new Error(`window.not_found: ${titlePart}`);
    }

    return {
      windowId: window.window_id ?? window.windowId ?? window.id,
      title: window.title ?? window.name,
      pid: window.pid,
      bounds: normalizeBounds(window.bounds),
    };
  }

  async health() {
    return checkCuaDriverHealth({
      env: {
        ...process.env,
        AGENT_COMPUTER_USE_CUA_DRIVER: this.client.driverPath,
        XIAOZHICLAW_CUA_DRIVER: this.client.driverPath,
      },
    });
  }

  async capture({ window, mode = "semantic" }) {
    await this.ensureStarted();
    const result = await this.client.callTool("get_window_state", {
      pid: window.pid,
      window_id: window.windowId,
      include_screenshot: false,
      max_elements: 500,
      max_depth: 20,
      session: this.session,
    });
    return normalizeCuaObservation(result.structuredContent ?? result, {
      mode: mode === "semantic" ? "som" : mode,
    });
  }

  async setValue({ window, elementToken, elementIndex, value }) {
    await this.ensureStarted();
    return this.client.callTool("set_value", {
      pid: window.pid,
      window_id: window.windowId,
      element_index: elementIndex,
      element_token: elementToken,
      value,
      session: this.session,
    });
  }

  async click({ window, elementToken, elementIndex, deliveryMode = "background" }) {
    await this.ensureStarted();
    return this.client.callTool("click", {
      pid: window.pid,
      window_id: window.windowId,
      element_index: elementIndex,
      element_token: elementToken,
      delivery_mode: deliveryMode,
      session: this.session,
    });
  }

  async close() {
    if (this.started) {
      await this.client.callTool("end_session", { session: this.session }).catch(() => {});
    }
    this.started = false;
    await this.client.close?.();
  }
}

export class CuaDriverMcpClient {
  constructor(options = {}) {
    this.driverPath = options.driverPath
      ?? resolveCuaDriverCandidate(process.env)
      ?? (process.env.LOCALAPPDATA ? DEFAULT_DRIVER_PATH : "cua-driver");
    this.client = options.client ?? new Client({
      name: "agent-computer-use-mcp",
      version: "0.0.1",
    }, {
      capabilities: {},
    });
    this.transport = null;
    this.started = false;
    this.stderr = "";
  }

  async start() {
    if (this.started) return;
    this.transport = new StdioClientTransport({
      command: this.driverPath,
      args: ["mcp"],
      stderr: "pipe",
    });
    this.transport.stderr?.on?.("data", (chunk) => {
      this.stderr += chunk;
    });
    await this.client.connect(this.transport);
    this.started = true;
  }

  async callTool(name, args) {
    await this.start();
    const result = await this.client.callTool({ name, arguments: args });
    return result.structuredContent ?? result;
  }

  async close() {
    if (!this.started) return;
    this.started = false;
    await this.client.close();
    this.transport = null;
  }

  stderrText() {
    return this.stderr;
  }
}

function normalizeBounds(bounds) {
  if (!bounds) return undefined;
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width ?? bounds.w,
    height: bounds.height ?? bounds.h,
  };
}
