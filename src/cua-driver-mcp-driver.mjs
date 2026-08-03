import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeCuaObservation } from "./computer-observation.mjs";
import { checkCuaDriverHealth, resolveCuaDriverCandidate } from "./driver-health.mjs";
import { DEFAULT_AGENT_CURSOR_STYLE } from "./overlay-theme-cursor-tokens.mjs";
import { activateWindowsForeground } from "./windows-foreground-activation.mjs";
import { queryWindowsForegroundWindowId } from "./windows-foreground-probe.mjs";
import { queryWindowsProcessApplications } from "./windows-process-application-probe.mjs";
import { activateWindowsTrayApplication } from "./windows-tray-application-activation.mjs";
import { queryWindowsDesktopSession } from "./windows-desktop-session-probe.mjs";
import { queryWindowsWindowRelationships } from "./windows-window-relationship-probe.mjs";
import { captureWindowPngById } from "./real-window-capture.mjs";
import { clickWindowsRelatedSurface } from "./windows-related-surface-click.mjs";

const RUNTIME_ENV = globalThis.process?.env ?? {};
const DEFAULT_DRIVER_PATH = `${RUNTIME_ENV.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const DEFAULT_SCREENSHOT_TIMEOUT_MS = 8_000;
const RELATED_SURFACE_RELEASE_SETTLE_MS = 200;

export class CuaDriverMcpDriver {
  constructor(options = {}) {
    this.session = options.session ?? `agent-computer-use-${randomUUID()}`;
    this.clientFactory = options.clientFactory
      ?? (options.client ? null : (() => new CuaDriverMcpClient({
        driverPath: options.driverPath,
      })));
    this.client = options.client ?? this.clientFactory();
    this.foregroundWindowActivator = options.foregroundWindowActivator ?? activateWindowsForeground;
    this.foregroundWindowProbe = options.foregroundWindowProbe ?? queryWindowsForegroundWindowId;
    this.processApplicationProbe = options.processApplicationProbe ?? queryWindowsProcessApplications;
    this.trayApplicationActivator = options.trayApplicationActivator ?? activateWindowsTrayApplication;
    this.windowRelationshipProbe = options.windowRelationshipProbe
      ?? queryWindowsWindowRelationships;
    this.mainWindowCapture = options.mainWindowCapture === false
      ? null
      : options.mainWindowCapture ?? captureWindowPngById;
    this.relatedWindowCapture = options.relatedWindowCapture ?? captureWindowPngById;
    this.relatedSurfaceClick = options.relatedSurfaceClick ?? clickWindowsRelatedSurface;
    this.desktopSessionProbe = options.desktopSessionProbe ?? queryWindowsDesktopSession;
    this.unicodeInput = options.unicodeInput ?? null;
    this.focusVerifier = options.focusVerifier ?? null;
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
      const [driverInventory, processInventory] = await Promise.allSettled([
        this.client.callTool("list_apps", {}),
        this.processApplicationProbe(),
      ]);
      this.assertWorkTicket(ticket);
      if (driverInventory.status === "rejected" && processInventory.status === "rejected") {
        throw driverInventory.reason;
      }
      const result = driverInventory.status === "fulfilled"
        ? driverInventory.value
        : { apps: [], processes: [] };
      const processApplications = processInventory.status === "fulfilled"
        ? processInventory.value
        : [];
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
            processIds: normalizeProcessIds(app.process_ids, app.pid, process?.pid),
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
          existing.processIds = normalizeProcessIds(
            existing.processIds,
            existing.pid,
            ...normalizeProcessIds(processApplication.processIds, processApplication.pid),
          );
          continue;
        }
        const normalizedProcessApplication = {
          ...processApplication,
          processIds: normalizeProcessIds(
            processApplication.processIds,
            processApplication.pid,
          ),
        };
        applications.push(normalizedProcessApplication);
        byExecutable.set(key, normalizedProcessApplication);
      }
      return applications
        .sort(compareApplications)
        .slice(0, 64);
    });
  }

  launchApp({ launchPath, name, pid, processIds = [], running = false }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const candidateProcessIds = new Set(normalizeProcessIds(processIds, pid));
      if (running === true && candidateProcessIds.size > 0) {
        const existingWindows = (await this.listWindowsResources(ticket, {
          onScreenOnly: false,
          includeForeground: false,
        }))
          .filter((window) => candidateProcessIds.has(window.pid))
          .sort((left, right) => compareApplicationWindowControllability(
            left,
            right,
            { name },
          ));
        const identityMatchedWindows = existingWindows.filter((window) => (
          matchesApplicationWindowIdentity(window, { name })
        ));
        const relationships = existingWindows.length > 1 && identityMatchedWindows.length > 0
          ? await this.awaitWindowRelationships(ticket, existingWindows)
          : [];
        const blockingModalWindows = findBlockingApplicationModalWindows(
          existingWindows,
          identityMatchedWindows,
          relationships,
        );
        for (const blockingWindow of blockingModalWindows) {
          const activation = await this.activateWindowResources(ticket, blockingWindow);
          if (activation.verified === true) {
            return {
              status: "restored",
              method: "blocking-owned-window",
              pid: activation.foregroundWindow.pid,
              name,
              windows: [
                activation.foregroundWindow,
                ...existingWindows.filter((window) => (
                  !sameNativeWindowId(window.windowId, blockingWindow.windowId)
                )),
              ],
            };
          }
        }
        const deferredCompactWindows = identityMatchedWindows.filter((window) => (
          shouldDeferCompactApplicationWindow(window, existingWindows)
        ));
        const directActivationWindows = identityMatchedWindows.filter((window) => (
          !deferredCompactWindows.includes(window)
        ));
        for (const existingWindow of directActivationWindows) {
          const activation = await this.activateWindowResources(ticket, existingWindow);
          if (activation.verified === true) {
            return {
              status: "restored",
              pid: activation.foregroundWindow.pid,
              name: null,
              windows: [
                activation.foregroundWindow,
                ...existingWindows.filter((window) => window.windowId !== existingWindow.windowId),
              ],
            };
          }
        }
        const trayActivation = await this.trayApplicationActivator({ name });
        this.assertWorkTicket(ticket);
        if (trayActivation?.status === "invoked") {
          let restoredWindow = null;
          let applicationWindows = [];
          for (let attempt = 0; restoredWindow === null && attempt < 8; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            this.assertWorkTicket(ticket);
            applicationWindows = (await this.listWindowsResources(ticket, {
              onScreenOnly: false,
              includeForeground: false,
            }))
              .filter((window) => candidateProcessIds.has(window.pid))
              .filter((window) => matchesApplicationWindowIdentity(window, { name }))
              .sort((left, right) => compareApplicationWindowControllability(
                left,
                right,
                { name },
              ));
            restoredWindow = applicationWindows.find((window) => (
              isMateriallyRestoredApplicationWindow(window, identityMatchedWindows)
            )) ?? null;
          }
          if (restoredWindow) {
            return {
              status: "restored",
              method: "tray-accessibility-invoke",
              pid: restoredWindow.pid,
              name,
              windows: [
                restoredWindow,
                ...applicationWindows.filter((window) => (
                  !sameNativeWindowId(window.windowId, restoredWindow.windowId)
                )),
              ],
            };
          }
        }
        for (const existingWindow of deferredCompactWindows) {
          const activation = await this.activateWindowResources(ticket, existingWindow);
          if (activation.verified === true) {
            return {
              status: "restored",
              pid: activation.foregroundWindow.pid,
              name: null,
              windows: [
                activation.foregroundWindow,
                ...existingWindows.filter((window) => window.windowId !== existingWindow.windowId),
              ],
            };
          }
        }
      }
      if (running === true) {
        return {
          status: "not-applied",
          reason: "running-application-window-unavailable",
          pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
          name: name ?? null,
          windows: [],
        };
      }
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
        const launchedPid = payload.pid ?? pid;
        windows = (await this.listWindowsResources(ticket, {
          onScreenOnly: false,
          includeForeground: false,
        }))
          .filter((window) => !launchedPid || window.pid === launchedPid);
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

  async awaitWindowRelationships(ticket, windows, options = {}) {
    try {
      const relationships = await this.windowRelationshipProbe({
        windowIds: windows.map((window) => window.windowId),
        ...(options.includeOwnedWindows === true ? {
          includeOwnedWindows: true,
          processIds: options.processIds,
        } : {}),
      });
      this.assertWorkTicket(ticket);
      return Array.isArray(relationships) ? relationships : [];
    } catch {
      this.assertWorkTicket(ticket);
      return [];
    }
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
    const controllable = normalized.filter((window) => (
      !isLikelyProcessBackdrop(window, normalized, foregroundWindowId)
    ));
    controllable.sort(compareWindowZOrder);
    return controllable.map((window) => ({
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

  desktopState() {
    return this.runWork(async (ticket) => {
      const state = await this.desktopSessionProbe();
      this.assertWorkTicket(ticket);
      return state;
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
      const rawObservation = result.structuredContent ?? result;
      const surfaceProvenance = verifyCaptureWindowIdentity(window, rawObservation.window);
      const observation = normalizeCuaObservation({
        ...rawObservation,
        window: reconcileReportedWindow(window, rawObservation.window),
      }, {
        mode: mode === "semantic" ? "som" : mode,
        maxElements: 500,
        maxDepth: 20,
      });
      return {
        ...observation,
        surfaceProvenance,
      };
    });
  }

  captureScreenshot({
    window,
    outputPath,
    timeoutMs = DEFAULT_SCREENSHOT_TIMEOUT_MS,
    includeRelatedSurfaces = true,
    preferNativeMainCapture = false,
  }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const request = {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: true,
        screenshot_out_file: outputPath,
        // Screenshot perception runs OCR separately. Traversing a large
        // accessibility tree here only adds tail latency and can stall on
        // dynamic desktop surfaces.
        max_elements: 1,
        max_depth: 1,
        session: this.session,
      };
      let result;
      let screenshot;
      let primaryCaptureMethod = "cua-driver-get_window_state";
      if (preferNativeMainCapture === true && this.mainWindowCapture) {
        const nativeCapture = await this.mainWindowCapture(window.windowId, outputPath, {
          expectedProcessId: window.pid,
          timeoutMs,
        });
        if (sameNativeWindowId(nativeCapture?.hwnd, window.windowId)
          && Number(nativeCapture?.processId) === Number(window.pid)) {
          screenshot = await readPngArtifact(outputPath, { attempts: 2 });
          if (screenshot) {
            primaryCaptureMethod = nativeCapture.method ?? "PrintWindow";
            result = {
              window: {
                id: String(nativeCapture.hwnd),
                title: nativeCapture.title ?? window.title,
                pid: Number(nativeCapture.processId),
                bounds: {
                  x: nativeCapture.x,
                  y: nativeCapture.y,
                  width: nativeCapture.width,
                  height: nativeCapture.height,
                },
              },
            };
          }
        }
      }
      for (let attempt = 0; !screenshot && attempt < 2; attempt += 1) {
        result = await this.client.callTool("get_window_state", request, {
          timeoutMs,
          selectResult: selectWindowStateWithScreenshots,
        });
        this.assertWorkTicket(ticket);
        verifyCaptureWindowIdentity(window, result.window ?? {});
        screenshot = await materializePrimaryScreenshotFromResult(result, outputPath, {
          mainWindowId: window.windowId,
          mainBounds: result.window?.bounds ?? window.bounds,
        }) ?? await readPngArtifact(outputPath, {
          attempts: attempt === 0 ? 20 : 40,
        });
        this.assertWorkTicket(ticket);
        if (screenshot) break;
      }
      if (!screenshot && this.mainWindowCapture) {
        const nativeCapture = await this.mainWindowCapture(window.windowId, outputPath, {
          expectedProcessId: window.pid,
          timeoutMs,
        });
        if (sameNativeWindowId(nativeCapture?.hwnd, window.windowId)
          && Number(nativeCapture?.processId) === Number(window.pid)) {
          screenshot = await readPngArtifact(outputPath, { attempts: 2 });
          if (screenshot) primaryCaptureMethod = nativeCapture.method ?? "PrintWindow";
        }
      }
      if (!screenshot) {
        const error = new Error("The screenshot driver did not produce a readable PNG artifact after one bounded retry.");
        error.code = "capture.artifact_missing";
        error.detail = {
          windowId: String(window.windowId),
          processId: window.pid,
          attempts: 2,
          retryable: true,
        };
        throw error;
      }
      const resultWindow = result?.window ?? {};
      const surfaceProvenance = verifyCaptureWindowIdentity(window, resultWindow);
      const reconciledWindow = reconcileReportedWindow(window, resultWindow);
      const reportedBounds = reconciledWindow.bounds;
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
        source: primaryCaptureMethod === "cua-driver-get_window_state"
          ? "cua-driver-window-state"
          : "windows-window-capture",
        title: reconciledWindow.title,
        path: outputPath,
        method: primaryCaptureMethod,
        hwnd: reconciledWindow.id,
        x: bounds?.x,
        y: bounds?.y,
        width: bounds?.width,
        height: bounds?.height,
        nativeWindowBounds: reportedBounds,
        surfaceProvenance,
        coordinateScale: createCoordinateScaleMetadata({
          screenshot,
          nativeWindowBounds: reportedBounds,
        }),
        window: {
          id: reconciledWindow.id,
          title: reconciledWindow.title,
          pid: reconciledWindow.pid,
          bounds,
        },
      };
      const relatedWindowRelationships = await this.awaitWindowRelationships(ticket, [{
        ...window,
        windowId: reconciledWindow.id,
      }], {
        includeOwnedWindows: includeRelatedSurfaces === true,
        processIds: [reconciledWindow.pid],
      });
      const nativeMainBounds = relationshipBoundsForWindow(
        relatedWindowRelationships,
        reconciledWindow.id,
      ) ?? reportedBounds;
      const observedBounds = nativeMainBounds && screenshot
        ? {
            ...nativeMainBounds,
            width: screenshot.width,
            height: screenshot.height,
          }
        : nativeMainBounds;
      capture.x = observedBounds?.x;
      capture.y = observedBounds?.y;
      capture.width = observedBounds?.width;
      capture.height = observedBounds?.height;
      capture.nativeWindowBounds = nativeMainBounds;
      capture.coordinateScale = createCoordinateScaleMetadata({
        screenshot,
        nativeWindowBounds: nativeMainBounds,
      });
      capture.window.bounds = observedBounds;
      if (nativeMainBounds && reportedBounds && !nearBounds(nativeMainBounds, reportedBounds, 8)) {
        capture.driverReportedWindowBounds = reportedBounds;
        capture.surfaceProvenance = {
          ...capture.surfaceProvenance,
          boundsAuthority: "windows-window-relationship-probe",
        };
      }
      const reconciledNativeWindow = {
        ...reconciledWindow,
        bounds: nativeMainBounds,
      };
      const driverRelatedSurfaces = includeRelatedSurfaces === true
        ? await buildRelatedScreenshotCaptures({
            result,
            primaryScreenshot: screenshot,
            requestedWindow: window,
            reconciledWindow: reconciledNativeWindow,
            outputPath,
            windowRelationships: relatedWindowRelationships,
          })
        : [];
      const nativeRelatedSurfaces = includeRelatedSurfaces === true
        ? await captureMissingRelatedWindows({
            relationships: relatedWindowRelationships,
            existingCaptures: driverRelatedSurfaces,
            mainBounds: nativeMainBounds ?? window?.bounds,
            mainWindowId: String(reconciledWindow.id),
            processId: reconciledWindow.pid,
            outputPath,
            captureWindow: this.relatedWindowCapture,
            timeoutMs,
          })
        : [];
      this.assertWorkTicket(ticket);
      const relatedSurfaces = [...driverRelatedSurfaces, ...nativeRelatedSurfaces];
      if (relatedSurfaces.length > 0) capture.relatedSurfaces = relatedSurfaces;
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

  activateWindow({ window, signal }) {
    return this.runWork((ticket) => this.activateWindowResources(ticket, window), signal);
  }

  async activateWindowResources(ticket, window) {
    await this.ensureStartedResources(ticket);
    let activation = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      activation = await this.client.callTool("bring_to_front", {
        pid: window.pid,
        window_id: window.windowId,
      }, { signal: ticket.signal });
      this.assertWorkTicket(ticket);
      const foregroundWindowId = await this.foregroundWindowProbe();
      this.assertWorkTicket(ticket);
      const driverConfirmed = activation?.landed_on_target !== false
        && sameNativeWindowId(foregroundWindowId, window.windowId);
      if (driverConfirmed) {
        return {
          status: "ok",
          effect: "applied",
          verified: true,
          activation: {
            ...activation,
            verified_fg_hwnd: foregroundWindowId,
          },
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
  }

  async ensureForegroundActionResources(ticket, window) {
    await this.ensureStartedResources(ticket);
    const currentForegroundWindowId = await this.foregroundWindowProbe();
    this.assertWorkTicket(ticket);
    if (sameNativeWindowId(currentForegroundWindowId, window.windowId)) {
      return {
        status: "ok",
        effect: "preserved",
        verified: true,
        activation: {
          method: "already-foreground",
          verified_fg_hwnd: currentForegroundWindowId,
        },
        foregroundWindow: {
          ...window,
          isForeground: true,
        },
      };
    }
    const activation = await this.activateWindowResources(ticket, window);
    if (activation?.verified === true && activation?.foregroundWindow?.isForeground === true) {
      return activation;
    }
    return null;
  }

  setValue({ window, elementToken, elementIndex, value, signal }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const result = await this.client.callTool("set_value", {
        pid: window.pid,
        window_id: window.windowId,
        element_index: elementIndex,
        element_token: elementToken,
        value,
        session: this.session,
      }, { signal: ticket.signal });
      this.assertWorkTicket(ticket);
      return result;
    }, signal);
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
    focusVerified = false,
    signal,
  }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const coordinateGrounded = Number.isFinite(x) && Number.isFinite(y);
      let coordinateFocusVerified = focusVerified === true;
      if (deliveryMode === "foreground" && coordinateGrounded) {
        const activation = await this.ensureForegroundActionResources(ticket, window);
        if (!activation) return foregroundActionNotApplied("type_text");
        if (!coordinateFocusVerified) {
          const focusClick = await this.client.callTool("click", {
            pid: window.pid,
            window_id: window.windowId,
            x,
            y,
            delivery_mode: "foreground",
            session: this.session,
          }, { signal: ticket.signal });
          this.assertWorkTicket(ticket);
          coordinateFocusVerified = focusClick?.status !== "error"
            && focusClick?.effect !== "not-applied";
        }
      }
      if (coordinateGrounded && textMode === "replace-all") {
        if (!this.unicodeInput) throw unicodeInputUnavailableError();
        const result = await this.unicodeInput({
          windowId: window.windowId,
          processId: window.pid,
          focusX: x,
          focusY: y,
          text: value,
          replaceAll: textMode === "replace-all",
          inputBehavior,
          signal: ticket.signal,
        });
        this.assertWorkTicket(ticket);
        return {
          ...result,
          ...(result.exactValueVerified === true ? { verified: true } : {}),
          characters: value.length,
          textMode,
          inputBehavior,
          ...(coordinateFocusVerified ? { focusVerified: true } : {}),
          providerPath: result.deliveryPath ?? "windows-native-text-input",
        };
      }
      // Coordinates establish editable focus, but keyboard delivery must target
      // the focused window. Passing the same point into cua-driver's text tool
      // selects a different injection path that custom-drawn editors can accept
      // without emitting their live text-change event.
      const keyboardAddress = coordinateGrounded
        ? {}
        : actionAddress({ elementToken, elementIndex, x, y });
      // Coordinate-grounded custom editors need cua-driver's foreground key
      // route after the verified focus click. Omitting the delivery mode can
      // report key-events delivered while custom search fields receive none.
      const keyboardDelivery = coordinateGrounded
        ? { delivery_mode: "foreground" }
        : { delivery_mode: deliveryMode };
      if (textMode === "replace-all") {
        await this.client.callTool("press_key", {
          pid: window.pid,
          window_id: window.windowId,
          ...keyboardAddress,
          key: "a",
          modifiers: ["ctrl"],
          ...keyboardDelivery,
          session: this.session,
        }, { signal: ticket.signal });
        this.assertWorkTicket(ticket);
        await this.client.callTool("press_key", {
          pid: window.pid,
          window_id: window.windowId,
          ...keyboardAddress,
          key: "backspace",
          ...keyboardDelivery,
          session: this.session,
        }, { signal: ticket.signal });
        this.assertWorkTicket(ticket);
      }
      const result = await this.client.callTool("type_text", {
        pid: window.pid,
        window_id: window.windowId,
        ...keyboardAddress,
        text: value,
        ...keyboardDelivery,
        session: this.session,
      }, { signal: ticket.signal });
      this.assertWorkTicket(ticket);
      return {
        ...result,
        ...(coordinateFocusVerified ? { focusVerified: true } : {}),
      };
    }, signal);
  }

  click({
    window,
    elementToken,
    elementIndex,
    x,
    y,
    deliveryMode = "background",
    interactionIntent,
    relatedWindowId,
    signal,
  }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      const coordinateGrounded = Number.isFinite(x) && Number.isFinite(y);
      if (coordinateGrounded && deliveryMode === "foreground") {
        const activation = await this.ensureForegroundActionResources(ticket, window);
        if (!activation) return foregroundActionNotApplied("click");
      }
      if (coordinateGrounded
        && deliveryMode === "foreground"
        && relatedWindowId !== undefined
        && String(relatedWindowId) !== String(window.windowId)) {
        const restoreAgentCursor = this.cursorEnabled;
        const restoreDriverSession = this.sessionStarted;
        if (restoreAgentCursor) await this.stopCursorResources(ticket);
        if (restoreDriverSession) {
          await this.client.callTool("end_session", { session: this.session });
          this.assertWorkTicket(ticket);
          this.sessionStarted = false;
          this.sessionStartAttempted = false;
        }
        if (this.clientFactory) {
          await this.client.close();
          this.assertWorkTicket(ticket);
          this.client = this.clientFactory();
          this.clientStarted = false;
          this.clientStartAttempted = false;
          await waitForDriverInputRelease(ticket.signal);
          this.assertWorkTicket(ticket);
        }
        try {
          const result = await this.relatedSurfaceClick({
            controllerWindowId: window.windowId,
            relatedWindowId,
            processId: window.pid,
            screenX: window.bounds.x + x,
            screenY: window.bounds.y + y,
            signal: ticket.signal,
          });
          this.assertWorkTicket(ticket);
          return result;
        } finally {
          if (ticket.signal?.aborted !== true) {
            if (restoreDriverSession) await this.ensureStartedResources(ticket);
            if (restoreAgentCursor) await this.startCursorResources(ticket);
          }
        }
      }
      const result = await this.client.callTool("click", {
        pid: window.pid,
        window_id: window.windowId,
        ...actionAddress({ elementToken, elementIndex, x, y }),
        delivery_mode: deliveryMode,
        session: this.session,
      }, { signal: ticket.signal });
      this.assertWorkTicket(ticket);
      if (interactionIntent === "focus-editable"
        && coordinateGrounded
        && deliveryMode === "foreground"
        && result?.status !== "error"
        && result?.effect !== "not-applied"
        && this.focusVerifier) {
        try {
          const focus = await this.focusVerifier({
            windowId: window.windowId,
            processId: window.pid,
            signal: ticket.signal,
          });
          this.assertWorkTicket(ticket);
          return {
            ...result,
            focusVerified: focus?.focusVerified === true,
            focusVerificationPath: focus?.verificationPath ?? "windows-focused-process-boundary",
          };
        } catch (error) {
          this.assertWorkTicket(ticket);
          return {
            ...result,
            focusVerified: false,
            focusVerificationError: error?.code ?? "focus.verification_failed",
          };
        }
      }
      return result;
    }, signal);
  }

  pressKey({ window, elementToken, elementIndex, x, y, key, modifiers, deliveryMode = "background", signal }) {
    return this.runWork(async (ticket) => {
      await this.ensureStartedResources(ticket);
      if (deliveryMode === "foreground") {
        const activation = await this.ensureForegroundActionResources(ticket, window);
        if (!activation) return foregroundActionNotApplied("press_key");
      }
      const result = await this.client.callTool("press_key", {
        pid: window.pid,
        window_id: window.windowId,
        ...actionAddress({ elementToken, elementIndex, x, y }),
        key,
        ...(Array.isArray(modifiers) ? { modifiers } : {}),
        delivery_mode: deliveryMode,
        session: this.session,
      }, { signal: ticket.signal });
      this.assertWorkTicket(ticket);
      return result;
    }, signal);
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

  runWork(operation, signal) {
    const ticket = this.acquireWorkTicket(signal);
    if (!ticket) return Promise.reject(lifecycleClosedError());
    return this.runLifecycle(async () => {
      this.assertWorkTicket(ticket);
      const result = await operation(ticket);
      this.assertWorkTicket(ticket);
      return result;
    });
  }

  acquireWorkTicket(signal) {
    if (this.lifecycleState !== "open") return null;
    return { generation: this.lifecycleGeneration, signal };
  }

  assertWorkTicket(ticket) {
    if (ticket.signal?.aborted === true) throw operationCancelledError(ticket.signal.reason);
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

function sameNativeWindowId(left, right) {
  try {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return BigInt(left).toString() === BigInt(right).toString();
  } catch {
    return String(left) === String(right);
  }
}

function unicodeInputUnavailableError() {
  const error = new Error("unicode_input.unavailable");
  error.code = "unicode_input.unavailable";
  return error;
}

function waitForDriverInputRelease(signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(operationCancelledError(signal?.reason));
    const timer = setTimeout(() => finish(), RELATED_SURFACE_RELEASE_SETTLE_MS);
    timer.unref?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class CuaDriverMcpClient {
  constructor(options = {}) {
    this.driverPath = options.driverPath
      ?? resolveCuaDriverCandidate(RUNTIME_ENV)
      ?? (RUNTIME_ENV.LOCALAPPDATA ? DEFAULT_DRIVER_PATH : "cua-driver");
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

  callTool(name, args, options = {}) {
    const ticket = this.acquireCallTicket();
    if (!ticket) return Promise.reject(lifecycleClosedError());
    let operation;
    try {
      operation = this.callToolOperation(ticket, name, args, options);
    } catch (error) {
      this.finishCallTicket(ticket);
      throw error;
    }
    return Promise.resolve(operation).then(
      (result) => {
        this.assertCallTicket(ticket);
        return typeof options.selectResult === "function"
          ? options.selectResult(result)
          : (result.structuredContent ?? result);
      },
      (error) => {
        if (!this.isCallTicketCurrent(ticket)) throw lifecycleClosedError();
        throw error;
      },
    ).finally(() => {
      this.finishCallTicket(ticket);
    });
  }

  async callToolOperation(ticket, name, args, options = {}) {
    await this.start();
    this.assertCallTicket(ticket);
    const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
    const requestOptions = {
      ...(timeout === undefined ? {} : {
        timeout,
        maxTotalTimeout: timeout,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      Object.keys(requestOptions).length === 0 ? undefined : requestOptions,
    );
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

function reconcileReportedWindow(requestedWindow, reportedWindow) {
  const requestedId = requestedWindow?.windowId ?? requestedWindow?.id;
  const reportedId = reportedWindow?.window_id ?? reportedWindow?.windowId ?? reportedWindow?.id;
  const identityMatches = reportedId !== undefined
    && reportedId !== null
    && sameNativeWindowId(reportedId, requestedId);
  return {
    id: requestedId,
    title: identityMatches
      ? (reportedWindow.title ?? requestedWindow?.title)
      : requestedWindow?.title,
    pid: identityMatches
      ? (reportedWindow.pid ?? requestedWindow?.pid)
      : requestedWindow?.pid,
    bounds: identityMatches
      ? (normalizeBounds(reportedWindow.bounds) ?? requestedWindow?.bounds)
      : requestedWindow?.bounds,
  };
}

function createCoordinateScaleMetadata({ screenshot, nativeWindowBounds }) {
  const observationWidth = screenshot?.width ?? nativeWindowBounds?.width;
  const observationHeight = screenshot?.height ?? nativeWindowBounds?.height;
  const nativeWidth = nativeWindowBounds?.width ?? observationWidth;
  const nativeHeight = nativeWindowBounds?.height ?? observationHeight;
  const scaleX = positiveRatio(observationWidth, nativeWidth);
  const scaleY = positiveRatio(observationHeight, nativeHeight);
  const observationToNativeScaleX = positiveRatio(nativeWidth, observationWidth);
  const observationToNativeScaleY = positiveRatio(nativeHeight, observationHeight);
  return {
    schemaVersion: 1,
    sourceSpace: screenshot ? "screenshot-pixel" : "window-local",
    actionSpace: "window-local",
    actionTransform: {
      scaleX: observationToNativeScaleX,
      scaleY: observationToNativeScaleY,
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

function captureWindowIdentity(window = {}) {
  const rawWindowId = window.windowId ?? window.window_id ?? window.id;
  const rawPid = window.pid ?? window.processId ?? window.process_id;
  return {
    windowId: rawWindowId === undefined || rawWindowId === null
      ? null
      : String(rawWindowId),
    pid: Number.isSafeInteger(Number(rawPid)) && Number(rawPid) > 0
      ? Number(rawPid)
      : null,
  };
}

function verifyCaptureWindowIdentity(requestedWindow, reportedWindow = {}) {
  const reportedIdentity = captureWindowIdentity(reportedWindow);
  const requestedIdentity = captureWindowIdentity(requestedWindow);
  const windowIdentityVerified = reportedIdentity.windowId === null
    || requestedIdentity.windowId === null
    || sameNativeWindowId(reportedIdentity.windowId, requestedIdentity.windowId);
  const processIdentityVerified = reportedIdentity.pid === null
    || requestedIdentity.pid === null
    || reportedIdentity.pid === requestedIdentity.pid;
  const identityVerified = windowIdentityVerified && processIdentityVerified;
  if (!identityVerified) {
    const error = new Error(
      "The observation provider returned a surface that does not belong to the acquired window.",
    );
    error.code = "capture.surface_identity_mismatch";
    error.detail = {
      requestedWindowId: requestedIdentity.windowId,
      reportedWindowId: reportedIdentity.windowId,
      requestedProcessId: requestedIdentity.pid,
      reportedProcessId: reportedIdentity.pid,
    };
    throw error;
  }
  return {
    schemaVersion: 1,
    requestedWindowId: requestedIdentity.windowId,
    reportedWindowId: reportedIdentity.windowId,
    requestedProcessId: requestedIdentity.pid,
    reportedProcessId: reportedIdentity.pid,
    identityVerified,
    binding: reportedIdentity.windowId === null
      ? "requested-window"
      : "reported-window",
  };
}

function positiveRatio(numerator, denominator) {
  return Number.isFinite(numerator) && numerator > 0
    && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : 1;
}

function selectWindowStateWithScreenshots(result) {
  const structured = result?.structuredContent ?? result ?? {};
  const selected = structured && typeof structured === "object" && !Array.isArray(structured)
    ? { ...structured }
    : {};
  const screenshotImages = (Array.isArray(result?.content) ? result.content : [])
    .filter((block) => block?.type === "image" && typeof block.data === "string")
    .map((block, index) => ({
      index,
      data: block.data,
      mimeType: block.mimeType,
      metadata: screenshotBlockMetadata(block),
    }));
  if (screenshotImages.length > 0) {
    Object.defineProperty(selected, "screenshotImages", {
      configurable: false,
      enumerable: false,
      value: screenshotImages,
      writable: false,
    });
  }
  return selected;
}

function screenshotBlockMetadata(block) {
  const metadata = block?._meta;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  for (const key of ["screenshot", "cua/screenshot", "computerUse/screenshot"]) {
    const nested = metadata[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return metadata;
}

async function buildRelatedScreenshotCaptures({
  result,
  primaryScreenshot,
  requestedWindow,
  reconciledWindow,
  outputPath,
  windowRelationships,
}) {
  const images = normalizeScreenshotImages(result);
  if (images.length === 0) return [];
  const mainBounds = reconciledWindow.bounds ?? requestedWindow?.bounds;
  const mainWindowId = String(reconciledWindow.id);
  const relationships = eligibleRelatedRelationships(
    windowRelationships,
    mainWindowId,
    reconciledWindow.pid,
  );
  if (relationships.length === 0) return [];

  const output = [];
  const usedWindowIds = new Set();
  for (const image of images) {
    const png = pngFromImageContent(image);
    if (!png) continue;
    const descriptorBounds = screenshotDescriptorBounds(image.descriptor, png);
    if (isPrimaryScreenshotImage({
      descriptor: image.descriptor,
      descriptorBounds,
      mainBounds,
      mainWindowId,
      png,
      primaryScreenshot,
      imageIndex: image.index,
      imageCount: images.length,
    })) continue;
    const relationship = selectScreenshotRelationship({
      descriptor: image.descriptor,
      descriptorBounds,
      png,
      relationships,
      usedWindowIds,
    });
    if (!relationship) continue;
    usedWindowIds.add(String(relationship.windowId));
    const surfaceIndex = output.length + 1;
    const path = relatedScreenshotPath(outputPath, surfaceIndex);
    await writeFile(path, png.bytes);
    const nativeBounds = relationship.bounds;
    const screenBounds = descriptorBounds ?? nativeBounds;
    const screenshotId = screenshotDescriptorId(image.descriptor)
      ?? `related-screenshot-${surfaceIndex}`;
    output.push(createRelatedCapture({
      relationship,
      mainBounds,
      mainWindowId,
      processId: reconciledWindow.pid,
      path,
      png,
      screenBounds,
      screenshotId,
      zIndex: finiteNumber(image.descriptor?.zIndex, image.descriptor?.z_index, surfaceIndex),
      source: "cua-driver-related-window-state",
      method: "cua-driver-get_window_state-related-screenshot",
    }));
  }
  return output;
}

async function captureMissingRelatedWindows({
  relationships,
  existingCaptures,
  mainBounds,
  mainWindowId,
  processId,
  outputPath,
  captureWindow,
  timeoutMs,
}) {
  if (typeof captureWindow !== "function") return [];
  const usedWindowIds = new Set(existingCaptures.map((capture) => String(capture.hwnd)));
  const candidates = eligibleRelatedRelationships(relationships, mainWindowId, processId)
    .filter((relationship) => !usedWindowIds.has(String(relationship.windowId)))
    .slice(0, Math.max(0, 8 - existingCaptures.length));
  const output = [];
  for (const relationship of candidates) {
    const surfaceIndex = existingCaptures.length + output.length + 1;
    const path = relatedScreenshotPath(outputPath, surfaceIndex);
    let captured;
    try {
      captured = await captureWindow(relationship.windowId, path, {
        expectedProcessId: processId,
        timeoutMs,
      });
    } catch {
      continue;
    }
    if (String(captured?.hwnd) !== String(relationship.windowId)
      || captured?.processId !== processId) continue;
    const capturedBounds = {
      x: captured.x,
      y: captured.y,
      width: captured.width,
      height: captured.height,
    };
    if (!isPositiveBounds(capturedBounds)
      || !nearBounds(capturedBounds, relationship.bounds, 8)) continue;
    const png = await readPngArtifact(path, { attempts: 2 });
    if (!png || png.width !== capturedBounds.width || png.height !== capturedBounds.height) continue;
    output.push(createRelatedCapture({
      relationship,
      mainBounds,
      mainWindowId,
      processId,
      path,
      png,
      screenBounds: capturedBounds,
      screenshotId: `owned-window-${relationship.windowId}`,
      zIndex: surfaceIndex,
      source: "windows-owned-window-capture",
      method: captured.method ?? "PrintWindow",
    }));
  }
  return output;
}

function eligibleRelatedRelationships(relationships, mainWindowId, processId) {
  return (Array.isArray(relationships) ? relationships : [])
    .filter((relationship) => String(relationship.windowId) !== mainWindowId)
    .filter((relationship) => relationship.visible === true)
    .filter((relationship) => relationship.processId === processId)
    .filter((relationship) => relationship.ownedByRequestedWindow === true
      || relationship.sameRequestedProcess === true)
    .filter((relationship) => isPositiveBounds(relationship.bounds));
}

function createRelatedCapture({
  relationship,
  mainBounds,
  mainWindowId,
  processId,
  path,
  png,
  screenBounds,
  screenshotId,
  zIndex,
  source,
  method,
}) {
  const nativeBounds = relationship.bounds;
  const relationshipKind = relationship.ownedByRequestedWindow === true
    ? "owned-window"
    : "same-process-auxiliary";
  const scaleX = positiveRatio(screenBounds.width, png.width);
  const scaleY = positiveRatio(screenBounds.height, png.height);
  const actionOffsetX = Number.isFinite(mainBounds?.x) ? screenBounds.x - mainBounds.x : 0;
  const actionOffsetY = Number.isFinite(mainBounds?.y) ? screenBounds.y - mainBounds.y : 0;
  const capture = {
    status: "ok",
    provider: "cua-driver",
    source,
    title: "",
    path,
    method,
    screenshotId,
    zIndex,
    hwnd: relationship.windowId,
    ownerWindowId: relationship.ownerWindowId,
    relationship: relationshipKind,
    x: screenBounds.x,
    y: screenBounds.y,
    width: png.width,
    height: png.height,
    nativeWindowBounds: nativeBounds,
    surfaceProvenance: {
      schemaVersion: 1,
      requestedWindowId: mainWindowId,
      relatedWindowId: String(relationship.windowId),
      requestedProcessId: processId,
      relatedProcessId: relationship.processId,
      ownerWindowId: relationship.ownerWindowId,
      relationshipVerified: true,
      relationship: relationshipKind,
    },
    coordinateScale: {
      schemaVersion: 1,
      sourceSpace: "screenshot-pixel",
      actionSpace: "controller-window-local",
      actionWindowId: mainWindowId,
      actionTransform: {
        scaleX,
        scaleY,
        offsetX: actionOffsetX,
        offsetY: actionOffsetY,
      },
      observationPixels: { width: png.width, height: png.height },
      nativeWindowUnits: { width: screenBounds.width, height: screenBounds.height },
      nativeToObservation: {
        scaleX: positiveRatio(png.width, screenBounds.width),
        scaleY: positiveRatio(png.height, screenBounds.height),
      },
    },
    window: {
      id: relationship.windowId,
      title: "",
      pid: relationship.processId,
      ownerWindowId: relationship.ownerWindowId,
      bounds: {
        x: screenBounds.x,
        y: screenBounds.y,
        width: png.width,
        height: png.height,
      },
    },
  };
  Object.defineProperty(capture, "artifactBytes", {
    configurable: false,
    enumerable: false,
    value: png.bytes,
    writable: false,
  });
  return capture;
}

function normalizeScreenshotImages(result) {
  const images = Array.isArray(result?.screenshotImages) ? result.screenshotImages : [];
  const descriptors = Array.isArray(result?.screenshots) ? result.screenshots : [];
  const descriptorOffset = descriptors.length === images.length + 1 ? 1 : 0;
  return images.map((image, index) => ({
    ...image,
    index,
    descriptor: mergeScreenshotDescriptor(
      descriptors[index + descriptorOffset] ?? descriptors[index],
      image.metadata,
    ),
  }));
}

async function materializePrimaryScreenshotFromResult(result, outputPath, {
  mainWindowId,
  mainBounds,
} = {}) {
  const images = normalizeScreenshotImages(result);
  for (const image of images) {
    const png = pngFromImageContent(image);
    if (!png) continue;
    const descriptorBounds = screenshotDescriptorBounds(image.descriptor, png);
    const descriptorWindowId = image.descriptor?.windowId ?? image.descriptor?.window_id;
    const identityMatch = descriptorWindowId !== undefined
      && sameNativeWindowId(descriptorWindowId, mainWindowId);
    const boundsMatch = isPositiveBounds(descriptorBounds)
      && isPositiveBounds(mainBounds)
      && nearBounds(descriptorBounds, mainBounds, 8);
    const dimensionMatch = isPositiveBounds(mainBounds)
      && Math.abs(png.width - mainBounds.width) <= 8
      && Math.abs(png.height - mainBounds.height) <= 8;
    if (!identityMatch && !boundsMatch && !(image.index === 0 && dimensionMatch)) continue;
    await writeFile(outputPath, png.bytes);
    return png;
  }
  return null;
}

function mergeScreenshotDescriptor(primary, secondary) {
  const left = primary && typeof primary === "object" && !Array.isArray(primary) ? primary : {};
  const right = secondary && typeof secondary === "object" && !Array.isArray(secondary) ? secondary : {};
  return { ...left, ...right };
}

function pngFromImageContent(image) {
  if (image?.mimeType !== undefined && image.mimeType !== "image/png") return null;
  let bytes;
  try {
    bytes = Buffer.from(image?.data ?? "", "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength < 24
    || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
    || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0
    ? { bytes, width, height }
    : null;
}

function screenshotDescriptorBounds(descriptor, png) {
  const x = finiteNumber(descriptor?.originX, descriptor?.origin_x, descriptor?.x);
  const y = finiteNumber(descriptor?.originY, descriptor?.origin_y, descriptor?.y);
  const width = finiteNumber(descriptor?.width, png.width);
  const height = finiteNumber(descriptor?.height, png.height);
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { x, y, width, height }
    : null;
}

function screenshotDescriptorId(descriptor) {
  const value = descriptor?.id ?? descriptor?.screenshotId ?? descriptor?.screenshot_id;
  return value === undefined || value === null || String(value).trim() === ""
    ? null
    : String(value);
}

function isPrimaryScreenshotImage({
  descriptor,
  descriptorBounds,
  mainBounds,
  mainWindowId,
  png,
  primaryScreenshot,
  imageIndex,
  imageCount,
}) {
  const descriptorWindowId = descriptor?.windowId ?? descriptor?.window_id;
  if (descriptorWindowId !== undefined && sameNativeWindowId(descriptorWindowId, mainWindowId)) return true;
  if (isPositiveBounds(descriptorBounds) && isPositiveBounds(mainBounds)
    && nearBounds(descriptorBounds, mainBounds, 8)) return true;
  return imageIndex === 0 && imageCount > 1
    && png.width === primaryScreenshot?.width
    && png.height === primaryScreenshot?.height;
}

function selectScreenshotRelationship({
  descriptor,
  descriptorBounds,
  png,
  relationships,
  usedWindowIds,
}) {
  const descriptorWindowId = descriptor?.windowId ?? descriptor?.window_id;
  if (descriptorWindowId !== undefined) {
    const exact = relationships.find((relationship) => (
      !usedWindowIds.has(String(relationship.windowId))
      && sameNativeWindowId(relationship.windowId, descriptorWindowId)
    ));
    if (exact) return exact;
  }
  if (isPositiveBounds(descriptorBounds)) {
    const exactBounds = relationships.filter((relationship) => (
      !usedWindowIds.has(String(relationship.windowId))
      && relatedSurfaceBoundsMatch(relationship.bounds, descriptorBounds, 8)
    ));
    if (exactBounds.length === 1) return exactBounds[0];
  }
  const sizeMatches = relationships.filter((relationship) => (
    !usedWindowIds.has(String(relationship.windowId))
    && Math.abs(relationship.bounds.width - png.width) <= 8
    && Math.abs(relationship.bounds.height - png.height) <= 8
  ));
  return sizeMatches.length === 1 ? sizeMatches[0] : null;
}

function relatedSurfaceBoundsMatch(windowBounds, screenshotBounds, tolerance) {
  return Math.abs(windowBounds.x - screenshotBounds.x) <= tolerance
    && Math.abs(windowBounds.y - screenshotBounds.y) <= tolerance
    && Math.abs(windowBounds.width - screenshotBounds.width) <= tolerance
    && screenshotBounds.height <= windowBounds.height + tolerance;
}

function relatedScreenshotPath(outputPath, index) {
  const parsed = parse(outputPath);
  return join(parsed.dir, `${parsed.name}.related-${index}${parsed.ext || ".png"}`);
}

function relationshipBoundsForWindow(relationships, windowId) {
  const match = relationships.find((relationship) => (
    sameNativeWindowId(relationship?.windowId, windowId)
    && relationship?.visible !== false
    && isPositiveBounds(relationship?.bounds)
  ));
  return match?.bounds ? { ...match.bounds } : null;
}

function nearBounds(left, right, tolerance) {
  return Math.abs(left.x - right.x) <= tolerance
    && Math.abs(left.y - right.y) <= tolerance
    && Math.abs(left.width - right.width) <= tolerance
    && Math.abs(left.height - right.height) <= tolerance;
}

function isPositiveBounds(bounds) {
  return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0;
}

function finiteNumber(...values) {
  return values.find(Number.isFinite);
}

async function readPngArtifact(filePath, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0
    ? options.attempts
    : 50;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const bytes = await readFile(filePath);
      if (bytes.byteLength < 24
        || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
        || bytes.toString("ascii", 12, 16) !== "IHDR") {
        if (attempt === attempts - 1) return undefined;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (!Number.isSafeInteger(width) || width <= 0
        || !Number.isSafeInteger(height) || height <= 0) {
        if (attempt === attempts - 1) return undefined;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      return { width, height, bytes };
    } catch {
      if (attempt === attempts - 1) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 50));
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

function normalizeProcessIds(processIds, ...fallbackProcessIds) {
  const normalized = [];
  for (const processId of [
    ...(Array.isArray(processIds) ? processIds : []),
    ...fallbackProcessIds,
  ]) {
    const value = Number(processId);
    if (Number.isSafeInteger(value) && value > 0 && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
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

function compareApplicationWindowControllability(left, right, { name } = {}) {
  const leftIdentityMatch = matchesApplicationWindowIdentity(left, { name });
  const rightIdentityMatch = matchesApplicationWindowIdentity(right, { name });
  if (leftIdentityMatch !== rightIdentityMatch) return leftIdentityMatch ? -1 : 1;
  return compareWindowControllability(left, right);
}

function matchesApplicationWindowIdentity(window, { name } = {}) {
  const expectedName = normalizeApplicationIdentity(name);
  if (expectedName === "") return true;
  const title = normalizeApplicationIdentity(window?.title);
  return title === expectedName || title.includes(expectedName);
}

function normalizeApplicationIdentity(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function boundedWindowArea(window) {
  const width = Number(window?.bounds?.width);
  const height = Number(window?.bounds?.height);
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    ? width * height
    : 0;
}

function shouldDeferCompactApplicationWindow(window, applicationWindows) {
  const bounds = window?.bounds;
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  if (
    window?.isOnScreen !== true
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || x < -10_000
    || y < -10_000
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || (width >= 480 && height >= 320)
  ) {
    return false;
  }
  return applicationWindows.some((sibling) => (
    sibling !== window
    && sibling.pid === window.pid
    && boundedWindowArea(sibling) > 0
  ));
}

function isMateriallyRestoredApplicationWindow(window, initialIdentityWindows) {
  if (initialIdentityWindows.length === 0) return true;
  const initialWindow = initialIdentityWindows.find((candidate) => (
    sameNativeWindowId(candidate.windowId, window.windowId)
  ));
  const width = Number(window?.bounds?.width);
  const height = Number(window?.bounds?.height);
  const hasPrimarySurface = Number.isFinite(width) && width >= 480
    && Number.isFinite(height) && height >= 320;
  if (!hasPrimarySurface) return false;
  if (!initialWindow) return true;
  if (initialWindow.isOnScreen !== true && window.isOnScreen === true) return true;
  return boundedWindowArea(window) >= boundedWindowArea(initialWindow) * 1.5;
}

function findBlockingApplicationModalWindows(
  applicationWindows,
  identityMatchedWindows,
  relationships,
) {
  const relationshipsByWindow = new Map(
    relationships.map((relationship) => [String(relationship.windowId), relationship]),
  );
  const disabledOwnerIds = new Set(identityMatchedWindows
    .filter((window) => (
      relationshipsByWindow.get(String(window.windowId))?.enabled === false
    ))
    .map((window) => String(window.windowId)));
  if (disabledOwnerIds.size === 0) return [];
  return applicationWindows
    .filter((window) => {
      const relationship = relationshipsByWindow.get(String(window.windowId));
      return relationship?.enabled === true
        && relationship.ownerWindowId !== null
        && disabledOwnerIds.has(String(relationship.ownerWindowId));
    })
    .sort(compareWindowZOrder);
}

function isLikelyProcessBackdrop(window, windows, foregroundWindowId) {
  if (sameNativeWindowId(window.windowId, foregroundWindowId)) return false;
  if (!Number.isSafeInteger(window.pid) || window.pid <= 0) return false;
  if (Number(window?.bounds?.x) > 0 || Number(window?.bounds?.y) > 0) return false;

  const title = normalizeApplicationIdentity(window.title);
  const appName = normalizeApplicationIdentity(window.appName);
  const executableIdentity = appName.endsWith(".exe")
    ? appName.slice(0, -4)
    : appName;
  if (title === "" || executableIdentity === "" || title !== executableIdentity) return false;

  const area = boundedWindowArea(window);
  if (area === 0) return false;
  return windows.some((sibling) => (
    sibling !== window
    && sibling.pid === window.pid
    && sibling.isOnScreen === true
    && boundedWindowArea(sibling) > 0
    && area >= boundedWindowArea(sibling) * 4
  ));
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

function foregroundActionNotApplied(action) {
  return {
    status: "indeterminate",
    effect: "not_applied",
    verified: false,
    focusVerified: false,
    replaySafe: true,
    actionAttempted: false,
    reason: "foreground.activation_unverified",
    action,
    nextAction: "Observe desktop state and reacquire the intended window before another action.",
  };
}

function lifecycleClosedError() {
  const error = new Error("lifecycle.closed: cua-driver lifecycle is closing or closed");
  error.code = "lifecycle.closed";
  return error;
}

function operationCancelledError(reason) {
  const error = new Error("operation.cancelled: cua-driver operation was cancelled");
  error.code = "operation.cancelled";
  error.reason = reason;
  return error;
}
