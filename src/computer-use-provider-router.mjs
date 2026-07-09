import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_OCR_PREWARM_BUCKETS, expandRegionToBucket } from "./crop-bucket.mjs";
import { computeDirtyRegion } from "./image-diff.mjs";
import { fail } from "./computer-use-errors.mjs";
import { OcrSidecarSession, normalizeOcrSidecarResponse } from "./ocr-sidecar.mjs";
import { runInstallCacheDoctor } from "./install-cache-doctor.mjs";
import { captureWindowPngByTitle } from "./real-window-capture.mjs";

export class ComputerUseProviderRouter {
  constructor(options = {}) {
    this.ocr = options.ocrSession ?? new OcrSidecarSession();
    this.driver = options.driver ?? null;
    this.overlayRuntime = options.overlayRuntime ?? null;
    this.overlayHandle = null;
    this.ocrStarted = false;
    this.artifactRoot = options.artifactRoot;
    this.clock = options.clock ?? {
      now: () => Date.now(),
      iso: (timeMs = Date.now()) => new Date(timeMs).toISOString(),
    };
    this.activeController = null;
    this.lastCapture = null;
    this.pendingRepairApproval = null;
    this.auditEvents = [];
    this.actionPolicy = {
      allowedKinds: ["set_value", "click"],
      deliveryModes: ["background"],
      observeTierBlocksAction: true,
    };
  }

  async health(options = {}) {
    const result = {
      status: "ready",
      module: "agent-computer-use-mcp",
      version: "0.0.1",
      phases: {
        "0.9": "contract-freeze",
        "1.0": "stdio-mcp-server",
        "1.1": "provider-router",
        "1.2": "packaging-health-contract",
        "1.3": "action-lifecycle",
        "1.4": "real-cua-driver-mcp",
        "1.5": "safety-diagnostics",
        "1.6": "install-config-contract",
        "1.7": "standard-sdk-client-smoke",
        "1.8": "standard-sdk-server-transport",
        "2.0": "doctor-tool",
        "2.1": "repair-approval-gate",
        "2.2": "repair-approval-state",
      },
      providers: {
        windowCapture: process.platform === "win32" ? "PrintWindow" : "unsupported",
        ocrSidecar: options.fast ? "deferred" : "daemon",
        driver: options.fast ? "deferred" : "cua-driver-mcp",
        overlay: "gateway-managed-user-only",
      },
      actionPolicy: this.actionPolicy,
      includeUserOverlay: false,
    };

    if (!options.fast) {
      if (this.driver?.health) {
        result.driver = await this.driver.health();
        if (result.driver.status !== "healthy") {
          result.status = "degraded";
        }
      }
      await this.ensureOcr();
      result.ocr = await this.ocr.doctor();
      if (options.prewarm) {
        result.prewarm = await this.prewarmOcrBuckets();
      }
    }

    return result;
  }

