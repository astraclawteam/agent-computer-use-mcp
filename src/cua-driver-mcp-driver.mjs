import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeCuaObservation } from "./computer-observation.mjs";
import { checkCuaDriverHealth, resolveCuaDriverCandidate } from "./driver-health.mjs";
import { DEFAULT_AGENT_CURSOR_STYLE } from "./overlay-theme-cursor-tokens.mjs";
import { sendWindowsUnicodeText } from "./windows-unicode-input.mjs";
import { activateWindowsForeground } from "./windows-foreground-activation.mjs";
import { queryWindowsForegroundWindowId } from "./windows-foreground-probe.mjs";
import { queryWindowsProcessApplications } from "./windows-process-application-probe.mjs";

const DEFAULT_DRIVER_PATH = `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;

export class CuaDriverMcpDriver {
  constructor(options = {}) {
    this.session = options.session ?? `agent-computer-use-${randomUUID()}`;
    this.client = options.client ?? new CuaDriverMcpClient({
      driverPath: options.driverPath,
    });
    this.unicodeInput = options.unicodeInput ?? sendWindowsUnicodeText;
    this.foregroundWindowActivator = options.foregroundWindowActivator ?? activateWindowsForeground;
    this.foregroundWindowProbe = options.foregroundWindowProbe ?? queryWindowsForegroundWindowId;
    this.processApplicationProbe = options.processApplicationProbe ?? queryWindowsProcessApplications;
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

  listWindows({ onScreenOnly = true } = {}) {
    return this.runWork((ticket) => this.listWindowsResources(ticket, { onScreenOnly }));
  }

  listApps() {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const [result, processApplications] = await Promise.all([
        this.client.callTool("list_apps", {}),
        this.processApplicationProbe(),
      ]);
      this.assertWorkTicket(ticket);
      const payload = result.structuredContent ?? result;
      const processes = new Map((payload.processes ?? []).map((process) => [
        String(process.name ?? "").toLowerCase(),
        process,
      ]));
      const applications = (payload.apps ?? [])
        .filter((app) => typeof app.launch_path === "string" && app.launch_path.trim() !== "")
        .map((app) => {
          const process = processes.get(executableNameFromLaunchPath(app.launch_path));
          return {
            name: app.name,
            kind: app.kind ?? "desktop",
            running: app.running === true || Boolean(process),
            active: app.active === true,
            pid: Number.isInteger(app.pid) && app.pid > 0 ? app.pid : (process?.pid ?? 0),
            lastUsed: app.last_used ?? null,
            launchPath: app.launch_path,
          };
        });
      const byExecutable = new Map(applications.map((application) => [
        executableNameFromLaunchPath(application.launchPath),
        application,
      ]));
      for (const processApplication of processApplications) {
        const key = executableNameFromLaunchPath(processApplication.launchPath);
        const existing = byExecutable.get(key);
        if (existing) {
          existing.running = true;
          existing.pid ||= processApplication.pid;
          continue;
        }
        applications.push(processApplication);
        byExecutable.set(key, processApplication);
      }
      return applications
        .sort(compareApplications)
        .slice(0, 64);
    });
  }

  launchApp({ launchPath }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("launch_app", {
        launch_path: launchPath,
        start_minimized: false,
      });
      this.assertWorkTicket(ticket);
      const payload = result.structuredContent ?? result;
      let windows = (payload.windows ?? []).map(normalizeWindow);
      for (let attempt = 0; windows.length === 0 && attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        this.assertWorkTicket(ticket);
        windows = (await this.listWindowsResources(ticket, {
          onScreenOnly: false,
          includeForeground: false,
        }))
          .filter((window) => !payload.pid || window.pid === payload.pid);
      }
      windows.sort(compareWindowControllability);
      return {
        status: "launched",
        pid: payload.pid ?? windows[0]?.pid ?? 0,
        name: payload.name ?? null,
        windows,
      };
    });
  }

  async listWindowsResources(ticket, { onScreenOnly, includeForeground = true }) {
    await this.ensureStartedResources(ticket);
    const result = await this.client.callTool("list_windows", {
      on_screen_only: onScreenOnly,
    });
    this.assertWorkTicket(ticket);
    const foregroundWindowId = includeForeground
      ? await this.foregroundWindowProbe()
      : null;
    this.assertWorkTicket(ticket);
    const windows = result.windows ?? result.structuredContent?.windows ?? [];
    const normalized = windows
      .map(normalizeWindow)
      .filter((window) => (
        window.windowId !== undefined
        && window.title
        && !isComputerUseOverlayWindow(window)
      ));
    normalized.sort(compareWindowZOrder);
    return normalized.map((window) => ({
      ...window,
      isForeground: sameNativeWindowId(window.windowId, foregroundWindowId),
    }));
  }

  findWindow({ titlePart, windowId, target } = {}) {
    return this.runWork(async (ticket) => {
      const selectsForeground = target === "foreground" || titlePart?.trim() === "*";
      const windows = await this.listWindowsResources(ticket, {
        onScreenOnly: selectsForeground,
        includeForeground: selectsForeground,
      });
      let window;
      if (selectsForeground) {
        window = windows.find((item) => item.isForeground);
      } else if (windowId !== undefined) {
        window = windows.find((item) => String(item.windowId) === String(windowId));
      } else if (typeof titlePart === "string" && titlePart.trim() !== "") {
        const expected = titlePart.trim().toLowerCase();
        window = windows
          .filter((item) => (
            item.title.toLowerCase().includes(expected)
            || item.appName?.toLowerCase().includes(expected)
          ))
          .sort(compareWindowControllability)[0];
      } else {
        throw windowSelectionError(
          "window.selector_required",
          "Select a window by target=\"foreground\", windowId, or titlePart.",
        );
      }
      if (!window) {
        const selector = selectsForeground
          ? "foreground"
          : windowId !== undefined
            ? `windowId=${windowId}`
            : `titlePart=${titlePart}`;
        throw windowSelectionError(
          "window.not_found",
          `No visible window matched ${selector}.`,
          {
            retryable: true,
            nextTool: "computer.observe",
            suggestedAction: "Discover the current foreground window with computer.observe mode=\"state\", then retry using target=\"foreground\" or the returned windowId.",
          },
        );
      }
      return {
        windowId: window.windowId,
        title: window.title,
        pid: window.pid,
        bounds: window.bounds,
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
        maxElements: 500,
        maxDepth: 20,
      });
    });
  }

  captureScreenshot({ window, outputPath }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("get_window_state", {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: true,
        screenshot_out_file: outputPath,
        max_elements: 500,
        max_depth: 20,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      const resultWindow = result.window ?? {};
      const reportedBounds = normalizeBounds(resultWindow.bounds) ?? window.bounds;
      const screenshot = await readPngArtifact(outputPath);
      this.assertWorkTicket(ticket);
      const bounds = reportedBounds && screenshot
        ? {
            ...reportedBounds,
            width: screenshot.width,
            height: screenshot.height,
          }
        : reportedBounds;
      const capture = {
        status: "ok",
        provider: "cua-driver",
        source: "cua-driver-window-state",
        title: resultWindow.title ?? window.title,
        path: outputPath,
        method: "cua-driver-get_window_state",
        hwnd: resultWindow.id ?? resultWindow.window_id ?? window.windowId,
        x: bounds?.x,
        y: bounds?.y,
        width: bounds?.width,
        height: bounds?.height,
        nativeWindowBounds: reportedBounds,
        coordinateScale: createCoordinateScaleMetadata({
          screenshot,
          nativeWindowBounds: reportedBounds,
        }),
        window: {
          id: resultWindow.id ?? resultWindow.window_id ?? window.windowId,
          title: resultWindow.title ?? window.title,
          pid: resultWindow.pid ?? window.pid,
          bounds,
        },
      };
      if (screenshot?.bytes) {
        Object.defineProperty(capture, "artifactBytes", {
          configurable: false,
          enumerable: false,
          value: screenshot.bytes,
          writable: false,
        });
      }
      return capture;
    });
  }

  activateWindow({ window }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      let activation = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        activation = await this.client.callTool("bring_to_front", {
          pid: window.pid,
          window_id: window.windowId,
        });
        this.assertWorkTicket(ticket);
        const driverConfirmed = activation?.landed_on_target === true
          || (
            activation?.landed_on_target !== false
            && sameNativeWindowId(activation?.now_fg_hwnd, window.windowId)
          );
        if (driverConfirmed) {
          return {
            status: "ok",
            effect: "applied",
            verified: true,
            activation,
            foregroundWindow: {
              ...window,
              isForeground: true,
            },
          };
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 75));
      }
      let fallbackActivation = null;
      let fallbackError = null;
      try {
        fallbackActivation = await this.foregroundWindowActivator({
          windowId: window.windowId,
          processId: window.pid,
        });
        this.assertWorkTicket(ticket);
      } catch (error) {
        this.assertWorkTicket(ticket);
        fallbackError = {
          code: error?.code ?? "foreground_activation.failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (fallbackActivation?.landed_on_target === true
        && sameNativeWindowId(fallbackActivation?.now_fg_hwnd, window.windowId)) {
        return {
          status: "ok",
          effect: "applied",
          verified: true,
          activation: fallbackActivation,
          driverActivation: activation,
          foregroundWindow: {
            ...window,
            isForeground: true,
          },
        };
      }
      return {
        status: "indeterminate",
        effect: "possibly_applied",
        verified: false,
        replaySafe: true,
        activation: fallbackActivation ?? activation,
        driverActivation: activation,
        ...(fallbackError ? { fallbackError } : {}),
        foregroundWindow: null,
        nextAction: "Call computer.observe mode=\"state\" and verify foregroundWindow before interacting.",
      };
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

  typeText({
    window,
    elementToken,
    elementIndex,
    x,
    y,
    value,
    textMode = "insert",
    inputBehavior = "incremental",
    deliveryMode = "background",
  }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      if (shouldUseWindowsUnicodeInput({
        elementToken,
        elementIndex,
        x,
        y,
        value,
        deliveryMode,
      })) {
        await this.client.callTool("bring_to_front", {
          pid: window.pid,
          window_id: window.windowId,
        });
        this.assertWorkTicket(ticket);
        await this.client.callTool("click", {
          pid: window.pid,
          window_id: window.windowId,
          x,
          y,
          delivery_mode: "foreground",
          session: this.session,
        });
        this.assertWorkTicket(ticket);
        const unicodeResult = await this.unicodeInput({
          windowId: window.windowId,
          processId: window.pid,
          text: value,
          replaceAll: textMode === "replace-all",
          inputBehavior,
        });
        this.assertWorkTicket(ticket);
        return {
          status: unicodeResult.status ?? "ok",
          path: unicodeResult.deliveryPath ?? "windows_unicode_send_input",
          characters: [...value].length,
          utf16CodeUnits: unicodeResult.utf16CodeUnits,
          ...(typeof unicodeResult.clipboardRestored === "boolean"
            ? { clipboardRestored: unicodeResult.clipboardRestored }
            : {}),
          ...(typeof unicodeResult.changeSignalDelivered === "boolean"
            ? { changeSignalDelivered: unicodeResult.changeSignalDelivered }
            : {}),
          textMode,
          inputBehavior,
          effect: "possibly_applied",
          verified: false,
        };
      }
      const result = await this.client.callTool("type_text", {
        pid: window.pid,
        window_id: window.windowId,
        ...actionAddress({ elementToken, elementIndex, x, y }),
        text: value,
        delivery_mode: deliveryMode,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  click({ window, elementToken, elementIndex, x, y, deliveryMode = "background" }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("click", {
        pid: window.pid,
        window_id: window.windowId,
        ...actionAddress({ elementToken, elementIndex, x, y }),
        delivery_mode: deliveryMode,
        session: this.session,
      });
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  pressKey({ window, elementToken, elementIndex, x, y, key, modifiers, deliveryMode = "background" }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("press_key", {
        pid: window.pid,
        window_id: window.windowId,
        ...actionAddress({ elementToken, elementIndex, x, y }),
        key,
        ...(Array.isArray(modifiers) ? { modifiers } : {}),
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

function actionAddress({ elementToken, elementIndex, x, y }) {
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  const address = {};
  if (elementToken !== undefined) address.element_token = elementToken;
  if (elementIndex !== undefined) address.element_index = elementIndex;
  return address;
}

function shouldUseWindowsUnicodeInput({
  elementToken,
  elementIndex,
  x,
  y,
  value,
  deliveryMode,
}) {
  return deliveryMode === "foreground"
    && elementToken === undefined
    && elementIndex === undefined
    && Number.isFinite(x)
    && Number.isFinite(y)
    && containsNonAsciiCodeUnit(value);
}

function containsNonAsciiCodeUnit(value) {
  if (typeof value !== "string") return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return true;
  }
  return false;
}

function sameNativeWindowId(left, right) {
  try {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return BigInt(left).toString() === BigInt(right).toString();
  } catch {
    return String(left) === String(right);
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

function createCoordinateScaleMetadata({ screenshot, nativeWindowBounds }) {
  const observationWidth = screenshot?.width ?? nativeWindowBounds?.width;
  const observationHeight = screenshot?.height ?? nativeWindowBounds?.height;
  const nativeWidth = nativeWindowBounds?.width ?? observationWidth;
  const nativeHeight = nativeWindowBounds?.height ?? observationHeight;
  const scaleX = positiveRatio(observationWidth, nativeWidth);
  const scaleY = positiveRatio(observationHeight, nativeHeight);
  return {
    schemaVersion: 1,
    sourceSpace: screenshot ? "screenshot-pixel" : "window-local",
    actionSpace: "window-local",
    actionTransform: {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    },
    observationPixels: {
      width: observationWidth,
      height: observationHeight,
    },
    nativeWindowUnits: {
      width: nativeWidth,
      height: nativeHeight,
    },
    nativeToObservation: {
      scaleX,
      scaleY,
    },
  };
}

function positiveRatio(numerator, denominator) {
  return Number.isFinite(numerator) && numerator > 0
    && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : 1;
}

async function readPngArtifact(filePath) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const bytes = await readFile(filePath);
      if (bytes.byteLength < 24
        || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
        || bytes.toString("ascii", 12, 16) !== "IHDR") {
        return undefined;
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (!Number.isSafeInteger(width) || width <= 0
        || !Number.isSafeInteger(height) || height <= 0) {
        return undefined;
      }
      return { width, height, bytes };
    } catch {
      if (attempt === 7) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return undefined;
}

function normalizeWindow(window, index) {
  const zIndex = Number.isFinite(window.z_index)
    ? window.z_index
    : Number.isFinite(window.zIndex)
      ? window.zIndex
      : -index;
  return {
    windowId: window.window_id ?? window.windowId ?? window.id,
    title: window.title ?? window.name,
    appName: window.app_name ?? window.appName,
    pid: window.pid,
    zIndex,
    isOnScreen: window.is_on_screen ?? window.isOnScreen ?? true,
    isForeground: false,
    bounds: normalizeBounds(window.bounds),
  };
}

function executableNameFromLaunchPath(launchPath) {
  const trimmed = String(launchPath).trim();
  let executable;
  if (trimmed.toLowerCase().endsWith(".exe")) {
    executable = trimmed;
  } else if (trimmed.startsWith("\"")) {
    const closingQuote = trimmed.indexOf("\"", 1);
    executable = closingQuote > 1 ? trimmed.slice(1, closingQuote) : trimmed.slice(1);
  } else {
    const firstSpace = trimmed.indexOf(" ");
    executable = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  }
  return executable.replaceAll("/", "\\").split("\\").at(-1).toLowerCase();
}

function compareApplications(left, right) {
  if (left.running !== right.running) return left.running ? -1 : 1;
  if (left.active !== right.active) return left.active ? -1 : 1;
  return String(right.lastUsed ?? "").localeCompare(String(left.lastUsed ?? ""));
}

function compareWindowZOrder(left, right) {
  return right.zIndex - left.zIndex;
}

function compareWindowControllability(left, right) {
  const areaDifference = boundedWindowArea(right) - boundedWindowArea(left);
  if (areaDifference !== 0) return areaDifference;
  if (left.isOnScreen !== right.isOnScreen) return left.isOnScreen ? -1 : 1;
  return compareWindowZOrder(left, right);
}

function boundedWindowArea(window) {
  const width = Number(window?.bounds?.width);
  const height = Number(window?.bounds?.height);
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    ? width * height
    : 0;
}

function isComputerUseOverlayWindow(window) {
  const title = String(window.title ?? "").trim().toLowerCase();
  const appName = String(window.appName ?? "").trim().toLowerCase();
  return title.startsWith("cua.agentcursoroverlay.")
    || title === "gateway-managed computer use"
    || appName === "gatewaycomputeruseoverlay.exe";
}

function windowSelectionError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  return error;
}

function lifecycleClosedError() {
  const error = new Error("lifecycle.closed: cua-driver lifecycle is closing or closed");
  error.code = "lifecycle.closed";
  return error;
}
