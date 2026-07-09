import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_OCR_PREWARM_BUCKETS, expandRegionToBucket } from "./crop-bucket.mjs";
import { computeDirtyRegion } from "./image-diff.mjs";
import { fail } from "./computer-use-errors.mjs";
import { OcrSidecarSession, normalizeOcrSidecarResponse } from "./ocr-sidecar.mjs";
import { runInstallCacheDoctor } from "./install-cache-doctor.mjs";
import { buildDiagnosticsPolicy } from "./diagnostics-policy.mjs";
import { captureWindowPngByTitle } from "./real-window-capture.mjs";
import { createComputerUsePolicy } from "./computer-use-policy.mjs";
import { createRepairProgressPlan } from "./repair-progress-plan.mjs";
import { cleanupRuntimeState } from "./runtime-cleanup.mjs";

export class ComputerUseProviderRouter {
  constructor(options = {}) {
    this.ocr = options.ocrSession ?? new OcrSidecarSession();
    this.driver = options.driver ?? null;
    this.overlayRuntime = options.overlayRuntime ?? null;
    this.processSupervisor = options.processSupervisor ?? null;
    this.daemonSession = options.daemonSession ?? null;
    this.runtimeCleanup = options.runtimeCleanup ?? null;
    this.runtimeCleanupOptions = options.runtimeCleanupOptions ?? {};
    this.overlayHandle = null;
    this.ocrStarted = false;
    this.artifactRoot = options.artifactRoot;
    this.clock = options.clock ?? {
      now: () => Date.now(),
      iso: (timeMs = Date.now()) => new Date(timeMs).toISOString(),
    };
    this.controllerRequestInProgress = false;
    this.activeController = null;
    this.pendingAccessApproval = null;
    this.lastCapture = null;
    this.pendingRepairApproval = null;
    this.auditEvents = [];
    this.policy = options.policy ?? createComputerUsePolicy(options.policyOptions);
    this.actionPolicy = this.policy.describe();
  }