  async doctor(options = {}) {
    const runtime = await this.health({
      fast: options.fast ?? true,
      prewarm: false,
    });
    const installCache = options.includeInstallCache === false
      ? null
      : await runInstallCacheDoctor();
    const status = deriveDoctorStatus([runtime.status, installCache?.status]);
    const repairPlan = installCache?.repairPlan ?? {
      mode: "plan-only",
      requiresApproval: false,
      actions: [],
    };

    return {
      status,
      module: "agent-computer-use-mcp",
      runtime,
      installCache,
      repairPlan,
      activeController: this.activeController ? {
        controllerId: this.activeController.controllerId,
        status: this.activeController.status,
        tier: this.activeController.tier,
        window: this.activeController.window,
      } : null,
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  async repair(options = {}) {
    const doctor = await this.doctor({
      fast: true,
      includeInstallCache: true,
    });
    const actionIds = new Set(options.actionIds ?? []);
    const actions = doctor.repairPlan.actions
      .filter((action) => actionIds.size === 0 || actionIds.has(action.id))
      .map((action) => ({
        ...action,
        executesImmediately: false,
      }));
    const repairPlan = {
      ...doctor.repairPlan,
      actions,
      requiresApproval: actions.length > 0,
    };
    const approved = options.approved === true;
    const dryRun = options.dryRun !== false;
    const approval = this.resolveRepairApproval({
      approved,
      approvalToken: options.approvalToken,
      requestApproval: options.requestApproval,
      approvalTtlMs: options.approvalTtlMs,
      repairPlan,
    });
    if (approval.status === "expired") {
      return {
        status: "approval_expired",
        mode: "plan-only",
        module: "agent-computer-use-mcp",
        approved: false,
        dryRun,
        approval,
        repairPlan,
        executesImmediately: false,
        execution: {
          status: "not_started",
          reason: "approval-expired",
        },
        includeUserOverlay: false,
        startsDesktopControl: false,
      };
    }
    const status = !approved && actions.length > 0
      ? "approval_required"
      : "planned";

    return {
      status,
      mode: "plan-only",
      module: "agent-computer-use-mcp",
      approved,
      dryRun,
      approval,
      repairPlan,
      executesImmediately: false,
      execution: {
        status: "not_started",
        reason: approved
          ? "execution-not-implemented"
          : "approval-required",
      },
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  async requestAccess(args) {
    if (!this.driver?.findWindow) {
      fail("provider.unavailable", "cua-driver is not available", { provider: "cua-driver" });
    }
    if (this.activeController) {
      fail("controller.already_active", "A Gateway-managed Computer Use controller is already active.", {
        controllerId: this.activeController.controllerId,
      });
    }
    const tier = args.tier ?? "full";
    if (!["observe", "full"].includes(tier)) {
      fail("access.tier_unsupported", `Unsupported computer access tier: ${tier}`);
    }

    const window = await this.driver.findWindow({ titlePart: args.titlePart });
    this.activeController = {
      controllerId: randomUUID(),
      provider: "gateway-managed",
      tier,
      agentId: args.agentId ?? "unknown",
      status: "active",
      window,
      startedAt: new Date().toISOString(),
      includeUserOverlay: false,
    };
    if (this.overlayRuntime?.start) {
      this.overlayHandle = await this.overlayRuntime.start({ targetRect: window.bounds ? {
        windowId: window.windowId,
        title: window.title,
        x: window.bounds.x,
        y: window.bounds.y,
        width: window.bounds.width,
        height: window.bounds.height,
      } : undefined });
    }
    this.recordAudit("computer.access.granted", {
      controllerId: this.activeController.controllerId,
      title: window.title,
      tier: this.activeController.tier,
    });
    return {
      status: "granted",
      controller: this.activeController,
      overlay: this.overlayHandle,
      includeUserOverlay: false,
    };
  }

  async capture(args = {}) {
    this.requireActiveController();
    const mode = args.mode ?? "semantic";
    let observation;
    if (mode === "semantic") {
      if (!this.driver?.capture) fail("provider.unavailable", "semantic capture provider is not available");
      observation = await this.driver.capture({
        window: this.activeController.window,
        mode,
        controllerId: this.activeController.controllerId,
      });
    } else if (mode === "ocr-region") {
      observation = (await this.ocrRegion({
        titlePart: this.activeController.window.title,
        crop: args.crop,
        timeoutMs: args.timeoutMs,
      })).observation;
    } else if (mode === "screenshot") {
      observation = await this.captureWindow({
        titlePart: this.activeController.window.title,
        timeoutMs: args.timeoutMs,
      });
    } else {
      fail("capture.mode_unsupported", `Unsupported capture mode: ${mode}`);
    }

    this.lastCapture = {
      ...observation,
      provider: observation.provider ?? "gateway-managed",
      includeUserOverlay: false,
    };
    this.recordAudit("computer.capture.created", {
      controllerId: this.activeController.controllerId,
      mode,
      observationId: this.lastCapture.observationId,
    });
    return this.lastCapture;
  }

  async act(args = {}) {
    this.requireActiveController();
    const action = args.action;
    this.validateAction(action);
    this.recordAudit("computer.action.started", {
      controllerId: this.activeController.controllerId,
      kind: action.kind,
      elementToken: action.elementToken,
      elementIndex: action.elementIndex,
    });

    let result;
    try {
      if (action.kind === "set_value") {
        if (!this.driver?.setValue) fail("provider.unavailable", "set_value provider is not available");
        result = await this.driver.setValue({
          window: this.activeController.window,
          elementToken: action.elementToken,
          elementIndex: action.elementIndex,
          value: action.value,
        });
      } else if (action.kind === "click") {
        if (!this.driver?.click) fail("provider.unavailable", "click provider is not available");
        result = await this.driver.click({
          window: this.activeController.window,
          elementToken: action.elementToken,
          elementIndex: action.elementIndex,
          deliveryMode: action.deliveryMode ?? "background",
        });
      }
    } catch (error) {
      this.recordAudit("computer.action.failed", {
        controllerId: this.activeController.controllerId,
        kind: action.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const actionResult = {
      status: result.status ?? "ok",
      provider: "gateway-managed",
      action: action.kind,
      result,
      pixelLimitedAction: false,
      includeUserOverlay: false,
    };
    if (action.captureAfter) {
      actionResult.capture = await this.capture({ mode: "semantic" });
    }
    this.recordAudit("computer.action.completed", {
      controllerId: this.activeController.controllerId,
      kind: action.kind,
      status: actionResult.status,
    });
    return actionResult;
  }

  async cancel(args = {}) {
    const previous = this.activeController;
    this.activeController = null;
    await this.stopOverlay();
    this.recordAudit("computer.cancelled", {
      controllerId: previous?.controllerId,
      reason: args.reason ?? "cancelled",
    });
    return { status: "cancelled", previousController: previous, includeUserOverlay: false };
  }

  async revoke(args = {}) {
    const previous = this.activeController;
    this.activeController = null;
    this.lastCapture = null;
    this.pendingRepairApproval = null;
    await this.stopOverlay();
    this.recordAudit("computer.revoked", {
      controllerId: previous?.controllerId,
      reason: args.reason ?? "revoked",
    });
    return { status: "revoked", previousController: previous, includeUserOverlay: false };
  }

  async listState() {
    return {
      status: this.activeController ? "active" : "idle",
      activeController: this.activeController,
      lastCapture: this.lastCapture,
      pendingRepairApproval: this.getPendingRepairApproval(),
      auditEvents: this.auditEvents.slice(-50),
      includeUserOverlay: false,
    };
  }

  async captureWindow(args) {
    const outputPath = args.outputPath ?? await this.createArtifactPath("window.png");
    const capture = await captureWindowPngByTitle(args.titlePart, outputPath, {
      timeoutMs: args.timeoutMs,
    });
    return {
      status: "ok",
      provider: "gateway-managed",
      source: "window-capture",
      capture,
      artifact: { path: capture.path, mimeType: "image/png" },
      includeUserOverlay: false,
    };
  }

  async ocrRegion(args) {
    await this.ensureOcr();
    let imagePath = args.imagePath;
    let capture = null;
    if (!imagePath && args.titlePart) {
      const captured = await this.captureWindow({
        titlePart: args.titlePart,
        timeoutMs: args.timeoutMs,
      });
      capture = captured.capture;
      imagePath = captured.capture.path;
    }
    if (!imagePath) {
      fail("ocr_region.requires_imagePath_or_titlePart", "ocr_region requires either imagePath or titlePart");
    }

    const response = await this.ocr.recognize({
      imagePath,
      crop: args.crop,
      languages: args.languages ?? ["zh", "en"],
      timeoutMs: args.timeoutMs ?? 15000,
      noCache: args.noCache,
    });
    const observation = normalizeOcrSidecarResponse(response, {
      observationId: `ocr-region-${Date.now()}`,
      window: capture ? { title: capture.title } : undefined,
    });

    return {
      status: "ok",
      provider: "gateway-managed",
      mode: "ocr-region",
      imagePath,
      capture,
      observation,
      includeUserOverlay: false,
    };
  }

  async observeDiff(args) {
    const dirtyRegion = await computeDirtyRegion(args.baselinePath, args.changedPath, {
      threshold: args.threshold,
      padding: args.padding,
    });
    if (!dirtyRegion) {
      return {
        status: "ok",
        provider: "gateway-managed",
        mode: "dirty-region",
        dirtyRegion: null,
        observation: null,
        includeUserOverlay: false,
      };
    }
    const ocrRegion = expandRegionToBucket(dirtyRegion);

    const ocr = await this.ocrRegion({
      imagePath: args.changedPath,
      crop: ocrRegion,
      languages: args.languages,
      timeoutMs: args.timeoutMs,
      noCache: true,
    });

    return {
      status: "ok",
      provider: "gateway-managed",
      mode: "dirty-region",
      baselinePath: args.baselinePath,
      changedPath: args.changedPath,
      dirtyRegion,
      ocrRegion,
      observation: ocr.observation,
      includeUserOverlay: false,
    };
  }

  async close() {
    await this.stopOverlay();
    if (this.driver?.close) {
      await this.driver.close();
    }
    if (this.ocrStarted) {
      await this.ocr.close();
    }
    this.ocrStarted = false;
  }

  async ensureOcr() {
    if (this.ocrStarted) return;
    await this.ocr.start();
    this.ocrStarted = true;
  }

  async prewarmOcrBuckets(buckets = DEFAULT_OCR_PREWARM_BUCKETS) {
    const started = performance.now();
    const results = [];
    for (const bucket of buckets) {
      const before = performance.now();
      const response = await this.ocr.recognize({
        fixture: "canvas-lab",
        crop: bucket.crop,
        languages: ["zh", "en"],
        timeoutMs: 15000,
        noCache: true,
      });
      results.push({
        size: bucket.size,
        crop: bucket.crop,
        totalMs: Math.round((performance.now() - before) * 10) / 10,
        count: response.items?.length ?? 0,
      });
    }
    return {
      status: "completed",
      totalMs: Math.round((performance.now() - started) * 10) / 10,
      buckets: results,
    };
  }

  async createArtifactPath(name) {
    if (!this.artifactRoot) {
      this.artifactRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-mcp-"));
    }
    return join(this.artifactRoot, `${Date.now()}-${name}`);
  }

  requireActiveController() {
    if (!this.activeController) {
      fail("controller.required", "A Gateway-managed Computer Use controller is required.");
    }
  }

  validateAction(action) {
    if (!action?.kind) {
      fail("action.kind_required", "computer.act requires action.kind.");
    }
    if (!this.actionPolicy.allowedKinds.includes(action.kind)) {
      fail("action.kind_unsupported", `Unsupported action kind: ${action.kind}`, {
        allowedKinds: this.actionPolicy.allowedKinds,
      });
    }
    if (this.activeController?.tier === "observe" && this.actionPolicy.observeTierBlocksAction) {
      fail("permission.denied", "The active Computer Use controller has observe-only access.", {
        tier: this.activeController.tier,
        requiredTier: "full",
      });
    }
    const hasElementRef = action.elementToken !== undefined || action.elementIndex !== undefined;
    if (!hasElementRef) {
      fail("action.element_required", "Element action requires elementToken or elementIndex.");
    }
    if (action.kind === "set_value" && typeof action.value !== "string") {
      fail("action.value_required", "set_value requires a string value.");
    }
    const deliveryMode = action.deliveryMode ?? "background";
    if (!this.actionPolicy.deliveryModes.includes(deliveryMode)) {
      fail("delivery_mode.unsupported", `Unsupported delivery mode: ${deliveryMode}`, {
        allowedDeliveryModes: this.actionPolicy.deliveryModes,
      });
    }
  }

  recordAudit(type, payload = {}) {
    this.auditEvents.push({
      eventId: randomUUID(),
      type,
      ts: new Date().toISOString(),
      provider: "gateway-managed",
      ...payload,
    });
  }

  resolveRepairApproval({ approved, approvalToken, requestApproval, approvalTtlMs, repairPlan }) {
    if (approvalToken) {
      const pending = this.pendingRepairApproval;
      if (!pending || pending.token !== approvalToken) {
        return { status: "invalid", token: approvalToken };
      }
      if (pending.expiresAtMs <= this.clock.now()) {
        this.pendingRepairApproval = null;
        return {
          status: "expired",
          token: approvalToken,
          expiresAt: pending.expiresAt,
        };
      }
      return {
        status: approved ? "approved" : "pending",
        token: approvalToken,
        expiresAt: pending.expiresAt,
      };
    }
    this.expireRepairApproval();
    if (requestApproval && repairPlan.actions.length > 0) {
      const ttlMs = Math.max(1, approvalTtlMs ?? 300000);
      const expiresAtMs = this.clock.now() + ttlMs;
      const token = randomUUID();
      this.pendingRepairApproval = {
        token,
        status: "pending",
        requestedAt: this.clock.iso(this.clock.now()),
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        actionIds: repairPlan.actions.map((action) => action.id),
      };
      return this.getPendingRepairApproval();
    }
    if (this.pendingRepairApproval) {
      return this.getPendingRepairApproval();
    }
    return {
      status: approved ? "missing" : "not_requested",
    };
  }

  expireRepairApproval() {
    if (this.pendingRepairApproval && this.pendingRepairApproval.expiresAtMs <= this.clock.now()) {
      this.pendingRepairApproval = null;
    }
  }

  getPendingRepairApproval() {
    this.expireRepairApproval();
    if (!this.pendingRepairApproval) return null;
    return {
      token: this.pendingRepairApproval.token,
      status: this.pendingRepairApproval.status,
      requestedAt: this.pendingRepairApproval.requestedAt,
      expiresAt: this.pendingRepairApproval.expiresAt,
      actionIds: this.pendingRepairApproval.actionIds,
    };
  }

  async stopOverlay() {
    if (!this.overlayHandle) return;
    const handle = this.overlayHandle;
    this.overlayHandle = null;
    if (this.overlayRuntime?.stop) {
      await this.overlayRuntime.stop(handle);
    } else if (handle.stop) {
      handle.stop();
    }
  }
}

function deriveDoctorStatus(statuses) {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}
