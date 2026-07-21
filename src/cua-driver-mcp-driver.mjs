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
    this.clientStarted = false;
    this.clientStartAttempted = false;
    this.sessionStarted = false;
    this.sessionStartAttempted = false;
    this.cursorEnabled = false;
    this.cursorEnableAttempted = false;
    this.lifecycleTail = Promise.resolve();
    this.closePromise = null;
    this.lifecycleState = "open";
    this.lifecycleGeneration = 0;
  }

  ensureStarted() {
    return this.runWork((ticket) => this.ensureStartedResources(ticket));
  }

  async ensureStartedResources(ticket) {
    if (this.clientStarted && this.sessionStarted) return;
    if (!this.clientStarted) {
      this.clientStartAttempted = true;
      await this.client.start();
      this.assertWorkTicket(ticket);
      this.clientStarted = true;
    }
    if (!this.sessionStarted) {
      this.sessionStartAttempted = true;
      await this.client.callTool("start_session", { session: this.session });
      this.assertWorkTicket(ticket);
      this.sessionStarted = true;
    }
  }

  startCursor() {
    return this.runWork((ticket) => this.startCursorResources(ticket));
  }

  async startCursorResources(ticket) {
    await this.ensureStartedResources(ticket);
    this.assertWorkTicket(ticket);
    if (this.cursorEnabled) return;
    await this.client.callTool("set_agent_cursor_style", DEFAULT_AGENT_CURSOR_STYLE);
    this.assertWorkTicket(ticket);
    this.cursorEnableAttempted = true;
    await this.client.callTool("set_agent_cursor_enabled", { enabled: true, cursor_id: "default" });
    this.assertWorkTicket(ticket);
    this.cursorEnabled = true;
  }

  stopCursor() {
    return this.runWork((ticket) => this.stopCursorResources(ticket));
  }

  async stopCursorResources(ticket = null) {
    if (!this.cursorEnabled && !this.cursorEnableAttempted) return;
    await this.client.callTool("set_agent_cursor_enabled", { enabled: false, cursor_id: "default" });
    if (ticket) this.assertWorkTicket(ticket);
    this.cursorEnabled = false;
    this.cursorEnableAttempted = false;
  }

  findWindow({ titlePart }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("list_windows", { on_screen_only: false });
      this.assertWorkTicket(ticket);
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
    });
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

  capture({ window, mode = "semantic" }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("get_window_state", {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: false,
        max_elements: 500,
        max_depth: 20,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return normalizeCuaObservation(result.structuredContent ?? result, {
        mode: mode === "semantic" ? "som" : mode,
      });
    });
  }

  setValue({ window, elementToken, elementIndex, value }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("set_value", {
        pid: window.pid,
        window_id: window.windowId,
        element_index: elementIndex,
        element_token: elementToken,
        value,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  typeText({ window, elementToken, elementIndex, value, deliveryMode = "background" }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("type_text", {
        pid: window.pid,
        window_id: window.windowId,
        element_index: elementIndex,
        element_token: elementToken,
        text: value,
        delivery_mode: deliveryMode,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  click({ window, elementToken, elementIndex, deliveryMode = "background" }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("click", {
        pid: window.pid,
        window_id: window.windowId,
        element_index: elementIndex,
        element_token: elementToken,
        delivery_mode: deliveryMode,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  close() {
    if (this.lifecycleState === "closed") return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    this.lifecycleState = "closing";
    this.lifecycleGeneration += 1;
    this.closePromise = this.runLifecycle(() => this.closeResources());
    const attempt = this.closePromise;
    return attempt.then(
      (result) => {
        this.lifecycleState = "closed";
        return result;
      },
      (error) => {
        throw error;
      },
    ).finally(() => {
      if (this.closePromise === attempt) this.closePromise = null;
    });
  }

  async closeResources() {
    let firstError;
    try {
      await this.stopCursorResources();
    } catch (error) {
      firstError = error;
    }

    if (this.sessionStarted || this.sessionStartAttempted) {
      try {
        await this.client.callTool("end_session", { session: this.session });
        this.sessionStarted = false;
        this.sessionStartAttempted = false;
      } catch (error) {
        firstError ??= error;
      }
    }

    if (this.clientStarted || this.clientStartAttempted) {
      try {
        await this.client.close?.();
        this.clientStarted = false;
        this.clientStartAttempted = false;
        this.sessionStarted = false;
        this.sessionStartAttempted = false;
        this.cursorEnabled = false;
        this.cursorEnableAttempted = false;
      } catch (error) {
        firstError ??= error;
      }
    }

    if (firstError) throw firstError;
  }

  async runLifecycle(operation) {
    const previous = this.lifecycleTail;
    let release;
    this.lifecycleTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  runWork(operation) {
    const ticket = this.acquireWorkTicket();
    if (!ticket) return Promise.reject(lifecycleClosedError());
    return this.runLifecycle(async () => {
      this.assertWorkTicket(ticket);
      const result = await operation(ticket);
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  acquireWorkTicket() {
    if (this.lifecycleState !== "open") return null;
    return { generation: this.lifecycleGeneration };
  }

  assertWorkTicket(ticket) {
    if (this.lifecycleState !== "open" || ticket.generation !== this.lifecycleGeneration) {
      throw lifecycleClosedError();
    }
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
    this.transportFactory = options.transportFactory ?? (() => new StdioClientTransport({
      command: this.driverPath,
      args: ["mcp"],
      stderr: "pipe",
    }));
    this.transport = null;
    this.started = false;
    this.connected = false;
    this.startPromise = null;
    this.closePromise = null;
    this.lifecycleState = "open";
    this.callTickets = new Set();
    this.stderr = "";
  }

  start() {
    if (this.lifecycleState === "closed") return Promise.reject(lifecycleClosedError());
    if (this.lifecycleState === "closing") return this.rejectAfterClose(this.closePromise);
    if (this.started) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      if (!this.transport) {
        this.transport = this.transportFactory();
        this.transport.stderr?.on?.("data", (chunk) => {
          this.stderr += chunk;
        });
      }
      await this.client.connect(this.transport);
      this.connected = true;
      if (this.lifecycleState !== "open") throw lifecycleClosedError();
      this.started = true;
    })();
    const attempt = this.startPromise;
    return attempt.finally(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
  }

  callTool(name, args) {
    const ticket = this.acquireCallTicket();
    if (!ticket) return Promise.reject(lifecycleClosedError());
    let operation;
    try {
      operation = this.callToolOperation(ticket, name, args);
    } catch (error) {
      this.finishCallTicket(ticket);
      throw error;
    }
    return Promise.resolve(operation).then(
      (result) => {
        this.assertCallTicket(ticket);
        return result.structuredContent ?? result;
      },
      (error) => {
        if (!this.isCallTicketCurrent(ticket)) throw lifecycleClosedError();
        throw error;
      },
    ).finally(() => {
      this.finishCallTicket(ticket);
    });
  }

  async callToolOperation(ticket, name, args) {
    await this.start();
    this.assertCallTicket(ticket);
    const result = await this.client.callTool({ name, arguments: args });
    this.assertCallTicket(ticket);
    return result;
  }

  close() {
    if (this.lifecycleState === "closed") return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    this.lifecycleState = "closing";
    this.closePromise = (async () => {
      await this.waitForAdmittedCalls();
      if (this.startPromise) {
        try {
          await this.startPromise;
        } catch {
          // A failed connect still owns a transport that must be closed below.
        }
      }
      if (this.started || this.transport) {
        if ((this.started || this.connected) && this.client.close) {
          await this.client.close();
        } else {
          await this.transport?.close?.();
        }
        this.started = false;
        this.connected = false;
        this.transport = null;
      }
      this.lifecycleState = "closed";
    })();
    const attempt = this.closePromise;
    return attempt.finally(() => {
      if (this.closePromise === attempt) this.closePromise = null;
    });
  }

  acquireCallTicket() {
    if (this.lifecycleState !== "open") return null;
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const ticket = { settled, settle };
    this.callTickets.add(ticket);
    return ticket;
  }

  finishCallTicket(ticket) {
    if (!this.callTickets.delete(ticket)) return;
    ticket.settle();
  }

  isCallTicketCurrent(ticket) {
    return this.lifecycleState === "open" && this.callTickets.has(ticket);
  }

  assertCallTicket(ticket) {
    if (!this.isCallTicketCurrent(ticket)) throw lifecycleClosedError();
  }

  async waitForAdmittedCalls() {
    const admitted = [...this.callTickets];
    await Promise.all(admitted.map((ticket) => ticket.settled));
  }

  async rejectAfterClose(attempt) {
    try {
      await attempt;
    } catch {
      // Closing is terminal even when this cleanup attempt must be retried.
    }
    throw lifecycleClosedError();
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

function lifecycleClosedError() {
  const error = new Error("lifecycle.closed: cua-driver lifecycle is closing or closed");
  error.code = "lifecycle.closed";
  return error;
}