  async health(options = {}) {
    const result = {
      status: "ready",
      module: "agent-computer-use-mcp",
      version: "0.0.1",
      phases: {
        "0.9": "contract-freeze",
        "0.10": "release-metadata-changelog",
        "0.11": "release-readiness-gate",
        "0.12": "release-artifact-verification",
        "1.0": "stdio-mcp-server",
        "1.1": "provider-router",
        "1.2": "packaging-health-contract",
        "1.3": "action-lifecycle",
        "1.4": "real-cua-driver-mcp",
        "1.5": "safety-diagnostics",
        "1.6": "install-config-contract",
        "1.7": "standard-sdk-client-smoke",
        "1.8": "standard-sdk-server-transport",
        "1.9": "permission-policy-engine",
        "1.10": "controller-lease-timeout",
        "1.11": "policy-deny-proof",
        "1.12": "control-approval-state",
        "2.0": "doctor-tool",
        "2.1": "repair-approval-gate",
        "2.2": "repair-approval-state",
        "2.3": "diagnostics-policy",
        "2.4": "redacted-trace-writer",
        "2.5": "diagnostics-retention-cleanup",
        "2.6": "daemon-lifecycle-manager",
        "2.7": "process-supervisor-recovery",
        "2.8": "supervisor-doctor-repair",
        "2.9": "repair-deny-state",
        "2.10": "daemon-session",
        "2.11": "daemon-session-doctor-repair",
        "2.12": "runtime-cleanup",
        "2.13": "runtime-cleanup-doctor-repair",
        "3.0": "ocr-model-pack-manager",
        "3.1": "ocr-region-diff-scheduler",
        "3.2": "template-matching-provider",
        "3.3": "som-proposal-provider",
        "3.4": "per-region-strategy-selector",
        "3.5": "perception-latency-budget",
        "4.0": "overlay-placement-planner",
        "4.1": "overlay-theme-cursor-tokens",
        "4.2": "overlay-target-tracker",
        "4.3": "overlay-exclusion-policy",
        "5.0": "concurrent-controller-guard",
        "5.1": "standard-mcp-multi-client",
        "5.2": "disconnect-cleanup",
        "5.3": "strict-tool-output-schemas",
        "5.4": "mcp-inspector-smoke",
        "5.5": "approval-compatibility",
        "5.6": "standard-mcp-multi-client-stress",
        "6.0": "app-smoke-matrix-contract",
        "6.1": "app-smoke-coverage-gate",
        "7.0": "first-run-readiness",
        "7.1": "offline-bundle-readiness",
        "7.2": "repair-progress-plan",
        "7.3": "offline-capability-proof",
        "7.4": "offline-install-proof",
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
    const runtimeSupervisor = this.processSupervisor?.health
      ? this.processSupervisor.health()
      : null;
    const daemonSession = this.daemonSession?.health
      ? this.daemonSession.health()
      : null;
    const runtimeCleanup = await this.inspectRuntimeCleanup();
    const status = deriveDoctorStatus([runtime.status, installCache?.status, runtimeSupervisor?.status, daemonSession?.status, runtimeCleanup?.status]);
    const repairPlan = mergeRepairPlans(
      installCache?.repairPlan,
      runtimeCleanup?.repairPlan?.actions,
      runtimeSupervisor?.recoverActions,
      daemonSession?.recoverActions,
    );
    const diagnostics = buildDiagnosticsPolicy();

    return {
      status,
      module: "agent-computer-use-mcp",
      runtime,
      runtimeSupervisor,
      daemonSession,
      runtimeCleanup,
      installCache,
      diagnostics,
      repairPlan,
      activeController: this.activeController ? {
        controllerId: this.activeController.controllerId,
        status: this.activeController.status,
        tier: this.activeController.tier,
        expiresAt: this.activeController.expiresAt,
        window: this.activeController.window,
      } : null,
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  async repair(options = {}) {
    const doctor = await this.doctor({
      fast: true,
      includeInstallCache: options.includeInstallCache,
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
    const denied = options.denied === true;
    const dryRun = options.dryRun !== false;
    const approval = this.resolveRepairApproval({
      approved,
      denied,
      approvalToken: options.approvalToken,
      requestApproval: options.requestApproval,
      approvalTtlMs: options.approvalTtlMs,
      repairPlan,
    });
    const progressPlan = createRepairProgressPlan({
      repairPlan,
      approval,
      approved,
      dryRun,
      operationId: options.operationId ?? `repair-${this.clock.now()}`,
    });
    if (approval.status === "invalid") {
      return {
        status: "approval_invalid",
        mode: "plan-only",
        module: "agent-computer-use-mcp",
        approved: false,
        denied: false,
        dryRun,
        approval,
        repairPlan,
        progressPlan,
        executesImmediately: false,
        execution: {
          status: "not_started",
          reason: "approval-invalid",
        },
        includeUserOverlay: false,
        startsDesktopControl: false,
      };
    }
    if (approval.status === "expired") {
      return {
        status: "approval_expired",
        mode: "plan-only",
        module: "agent-computer-use-mcp",
        approved: false,
        denied: false,
        dryRun,
        approval,
        repairPlan,
        progressPlan,
        executesImmediately: false,
        execution: {
          status: "not_started",
          reason: "approval-expired",
        },
        includeUserOverlay: false,
        startsDesktopControl: false,
      };
    }
    if (approval.status === "denied") {
      return {
        status: "approval_denied",
        mode: "plan-only",
        module: "agent-computer-use-mcp",
        approved: false,
        denied: true,
        dryRun,
        approval,
        repairPlan,
        progressPlan,
        executesImmediately: false,
        execution: {
          status: "not_started",
          reason: "approval-denied",
        },
        includeUserOverlay: false,
        startsDesktopControl: false,
      };
    }
    const executableProcessActions = actions
      .filter((action) => action.kind === "process-restart");
    const executableRuntimeCleanupActions = actions
      .filter((action) => action.kind === "runtime-cleanup");
    const shouldExecuteRepairActions = approved
      && dryRun === false
      && (executableProcessActions.length > 0 || executableRuntimeCleanupActions.length > 0);
    const executionResults = shouldExecuteRepairActions
      ? await Promise.all([
        ...executableProcessActions.map((action) => this.recoverProcessAction(action)),
        ...executableRuntimeCleanupActions.map((action) => this.executeRuntimeCleanupAction(action)),
      ])
      : [];
    const status = shouldExecuteRepairActions
      ? "repaired"
      : !approved && actions.length > 0
      ? "approval_required"
      : "planned";

    return {
      status,
      mode: "plan-only",
      module: "agent-computer-use-mcp",
      approved,
      denied,
      dryRun,
      approval,
      repairPlan,
      progressPlan,
      executesImmediately: shouldExecuteRepairActions,
      execution: {
        status: shouldExecuteRepairActions ? "completed" : "not_started",
        reason: shouldExecuteRepairActions
          ? "approved-repair-actions"
          : approved
            ? "execution-not-implemented"
            : "approval-required",
        results: executionResults,
      },
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  async inspectRuntimeCleanup() {
    const report = this.runtimeCleanup?.inspect
      ? await this.runtimeCleanup.inspect({ dryRun: true })
      : await cleanupRuntimeState({
        ...this.runtimeCleanupOptions,
        dryRun: true,
      });
    return normalizeRuntimeCleanupDoctor(report);
  }

  async executeRuntimeCleanupAction() {
    if (this.runtimeCleanup?.cleanup) {
      return await this.runtimeCleanup.cleanup({ dryRun: false });
    }
    return await cleanupRuntimeState({
      ...this.runtimeCleanupOptions,
      dryRun: false,
    });
  }

  recoverProcessAction(action) {
    if (action.source === "daemon-session" && this.daemonSession?.recover) {
      return this.daemonSession.recover(action.id, { approved: true });
    }
    if (this.processSupervisor?.recover) {
      const result = this.processSupervisor.recover(action.id, { approved: true });
      if (result?.status !== "not_found") return result;
    }
    if (this.daemonSession?.recover) {
      return this.daemonSession.recover(action.id, { approved: true });
    }
    return {
      status: "not_found",
      actionId: action.id,
      executesImmediately: false,
      includeUserOverlay: false,
    };
  }

  async requestAccess(args) {
    if (!this.driver?.findWindow) {
      fail("provider.unavailable", "cua-driver is not available", { provider: "cua-driver" });
    }
    await this.expireActiveController({ throwOnExpire: false });
    if (this.controllerRequestInProgress) {
      fail("controller.request_in_progress", "A Gateway-managed Computer Use controller request is already in progress.", {
        includeUserOverlay: false,
      });
    }
    if (this.activeController) {
      fail("controller.already_active", "A Gateway-managed Computer Use controller is already active.", {
        controllerId: this.activeController.controllerId,
      });
    }
    this.expireAccessApproval();
    if (this.pendingAccessApproval) {
      fail("controller.approval_pending", "A Gateway-managed Computer Use approval request is already pending.", {
        token: this.pendingAccessApproval.token,
        expiresAt: this.pendingAccessApproval.expiresAt,
        includeUserOverlay: false,
      });
    }
    this.controllerRequestInProgress = true;
    try {
      const tier = args.tier ?? "full";
      const window = await this.driver.findWindow({ titlePart: args.titlePart });
      this.enforcePolicyDecision(this.policy.evaluateAccessRequest({ tier, window }));
      if (args.approvalRequired === true) {
        const approvalTtlMs = Math.max(1, args.approvalTtlMs ?? 300000);
        const requestedAtMs = this.clock.now();
        const expiresAtMs = requestedAtMs + approvalTtlMs;
        this.pendingAccessApproval = {
          token: randomUUID(),
          status: "pending",
          action: "computer.request_access",
          requestedAt: this.clock.iso(requestedAtMs),
          expiresAt: this.clock.iso(expiresAtMs),
          expiresAtMs,
          approvalTtlMs,
          request: {
            titlePart: args.titlePart,
            tier,
            agentId: args.agentId ?? "unknown",
            reason: args.reason ?? null,
            leaseTtlMs: args.leaseTtlMs,
            window,
          },
        };
        this.recordAudit("computer.access.approval_requested", {
          token: this.pendingAccessApproval.token,
          title: window.title,
          tier,
        });
        return {
          status: "approval_required",
          approval: this.getPendingAccessApproval(),
          controller: null,
          overlay: null,
          startsDesktopControl: false,
          includeUserOverlay: false,
        };
      }
      const leaseTtlMs = Math.max(1, args.leaseTtlMs ?? 300000);
      return await this.grantAccessController({
        tier,
        agentId: args.agentId ?? "unknown",
        window,
        leaseTtlMs,
        approval: { status: "not_required" },
      });
    } finally {
      this.controllerRequestInProgress = false;
    }
  }

  async approveAccess(args = {}) {
    await this.expireActiveController({ throwOnExpire: false });
    const pending = this.pendingAccessApproval;
    if (!args.approvalToken || !pending || pending.token !== args.approvalToken) {
      return {
        status: "approval_invalid",
        approval: { status: "invalid", token: args.approvalToken ?? null },
        controller: null,
        overlay: null,
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
    }
    if (pending.expiresAtMs <= this.clock.now()) {
      this.pendingAccessApproval = null;
      this.recordAudit("computer.access.approval_expired", {
        token: pending.token,
        expiresAt: pending.expiresAt,
      });
      return {
        status: "approval_expired",
        approval: { ...this.serializeAccessApproval(pending), status: "expired" },
        controller: null,
        overlay: null,
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
    }
    if (args.denied === true) {
      this.pendingAccessApproval = null;
      this.recordAudit("computer.access.approval_denied", {
        token: pending.token,
        reason: args.reason ?? "denied",
      });
      return {
        status: "approval_denied",
        approval: { ...this.serializeAccessApproval(pending), status: "denied" },
        controller: null,
        overlay: null,
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
    }
    if (args.approved !== true) {
      return {
        status: "approval_pending",
        approval: this.getPendingAccessApproval(),
        controller: null,
        overlay: null,
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
    }
    if (this.activeController) {
      fail("controller.already_active", "A Gateway-managed Computer Use controller is already active.", {
        controllerId: this.activeController.controllerId,
      });
    }
    const { request } = pending;
    this.enforcePolicyDecision(this.policy.evaluateAccessRequest({ tier: request.tier, window: request.window }));
    this.pendingAccessApproval = null;
    return await this.grantAccessController({
      tier: request.tier,
      agentId: request.agentId,
      window: request.window,
      leaseTtlMs: Math.max(1, args.leaseTtlMs ?? request.leaseTtlMs ?? 300000),
      approval: { ...this.serializeAccessApproval(pending), status: "approved" },
    });
  }

  async capture(args = {}) {
    await this.requireActiveController();
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
    await this.requireActiveController();
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
    const previousApproval = this.getPendingAccessApproval();
    this.pendingAccessApproval = null;
    this.activeController = null;
    await this.stopOverlay();
    this.recordAudit("computer.cancelled", {
      controllerId: previous?.controllerId,
      approvalToken: previousApproval?.token,
      reason: args.reason ?? "cancelled",
    });
    return { status: "cancelled", previousController: previous, previousApproval, includeUserOverlay: false };
  }

  async revoke(args = {}) {
    const previous = this.activeController;
    const previousApproval = this.getPendingAccessApproval();
    this.pendingAccessApproval = null;
    this.activeController = null;
    this.lastCapture = null;
    this.pendingRepairApproval = null;
    await this.stopOverlay();
    this.recordAudit("computer.revoked", {
      controllerId: previous?.controllerId,
      approvalToken: previousApproval?.token,
      reason: args.reason ?? "revoked",
    });
    return { status: "revoked", previousController: previous, previousApproval, includeUserOverlay: false };
  }

  async listState() {
    await this.expireActiveController({ throwOnExpire: false });
    this.expireAccessApproval();
    return {
      status: this.activeController ? "active" : "idle",
      activeController: this.activeController,
      pendingAccessApproval: this.getPendingAccessApproval(),
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

  async close(args = {}) {
    const previous = this.activeController;
    const previousAccessApproval = this.getPendingAccessApproval();
    this.activeController = null;
    this.lastCapture = null;
    this.pendingRepairApproval = null;
    this.pendingAccessApproval = null;
    this.controllerRequestInProgress = false;
    await this.stopOverlay();
    if (previous) {
      this.recordAudit("computer.controller.closed", {
        controllerId: previous.controllerId,
        reason: args.reason ?? "router-close",
      });
    }
    if (previousAccessApproval) {
      this.recordAudit("computer.access.approval_closed", {
        token: previousAccessApproval.token,
        reason: args.reason ?? "router-close",
      });
    }
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

  async requireActiveController() {
    await this.expireActiveController({ throwOnExpire: true });
    if (!this.activeController) {
      fail("controller.required", "A Gateway-managed Computer Use controller is required.");
    }
  }

  async expireActiveController({ throwOnExpire = false } = {}) {
    if (!this.activeController?.expiresAtMs || this.activeController.expiresAtMs > this.clock.now()) return false;
    const previous = this.activeController;
    this.activeController = null;
    this.lastCapture = null;
    await this.stopOverlay();
    this.recordAudit("computer.controller.expired", {
      controllerId: previous.controllerId,
      tier: previous.tier,
      expiresAt: previous.expiresAt,
    });
    if (throwOnExpire) {
      fail("controller.expired", "controller.expired: The Gateway-managed Computer Use controller lease expired.", {
        controllerId: previous.controllerId,
        expiresAt: previous.expiresAt,
        includeUserOverlay: false,
      });
    }
    return true;
  }

  expireAccessApproval() {
    if (this.pendingAccessApproval && this.pendingAccessApproval.expiresAtMs <= this.clock.now()) {
      const pending = this.pendingAccessApproval;
      this.pendingAccessApproval = null;
      this.recordAudit("computer.access.approval_expired", {
        token: pending.token,
        expiresAt: pending.expiresAt,
      });
      return pending;
    }
    return null;
  }

  getPendingAccessApproval() {
    this.expireAccessApproval();
    if (!this.pendingAccessApproval) return null;
    return this.serializeAccessApproval(this.pendingAccessApproval);
  }

  serializeAccessApproval(approval) {
    return {
      token: approval.token,
      status: approval.status,
      action: approval.action,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      tier: approval.request.tier,
      agentId: approval.request.agentId,
      title: approval.request.window.title,
      reason: approval.request.reason,
    };
  }

  async grantAccessController({ tier, agentId, window, leaseTtlMs, approval }) {
    const startedAtMs = this.clock.now();
    const expiresAtMs = startedAtMs + leaseTtlMs;
    this.activeController = {
      controllerId: randomUUID(),
      provider: "gateway-managed",
      tier,
      agentId,
      status: "active",
      window,
      startedAt: this.clock.iso(startedAtMs),
      expiresAt: this.clock.iso(expiresAtMs),
      expiresAtMs,
      leaseTtlMs,
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
      approvalStatus: approval.status,
    });
    return {
      status: "granted",
      approval,
      controller: this.activeController,
      overlay: this.overlayHandle,
      startsDesktopControl: true,
      includeUserOverlay: false,
    };
  }

  validateAction(action) {
    const decision = this.policy.validateAction({
      tier: this.activeController?.tier,
      action,
      observation: this.lastCapture,
    });
    this.enforcePolicyDecision(decision);
  }

  enforcePolicyDecision(decision) {
    if (decision?.allowed) return;
    fail(decision.code, policyMessage(decision), decision);
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

  resolveRepairApproval({ approved, denied, approvalToken, requestApproval, approvalTtlMs, repairPlan }) {
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
      if (denied) {
        this.pendingRepairApproval = null;
        return {
          status: "denied",
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
    if (denied && this.pendingRepairApproval) {
      const pending = this.pendingRepairApproval;
      this.pendingRepairApproval = null;
      return {
        status: "denied",
        token: pending.token,
        expiresAt: pending.expiresAt,
      };
    }
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

function mergeRepairPlans(installRepairPlan, ...recoverActionGroups) {
  const installPlan = installRepairPlan ?? {
    mode: "plan-only",
    requiresApproval: false,
    actions: [],
  };
  const processActions = recoverActionGroups.flatMap((recoverActions = []) => (
    (recoverActions ?? []).map((action) => ({
      ...action,
      executesImmediately: false,
    }))
  ));
  const actions = [
    ...installPlan.actions,
    ...processActions,
  ];
  return {
    ...installPlan,
    actions,
    requiresApproval: actions.length > 0,
  };
}

function normalizeRuntimeCleanupDoctor(report) {
  const staleLockCount = report.staleLocks?.length ?? 0;
  const expiredFileCount = report.expired?.length ?? 0;
  const needsCleanup = staleLockCount + expiredFileCount > 0;
  return {
    ...report,
    status: needsCleanup ? "degraded" : "healthy",
    cleanupStatus: report.status,
    repairPlan: {
      mode: "plan-only",
      requiresApproval: needsCleanup,
      actions: needsCleanup ? [
        {
          id: "cleanup-runtime-state",
          kind: "runtime-cleanup",
          reason: "stale-daemon-locks-or-expired-runtime-files",
          staleLockCount,
          expiredFileCount,
          source: "runtime-cleanup",
          executesImmediately: false,
        },
      ] : [],
    },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function policyMessage(decision) {
  if (decision.code === "permission.denied" && decision.tier === "observe") {
    return "The active Computer Use controller has observe-only access.";
  }
  if (decision.code === "access.tier_unsupported") {
    return `Unsupported computer access tier: ${decision.tier}`;
  }
  if (decision.code === "action.kind_required") {
    return "computer.act requires action.kind.";
  }
  if (decision.code === "action.kind_unsupported") {
    return "Unsupported action kind.";
  }
  if (decision.code === "action.element_required") {
    return "Element action requires elementToken or elementIndex.";
  }
  if (decision.code === "action.value_required") {
    return "set_value requires a string value.";
  }
  if (decision.code === "delivery_mode.unsupported") {
    return "Unsupported delivery mode.";
  }
  return decision.code;
}
