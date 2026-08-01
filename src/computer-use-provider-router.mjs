import { mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_OCR_PREWARM_BUCKETS, expandRegionToBucket } from "./crop-bucket.mjs";
import { computeDirtyRegion } from "./image-diff.mjs";
import { ComputerUseMcpError, fail, serializeToolError } from "./computer-use-errors.mjs";
import { OcrSidecarSession, normalizeOcrSidecarResponse } from "./ocr-sidecar.mjs";
import { runInstallCacheDoctor } from "./install-cache-doctor.mjs";
import {
  PerceptionRegionCache,
  createPerceptionRegionCacheKey,
  readOverlayFreeRegionPixels,
} from "./perception-region-cache.mjs";
import {
  normalizeRecognizedUiText,
  UI_TEXT_NORMALIZATION_VERSION,
} from "./ui-text-normalization.mjs";
import { admitPerceptionAction } from "./perception-action-admission.mjs";
import { buildDiagnosticsPolicy } from "./diagnostics-policy.mjs";
import { captureWindowPngByTitle } from "./real-window-capture.mjs";
import { createComputerUsePolicy } from "./computer-use-policy.mjs";
import { createRepairProgressPlan } from "./repair-progress-plan.mjs";
import { cleanupRuntimeState } from "./runtime-cleanup.mjs";
import { createComputerUseCapabilityHandshake } from "./computer-use-capability-handshake.mjs";
import { MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";

function sameRequestContext(left, right) {
  if (!left || !right) return !left && !right;
  return left.schemaVersion === 1
    && right.schemaVersion === 1
    && left.ownerId === right.ownerId
    && left.agentId === right.agentId
    && left.projectId === right.projectId
    && left.sessionId === right.sessionId;
}

const ACTION_OBSERVATION_TTL_MS = 30_000;
const VISUAL_GROUNDING_OBSERVATION_TTL_MS = 120_000;
const FOCUS_RECEIPT_TTL_MS = 30_000;
const LOCAL_OCR_LATENCY_BUDGET_MS = 5_000;
const SCREENSHOT_LATENCY_BUDGET_MS = 8_000;
const POST_ACTION_UI_SETTLE_MS = 220;
const STABLE_FRAME_OBSERVATION_LIMIT = 6;
const PUBLIC_OBSERVATION_LIMIT = 7;
const VISUAL_ATTEMPT_WINDOW_MS = 30_000;
const VISUAL_REGION_HINT_TTL_MS = 120_000;
const STABLE_SEMANTIC_SOURCES = new Set(["cua-driver", "uia", "uia-som", "semantic"]);

export class ComputerUseProviderRouter {
  constructor(options = {}) {
    this.ocr = options.ocrSession ?? new OcrSidecarSession();
    this.perceptionCache = options.perceptionCache ?? new PerceptionRegionCache();
    this.ocrIdentity = options.ocrIdentity ?? null;
    this.driver = options.driver ?? null;
    this.overlayRuntime = options.overlayRuntime ?? null;
    this.processSupervisor = options.processSupervisor ?? null;
    this.daemonSession = options.daemonSession ?? null;
    this.runtimeCleanup = options.runtimeCleanup ?? null;
    this.runtimeCleanupOptions = options.runtimeCleanupOptions ?? {};
    this.overlayHandle = null;
    this.cursorStartAttempted = false;
    this.cursorActive = false;
    this.controlGeneration = 0;
    this.pendingControlGrant = null;
    this.controlVisualTail = Promise.resolve();
    this.ocrStarted = false;
    this.ocrStartAttempted = false;
    this.ocrStartPromise = null;
    this.artifactRoot = options.artifactRoot;
    this.clock = options.clock ?? {
      now: () => Date.now(),
      iso: (timeMs = Date.now()) => new Date(timeMs).toISOString(),
    };
    this.controllerRequestInProgress = false;
    this.activeController = null;
    this.activeControllerRequestContext = null;
    this.pendingAccessApproval = null;
    this.lastCapture = null;
    this.lastScreenshot = null;
    this.lastVisualUnderstanding = null;
    this.lastActionVisualCrop = null;
    this.lastFocusedObservationCrop = null;
    this.consecutivePublicObservations = 0;
    this.interactionStep = 0;
    this.pendingUnverifiedMutation = null;
    this.unconfirmedMutationHistory = [];
    this.lastDesktopState = null;
    this.surfaceGeneration = 0;
    this.consumedSurfaceReceiptId = null;
    this.actionTail = Promise.resolve();
    this.activeFocusReceipt = null;
    this.recentEditableTarget = null;
    this.semanticElementAliases = new Map();
    this.currentSemanticElements = new Map();
    this.applicationCatalog = new Map();
    this.pendingRepairApproval = null;
    this.assetOperationManager = options.assetOperationManager ?? null;
    this.assetCloseComplete = false;
    this.driverCloseComplete = false;
    this.closePromise = null;
    this.closeComplete = false;
    this.closeContext = null;
    this.lifecycleState = "open";
    this.lifecycleGeneration = 0;
    this.operationTickets = new Set();
    this.assetDeliveryConfig = options.assetDeliveryConfig ?? null;
    this.ownedArtifactCache = new Map();
    this.ownedArtifactCacheBytes = 0;
    this.installCacheDoctor = options.installCacheDoctor ?? runInstallCacheDoctor;
    this.auditEvents = [];
    this.policy = options.policy ?? createComputerUsePolicy(options.policyOptions);
    this.actionPolicy = this.policy.describe();
  }

  health(options = {}) {
    return this.runOperation((ticket) => this.healthOperation(options, ticket));
  }

  async healthOperation(options = {}, ticket) {
    const result = {
      status: "ready",
      module: "agent-computer-use-mcp",
      version: "0.0.26",
      phases: {
        "0.9": "contract-freeze",
        "0.10": "release-metadata-changelog",
        "0.11": "release-readiness-gate",
        "0.12": "release-artifact-verification",
        "0.13": "platform-native-inventory",
        "0.14": "protected-npm-release",
        "0.15": "real-release-assembly",
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
        "5.7": "public-mcp-contract-review",
        "6.0": "app-smoke-matrix-contract",
        "6.1": "app-smoke-coverage-gate",
        "6.2": "real-app-perception-smoke",
        "7.0": "first-run-readiness",
        "7.1": "offline-bundle-readiness",
        "7.2": "repair-progress-plan",
        "7.3": "offline-capability-proof",
        "7.4": "offline-install-proof",
        "7.5": "first-enable-safety",
        "7.6": "repair-entrypoint-catalog",
        "7.7": "clean-install-degraded-proof",
        "7.8": "platform-package-integrity",
        "7.9": "offline-package-identity",
        "8.0": "runtime-soak",
        "9.0": "commercial-promotion-evidence",
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
        result.driver = await this.awaitExternal(ticket, () => this.driver.health());
        if (result.driver.status !== "healthy") {
          result.status = "degraded";
        }
      }
      await this.ensureOcrResources(ticket);
      result.ocr = await this.awaitExternal(ticket, () => this.ocr.doctor());
      if (options.prewarm) {
        result.prewarm = await this.prewarmOcrBuckets(ticket);
      }
    }

    result.capabilityHandshake = createComputerUseCapabilityHandshake({
      moduleVersion: result.version,
      resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
      fast: options.fast === true,
      driver: result.driver,
      ocr: result.ocr,
    });
    return result;
  }

  doctor(options = {}) {
    return this.runOperation((ticket) => this.doctorOperation(options, ticket));
  }

  async doctorOperation(options = {}, ticket) {
    const runtime = await this.awaitExternal(ticket, () => this.healthOperation({
      fast: options.fast ?? true,
      prewarm: false,
    }, ticket));
    const installCache = options.includeInstallCache === false
      ? null
      : await this.awaitExternal(ticket, () => this.installCacheDoctor());
    const runtimeSupervisor = this.processSupervisor?.health
      ? this.processSupervisor.health()
      : null;
    const daemonSession = this.daemonSession?.health
      ? this.daemonSession.health()
      : null;
    const runtimeCleanup = await this.awaitExternal(ticket, () => this.inspectRuntimeCleanup());
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

  repair(options = {}) {
    return this.runOperation((ticket) => this.repairOperation(options, ticket));
  }

  async repairOperation(options = {}, ticket) {
    const operation = options.operation ?? "plan";
    if (operation === "status") {
      const operationState = await this.awaitExternal(
        ticket,
        () => this.requireAssetOperationManager().status(options.operationId),
      );
      return this.assetOperationResult({
        status: "repair_status",
        operation: operationState,
      });
    }
    if (operation === "cancel") {
      const operationState = await this.awaitExternal(
        ticket,
        () => this.requireAssetOperationManager().cancel(options.operationId, "mcp-cancel"),
      );
      return this.assetOperationResult({
        status: "repair_cancelled",
        operation: operationState,
      });
    }

    const doctor = await this.awaitExternal(ticket, () => this.doctorOperation({
      fast: true,
      includeInstallCache: options.includeInstallCache,
    }, ticket));
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
      actionIds: actions.map((action) => action.id),
      allowNetwork: options.allowNetwork === true,
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
    const shouldStartAssetOperation = operation === "start"
      && approved
      && approval.status === "approved"
      && dryRun === false;
    if (shouldStartAssetOperation) {
      if (actions.length === 0) {
        return this.assetOperationResult({
          status: "planned",
          operation: null,
          approval,
          repairPlan,
          progressPlan,
          reason: "no-selected-actions",
        });
      }
      const manager = this.requireAssetOperationManager();
      if (!this.assetDeliveryConfig) {
        throw new Error("asset.delivery_config_required");
      }
      const operationState = await this.awaitExternal(ticket, () => manager.start({
        ...this.assetDeliveryConfig,
        operationId: options.operationId,
        actionIds: actions.map((action) => action.id),
        allowNetwork: options.allowNetwork === true,
        timeoutMs: options.timeoutMs,
      }));
      this.pendingRepairApproval = null;
      return this.assetOperationResult({
        status: "repair_started",
        operation: operationState,
        approval,
        repairPlan,
        progressPlan,
      });
    }
    const executableProcessActions = actions
      .filter((action) => action.kind === "process-restart");
    const executableRuntimeCleanupActions = actions
      .filter((action) => action.kind === "runtime-cleanup");
    const shouldExecuteRepairActions = approved
      && dryRun === false
      && (executableProcessActions.length > 0 || executableRuntimeCleanupActions.length > 0);
    const executionResults = shouldExecuteRepairActions
      ? await this.awaitExternal(ticket, () => Promise.all([
        ...executableProcessActions.map((action) => this.recoverProcessAction(action)),
        ...executableRuntimeCleanupActions.map((action) => this.executeRuntimeCleanupAction(action)),
      ]))
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

  requestAccess(args) {
    return this.runOperation((ticket) => this.requestAccessOperation(args, ticket));
  }

  async requestAccessOperation(args, ticket) {
    await this.awaitExternal(
      ticket,
      () => this.expireActiveController({ throwOnExpire: false }, ticket),
    );
    if (this.controllerRequestInProgress) {
      fail("controller.request_in_progress", "A Gateway-managed Computer Use controller request is already in progress.", {
        includeUserOverlay: false,
      });
    }
    this.expireAccessApproval();
    await this.assertDesktopInteractive(ticket, "acquire");
    if (this.controllerRequestInProgress) {
      fail("controller.request_in_progress", "A Gateway-managed Computer Use controller request is already in progress.", {
        includeUserOverlay: false,
      });
    }
    if (this.pendingAccessApproval) {
      fail("controller.approval_pending", "A Gateway-managed Computer Use approval request is already pending.", {
        token: this.pendingAccessApproval.token,
        expiresAt: this.pendingAccessApproval.expiresAt,
        includeUserOverlay: false,
      });
    }
    const tier = args.tier ?? "full";
    const agentId = args.requestContext?.agentId ?? args.agentId ?? "unknown";
    const hasApplicationToken = typeof args.applicationToken === "string"
      && args.applicationToken.trim() !== "";
    const selectors = [
      args.target === "foreground",
      args.windowId !== undefined,
      !hasApplicationToken && typeof args.titlePart === "string" && args.titlePart.trim() !== "",
      hasApplicationToken,
    ].filter(Boolean).length;
    if (selectors !== 1) {
      fail(
        selectors === 0 ? "window.selector_required" : "window.selector_conflict",
        "Select exactly one target using target=\"foreground\", windowId, titlePart, or applicationToken.",
        {
          retryable: true,
          nextTool: "computer.observe",
        },
      );
    }
    if (hasApplicationToken) {
      if (!this.driver?.launchApp) {
        fail("provider.unavailable", "Application activation is not available.", {
          provider: "cua-driver",
        });
      }
    } else if (!this.driver?.findWindow) {
      fail("provider.unavailable", "Window discovery is not available.", {
        provider: "cua-driver",
      });
    }
    if (this.activeController && (
      args.approvalRequired === true
      || this.activeController.agentId !== agentId
    )) {
      fail("controller.already_active", "A Gateway-managed Computer Use controller is already active.", {
        controllerId: this.activeController.controllerId,
      });
    }
    this.controllerRequestInProgress = true;
    const grant = this.beginControlGrant();
    try {
      let window;
      try {
        if (hasApplicationToken) {
          const application = this.applicationCatalog.get(args.applicationToken);
          if (!application) {
            fail("application.token_invalid", "The application token is missing or stale.", {
              retryable: true,
              nextTool: "computer.observe",
              suggestedAction: "Call computer.observe mode=\"state\" and use the returned applicationToken.",
            });
          }
          const launch = await this.awaitExternal(
            ticket,
            () => this.driver.launchApp({
              launchPath: application.launchPath,
              name: application.name,
              pid: application.pid,
              ...(Array.isArray(application.processIds)
                ? { processIds: application.processIds }
                : {}),
              running: application.running,
            }),
          );
          window = launch.windows?.[0];
          if (!window) {
            fail("window.not_found", "The application was activated but no controllable window appeared.", {
              retryable: true,
              nextTool: "computer.observe",
            });
          }
        } else {
          window = await this.awaitExternal(
            ticket,
            () => this.driver.findWindow({
              target: args.target,
              windowId: args.windowId,
              titlePart: args.titlePart,
            }),
          );
        }
      } catch (error) {
        this.assertOperationTicket(ticket);
        if (error?.code === "window.not_found" || String(error?.message ?? "").startsWith("window.not_found")) {
          fail(
            "window.not_found",
            "No visible window matched the requested selector.",
            {
              retryable: true,
              nextTool: "computer.observe",
              suggestedAction: "Discover foregroundWindow with computer.observe mode=\"state\", then retry with target=\"foreground\" or the returned windowId.",
            },
          );
        }
        throw error;
      }
      this.assertControlGrant(grant);
      this.enforcePolicyDecision(this.policy.evaluateAccessRequest({ tier, window }));
      if (this.activeController) {
        const requestedAgentId = agentId;
        if (
          this.activeController.agentId !== requestedAgentId
          || !sameRequestContext(this.activeControllerRequestContext, args.requestContext)
        ) {
          fail("controller.already_active", "A Gateway-managed Computer Use controller is already active.", {
            controllerId: this.activeController.controllerId,
          });
        }
        if (
          controllerWindowId(this.activeController.window) === controllerWindowId(window)
          && this.activeController.tier === tier
        ) {
          this.activeController.leaseTtlMs = Math.max(
            1,
            args.leaseTtlMs ?? this.activeController.leaseTtlMs ?? 300000,
          );
          this.renewActiveController();
          this.recordAudit("computer.access.reused", {
            controllerId: this.activeController.controllerId,
            title: this.activeController.window.title,
            tier: this.activeController.tier,
          });
          return {
            status: "reused",
            approval: { status: "not_required" },
            controller: this.activeController,
            overlay: this.overlayHandle,
            startsDesktopControl: false,
            includeUserOverlay: false,
            reused: true,
          };
        }
        const previous = this.activeController;
        this.activeController = null;
        this.lastCapture = null;
        this.pendingUnverifiedMutation = null;
        this.activeFocusReceipt = null;
        await this.awaitExternal(ticket, () => this.stopControlVisuals(ticket));
        this.recordAudit("computer.access.replaced", {
          controllerId: previous.controllerId,
          previousTitle: previous.window.title,
          nextTitle: window.title,
          previousTier: previous.tier,
          nextTier: tier,
        });
      }
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
            windowId: args.windowId,
            target: args.target,
            tier,
            agentId: args.requestContext?.agentId ?? args.agentId ?? "unknown",
            requestContext: args.requestContext,
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
      return await this.awaitExternal(ticket, () => this.grantAccessController({
        tier,
        agentId,
        requestContext: args.requestContext,
        window,
        leaseTtlMs,
        approval: { status: "not_required" },
        grant,
        ticket,
      }));
    } finally {
      this.finishControlGrant(grant);
      this.controllerRequestInProgress = false;
    }
  }

  approveAccess(args = {}) {
    return this.runOperation((ticket) => this.approveAccessOperation(args, ticket));
  }

  async approveAccessOperation(args = {}, ticket) {
    await this.awaitExternal(
      ticket,
      () => this.expireActiveController({ throwOnExpire: false }, ticket),
    );
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
    if (this.controllerRequestInProgress) {
      fail("controller.request_in_progress", "A Gateway-managed Computer Use controller request is already in progress.", {
        includeUserOverlay: false,
      });
    }
    this.controllerRequestInProgress = true;
    const grant = this.beginControlGrant();
    try {
      return await this.awaitExternal(ticket, () => this.grantAccessController({
        tier: request.tier,
        agentId: request.agentId,
        requestContext: request.requestContext,
        window: request.window,
        leaseTtlMs: Math.max(1, args.leaseTtlMs ?? request.leaseTtlMs ?? 300000),
        approval: { ...this.serializeAccessApproval(pending), status: "approved" },
        grant,
        ticket,
      }));
    } finally {
      this.finishControlGrant(grant);
      this.controllerRequestInProgress = false;
    }
  }

  capture(args = {}) {
    return this.runOperation((ticket) => this.captureOperation({
      ...args,
      publicObservation: true,
    }, ticket));
  }

  async captureOperation(args = {}, ticket) {
    await this.awaitExternal(ticket, () => this.requireActiveController(ticket, args.requestContext));
    if (args.publicObservation === true) {
      if (this.consecutivePublicObservations >= PUBLIC_OBSERVATION_LIMIT) {
        fail(
          "observation.step_budget_exhausted",
          "The current interaction step has already consumed its observation budget. Perform a grounded action from existing evidence or release control and report the blocker.",
          {
            retryable: false,
            allowedNextTools: ["computer.act", "computer.release"],
            observationCount: this.consecutivePublicObservations,
            observationLimit: PUBLIC_OBSERVATION_LIMIT,
          },
        );
      }
      this.consecutivePublicObservations += 1;
    }
    await this.assertDesktopInteractive(ticket, "observe");
    const mode = args.mode ?? "semantic";
    let observation;
    if (mode === "semantic") {
      if (!this.driver?.capture) fail("provider.unavailable", "semantic capture provider is not available");
      observation = await this.awaitExternal(ticket, () => this.driver.capture({
        window: this.activeController.window,
        mode,
        controllerId: this.activeController.controllerId,
      }));
      const semanticAssessment = assessSemanticActionability(observation);
      if (!semanticAssessment.sufficient && this.canReuseLatestScreenshotObservation()) {
        const preserved = {
          ...this.lastCapture,
          semanticProbe: {
            status: "insufficient",
            actionableElementCount: semanticAssessment.actionableElementCount,
            namedActionableRatio: semanticAssessment.namedActionableRatio,
            preservedObservationId: this.lastCapture.observationId,
          },
          perceptionRouting: {
            selectedMode: "semantic-fallback-existing-screenshot",
            avoidedVision: true,
            sufficient: false,
            actionableElementCount: semanticAssessment.actionableElementCount,
            namedActionableRatio: semanticAssessment.namedActionableRatio,
            reason: "empty-semantic-probe-preserved-fresh-screenshot",
          },
        };
        this.recordAudit("computer.capture.semantic_insufficient", {
          controllerId: this.activeController.controllerId,
          preservedObservationId: this.lastCapture.observationId,
        });
        return preserved;
      }
    } else if (mode === "ocr-region") {
      observation = (await this.awaitExternal(ticket, () => this.ocrRegionOperation({
        titlePart: this.activeController.window.title,
        crop: args.crop,
        timeoutMs: args.timeoutMs,
      }, ticket))).observation;
    } else if (mode === "screenshot") {
      let semanticObservation = null;
      if (this.driver?.capture) {
        try {
          semanticObservation = await this.awaitExternal(ticket, () => this.driver.capture({
            window: this.activeController.window,
            mode: "semantic",
            controllerId: this.activeController.controllerId,
          }));
        } catch (error) {
          this.assertOperationTicket(ticket);
        }
      }
      const semanticAssessment = assessSemanticActionability(semanticObservation);
      if (semanticAssessment.sufficient) {
        observation = {
          ...semanticObservation,
          requestedMode: "screenshot",
          perceptionRouting: {
            selectedMode: "semantic",
            avoidedVision: true,
            ...semanticAssessment,
          },
        };
      } else {
        const screenshot = await this.awaitExternal(ticket, () => this.captureWindowOperation({
          titlePart: this.activeController.window.title,
          timeoutMs: Math.min(
            positiveTimeout(args.timeoutMs, SCREENSHOT_LATENCY_BUDGET_MS),
            SCREENSHOT_LATENCY_BUDGET_MS,
          ),
        }, ticket));
        observation = await this.prioritizeLocalScreenshotPerception(screenshot, args, ticket);
      }
    } else {
      fail("capture.mode_unsupported", `Unsupported capture mode: ${mode}`);
    }

    this.lastCapture = this.createActionObservation({
      ...observation,
      observationId: observation.observationId ?? `capture-${Date.now()}`,
      provider: observation.provider ?? "gateway-managed",
    });
    this.rememberSemanticElements(this.lastCapture);
    this.reconcilePendingTextFocus(this.lastCapture);
    this.recordAudit("computer.capture.created", {
      controllerId: this.activeController.controllerId,
      mode,
      observationId: this.lastCapture.observationId,
    });
    return this.lastCapture;
  }

  canReuseLatestScreenshotObservation() {
    const latest = this.lastCapture;
    if (!latest || !isImageBearingObservation(latest)) return false;
    const receipt = latest.surfaceReceipt;
    if (!receipt?.id || receipt.id === this.consumedSurfaceReceiptId) return false;
    if (receipt.controllerId !== this.activeController?.controllerId) return false;
    if (receipt.windowId !== controllerWindowId(this.activeController?.window)) return false;
    const expiresAtMs = Number(latest.expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs > this.clock.now();
  }

  async prioritizeLocalScreenshotPerception(screenshot, args, ticket) {
    const imagePath = screenshot?.artifact?.path ?? screenshot?.capture?.path;
    if (typeof imagePath !== "string" || !imagePath) return screenshot;

    const currentDigest = await this.awaitExternal(ticket, async () => (
      createHash("sha256").update(await this.readOwnedArtifact(imagePath)).digest("hex")
    ));
    const windowId = String(
      this.activeController?.window?.windowId
      ?? this.activeController?.window?.id
      ?? this.activeController?.window?.title
      ?? "active-window",
    );
    const previous = this.lastScreenshot?.windowId === windowId ? this.lastScreenshot : null;
    const visualBounds = isCoordinateBox(screenshot.coordinateBounds)
      ? screenshot.coordinateBounds
      : Number.isFinite(screenshot.capture?.width) && Number.isFinite(screenshot.capture?.height)
        ? { x: 0, y: 0, width: screenshot.capture.width, height: screenshot.capture.height }
        : Number.isFinite(screenshot.window?.bounds?.width) && Number.isFinite(screenshot.window?.bounds?.height)
          ? { x: 0, y: 0, width: screenshot.window.bounds.width, height: screenshot.window.bounds.height }
          : null;
    const explicitVisualQuestion = typeof args.visualQuestion === "string"
      ? args.visualQuestion.trim()
      : "";
    const hintedActionCrop = args.crop == null
      && this.lastActionVisualCrop?.windowId === windowId
      && this.lastActionVisualCrop.expiresAtMs >= this.clock.now()
      ? this.lastActionVisualCrop.crop
      : null;
    const hintedObservationCrop = args.crop == null
      && hintedActionCrop == null
      && this.lastFocusedObservationCrop?.windowId === windowId
      && this.lastFocusedObservationCrop.expiresAtMs >= this.clock.now()
      ? this.lastFocusedObservationCrop.crop
      : null;
    const suggestedVisualRegion = hintedActionCrop ?? hintedObservationCrop;
    // A previous action target is only a locality hint, not authority to crop a
    // later question. The next ambiguity may concern the containing context,
    // and silently inheriting the old crop can make a truthful vision model
    // report that the rest of the UI is absent. The caller must opt into a
    // bounded crop explicitly; changed-region OCR remains automatic.
    const requestedCrop = normalizeObservationCrop(
      args.crop,
      visualBounds,
    );
    const cropAdjustment = describeObservationCropAdjustment(args.crop, requestedCrop, visualBounds);
    const observationSignature = JSON.stringify({
      crop: requestedCrop,
      visualQuestion: explicitVisualQuestion,
    });
    if (args.crop != null && requestedCrop) {
      this.lastFocusedObservationCrop = {
        windowId,
        crop: requestedCrop,
        expiresAtMs: this.clock.now() + VISUAL_REGION_HINT_TTL_MS,
      };
    }
    let dirtyRegion = null;
    let unchanged = false;
    if (previous?.path) {
      if (previous.digest === currentDigest) {
        unchanged = true;
      } else {
        try {
          dirtyRegion = await this.awaitExternal(ticket, () => computeDirtyRegion(previous.path, imagePath));
          unchanged = dirtyRegion === null;
        } catch (error) {
          this.assertOperationTicket(ticket);
        }
      }
    }

    const baselineOcrAttempts = previous?.baselineOcrAttempts ?? 0;
    const retryBaselineOcr = unchanged
      && previous?.ocrBaselineReady !== true
      && baselineOcrAttempts < 2;
    const stableFrameObservations = unchanged
      ? (previous?.stableFrameObservations ?? 0) + 1
      : 0;
    const stableFrameObservationBlocked = stableFrameObservations >= STABLE_FRAME_OBSERVATION_LIMIT
      && !retryBaselineOcr;
    const shouldRunLocalOcr = !stableFrameObservationBlocked && (
      !unchanged
      || retryBaselineOcr
      || Boolean(requestedCrop && args.effectHintRegion)
    );
    let localObservation = null;
    let primaryOcrElements = [];
    let secondaryOcrElements = [];
    let ocrRegion = null;
    let secondaryOcrRegion = null;
    let ocrError = null;

    if (shouldRunLocalOcr) {
      ocrRegion = requestedCrop ?? (dirtyRegion ? expandRegionToBucket(dirtyRegion) : null);
      try {
        const ocr = await this.awaitExternal(ticket, () => this.ocrRegionOperation({
          imagePath,
          crop: ocrRegion,
          timeoutMs: Math.min(
            positiveTimeout(args.timeoutMs, LOCAL_OCR_LATENCY_BUDGET_MS),
            LOCAL_OCR_LATENCY_BUDGET_MS,
          ),
        }, ticket));
        localObservation = {
          ...ocr.observation,
          coordinateSpace: screenshot.coordinateSpace,
          coordinateBounds: screenshot.coordinateBounds,
          coordinateTransform: screenshot.coordinateTransform,
          coordinateScale: screenshot.coordinateScale,
        };
        primaryOcrElements = Array.isArray(localObservation.elements)
          ? localObservation.elements
          : [];
        if (args.includeChangedRegionAlongsideCrop === true && requestedCrop) {
          // A declared selection effect is more useful than the global dirty
          // bounding box: sparse animation or live content can stretch that box
          // across the whole frame and make it materially overlap the clicked
          // item crop. Prefer the geometry-derived sibling/effect region, then
          // fall back to the changed pixels when no effect region was planned.
          const changedRegionCandidate = selectSecondaryOcrRegion({
            effectHintRegion: args.effectHintRegion,
            dirtyRegion,
            visualBounds,
          });
          if (
            changedRegionCandidate
            && !regionsMateriallyOverlap(requestedCrop, changedRegionCandidate)
          ) {
            secondaryOcrRegion = changedRegionCandidate;
            const secondaryOcr = await this.awaitExternal(ticket, () => this.ocrRegionOperation({
              imagePath,
              crop: secondaryOcrRegion,
              timeoutMs: Math.min(
                positiveTimeout(args.timeoutMs, LOCAL_OCR_LATENCY_BUDGET_MS),
                LOCAL_OCR_LATENCY_BUDGET_MS,
              ),
            }, ticket));
            secondaryOcrElements = Array.isArray(secondaryOcr.observation?.elements)
              ? secondaryOcr.observation.elements
              : [];
            localObservation = mergeLocalOcrObservations(
              localObservation,
              secondaryOcr.observation,
            );
          }
        }
      } catch (error) {
        this.assertOperationTicket(ticket);
        ocrError = serializeToolError(error);
      }
    }

    const localElements = Array.isArray(localObservation?.elements)
      ? localObservation.elements.length
      : 0;
    const completedFullWindowOcr = shouldRunLocalOcr
      && ocrRegion === null
      && localObservation !== null;
    const ocrBaselineReady = previous?.ocrBaselineReady === true || completedFullWindowOcr;
    const nextBaselineOcrAttempts = shouldRunLocalOcr && ocrRegion === null
      ? baselineOcrAttempts + 1
      : baselineOcrAttempts;
    const previousOcrElements = Array.isArray(previous?.ocrElements) ? previous.ocrElements : [];
    const currentOcrElements = Array.isArray(localObservation?.elements) ? localObservation.elements : [];
    const nonSemanticSparseChange = !unchanged && isNonSemanticSparseDirtyRegion({
      dirtyRegion,
      visualBounds,
      ocrRegion,
      previousElements: previousOcrElements,
      currentElements: currentOcrElements,
    });
    const visualRegion = explicitVisualQuestion && requestedCrop
      ? expandVisualContextRegion(requestedCrop, visualBounds)
      : requestedCrop;
    const dirtyRegionOutsideVisualRegion = isCoordinateBox(dirtyRegion)
      && isCoordinateBox(visualRegion)
      && !boxesIntersect(dirtyRegion, visualRegion);
    const visualSceneStable = unchanged
      || isVisuallyImmaterialDirtyRegion(dirtyRegion, visualBounds)
      || nonSemanticSparseChange
      || dirtyRegionOutsideVisualRegion;
    // Changed pixels are a low-latency OCR hint, not authority to crop an
    // explicit layout/icon question. Animations and live content can dominate
    // a diff while being unrelated to the requested ambiguity. Only a crop
    // explicitly supplied by the caller constrains Host vision.
    const sameVisualInteraction = this.lastVisualUnderstanding?.interactionStep === this.interactionStep;
    const sameVisualRegion = regionsMateriallyOverlap(
      this.lastVisualUnderstanding?.region,
      visualRegion,
    );
    const repeatedStableVisualRegion = Boolean(
      sameVisualInteraction
      && sameVisualRegion
      && visualSceneStable,
    );
    const repeatedVisualFrame = Boolean(
      explicitVisualQuestion
      && this.lastVisualUnderstanding?.windowId === windowId
      && (
        this.lastVisualUnderstanding?.observedAtMs + VISUAL_ATTEMPT_WINDOW_MS >= this.clock.now()
        || repeatedStableVisualRegion
      ),
    );
    const visualUnderstandingEligible = Boolean(explicitVisualQuestion)
      && !repeatedVisualFrame
      && !stableFrameObservationBlocked;
    const unchangedObservationStreak = unchanged
      && previous?.observationSignature === observationSignature
      ? (previous.unchangedObservationStreak ?? 0) + 1
      : 0;
    const repeatedUnchangedObservation = unchangedObservationStreak >= 2 && !retryBaselineOcr;
    if (visualUnderstandingEligible) {
      this.lastVisualUnderstanding = {
        digest: currentDigest,
        question: explicitVisualQuestion,
        windowId,
        interactionStep: this.interactionStep,
        region: visualRegion,
        observedAtMs: this.clock.now(),
      };
    }
    this.lastScreenshot = {
      path: imagePath,
      digest: currentDigest,
      windowId,
      ocrBaselineReady,
      baselineOcrAttempts: nextBaselineOcrAttempts,
      observationSignature,
      unchangedObservationStreak,
      stableFrameObservations,
      ocrElements: shouldRunLocalOcr
        ? mergePostActionOcrElementSnapshots({
            previousElements: previousOcrElements,
            primaryElements: primaryOcrElements.length > 0 ? primaryOcrElements : currentOcrElements,
            primaryRegion: ocrRegion,
            secondaryElements: secondaryOcrElements,
            secondaryRegion: secondaryOcrRegion,
          })
        : previousOcrElements,
    };

    const noProgress = repeatedUnchangedObservation || stableFrameObservationBlocked
      ? {
          status: "blocked",
          unchangedObservations: unchangedObservationStreak,
          stableFrameObservations,
          nextAction: stableFrameObservationBlocked
            ? "Do not call computer.observe again on this unchanged frame. Act from existing evidence or release control and report the blocker."
            : "Do not call computer.observe again for this unchanged region. Act from the existing evidence, inspect a different bounded region, or release control and report the blocker.",
        }
      : null;

    return {
      ...screenshot,
      ...(localObservation ? { localObservation } : {}),
      ...(noProgress
        ? {
            executionControl: {
              status: "blocked",
              scope: "turn",
              retryable: false,
              allowedNextTools: ["computer.release"],
              reason: stableFrameObservationBlocked
                ? "stable-frame-observation-budget-exhausted"
                : "repeated-unchanged-observation-blocked",
              nextAction: noProgress.nextAction,
            },
          }
        : {}),
      perceptionRouting: {
        selectedMode: retryBaselineOcr
          ? "window-ocr-baseline-retry"
          : unchanged
            ? "unchanged-frame"
          : (dirtyRegion ? "changed-region-ocr" : "window-ocr"),
        changedRegionFirst: true,
        localCropFirst: requestedCrop !== null || dirtyRegion !== null,
        ocrFirst: true,
        baselineOcrRequired: !ocrBaselineReady,
        baselineOcrRetry: retryBaselineOcr,
        baselineOcrAttempts: nextBaselineOcrAttempts,
        screenshotDigest: `sha256:${currentDigest}`,
        frameStatus: unchanged ? "unchanged" : (dirtyRegion ? "changed-region" : "new-frame"),
        visualSceneChanged: !visualSceneStable,
        dirtyRegion,
        ocrRegion,
        secondaryOcrRegion,
        visualRegion,
        suggestedVisualRegion,
        cropAdjustment,
        stableFrameObservations,
        localElementCount: localElements,
        visualUnderstandingEligible,
        avoidedVision: !visualUnderstandingEligible,
        ...(unchanged
          ? {
              unchangedInterpretation: {
                evidence: "pixel-equivalence-only",
                actionSemantics: "An unchanged frame does not prove the preceding action failed. If existing evidence already established the requested context or selection, treat the action as idempotent and proceed to the next distinct task step instead of clicking again.",
              },
            }
          : {}),
        reason: stableFrameObservationBlocked
          ? "stable-frame-observation-budget-exhausted"
          : repeatedUnchangedObservation
          ? "repeated-unchanged-observation-blocked"
          : repeatedVisualFrame
          ? "visual-reuse-suppressed-ocr-fallback"
          : explicitVisualQuestion
            ? "explicit-complex-visual-question"
            : localElements > 0
              ? "structured-local-observation-available"
              : ocrError
                ? "local-ocr-unavailable"
                : "no-explicit-visual-ambiguity",
        ...(noProgress ? { noProgress } : {}),
        ...(ocrError ? { ocrError } : {}),
      },
    };
  }

  act(args = {}) {
    const execute = () => this.runOperation((ticket) => this.actOperation(args, ticket));
    const operation = this.actionTail.then(execute, execute);
    this.actionTail = operation.catch(() => {});
    return operation;
  }

  async actOperation(args = {}, ticket) {
    await this.awaitExternal(ticket, () => this.requireActiveController(ticket, args.requestContext));
    await this.assertDesktopInteractive(ticket, "act");
    args = {
      ...args,
      action: this.bindCurrentActionReceipts(args.action),
    };
    const actionObservation = this.lastCapture;
    const action = normalizeActionCoordinates(
      args.action,
      this.lastCapture,
      this.activeController?.window,
    );
    this.assertNoRepeatedUnconfirmedMutation(action);
    if (this.pendingUnverifiedMutation) {
      fail(
        "action.observation_required_after_unverified_mutation",
        "A previous text mutation may already have changed the target. Observe the current window before any further action; never replay a possibly-applied write.",
        {
          actionKind: this.pendingUnverifiedMutation.actionKind,
          replaySafe: false,
          nextAction: "Call computer.observe with semantic, screenshot, or ocr-region mode, then decide from the fresh state.",
        },
      );
    }
    const surfaceReceipt = actionObservation?.surfaceReceipt;
    if (surfaceReceipt?.id && args.action?.surfaceReceiptId !== undefined
      && args.action.surfaceReceiptId !== surfaceReceipt.id) {
      fail(
        "action.surface_receipt_mismatch",
        "The supplied surface receipt does not match the latest observation.",
        {
          expectedSurfaceReceiptId: surfaceReceipt.id,
          retryable: true,
          nextTool: "computer.observe",
        },
      );
    }
    const focusContinuation = isTargetlessKeyboardAction(args.action)
      && typeof args.action?.focusReceiptId === "string";
    if (surfaceReceipt?.id && this.consumedSurfaceReceiptId === surfaceReceipt.id && !focusContinuation) {
      fail(
        "action.fresh_observation_required",
        "The latest surface observation has already authorized one action. Observe again before another action.",
        {
          consumedSurfaceReceiptId: surfaceReceipt.id,
          retryable: true,
          nextTool: "computer.observe",
        },
      );
    }
    const { admission, driverTarget, element, focusReceipt } = this.validateAction(action);
    // A newly admitted action starts a distinct perception step. Permit one
    // fresh layout escalation for its resulting scene and bound the number of
    // observations made before the next action.
    this.consecutivePublicObservations = 0;
    this.lastVisualUnderstanding = null;
    this.interactionStep += 1;
    const effectiveDeliveryMode = resolveEffectiveDeliveryMode(action, admission, focusReceipt);
    if (action.kind === "activate_window" || action.kind === "click" || action.kind === "set_value"
      || ((action.kind === "type_text" || action.kind === "press_key") && !focusReceipt)) {
      this.activeFocusReceipt = null;
    }
    this.recordAudit("computer.action.started", {
      controllerId: this.activeController.controllerId,
      kind: action.kind,
      elementToken: action.elementToken,
      elementIndex: action.elementIndex,
      effectiveDeliveryMode,
      surfaceReceiptId: surfaceReceipt?.id ?? null,
    });
    if (surfaceReceipt?.id && !focusContinuation) this.consumedSurfaceReceiptId = surfaceReceipt.id;

    let result;
    let outcome = "applied";
    try {
      if (action.kind === "activate_window") {
        if (!this.driver?.activateWindow) fail("provider.unavailable", "window activation provider is not available");
        result = await this.awaitExternal(ticket, () => this.driver.activateWindow({
          window: this.activeController.window,
        }));
        if (isExplicitlyUnverified(result)) {
          result = describeUnverifiedAction(result, action);
          outcome = "unverified";
        } else if (hasVerifiedFocus(result)) {
          try {
            const observation = await this.captureOperation({
              mode: "semantic",
              requestContext: args.requestContext,
            }, ticket);
            result = { ...result, observation };
          } catch (error) {
            this.assertOperationTicket(ticket);
            result = {
              ...result,
              observation: {
                status: "unavailable",
                error: {
                  code: error?.code ?? "verification.capture_failed",
                  message: error instanceof Error ? error.message : String(error),
                },
              },
            };
          }
          this.activeFocusReceipt = this.createFocusReceipt({ action, element, driverTarget });
        }
      } else if (action.kind === "set_value") {
        if (!this.driver?.setValue) fail("provider.unavailable", "set_value provider is not available");
        result = await this.awaitExternal(ticket, () => this.driver.setValue({
          window: this.activeController.window,
          ...driverTarget,
          value: action.value,
        }));
        if (isExplicitlyUnverified(result)) {
          result = describeUnverifiedAction(result, action);
          outcome = "unverified";
        }
      } else if (action.kind === "type_text") {
        if (!this.driver?.typeText) fail("provider.unavailable", "type_text provider is not available");
        result = await this.awaitExternal(ticket, () => this.driver.typeText({
          window: this.activeController.window,
          ...driverTarget,
          value: action.value,
          textMode: action.textMode,
          inputBehavior: action.inputBehavior ?? "incremental",
          deliveryMode: effectiveDeliveryMode,
        }));
        if (isCoordinateBox(action.targetBounds)) {
          this.recentEditableTarget = {
            controllerId: this.activeController.controllerId,
            windowId: controllerWindowId(this.activeController.window),
            bounds: { ...action.targetBounds },
            expiresAtMs: this.clock.now() + ACTION_OBSERVATION_TTL_MS,
          };
        }
        if (hasVerifiedFocus(result)) {
          this.activeFocusReceipt = this.createFocusReceipt({ action, element, driverTarget });
        }
        if (!isVerifiedTextMutation(result)) {
          const verification = admission.pixelLimitedAction === false && (element || focusReceipt)
            ? await this.verifySemanticStateTransition(actionObservation, args.requestContext, ticket)
            : null;
          if (verification?.verified) {
            result = {
              ...result,
              effect: "verified",
              verified: true,
              verification,
            };
          } else {
            result = {
              ...describePossiblyAppliedTextMutation(result),
              ...(verification ? { verification } : {}),
            };
            outcome = "unverified";
          }
        }
      } else if (action.kind === "click") {
        if (!this.driver?.click) fail("provider.unavailable", "click provider is not available");
        result = await this.awaitExternal(ticket, () => this.driver.click({
          window: this.activeController.window,
          ...driverTarget,
          deliveryMode: effectiveDeliveryMode,
        }));
        if (isExplicitlyUnverified(result)) {
          const verification = admission.pixelLimitedAction === false && element
            ? await this.verifySemanticStateTransition(actionObservation, args.requestContext, ticket)
            : null;
          if (verification?.verified) {
            result = {
              ...result,
              effect: "verified",
              verified: true,
              verification,
            };
          } else if (admission.pixelLimitedAction === false && element) {
            result = describeDeliveredSemanticClick(result, verification);
            outcome = "delivered";
          } else {
            result = {
              ...describeUnverifiedAction(result, action),
              ...(verification ? { verification } : {}),
            };
            outcome = "unverified";
          }
        } else if (hasVerifiedFocus(result)) {
          this.activeFocusReceipt = this.createFocusReceipt({ action, element, driverTarget });
        }
      } else if (action.kind === "press_key") {
        if (!this.driver?.pressKey) fail("provider.unavailable", "press_key provider is not available");
        result = await this.awaitExternal(ticket, () => this.driver.pressKey({
          window: this.activeController.window,
          ...driverTarget,
          key: action.key,
          modifiers: action.modifiers,
          deliveryMode: effectiveDeliveryMode,
        }));
        if (isExplicitlyUnverified(result)) {
          const verification = admission.pixelLimitedAction === false && (element || focusReceipt)
            ? await this.verifySemanticStateTransition(actionObservation, args.requestContext, ticket)
            : null;
          if (verification?.verified) {
            result = {
              ...result,
              effect: "verified",
              verified: true,
              verification,
            };
          } else {
            result = {
              ...describeUnverifiedAction(result),
              ...(verification ? { verification } : {}),
            };
            outcome = "unverified";
          }
        }
      }
    } catch (error) {
      this.assertOperationTicket(ticket);
      this.recordAudit("computer.action.failed", {
        controllerId: this.activeController.controllerId,
        kind: action.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (outcome === "unverified" && action.kind !== "activate_window") {
      const independentlyVerifiedTextFocus = action.kind === "type_text"
        && (hasVerifiedFocus(result) || focusReceipt?.status === "verified");
      if (!independentlyVerifiedTextFocus) this.activeFocusReceipt = null;
      this.pendingUnverifiedMutation = {
        actionKind: action.kind,
        controllerId: this.activeController.controllerId,
        windowId: controllerWindowId(this.activeController.window),
        observationId: this.lastCapture?.observationId,
        value: action.kind === "type_text" ? action.value : undefined,
        preexistingTextOccurrences: action.kind === "type_text"
          ? collectObservedTextOccurrences(actionObservation, action.value)
          : [],
        target: describeActionTarget(action, element, driverTarget),
      };
    } else {
      this.unconfirmedMutationHistory = [];
    }
    const actionResult = {
      status: outcome === "unverified" ? "indeterminate" : (result.status ?? "ok"),
      provider: "gateway-managed",
      action: action.kind,
      result,
      pixelLimitedAction: admission.pixelLimitedAction,
      outcome,
      effectiveDeliveryMode,
      execution: describeActionExecution({
        action,
        element,
        focusReceipt,
        result,
        effectiveDeliveryMode,
      }),
      includeUserOverlay: false,
      ...(surfaceReceipt?.id ? {
        consumedSurfaceReceipt: {
          id: surfaceReceipt.id,
          generation: surfaceReceipt.generation,
        },
        postActionObservationRequired: true,
      } : {}),
    };
    if (this.activeFocusReceipt) actionResult.focusReceipt = serializeFocusReceipt(this.activeFocusReceipt);
    const automaticLocalPostActionObservation = outcome === "unverified"
      && admission.pixelLimitedAction === true
      && (action.kind === "click" || action.kind === "type_text")
      && typeof this.driver?.captureScreenshot === "function"
      && this.ocr;
    const postActionVerificationCrop = automaticLocalPostActionObservation
      ? planPostActionObservationCrop(action, actionObservation)
      : null;
    const postActionEffectHintRegion = automaticLocalPostActionObservation
      ? planPostActionEffectRegion(action, actionObservation)
      : null;
    if (postActionVerificationCrop) {
      this.lastActionVisualCrop = {
        windowId: controllerWindowId(this.activeController.window),
        crop: postActionVerificationCrop,
        expiresAtMs: this.clock.now() + VISUAL_REGION_HINT_TTL_MS,
      };
    }
    if (action.captureAfter || automaticLocalPostActionObservation) {
      if (automaticLocalPostActionObservation) {
        await this.awaitExternal(
          ticket,
          () => new Promise((resolve) => setTimeout(resolve, POST_ACTION_UI_SETTLE_MS)),
        );
      }
      actionResult.capture = await this.awaitExternal(
        ticket,
        () => this.captureOperation({
          mode: automaticLocalPostActionObservation ? "screenshot" : "semantic",
          ...(postActionVerificationCrop ? { crop: postActionVerificationCrop } : {}),
          ...(automaticLocalPostActionObservation && action.kind === "click"
            ? {
                includeChangedRegionAlongsideCrop: true,
                ...(postActionEffectHintRegion
                  ? { effectHintRegion: postActionEffectHintRegion }
                  : {}),
              }
            : {}),
          requestContext: args.requestContext,
        }, ticket),
      );
      if (automaticLocalPostActionObservation) {
        const effectRegion = actionResult.capture?.perceptionRouting?.secondaryOcrRegion;
        if (effectRegion && action.kind === "click") {
          this.lastActionVisualCrop = {
            windowId: controllerWindowId(this.activeController.window),
            crop: effectRegion,
            expiresAtMs: this.clock.now() + VISUAL_REGION_HINT_TTL_MS,
          };
        }
        actionResult.postActionObservation = {
          source: "host-local-ocr",
          automatic: true,
          visionRequested: false,
          ...(postActionVerificationCrop
            ? {
                regionSource: "action-target",
                verificationRegion: postActionVerificationCrop,
              }
            : {}),
          ...(effectRegion
            ? {
                effectRegionSource: "changed-region",
                effectRegion,
              }
            : {}),
          freshSurfaceReceiptId: actionResult.capture?.surfaceReceipt?.id ?? null,
          nextAction: "Use this fresh local post-action observation before requesting another screenshot. Request Host vision only if OCR and change metadata leave a concrete layout, icon, or complex-scene ambiguity.",
        };
        if (action.kind === "type_text"
          && actionResult.capture?.mutationVerification?.status === "confirmed") {
          outcome = "completed";
          actionResult.status = "ok";
          actionResult.outcome = outcome;
          actionResult.result = {
            ...actionResult.result,
            effect: "verified",
            verified: true,
            focusVerified: true,
            verification: {
              method: actionResult.capture.mutationVerification.method,
              observationId: actionResult.capture.observationId,
            },
          };
          actionResult.postActionObservation.nextAction = "Text entry is already confirmed by a fresh exact OCR value that was absent before the action. Do not observe or type it again; continue with the next distinct action using the issued focus receipt when needed.";
        }
      }
      if (this.activeFocusReceipt) {
        actionResult.focusReceipt = serializeFocusReceipt(this.activeFocusReceipt);
      }
    }
    this.recordAudit(
      outcome === "unverified" ? "computer.action.indeterminate" : "computer.action.completed",
      {
      controllerId: this.activeController.controllerId,
      kind: action.kind,
      status: actionResult.status,
      outcome,
    });
    return actionResult;
  }

  async verifySemanticStateTransition(beforeObservation, requestContext, ticket) {
    try {
      const afterObservation = await this.captureOperation({
        mode: "semantic",
        requestContext,
      }, ticket);
      const beforeFingerprint = semanticStateFingerprint(beforeObservation);
      const afterFingerprint = semanticStateFingerprint(afterObservation);
      const changed = beforeFingerprint !== null
        && afterFingerprint !== null
        && beforeFingerprint !== afterFingerprint;
      return {
        status: beforeFingerprint === null || afterFingerprint === null
          ? "unavailable"
          : (changed ? "changed" : "unchanged"),
        verified: changed,
        method: "semantic-state-transition",
        observation: afterObservation,
      };
    } catch (error) {
      this.assertOperationTicket(ticket);
      return {
        status: "unavailable",
        verified: false,
        method: "semantic-state-transition",
        error: {
          code: error?.code ?? "verification.capture_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  cancel(args = {}) {
    return this.runOperation((ticket) => this.cancelOperation(args, ticket));
  }

  async cancelOperation(args = {}, ticket) {
    this.assertControllerRequestContext(args.requestContext);
    this.invalidateControlGrant(
      "controller.cancelled",
      "The Gateway-managed Computer Use controller request was cancelled.",
    );
    const previous = this.activeController;
    const previousApproval = this.getPendingAccessApproval();
    this.pendingAccessApproval = null;
    this.activeController = null;
    this.activeControllerRequestContext = null;
    this.pendingUnverifiedMutation = null;
    this.unconfirmedMutationHistory = [];
    this.activeFocusReceipt = null;
    this.lastScreenshot = null;
    this.lastVisualUnderstanding = null;
    this.lastActionVisualCrop = null;
    this.lastFocusedObservationCrop = null;
    this.consecutivePublicObservations = 0;
    this.semanticElementAliases.clear();
    this.currentSemanticElements.clear();
    await this.awaitExternal(ticket, () => this.stopControlVisuals(ticket));
    this.recordAudit("computer.cancelled", {
      controllerId: previous?.controllerId,
      approvalToken: previousApproval?.token,
      reason: args.reason ?? "cancelled",
    });
    return { status: "cancelled", previousController: previous, previousApproval, includeUserOverlay: false };
  }

  revoke(args = {}) {
    return this.runOperation((ticket) => this.revokeOperation(args, ticket));
  }

  async revokeOperation(args = {}, ticket) {
    this.invalidateControlGrant(
      "controller.revoked",
      "The Gateway-managed Computer Use controller request was revoked.",
    );
    const previous = this.activeController;
    const previousApproval = this.getPendingAccessApproval();
    this.pendingAccessApproval = null;
    this.activeController = null;
    this.activeControllerRequestContext = null;
    this.pendingUnverifiedMutation = null;
    this.unconfirmedMutationHistory = [];
    this.activeFocusReceipt = null;
    this.lastCapture = null;
    this.lastScreenshot = null;
    this.lastVisualUnderstanding = null;
    this.lastActionVisualCrop = null;
    this.lastFocusedObservationCrop = null;
    this.consecutivePublicObservations = 0;
    this.semanticElementAliases.clear();
    this.currentSemanticElements.clear();
    this.pendingRepairApproval = null;
    let firstError;
    try {
      await this.awaitExternal(
        ticket,
        () => this.assetOperationManager?.cancelAll?.(args.reason ?? "router-revoked"),
      );
    } catch (error) {
      this.assertOperationTicket(ticket);
      firstError = error;
    }
    try {
      await this.awaitExternal(ticket, () => this.stopControlVisuals(ticket));
    } catch (error) {
      this.assertOperationTicket(ticket);
      firstError ??= error;
    }
    this.recordAudit("computer.revoked", {
      controllerId: previous?.controllerId,
      approvalToken: previousApproval?.token,
      reason: args.reason ?? "revoked",
    });
    if (firstError) throw firstError;
    return { status: "revoked", previousController: previous, previousApproval, includeUserOverlay: false };
  }

  listState(options = {}) {
    return this.runOperation((ticket) => this.listStateOperation(ticket, options));
  }

  async listStateOperation(ticket, options = {}) {
    await this.awaitExternal(
      ticket,
      () => this.expireActiveController({ throwOnExpire: false }, ticket),
    );
    this.expireAccessApproval();
    const desktopState = await this.probeDesktopState(ticket);
    if (desktopState.status === "locked") {
      return {
        status: "blocked",
        blocker: {
          code: "desktop.locked",
          message: "The Windows input desktop is locked or otherwise secure.",
          requiresUserAction: "unlock",
        },
        desktopState,
        activeController: this.activeController,
        pendingAccessApproval: this.getPendingAccessApproval(),
        lastCapture: this.lastCapture,
        pendingRepairApproval: this.getPendingRepairApproval(),
        foregroundWindow: null,
        windows: [],
        windowDiscovery: {
          status: "blocked",
          source: "windows-input-desktop",
        },
        applications: [],
        applicationDiscovery: {
          status: "blocked",
          source: "windows-input-desktop",
        },
        auditEvents: this.auditEvents.slice(-50),
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
    }
    let windows = [];
    let foregroundWindow = null;
    let windowDiscovery;
    let applications = [];
    let applicationDiscovery = {
      status: "unavailable",
      source: "cua-driver",
    };
    if (!this.driver?.listWindows) {
      windowDiscovery = {
        status: "unavailable",
        source: "cua-driver",
        error: {
          code: "provider.unavailable",
          message: "Window discovery provider is not available.",
        },
      };
    } else {
      try {
        windows = await this.awaitExternal(
          ticket,
          () => this.driver.listWindows({ onScreenOnly: false }),
        );
        foregroundWindow = windows.find((window) => window.isForeground) ?? null;
        windowDiscovery = {
          status: "ready",
          source: "cua-driver",
        };
      } catch (error) {
        this.assertOperationTicket(ticket);
        windowDiscovery = {
          status: "unavailable",
          source: "cua-driver",
          error: serializeToolError(error),
        };
      }
    }
    if (this.driver?.listApps) {
      try {
        const discovered = await this.awaitExternal(ticket, () => this.driver.listApps());
        this.applicationCatalog.clear();
        applications = discovered.map((application) => {
          // Application tokens are ephemeral selectors, not authorization
          // secrets. Keep enough entropy to avoid collisions within one state
          // inventory without repeating a 36-character UUID for every app in
          // every model turn.
          const applicationToken = `application-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
          this.applicationCatalog.set(applicationToken, application);
          const visible = windows.some((window) => (
            Number.isSafeInteger(application.pid)
            && Number.isSafeInteger(window.pid)
            && application.pid === window.pid
          ));
          const state = application.active
            ? "active"
            : visible
              ? "visible"
              : application.running
                ? "recoverable"
                : "installed";
          return {
            applicationToken,
            name: application.name,
            state,
            ...(application.active ? { active: true } : {}),
            ...(visible ? { visible: true } : {}),
            ...(application.running ? { running: true } : {}),
          };
        });
        const includeInstalled = options.includeInstalled === true;
        const discoveredApplications = applications;
        applications = includeInstalled
          ? discoveredApplications
          : discoveredApplications.filter((application) => application.state !== "installed");
        applicationDiscovery = {
          status: "ready",
          source: "cua-driver",
          total: discoveredApplications.length,
          returned: applications.length,
          omittedInstalled: discoveredApplications.length - applications.length,
          includeInstalled,
          active: discoveredApplications.filter((application) => application.state === "active").length,
          visible: discoveredApplications.filter((application) => application.state === "visible").length,
          recoverable: discoveredApplications.filter((application) => application.state === "recoverable").length,
        };
      } catch (error) {
        this.assertOperationTicket(ticket);
        applicationDiscovery = {
          status: "unavailable",
          source: "cua-driver",
          error: serializeToolError(error),
        };
      }
    }
    return {
      status: this.activeController ? "active" : "idle",
      activeController: this.activeController,
      pendingAccessApproval: this.getPendingAccessApproval(),
      lastCapture: this.lastCapture,
      pendingRepairApproval: this.getPendingRepairApproval(),
      foregroundWindow,
      windows,
      windowDiscovery,
      applications,
      applicationDiscovery,
      desktopState,
      auditEvents: this.auditEvents.slice(-50),
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  }

  captureWindow(args) {
    return this.runOperation((ticket) => this.captureWindowOperation(args, ticket));
  }

  async captureWindowOperation(args, ticket) {
    const outputPath = args.outputPath ?? await this.awaitExternal(
      ticket,
      () => this.createArtifactPath("window.png", ticket),
    );
    const capture = this.activeController && this.driver?.captureScreenshot
      ? await this.awaitExternal(ticket, () => this.driver.captureScreenshot({
          window: this.activeController.window,
          outputPath,
          timeoutMs: Math.min(
            positiveTimeout(args.timeoutMs, SCREENSHOT_LATENCY_BUDGET_MS),
            SCREENSHOT_LATENCY_BUDGET_MS,
          ),
        }))
      : await this.awaitExternal(ticket, () => captureWindowPngByTitle(args.titlePart, outputPath, {
          timeoutMs: args.timeoutMs,
        }));
    if (args.outputPath === undefined && typeof capture.path === "string") {
      await this.awaitExternal(ticket, () => this.pinOwnedArtifact(
        capture.path,
        capture.artifactBytes,
      ));
    }
    const result = {
      status: "ok",
      provider: "gateway-managed",
      source: capture.source ?? "window-capture",
      observationId: `capture-window-${Date.now()}`,
      capture,
      ...(capture.window ? { window: capture.window } : {}),
      artifact: { path: capture.path, mimeType: "image/png" },
      elements: [],
      includeUserOverlay: false,
    };
    if (!this.activeController) return result;
    const observation = this.createActionObservation(result);
    this.lastCapture = observation;
    return observation;
  }

  ocrRegion(args) {
    return this.runOperation((ticket) => this.ocrRegionOperation(args, ticket));
  }

  async ocrRegionOperation(args, ticket) {
    await this.ensureOcrResources(ticket);
    let imagePath = args.imagePath;
    let capture = null;
    if (!imagePath && args.titlePart) {
      const captured = await this.awaitExternal(ticket, () => this.captureWindowOperation({
        titlePart: args.titlePart,
        timeoutMs: args.timeoutMs,
      }, ticket));
      capture = captured.capture;
      imagePath = captured.capture.path;
    }
    if (!imagePath) {
      fail("ocr_region.requires_imagePath_or_titlePart", "ocr_region requires either imagePath or titlePart");
    }

    const windowId = String(args.windowId ?? capture?.title ?? this.activeController?.window?.id
      ?? this.activeController?.window?.title ?? "artifact");
    const pixels = await this.awaitExternal(ticket, () => readOverlayFreeRegionPixels(imagePath, args.crop ?? null));
    const keyOptions = {
      windowId,
      region: args.crop ?? { x: 0, y: 0, width: 1, height: 1 },
      pixels,
      normalizationVersion: UI_TEXT_NORMALIZATION_VERSION,
      includeUserOverlay: false,
    };
    if (this.ocrIdentity) {
      const key = createPerceptionRegionCacheKey({ ...keyOptions, modelIdentity: this.ocrIdentity });
      const cached = this.perceptionCache.get(key);
      if (cached) {
        const observation = this.createActionObservation({
          ...cached,
          cacheHit: true,
          timings: { ...(cached.timings ?? {}), totalMs: 0 },
        });
        this.lastCapture = observation;
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
    }

    const response = await this.awaitExternal(ticket, () => this.ocr.recognize({
      imagePath,
      crop: args.crop,
      languages: args.languages ?? ["zh", "en"],
      timeoutMs: args.timeoutMs ?? 15000,
      noCache: args.noCache,
    }));
    const observation = normalizeOcrSidecarResponse(response, {
      observationId: `ocr-region-${Date.now()}`,
      window: capture ? { title: capture.title } : undefined,
      languageClass: args.languageClass ?? "mixed",
    });
    if (capture
      && Number.isFinite(capture.x)
      && Number.isFinite(capture.y)
      && Number.isFinite(capture.width)
      && Number.isFinite(capture.height)) {
      observation.capture = {
        x: capture.x,
        y: capture.y,
        width: capture.width,
        height: capture.height,
      };
    }
    this.ocrIdentity = pickOcrIdentity(response);
    const actionObservation = this.createActionObservation(observation);
    this.lastCapture = actionObservation;
    const cacheKey = createPerceptionRegionCacheKey({ ...keyOptions, modelIdentity: this.ocrIdentity });
    this.perceptionCache.set(cacheKey, actionObservation, {
      windowId,
      sensitive: args.sensitiveRegion === true || args.passwordRegion === true || args.paymentRegion === true || args.privateRegion === true,
    });

    return {
      status: "ok",
      provider: "gateway-managed",
      mode: "ocr-region",
      imagePath,
      capture,
      observation: actionObservation,
      includeUserOverlay: false,
    };
  }

  observeDiff(args) {
    return this.runOperation((ticket) => this.observeDiffOperation(args, ticket));
  }

  async observeDiffOperation(args, ticket) {
    const dirtyRegion = await this.awaitExternal(ticket, () => computeDirtyRegion(args.baselinePath, args.changedPath, {
      threshold: args.threshold,
      padding: args.padding,
    }));
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

    const ocr = await this.awaitExternal(ticket, () => this.ocrRegionOperation({
      imagePath: args.changedPath,
      crop: ocrRegion,
      languages: args.languages,
      timeoutMs: args.timeoutMs,
      noCache: true,
    }, ticket));

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

  close(args = {}) {
    if (this.lifecycleState === "closed") return Promise.resolve();
    if (this.lifecycleState === "open") {
      this.lifecycleState = "closing";
      this.lifecycleGeneration += 1;
    }
    this.invalidateControlGrant(
      "lifecycle.closed",
      "lifecycle.closed: The computer use provider is closing or closed.",
    );
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      try {
        await this.waitForAdmittedOperations();
        await this.closeResources(args);
        this.closeComplete = true;
        this.lifecycleState = "closed";
      } finally {
        this.closePromise = null;
      }
    })();
    return this.closePromise;
  }

  async closeResources(args) {
    if (!this.closeContext) {
      this.closeContext = {
        previous: this.activeController,
        previousAccessApproval: this.getPendingAccessApproval(),
      };
      this.activeController = null;
      this.activeControllerRequestContext = null;
      this.lastCapture = null;
      this.pendingUnverifiedMutation = null;
      this.unconfirmedMutationHistory = [];
      this.activeFocusReceipt = null;
      this.lastActionVisualCrop = null;
      this.lastFocusedObservationCrop = null;
      this.semanticElementAliases.clear();
      this.currentSemanticElements.clear();
      this.pendingRepairApproval = null;
      this.pendingAccessApproval = null;
      if (this.closeContext.previous) {
        this.recordAudit("computer.controller.closed", {
          controllerId: this.closeContext.previous.controllerId,
          reason: args.reason ?? "router-close",
        });
      }
      if (this.closeContext.previousAccessApproval) {
        this.recordAudit("computer.access.approval_closed", {
          token: this.closeContext.previousAccessApproval.token,
          reason: args.reason ?? "router-close",
        });
      }
    }
    let firstError;
    if (!this.assetCloseComplete) {
      try {
        await this.assetOperationManager?.close?.(args.reason ?? "router-close");
        this.assetCloseComplete = true;
      } catch (error) {
        firstError = error;
      }
    }
    try {
      await this.stopControlVisuals();
    } catch (error) {
      firstError ??= error;
    }
    if (this.driver?.close && !this.driverCloseComplete) {
      try {
        await this.driver.close();
        this.driverCloseComplete = true;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (this.ocrStartPromise) {
      try {
        await this.ocrStartPromise;
      } catch {
        // Startup failure still leaves the attempted sidecar available for cleanup.
      }
    }
    if (this.ocrStarted || this.ocrStartAttempted) {
      try {
        await this.ocr.close();
        this.ocrStarted = false;
        this.ocrStartAttempted = false;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  ensureOcr() {
    return this.runOperation((ticket) => this.ensureOcrResources(ticket));
  }

  async ensureOcrResources(ticket) {
    if (this.ocrStarted) return;
    if (!this.ocrStartPromise) {
      this.assertOperationTicket(ticket);
      this.ocrStartAttempted = true;
      this.ocrStartPromise = Promise.resolve(this.ocr.start());
    }
    const attempt = this.ocrStartPromise;
    try {
      await this.awaitExternal(ticket, () => attempt);
    } finally {
      if (this.ocrStartPromise === attempt) this.ocrStartPromise = null;
    }
    this.ocrStarted = true;
  }

  async prewarmOcrBuckets(ticket, buckets = DEFAULT_OCR_PREWARM_BUCKETS) {
    const started = performance.now();
    const results = [];
    for (const bucket of buckets) {
      const before = performance.now();
      const response = await this.awaitExternal(ticket, () => this.ocr.recognize({
        fixture: "canvas-lab",
        crop: bucket.crop,
        languages: ["zh", "en"],
        timeoutMs: 15000,
        noCache: true,
      }));
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

  async createArtifactPath(name, ticket) {
    if (!this.artifactRoot) {
      this.artifactRoot = await this.awaitExternal(
        ticket,
        () => mkdtemp(join(tmpdir(), "agent-computer-use-mcp-")),
      );
    }
    return join(this.artifactRoot, `${Date.now()}-${name}`);
  }

  async readOwnedArtifact(filePath, options = {}) {
    if (!this.artifactRoot || typeof filePath !== "string" || !isAbsolute(filePath)) {
      fail("artifact.not_owned", "The requested capture is not owned by this Computer Use session.");
    }
    const cacheKey = resolve(filePath);
    const cached = this.ownedArtifactCache.get(cacheKey);
    if (cached) {
      this.ownedArtifactCache.delete(cacheKey);
      this.ownedArtifactCache.set(cacheKey, cached);
      return Buffer.from(cached);
    }
    const root = await realpath(resolve(this.artifactRoot));
    const candidate = await realpath(resolve(filePath));
    const relation = relative(root, candidate);
    if (relation.startsWith("..") || isAbsolute(relation)) {
      fail("artifact.not_owned", "The requested capture is outside this Computer Use session.");
    }
    const info = await stat(candidate);
    const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) {
      fail("artifact.invalid", "The requested capture is not a valid bounded image asset.");
    }
    return readFile(candidate);
  }

  async pinOwnedArtifact(filePath, capturedBytes) {
    let bytes;
    if (Buffer.isBuffer(capturedBytes)) {
      if (!this.artifactRoot || typeof filePath !== "string" || !isAbsolute(filePath)) {
        fail("artifact.not_owned", "The requested capture is not owned by this Computer Use session.");
      }
      const root = resolve(this.artifactRoot);
      const candidate = resolve(filePath);
      const relation = relative(root, candidate);
      if (relation.startsWith("..") || isAbsolute(relation)) {
        fail("artifact.not_owned", "The requested capture is outside this Computer Use session.");
      }
      if (capturedBytes.byteLength <= 0 || capturedBytes.byteLength > 20 * 1024 * 1024) {
        fail("artifact.invalid", "The requested capture is not a valid bounded image asset.");
      }
      bytes = capturedBytes;
    } else {
      bytes = await this.readOwnedArtifact(filePath, { maxBytes: 20 * 1024 * 1024 });
    }
    const cacheKey = resolve(filePath);
    const previous = this.ownedArtifactCache.get(cacheKey);
    if (previous) this.ownedArtifactCacheBytes -= previous.byteLength;
    const pinned = Buffer.from(bytes);
    this.ownedArtifactCache.delete(cacheKey);
    this.ownedArtifactCache.set(cacheKey, pinned);
    this.ownedArtifactCacheBytes += pinned.byteLength;
    while (this.ownedArtifactCache.size > 8 || this.ownedArtifactCacheBytes > 32 * 1024 * 1024) {
      const oldestKey = this.ownedArtifactCache.keys().next().value;
      const oldest = this.ownedArtifactCache.get(oldestKey);
      this.ownedArtifactCache.delete(oldestKey);
      this.ownedArtifactCacheBytes -= oldest.byteLength;
    }
    return pinned;
  }

  async requireActiveController(ticket, requestContext) {
    await this.awaitExternal(
      ticket,
      () => this.expireActiveController({ throwOnExpire: true }, ticket),
    );
    if (!this.activeController) {
      fail("controller.required", "A Gateway-managed Computer Use controller is required.");
    }
    this.assertControllerRequestContext(requestContext);
    this.renewActiveController();
  }

  assertControllerRequestContext(requestContext) {
    if (!this.activeControllerRequestContext) return;
    if (!sameRequestContext(this.activeControllerRequestContext, requestContext)) {
      fail("controller.lease_mismatch", "The active Computer Use controller belongs to another Host session.", {
        controllerId: this.activeController.controllerId,
        includeUserOverlay: false,
      });
    }
  }

  renewActiveController() {
    if (!this.activeController) return null;
    if (!Number.isFinite(this.activeController.leaseTtlMs) || this.activeController.leaseTtlMs <= 0) {
      return this.activeController;
    }
    const renewedAtMs = this.clock.now();
    const expiresAtMs = renewedAtMs + this.activeController.leaseTtlMs;
    this.activeController.expiresAtMs = expiresAtMs;
    this.activeController.expiresAt = this.clock.iso(expiresAtMs);
    return this.activeController;
  }

  async expireActiveController({ throwOnExpire = false } = {}, ticket) {
    const pending = this.pendingControlGrant;
    if (pending?.controller?.expiresAtMs && pending.controller.expiresAtMs <= this.clock.now()) {
      const error = this.invalidateControlGrant(
        "controller.expired",
        "controller.expired: The Gateway-managed Computer Use controller lease expired.",
        {
          controllerId: pending.controller.controllerId,
          expiresAt: pending.controller.expiresAt,
          includeUserOverlay: false,
        },
      );
      this.lastCapture = null;
      this.pendingUnverifiedMutation = null;
      this.unconfirmedMutationHistory = [];
      this.activeFocusReceipt = null;
      this.lastActionVisualCrop = null;
      this.lastFocusedObservationCrop = null;
      await this.awaitExternal(ticket, () => this.stopControlVisuals(ticket));
      this.recordAudit("computer.controller.expired", {
        controllerId: pending.controller.controllerId,
        tier: pending.controller.tier,
        expiresAt: pending.controller.expiresAt,
      });
      if (throwOnExpire) throw error;
      return true;
    }
    if (!this.activeController?.expiresAtMs || this.activeController.expiresAtMs > this.clock.now()) return false;
    const previous = this.activeController;
    this.activeController = null;
    this.activeControllerRequestContext = null;
    this.lastCapture = null;
    this.pendingUnverifiedMutation = null;
    this.unconfirmedMutationHistory = [];
    this.activeFocusReceipt = null;
    this.lastActionVisualCrop = null;
    this.lastFocusedObservationCrop = null;
    this.semanticElementAliases.clear();
    this.currentSemanticElements.clear();
    await this.awaitExternal(ticket, () => this.stopControlVisuals(ticket));
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

  async grantAccessController({ tier, agentId, requestContext, window, leaseTtlMs, approval, grant, ticket }) {
    const startedAtMs = this.clock.now();
    const expiresAtMs = startedAtMs + leaseTtlMs;
    const controller = {
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
    grant.controller = controller;
    try {
      await this.awaitExternal(
        ticket,
        () => this.startControlVisuals({ grant, tier, window, ticket }),
      );
      this.assertControlGrant(grant);
    } catch (error) {
      try {
        await this.stopControlVisuals();
      } catch {
        // Preserve the grant failure; cleanup has already attempted every visual stage.
      }
      throw error;
    }
    this.semanticElementAliases.clear();
    this.currentSemanticElements.clear();
    this.activeController = controller;
    this.activeControllerRequestContext = requestContext ?? null;
    this.activeFocusReceipt = null;
    this.consecutivePublicObservations = 0;
    this.lastVisualUnderstanding = null;
    this.interactionStep = 0;
    this.recordAudit("computer.access.granted", {
      controllerId: controller.controllerId,
      title: window.title,
      tier: controller.tier,
      approvalStatus: approval.status,
    });
    return {
      status: "granted",
      approval,
      controller,
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
    const element = resolveObservationElement(this.lastCapture, action)
      ?? this.resolveSemanticElementAlias(action);
    const focusReceipt = this.validateFocusReceipt(action);
    const admission = admitPerceptionAction({
      observation: this.lastCapture,
      element,
      recentEditableTarget: this.recentEditableTarget,
      action: {
        ...action,
        windowId: controllerWindowId(this.activeController.window),
        controllerId: this.activeController.controllerId,
      },
      now: this.clock.now(),
    });
    if (!admission.allowed) fail(admission.code, perceptionAdmissionMessage(admission), admission);
    return {
      admission,
      driverTarget: resolveDriverActionTarget(
        action,
        element,
        admission.pixelLimitedAction,
        this.lastCapture?.coordinateScale,
      ),
      element,
      focusReceipt,
    };
  }

  bindCurrentActionReceipts(action = {}) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return action;
    let normalized = { ...action };
    const surfaceReceipt = this.lastCapture?.surfaceReceipt;
    if (typeof normalized.observationId !== "string"
      && typeof normalized.surfaceReceiptId === "string"
      && normalized.surfaceReceiptId === surfaceReceipt?.id
      && typeof surfaceReceipt.observationId === "string") {
      normalized.observationId = surfaceReceipt.observationId;
    }
    const keyboardAction = normalized.kind === "type_text" || normalized.kind === "press_key";
    const focusReceipt = this.activeFocusReceipt;
    if (!keyboardAction
      || typeof normalized.focusReceiptId === "string"
      || !focusReceipt
      || focusReceipt.status !== "verified"
      || focusReceipt.expiresAtMs <= this.clock.now()
      || focusReceipt.controllerId !== this.activeController?.controllerId
      || focusReceipt.windowId !== controllerWindowId(this.activeController?.window)) {
      return normalized;
    }
    const suppliedTarget = describeActionTarget(normalized, null, normalized);
    const hasSuppliedTarget = isCoordinateBox(normalized.targetBounds)
      || (Number.isFinite(normalized.x) && Number.isFinite(normalized.y))
      || normalized.elementToken !== undefined
      || normalized.elementIndex !== undefined;
    if (hasSuppliedTarget && !actionTargetsOverlap(focusReceipt.target, suppliedTarget)) {
      return normalized;
    }
    normalized.focusReceiptId = focusReceipt.id;
    return normalized;
  }

  rememberSemanticElements(observation) {
    const elements = observation?.elements ?? observation?.observation?.elements ?? [];
    if (!Array.isArray(elements)) return;
    const current = new Map();
    for (const element of elements) {
      if (!isStableSemanticElement(element)) continue;
      const identity = semanticElementIdentity(element);
      const existing = current.get(identity);
      current.set(identity, existing ? null : element);
      if (typeof element.elementToken === "string" && element.elementToken.trim() !== "") {
        this.semanticElementAliases.set(element.elementToken, {
          controllerId: this.activeController?.controllerId,
          identity,
        });
      }
    }
    this.currentSemanticElements = new Map(
      [...current.entries()].filter(([, element]) => element !== null),
    );
  }

  resolveSemanticElementAlias(action = {}) {
    if (action.kind !== "click" || typeof action.elementToken !== "string") return null;
    const alias = this.semanticElementAliases.get(action.elementToken);
    if (!alias || alias.controllerId !== this.activeController?.controllerId) return null;
    return this.currentSemanticElements.get(alias.identity) ?? null;
  }

  validateFocusReceipt(action = {}) {
    if ((action.kind !== "type_text" && action.kind !== "press_key")
      || typeof action.focusReceiptId !== "string") return null;
    if (!this.activeFocusReceipt || action.focusReceiptId !== this.activeFocusReceipt.id) {
      fail(
        "focus.receipt_invalid",
        "The supplied focus receipt does not belong to the active Computer Use controller.",
        { focusVerified: false },
      );
    }
    const now = this.clock.now();
    if (this.activeFocusReceipt.expiresAtMs <= now) {
      this.activeFocusReceipt = null;
      fail(
        "focus.receipt_expired",
        "The focus receipt has expired. Observe the window and explicitly ground the next action.",
        { focusVerified: false },
      );
    }
    if (this.activeFocusReceipt.controllerId !== this.activeController?.controllerId
      || this.activeFocusReceipt.windowId !== controllerWindowId(this.activeController?.window)) {
      this.activeFocusReceipt = null;
      fail(
        "focus.receipt_invalid",
        "The focus receipt no longer matches the active controller window.",
        { focusVerified: false },
      );
    }
    const suppliedTarget = describeActionTarget(action, null, action);
    const hasSuppliedTarget = isCoordinateBox(action.targetBounds)
      || (Number.isFinite(action.x) && Number.isFinite(action.y))
      || action.elementToken !== undefined
      || action.elementIndex !== undefined;
    if (hasSuppliedTarget && !actionTargetsOverlap(this.activeFocusReceipt.target, suppliedTarget)) {
      fail(
        "focus.receipt_target_mismatch",
        "The focus receipt does not belong to the supplied keyboard target.",
        { focusVerified: false },
      );
    }
    return this.activeFocusReceipt;
  }

  createFocusReceipt({ action, element, driverTarget }) {
    const issuedAtMs = this.clock.now();
    return {
      id: randomUUID(),
      status: "verified",
      controllerId: this.activeController.controllerId,
      windowId: controllerWindowId(this.activeController.window),
      observationId: this.lastCapture?.observationId,
      target: describeActionTarget(action, element, driverTarget),
      issuedAt: this.clock.iso(issuedAtMs),
      issuedAtMs,
      expiresAt: this.clock.iso(issuedAtMs + FOCUS_RECEIPT_TTL_MS),
      expiresAtMs: issuedAtMs + FOCUS_RECEIPT_TTL_MS,
    };
  }

  reconcilePendingTextFocus(observation) {
    const pending = this.pendingUnverifiedMutation;
    this.pendingUnverifiedMutation = null;
    if (pending?.actionKind !== "type_text"
      || pending.controllerId !== this.activeController?.controllerId
      || pending.windowId !== controllerWindowId(this.activeController?.window)
      || typeof pending.value !== "string"
      || pending.value.length === 0) {
      return null;
    }

    const matchingElement = findObservedTextAtTarget(
      observation,
      pending.value,
      pending.target,
      pending.preexistingTextOccurrences,
    );
    if (!matchingElement) {
      this.rememberUnconfirmedMutation(pending);
      observation.mutationVerification = {
        status: "not-confirmed",
        actionKind: "type_text",
        replaySafe: false,
        focusReceiptIssued: false,
      };
      return null;
    }

    this.unconfirmedMutationHistory = [];
    this.activeFocusReceipt = this.createFocusReceipt({
      action: { kind: "type_text" },
      element: matchingElement,
      driverTarget: pending.target,
    });
    const serializedReceipt = serializeFocusReceipt(this.activeFocusReceipt);
    observation.focusReceipt = serializedReceipt;
    observation.mutationVerification = {
      status: "confirmed",
      actionKind: "type_text",
      method: "exact-observed-value-near-grounded-target",
      replaySafe: false,
      focusReceiptIssued: true,
      matchedElementToken: matchingElement.elementToken,
    };
    return serializedReceipt;
  }

  rememberUnconfirmedMutation(pending) {
    const cutoff = this.clock.now() - 30_000;
    this.unconfirmedMutationHistory = [
      ...this.unconfirmedMutationHistory.filter((entry) => entry.atMs >= cutoff),
      { ...pending, atMs: this.clock.now() },
    ].slice(-4);
  }

  assertNoRepeatedUnconfirmedMutation(action) {
    if (action?.kind !== "type_text" && action?.kind !== "click") return;
    const windowId = controllerWindowId(this.activeController?.window);
    const candidate = {
      actionKind: action.kind,
      controllerId: this.activeController?.controllerId,
      windowId,
      value: action.kind === "type_text" ? action.value : undefined,
      target: describeActionTarget(action, null, action),
    };
    const cutoff = this.clock.now() - 30_000;
    const matches = this.unconfirmedMutationHistory.filter((entry) => (
      entry.atMs >= cutoff
      && entry.controllerId === candidate.controllerId
      && entry.windowId === candidate.windowId
      && entry.actionKind === candidate.actionKind
      && entry.value === candidate.value
      && actionTargetsOverlap(entry.target, candidate.target)
    ));
    if (matches.length < 2) return;
    fail(
      "action.repeated_no_effect",
      "Two fresh observations could not confirm the same mutation in this target region. The Host stopped another coordinate retry because it would repeat an ineffective strategy.",
      {
        allowed: false,
        pixelLimitedAction: false,
        replaySafe: false,
        priorUnconfirmedAttempts: matches.length,
        nextAction: "Do not retry coordinates in this region. Use one target-local visual observation to identify a different interaction surface, switch to semantic targeting, or release control and report the blocker.",
      },
    );
  }

  createActionObservation(observation) {
    const now = this.clock.now();
    const ocrTextGeometry = observation.source === "ocr" || observation.mode === "ocr";
    const observationTtlMs = isImageBearingObservation(observation)
      ? VISUAL_GROUNDING_OBSERVATION_TTL_MS
      : ACTION_OBSERVATION_TTL_MS;
    const leaseExpiry = Number.isFinite(this.activeController?.expiresAtMs)
      ? this.activeController.expiresAtMs
      : Date.parse(this.activeController?.expiresAt ?? "");
    const captureBounds = observation.capture
      && Number.isFinite(observation.capture.x)
      && Number.isFinite(observation.capture.y)
      && Number.isFinite(observation.capture.width)
      && Number.isFinite(observation.capture.height)
      ? {
          x: observation.capture.x,
          y: observation.capture.y,
          width: observation.capture.width,
          height: observation.capture.height,
        }
      : undefined;
    const observedBounds = captureBounds
      ?? observation.window?.bounds
      ?? this.activeController?.window?.bounds;
    const coordinateBounds = Number.isFinite(observedBounds?.width)
      && Number.isFinite(observedBounds?.height)
      ? {
          x: 0,
          y: 0,
          width: observedBounds.width,
          height: observedBounds.height,
        }
      : undefined;
    const coordinateScale = coordinateBounds
      ? (
          observation.coordinateScale
          ?? observation.capture?.coordinateScale
          ?? createIdentityCoordinateScale(coordinateBounds)
        )
      : undefined;
    const observationId = observation.observationId ?? `observation-${now}`;
    const actionTransform = coordinateScale?.actionTransform;
    const coordinateTransform = isIdentityCoordinateTransform(actionTransform)
      ? "identity"
      : "scale-offset";
    const existingReceipt = observation.surfaceReceipt;
    const controllerId = this.activeController?.controllerId;
    const windowId = controllerWindowId(this.activeController?.window);
    const surfaceReceipt = existingReceipt?.controllerId === controllerId
      && existingReceipt?.windowId === windowId
      ? existingReceipt
      : {
          schemaVersion: 1,
          id: randomUUID(),
          generation: ++this.surfaceGeneration,
          controllerId,
          windowId,
          observationId,
          screenshotId: isImageBearingObservation(observation) ? observationId : null,
          desktopState: this.lastDesktopState?.status ?? "unknown",
          secureDesktop: this.lastDesktopState?.secureDesktop === true,
          capturedAt: this.clock.iso(now),
          provenance: observation.capture?.surfaceProvenance
            ?? observation.surfaceProvenance
            ?? {
              schemaVersion: 1,
              binding: "controller-window",
              requestedWindowId: windowId,
              identityVerified: true,
            },
        };
    return {
      ...observation,
      observationId,
      interactionStep: this.interactionStep,
      surfaceReceipt,
      coordinateSpace: "window-local",
      ...(coordinateBounds ? {
        coordinateBounds,
        coordinateTransform,
        coordinateScale,
      } : {}),
      interactionContract: {
        textEntry: {
          actionKind: "type_text",
          atomicFocus: true,
          separateFocusClick: "screenshot-grounded-focus-receipt-only",
          focusContinuation: "A verified focus-editable click may be followed by one targetless type_text or press_key using its focusReceipt without consuming another surfaceReceipt.",
          requiresExplicitTextMode: true,
          textModes: {
            insert: "Insert at the current caret without clearing existing content.",
            "replace-all": "Atomically focus the grounded editable point, select all existing content, and enter the exact value.",
          },
          coordinateRule: ocrTextGeometry
            ? "fresh-screenshot-editable-interior-required"
            : "copy-grounded-editable-interior-point",
          targetBoundsRequired: true,
          targetBoundsRule: "full editable surface rectangle from the same screenshot observation",
          executionPoint: "validated targetBounds center",
          pointSelection: "derive the full editable surface from the screenshot, then use a safe point near its visual center",
          excludedTargets: [
            "action-button row",
            "toolbar icon",
            "label or placeholder glyph",
            "border or resize affordance",
            "dialog, sheet, or other occluding overlay",
          ],
          occlusionRule: "If a dialog, sheet, or overlay covers the intended editable surface, do not type through it. Resolve or dismiss the occlusion, then capture a fresh screenshot.",
          acceptsOcrTextPoint: false,
          requiresVisualGrounding: ocrTextGeometry,
          verification: "fresh-observation",
        },
      },
      window: {
        ...(observation.window ?? {}),
        id: controllerWindowId(this.activeController?.window),
        title: this.activeController?.window?.title ?? observation.window?.title,
        bounds: observedBounds,
      },
      controllerId: this.activeController?.controllerId,
      expiresAt: Math.min(
        Number.isFinite(leaseExpiry) ? leaseExpiry : now + observationTtlMs,
        now + observationTtlMs,
      ),
      includeUserOverlay: false,
    };
  }

  async probeDesktopState(ticket) {
    if (!this.driver?.desktopState) {
      this.lastDesktopState = {
        status: "unavailable",
        inputDesktop: null,
        secureDesktop: false,
      };
      return this.lastDesktopState;
    }
    try {
      this.lastDesktopState = await this.awaitExternal(
        ticket,
        () => this.driver.desktopState(),
      );
    } catch (error) {
      this.assertOperationTicket(ticket);
      this.lastDesktopState = {
        status: "unavailable",
        inputDesktop: null,
        secureDesktop: false,
        error: serializeToolError(error),
      };
    }
    return this.lastDesktopState;
  }

  async assertDesktopInteractive(ticket, phase) {
    const desktopState = await this.probeDesktopState(ticket);
    if (desktopState.status === "locked" || desktopState.secureDesktop === true) {
      fail(
        "desktop.locked",
        "The Windows input desktop is locked or secure. Computer Use stopped before interacting.",
        {
          phase,
          terminal: true,
          retryable: false,
          requiresUserAction: "unlock",
          desktopState,
        },
      );
    }
    if (this.driver?.desktopState && desktopState.status !== "interactive") {
      fail(
        "desktop.state_unavailable",
        "The Windows input desktop could not be verified as interactive.",
        {
          phase,
          terminal: true,
          retryable: false,
          desktopState,
        },
      );
    }
    return desktopState;
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

  resolveRepairApproval({ approved, denied, approvalToken, requestApproval, approvalTtlMs, repairPlan, actionIds, allowNetwork }) {
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
      if (approved && !repairApprovalMatches(pending, { actionIds, allowNetwork })) {
        return {
          status: "invalid",
          token: approvalToken,
          reason: "approval-scope-mismatch",
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
        allowNetwork: allowNetwork === true,
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
      allowNetwork: this.pendingRepairApproval.allowNetwork,
    };
  }

  requireAssetOperationManager() {
    if (!this.assetOperationManager) throw new Error("asset.operation_manager_unavailable");
    return this.assetOperationManager;
  }

  assetOperationResult({ status, operation, approval = { status: "not_required" }, repairPlan, progressPlan, reason }) {
    const plan = repairPlan ?? { mode: "plan-only", requiresApproval: false, actions: [] };
    return {
      status,
      mode: "asset-operation",
      module: "agent-computer-use-mcp",
      approved: approval.status === "approved",
      denied: false,
      dryRun: false,
      approval,
      repairPlan: plan,
      progressPlan: progressPlan ?? { operationId: operation?.operationId ?? null, stages: [] },
      executesImmediately: status === "repair_started",
      execution: {
        status: operation?.status ?? "not_started",
        reason: reason ?? "asset-operation",
        operation,
      },
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  runOperation(operation) {
    const ticket = this.acquireOperationTicket();
    if (!ticket) return Promise.reject(lifecycleClosedError());
    let result;
    try {
      result = operation(ticket);
    } catch (error) {
      this.finishOperationTicket(ticket);
      throw error;
    }
    return Promise.resolve(result).then(
      (value) => {
        this.assertOperationTicket(ticket);
        return value;
      },
      (error) => {
        if (!this.isOperationTicketCurrent(ticket)) throw lifecycleClosedError();
        throw error;
      },
    ).finally(() => {
      this.finishOperationTicket(ticket);
    });
  }

  async awaitExternal(ticket, start, { onInvalidResult } = {}) {
    this.assertOperationTicket(ticket);
    try {
      const result = await start();
      if (!this.isOperationTicketCurrent(ticket)) {
        onInvalidResult?.(result);
        throw lifecycleClosedError();
      }
      this.assertOperationTicket(ticket);
      return result;
    } catch (error) {
      if (!this.isOperationTicketCurrent(ticket)) throw lifecycleClosedError();
      throw error;
    }
  }

  acquireOperationTicket() {
    if (this.lifecycleState !== "open") return null;
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const ticket = {
      generation: this.lifecycleGeneration,
      settled,
      settle,
    };
    this.operationTickets.add(ticket);
    return ticket;
  }

  finishOperationTicket(ticket) {
    if (!this.operationTickets.delete(ticket)) return;
    ticket.settle();
  }

  isOperationTicketCurrent(ticket) {
    return this.lifecycleState === "open"
      && ticket.generation === this.lifecycleGeneration;
  }

  assertOperationTicket(ticket) {
    if (!this.isOperationTicketCurrent(ticket)) throw lifecycleClosedError();
  }

  async waitForAdmittedOperations() {
    const admitted = [...this.operationTickets];
    await Promise.all(admitted.map((ticket) => ticket.settled));
  }

  beginControlGrant() {
    const grant = {
      generation: ++this.controlGeneration,
      controller: null,
      error: null,
    };
    this.pendingControlGrant = grant;
    return grant;
  }

  finishControlGrant(grant) {
    if (this.pendingControlGrant === grant) this.pendingControlGrant = null;
  }

  invalidateControlGrant(code, message, detail) {
    const grant = this.pendingControlGrant;
    if (!grant) return null;
    if (!grant.error) {
      this.controlGeneration += 1;
      grant.error = new ComputerUseMcpError(code, message, detail);
    }
    return grant.error;
  }

  assertControlGrant(grant) {
    if (grant.error) throw grant.error;
    if (this.pendingControlGrant !== grant || this.controlGeneration !== grant.generation) {
      throw new ComputerUseMcpError(
        "controller.cancelled",
        "The Gateway-managed Computer Use controller request is no longer current.",
      );
    }
  }

  startControlVisuals({ grant, tier, window, ticket }) {
    return this.runControlVisualLifecycle(async () => {
      this.assertControlGrant(grant);
      if (tier !== "observe" && this.driver?.startCursor) {
        this.cursorStartAttempted = true;
        await this.awaitExternal(ticket, () => this.driver.startCursor());
        this.cursorActive = true;
        this.assertControlGrant(grant);
      }
      if (this.overlayRuntime?.start) {
        const handle = await this.awaitExternal(
          ticket,
          () => this.overlayRuntime.start({ targetRect: window.bounds ? {
            windowId: window.windowId,
            title: window.title,
            x: window.bounds.x,
            y: window.bounds.y,
            width: window.bounds.width,
            height: window.bounds.height,
          } : undefined }),
          { onInvalidResult: (lateHandle) => { this.overlayHandle = lateHandle; } },
        );
        this.overlayHandle = handle;
        this.assertControlGrant(grant);
      }
    }, ticket);
  }

  async stopOverlay(ticket) {
    if (!this.overlayHandle) return;
    const handle = this.overlayHandle;
    if (this.overlayRuntime?.stop) {
      if (ticket) {
        await this.awaitExternal(ticket, () => this.overlayRuntime.stop(handle));
      } else {
        await this.overlayRuntime.stop(handle);
      }
    } else if (handle.stop) {
      if (ticket) {
        await this.awaitExternal(ticket, () => handle.stop());
      } else {
        await handle.stop();
      }
    }
    if (this.overlayHandle === handle) this.overlayHandle = null;
  }

  stopControlVisuals(ticket) {
    return this.runControlVisualLifecycle(async () => {
      let firstError;
      try {
        await this.stopOverlay(ticket);
      } catch (error) {
        if (ticket) this.assertOperationTicket(ticket);
        firstError = error;
      }
      if (this.cursorStartAttempted || this.cursorActive) {
        try {
          if (ticket) {
            await this.awaitExternal(ticket, () => this.driver?.stopCursor?.());
          } else {
            await this.driver?.stopCursor?.();
          }
          this.cursorStartAttempted = false;
          this.cursorActive = false;
        } catch (error) {
          if (ticket) this.assertOperationTicket(ticket);
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    }, ticket);
  }

  async runControlVisualLifecycle(operation, ticket) {
    const previous = this.controlVisualTail;
    let release;
    this.controlVisualTail = new Promise((resolve) => {
      release = resolve;
    });
    try {
      if (ticket) {
        await this.awaitExternal(ticket, () => previous);
      } else {
        await previous;
      }
      return await operation();
    } finally {
      release();
    }
  }
}

function pickOcrIdentity(response) {
  const identity = {};
  for (const key of ["provider", "model", "modelPack", "modelFormat", "runtime", "executionProvider"]) {
    if (typeof response?.[key] === "string" && response[key].trim() !== "") identity[key] = response[key];
  }
  if (!identity.provider) identity.provider = "xiaozhiclaw-ocr-sidecar";
  return identity;
}

function perceptionAdmissionMessage(admission) {
  if (admission?.code === "target.editable_interior_required") {
    if (admission?.requiredGrounding === "editable-surface-bounds") {
      return "Coordinate-grounded text focus requires the full editable surface rectangle and a safe central point from the same screenshot.";
    }
    return "OCR text geometry cannot safely focus a keyboard target. Ground the editable interior from a fresh screenshot before typing.";
  }
  if (admission?.code === "target.interaction_intent_required") {
    return "Pixel clicks must declare their intended UI effect before the Host can admit the action.";
  }
  if (admission?.code === "target.visual_grounding_required") {
    return "The declared click intent requires control geometry from a fresh screenshot; OCR glyph geometry is insufficient.";
  }
  return admission?.code ?? "observation.insufficient";
}

function resolveObservationElement(observation, action) {
  const elements = observation?.elements ?? observation?.observation?.elements ?? [];
  if (typeof action?.elementToken === "string") {
    return elements.find((element) => element.elementToken === action.elementToken) ?? null;
  }
  if (Number.isSafeInteger(action?.elementIndex) && action.elementIndex >= 0) return elements[action.elementIndex] ?? null;
  return null;
}

function semanticStateFingerprint(observation) {
  const elements = observation?.elements ?? observation?.observation?.elements ?? [];
  if (!Array.isArray(elements) || elements.length === 0) return null;
  return JSON.stringify(elements.map((element) => ({
    role: element?.role ?? null,
    name: element?.name ?? null,
    value: element?.value ?? null,
    state: element?.state ?? null,
    actions: Array.isArray(element?.actions) ? [...element.actions].sort() : [],
    bounds: element?.bounds ?? null,
  })));
}

function isStableSemanticElement(element) {
  return element
    && typeof element.elementToken === "string"
    && Array.isArray(element.actions)
    && element.actions.length > 0
    && element.pixelLimitedAction !== true
    && STABLE_SEMANTIC_SOURCES.has(element.source);
}

function semanticElementIdentity(element) {
  const bounds = element?.bounds;
  return JSON.stringify({
    role: element?.role ?? null,
    name: element?.name ?? null,
    actions: [...(element?.actions ?? [])].sort(),
    bounds: Number.isFinite(bounds?.x)
      && Number.isFinite(bounds?.y)
      && Number.isFinite(bounds?.width)
      && Number.isFinite(bounds?.height)
      ? [bounds.x, bounds.y, bounds.width, bounds.height]
      : null,
  });
}

function assessSemanticActionability(observation) {
  const elements = observation?.elements ?? observation?.observation?.elements ?? [];
  if (!Array.isArray(elements) || elements.length === 0) {
    return {
      sufficient: false,
      actionableElementCount: 0,
      namedActionableRatio: 0,
    };
  }
  const actionable = elements.filter((element) => Array.isArray(element?.actions) && element.actions.length > 0);
  const named = actionable.filter((element) => typeof element?.name === "string" && element.name.trim() !== "");
  const namedActionableRatio = actionable.length === 0 ? 0 : named.length / actionable.length;
  return {
    sufficient: actionable.length >= 3 && namedActionableRatio >= 0.8,
    actionableElementCount: actionable.length,
    namedActionableRatio: Number(namedActionableRatio.toFixed(3)),
  };
}

function isVerifiedTextMutation(result) {
  return result?.verified === true
    || result?.verify === "confirmed"
    || result?.effect === "verified"
    || result?.effect === "confirmed";
}

function isExplicitlyUnverified(result) {
  return result?.verified === false
    || result?.focusVerified === false
    || result?.focus?.verified === false
    || result?.verify === "unreadable"
    || result?.verify === "unverified"
    || result?.effect === "unverifiable"
    || result?.effect === "possibly_applied";
}

function hasVerifiedFocus(result) {
  return result?.focusVerified === true
    || result?.focus?.verified === true
    || (
      result?.verified === true
      && result?.foregroundWindow?.isForeground === true
    );
}

function describePossiblyAppliedTextMutation(result) {
  const { escalation: _unsafeReplayAdvice, ...details } = result ?? {};
  return {
    ...details,
    effect: "possibly_applied",
    verified: false,
    replaySafe: false,
    verificationRequired: "fresh_observation",
    nextAction: "Call computer.observe and inspect the fresh target state. Retry type_text only if the intended text is absent and the fresh screenshot proves a non-occluded editable surface. Derive the full surface and choose a safe interior point near its visual center; never infer the point from an adjacent action button or toolbar icon.",
    recovery: {
      requiresFreshObservation: true,
      sameActionReplayAllowed: false,
      requiredGrounding: "non-occluded-editable-interior",
      pointSelection: "derive-full-editable-surface-then-use-safe-interior-center",
      forbiddenInference: "adjacent-action-button-or-toolbar-icon",
    },
  };
}

function describeUnverifiedAction(result, action = {}) {
  const { escalation: _unsafeReplayAdvice, ...details } = result ?? {};
  const described = {
    ...details,
    effect: details.effect ?? "unverifiable",
    verified: false,
    replaySafe: false,
    verificationRequired: "fresh_observation",
    nextAction: "Call computer.observe and inspect the fresh target state before any further action.",
  };
  if (action.kind === "click") {
    described.recovery = {
      requiresFreshObservation: true,
      sameActionReplayAllowed: false,
      textEntry: {
        when: "The intended interaction is text entry on a custom-drawn surface.",
        useActionKind: "type_text",
        targetRequirement: "Capture a fresh screenshot, visually verify focus, and ground a point strictly inside the editable surface. Use that screenshot observationId and projected x/y in one type_text call. OCR glyph bounds and interactionPoint values cannot ground keyboard actions. Never add window.bounds.x/y to window-local coordinates.",
      },
    };
  }
  return described;
}

function describeDeliveredSemanticClick(result, verification) {
  const { escalation: _unsafeReplayAdvice, ...details } = result ?? {};
  return {
    ...details,
    effect: "delivered_unobserved",
    delivered: true,
    deliveryMethod: "semantic-accessibility-invoke",
    verified: false,
    replaySafe: false,
    completionEligible: false,
    verificationRequired: "later_observable_boundary",
    nextAction: "Do not replay this click. Continue with the next distinct planned action when the workflow has one, then verify the next stable observable state before claiming completion.",
    ...(verification ? { verification } : {}),
  };
}

function isTargetlessKeyboardAction(action = {}) {
  return (action.kind === "type_text" || action.kind === "press_key")
    && action.elementToken === undefined
    && action.elementIndex === undefined
    && !(Number.isFinite(action.x) && Number.isFinite(action.y));
}

function isImageBearingObservation(observation = {}) {
  return (typeof observation.artifact?.mimeType === "string"
      && observation.artifact.mimeType.startsWith("image/"))
    || observation.source === "window-capture"
    || observation.source === "cua-driver-window-state";
}

function normalizeActionCoordinates(action = {}, observation, window) {
  const boundsGroundedTextAction = action.kind === "type_text"
    && isCoordinateBox(action.targetBounds)
    && !Number.isFinite(action.x)
    && !Number.isFinite(action.y);
  const actionWithSafePoint = boundsGroundedTextAction
    ? {
        ...action,
        x: action.targetBounds.x + (action.targetBounds.width / 2),
        y: action.targetBounds.y + (action.targetBounds.height / 2),
        coordinateSpace: action.coordinateSpace ?? observation?.coordinateSpace ?? "window-local",
        derivedInteractionPoint: "target-bounds-center",
      }
    : action;
  const hasX = Number.isFinite(actionWithSafePoint.x);
  const hasY = Number.isFinite(actionWithSafePoint.y);
  if (!hasX && !hasY) return action;
  if (!hasX || !hasY) {
    fail(
      "action.coordinates_incomplete",
      "Coordinate actions require both x and y.",
      { coordinateSpace: actionWithSafePoint.coordinateSpace ?? null },
    );
  }
  if (actionWithSafePoint.coordinateSpace !== "window-local"
    && actionWithSafePoint.coordinateSpace !== "screen") {
    fail(
      "action.coordinate_space_required",
      "Coordinate actions must explicitly declare coordinateSpace as window-local or screen.",
      {
        allowedCoordinateSpaces: ["window-local", "screen"],
        observationId: observation?.observationId ?? null,
      },
    );
  }
  if (actionWithSafePoint.coordinateSpace === "window-local") return actionWithSafePoint;
  const bounds = observation?.window?.bounds ?? window?.bounds;
  if (!Number.isFinite(bounds?.x) || !Number.isFinite(bounds?.y)) {
    fail(
      "action.screen_coordinates_unavailable",
      "Screen coordinates cannot be translated because the observed window origin is unavailable.",
      { observationId: observation?.observationId ?? null },
    );
  }
  return {
    ...actionWithSafePoint,
    x: actionWithSafePoint.x - bounds.x,
    y: actionWithSafePoint.y - bounds.y,
    ...(isCoordinateBox(actionWithSafePoint.targetBounds) ? {
      targetBounds: {
        ...actionWithSafePoint.targetBounds,
        x: actionWithSafePoint.targetBounds.x - bounds.x,
        y: actionWithSafePoint.targetBounds.y - bounds.y,
      },
    } : {}),
    coordinateSpace: "window-local",
    suppliedCoordinateSpace: "screen",
  };
}

function isIdentityCoordinateTransform(transform) {
  return !transform || (
    transform.scaleX === 1
    && transform.scaleY === 1
    && (transform.offsetX ?? 0) === 0
    && (transform.offsetY ?? 0) === 0
  );
}

function isVisuallyImmaterialDirtyRegion(region, bounds) {
  if (!isCoordinateBox(region) || !isCoordinateBox(bounds)) return false;
  const frameArea = bounds.width * bounds.height;
  const hasChangedPixelCount = Number.isFinite(region.changedPixels) && region.changedPixels > 0;
  const changedArea = hasChangedPixelCount ? region.changedPixels : region.width * region.height;
  if (frameArea <= 0 || changedArea <= 0) return false;
  return changedArea / frameArea <= (hasChangedPixelCount ? 0.001 : 0.005);
}

function isNonSemanticSparseDirtyRegion({
  dirtyRegion,
  visualBounds,
  ocrRegion,
  previousElements,
  currentElements,
}) {
  if (!isCoordinateBox(dirtyRegion) || !isCoordinateBox(visualBounds)) return false;
  if (!Array.isArray(previousElements) || !Array.isArray(currentElements)) return false;
  const frameArea = visualBounds.width * visualBounds.height;
  const changedPixels = Number.isFinite(dirtyRegion.changedPixels) ? dirtyRegion.changedPixels : 0;
  if (frameArea <= 0 || changedPixels <= 0 || changedPixels / frameArea > 0.01) return false;
  const comparisonRegion = isCoordinateBox(ocrRegion) ? ocrRegion : dirtyRegion;
  return ocrElementFingerprint(previousElements, comparisonRegion)
    === ocrElementFingerprint(currentElements, comparisonRegion);
}

function mergeOcrElementSnapshots(previousElements, currentElements, replacedRegion) {
  if (!isCoordinateBox(replacedRegion)) return currentElements.map(cloneOcrElementSnapshot);
  return [
    ...previousElements
      .filter((element) => !boxesIntersect(element?.bounds, replacedRegion))
      .map(cloneOcrElementSnapshot),
    ...currentElements.map(cloneOcrElementSnapshot),
  ];
}

function mergePostActionOcrElementSnapshots({
  previousElements,
  primaryElements,
  primaryRegion,
  secondaryElements,
  secondaryRegion,
}) {
  const primaryMerged = mergeOcrElementSnapshots(
    previousElements,
    primaryElements,
    primaryRegion,
  );
  return isCoordinateBox(secondaryRegion)
    ? mergeOcrElementSnapshots(primaryMerged, secondaryElements, secondaryRegion)
    : primaryMerged;
}

function mergeLocalOcrObservations(primary, secondary) {
  const primaryElements = Array.isArray(primary?.elements) ? primary.elements : [];
  const secondaryElements = Array.isArray(secondary?.elements) ? secondary.elements : [];
  const text = [primary?.text, secondary?.text]
    .filter((entry) => typeof entry === "string" && entry.trim() !== "")
    .join("\n");
  return {
    ...primary,
    elements: [...primaryElements, ...secondaryElements],
    elementCount: primaryElements.length + secondaryElements.length,
    ...(text ? { text } : {}),
  };
}

function regionsMateriallyOverlap(left, right) {
  if (!isCoordinateBox(left) || !isCoordinateBox(right)) return false;
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 && intersectionArea / smallerArea >= 0.6;
}

export function selectSecondaryOcrRegion({
  effectHintRegion,
  dirtyRegion,
  visualBounds,
}) {
  return normalizeObservationCrop(effectHintRegion, visualBounds)
    ?? (dirtyRegion ? expandRegionToBucket(dirtyRegion) : null);
}

function cloneOcrElementSnapshot(element) {
  if (!element || typeof element !== "object") return element;
  return {
    ...(typeof element.name === "string" ? { name: element.name } : {}),
    ...(isCoordinateBox(element.bounds) ? { bounds: { ...element.bounds } } : {}),
  };
}

function ocrElementFingerprint(elements, region) {
  return elements
    .filter((element) => !isCoordinateBox(region) || boxesIntersect(element?.bounds, region))
    .map((element) => (
      typeof element?.name === "string"
        ? normalizeRecognizedUiText(element.name, { languageClass: "mixed" })
        : ""
    ))
    .filter(Boolean)
    .sort()
    .join("\u001f");
}

function boxesIntersect(left, right) {
  if (!isCoordinateBox(left) || !isCoordinateBox(right)) return false;
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

/**
 * Bind an indeterminate pixel action's automatic verification to the area that
 * could have changed because of that action. A global changed-region detector
 * can otherwise select an unrelated animation or incoming chat message and
 * make the Agent believe a correctly delivered click missed its target.
 */
export function planPostActionObservationCrop(action, observation) {
  const bounds = isCoordinateBox(observation?.coordinateBounds)
    ? observation.coordinateBounds
    : Number.isFinite(observation?.capture?.width) && Number.isFinite(observation?.capture?.height)
      ? { x: 0, y: 0, width: observation.capture.width, height: observation.capture.height }
      : null;
  if (!bounds) return null;
  const target = isCoordinateBox(action?.targetBounds)
    ? action.targetBounds
    : Number.isFinite(action?.x) && Number.isFinite(action?.y)
      ? { x: action.x, y: action.y, width: 1, height: 1 }
      : null;
  if (!target) return null;

  const isTextEntry = action?.kind === "type_text";
  const width = Math.min(
    bounds.width,
    Math.max(
      384,
      Math.min(640, Math.ceil(target.width + (isTextEntry ? 96 : 320))),
    ),
  );
  const height = Math.min(
    bounds.height,
    Math.max(
      isTextEntry ? 192 : 360,
      Math.min(isTextEntry ? 288 : 480, Math.ceil(target.height + (isTextEntry ? 160 : 320))),
    ),
  );
  const centerX = target.x + (target.width / 2);
  const centerY = target.y + (target.height / 2);
  const x = Math.min(
    bounds.x + bounds.width - width,
    Math.max(bounds.x, Math.floor(centerX - (width / 2))),
  );
  const y = Math.min(
    bounds.y + bounds.height - height,
    Math.max(bounds.y, Math.floor(centerY - (height / 2))),
  );
  return { x, y, width, height };
}

/**
 * A selection often updates a sibling pane rather than the pixels that were
 * clicked. When no dirty region exists because the item was already selected,
 * observe the largest complementary rectangle as a bounded effect hint. This
 * uses only the declared interaction intent and screenshot geometry.
 */
export function planPostActionEffectRegion(action, observation) {
  if (action?.interactionIntent !== "select-item") return null;
  const bounds = isCoordinateBox(observation?.coordinateBounds)
    ? observation.coordinateBounds
    : Number.isFinite(observation?.capture?.width) && Number.isFinite(observation?.capture?.height)
      ? { x: 0, y: 0, width: observation.capture.width, height: observation.capture.height }
      : null;
  const target = isCoordinateBox(action?.targetBounds)
    ? action.targetBounds
    : Number.isFinite(action?.x) && Number.isFinite(action?.y)
      ? { x: action.x, y: action.y, width: 1, height: 1 }
      : null;
  if (!bounds || !target) return null;

  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const targetRight = Math.min(boundsRight, Math.max(bounds.x, target.x + target.width));
  const targetBottom = Math.min(boundsBottom, Math.max(bounds.y, target.y + target.height));
  const targetLeft = Math.min(boundsRight, Math.max(bounds.x, target.x));
  const targetTop = Math.min(boundsBottom, Math.max(bounds.y, target.y));
  const candidates = [
    { x: targetRight, y: bounds.y, width: boundsRight - targetRight, height: bounds.height },
    { x: bounds.x, y: bounds.y, width: targetLeft - bounds.x, height: bounds.height },
    { x: bounds.x, y: targetBottom, width: bounds.width, height: boundsBottom - targetBottom },
    { x: bounds.x, y: bounds.y, width: bounds.width, height: targetTop - bounds.y },
  ].filter((region) => region.width >= 192 && region.height >= 128);
  candidates.sort((left, right) => (
    (right.width * right.height) - (left.width * left.height)
  ));
  return candidates[0] ?? null;
}

function normalizeObservationCrop(crop, bounds) {
  if (crop === undefined || crop === null) return null;
  if (!isCoordinateBox(crop) || !isCoordinateBox(bounds)) {
    fail("capture.crop_invalid", "The observation crop must be a positive window-local rectangle.");
  }
  const normalized = {
    x: Math.floor(crop.x),
    y: Math.floor(crop.y),
    width: Math.ceil(crop.width),
    height: Math.ceil(crop.height),
  };
  const left = Math.max(bounds.x, normalized.x);
  const top = Math.max(bounds.y, normalized.y);
  const right = Math.min(bounds.x + bounds.width, normalized.x + normalized.width);
  const bottom = Math.min(bounds.y + bounds.height, normalized.y + normalized.height);
  if (right <= left || bottom <= top) return { ...bounds };
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function expandVisualContextRegion(region, bounds) {
  if (!isCoordinateBox(region) || !isCoordinateBox(bounds)) return region;
  const width = Math.min(bounds.width, Math.max(320, region.width));
  const height = Math.min(bounds.height, Math.max(256, region.height));
  const centerX = region.x + (region.width / 2);
  const centerY = region.y + (region.height / 2);
  return {
    x: Math.min(
      bounds.x + bounds.width - width,
      Math.max(bounds.x, Math.floor(centerX - (width / 2))),
    ),
    y: Math.min(
      bounds.y + bounds.height - height,
      Math.max(bounds.y, Math.floor(centerY - (height / 2))),
    ),
    width,
    height,
  };
}

function describeObservationCropAdjustment(supplied, used, bounds) {
  if (!isCoordinateBox(supplied) || !isCoordinateBox(used) || !isCoordinateBox(bounds)) return null;
  if (
    supplied.x === used.x
    && supplied.y === used.y
    && supplied.width === used.width
    && supplied.height === used.height
  ) return null;
  const intersects = supplied.x < bounds.x + bounds.width
    && supplied.x + supplied.width > bounds.x
    && supplied.y < bounds.y + bounds.height
    && supplied.y + supplied.height > bounds.y;
  return {
    status: intersects ? "clamped" : "fallback-full-window",
    reason: "supplied-crop-exceeded-window-local-bounds",
    supplied: {
      x: Math.floor(supplied.x),
      y: Math.floor(supplied.y),
      width: Math.ceil(supplied.width),
      height: Math.ceil(supplied.height),
    },
    used,
  };
}

function resolveEffectiveDeliveryMode(action, admission, focusReceipt) {
  if (action.kind === "activate_window") return "foreground";
  if (action.deliveryMode) return action.deliveryMode;
  if (admission.pixelLimitedAction || focusReceipt) return "foreground";
  return "background";
}

function resolveDriverActionTarget(action, element, pixelLimitedAction, coordinateScale) {
  if (!pixelLimitedAction) {
    if (action.elementToken === undefined && action.elementIndex === undefined) return {};
    return {
      elementToken: element?.elementToken ?? action.elementToken,
      elementIndex: action.elementIndex === undefined
        ? undefined
        : (element?.elementIndex ?? action.elementIndex),
    };
  }
  if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
    const observationPoint = shouldUseTargetBoundsCenter(action)
      ? {
          x: action.targetBounds.x + (action.targetBounds.width / 2),
          y: action.targetBounds.y + (action.targetBounds.height / 2),
        }
      : { x: action.x, y: action.y };
    return transformObservationPoint(
      observationPoint,
      coordinateScale?.actionTransform,
    );
  }
  const region = element?.sourceRegion ?? element?.bounds;
  if (!region) return {};
  return transformObservationPoint({
    x: region.x + (region.width / 2),
    y: region.y + (region.height / 2),
  }, coordinateScale?.actionTransform);
}

function shouldUseTargetBoundsCenter(action) {
  return isCoordinateBox(action.targetBounds)
    && (
      action.kind === "type_text"
      || action.kind === "click"
    );
}

function isCoordinateBox(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && value.width > 0
    && Number.isFinite(value.height)
    && value.height > 0;
}

function transformObservationPoint(point, transform) {
  if (!transform || isIdentityCoordinateTransform(transform)) return point;
  return {
    x: (point.x * transform.scaleX) + (transform.offsetX ?? 0),
    y: (point.y * transform.scaleY) + (transform.offsetY ?? 0),
    observationPoint: point,
    appliedCoordinateTransform: {
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      offsetX: transform.offsetX ?? 0,
      offsetY: transform.offsetY ?? 0,
    },
  };
}

function describeActionTarget(action, element, driverTarget) {
  const target = { kind: action.kind };
  if (typeof action.elementToken === "string") target.elementToken = action.elementToken;
  if (Number.isSafeInteger(action.elementIndex)) target.elementIndex = action.elementIndex;
  if (Number.isFinite(driverTarget?.x) && Number.isFinite(driverTarget?.y)) {
    target.x = driverTarget.x;
    target.y = driverTarget.y;
  }
  const bounds = action?.targetBounds ?? element?.sourceRegion ?? element?.bounds;
  if (bounds) target.bounds = { ...bounds };
  return target;
}

function actionTargetsOverlap(left, right) {
  if (left?.elementToken && right?.elementToken) {
    return left.elementToken === right.elementToken;
  }
  const leftBounds = isCoordinateBox(left?.bounds) ? left.bounds : null;
  const rightBounds = isCoordinateBox(right?.bounds) ? right.bounds : null;
  if (leftBounds && rightBounds) {
    const intersectionWidth = Math.max(
      0,
      Math.min(leftBounds.x + leftBounds.width, rightBounds.x + rightBounds.width)
        - Math.max(leftBounds.x, rightBounds.x),
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(leftBounds.y + leftBounds.height, rightBounds.y + rightBounds.height)
        - Math.max(leftBounds.y, rightBounds.y),
    );
    const intersectionArea = intersectionWidth * intersectionHeight;
    const smallerArea = Math.min(
      leftBounds.width * leftBounds.height,
      rightBounds.width * rightBounds.height,
    );
    if (smallerArea > 0 && intersectionArea / smallerArea >= 0.5) return true;
  }
  if (
    Number.isFinite(left?.x)
    && Number.isFinite(left?.y)
    && Number.isFinite(right?.x)
    && Number.isFinite(right?.y)
  ) {
    return Math.hypot(left.x - right.x, left.y - right.y) <= 64;
  }
  return false;
}

function findObservedTextAtTarget(
  observation,
  intendedValue,
  target,
  preexistingOccurrences = [],
) {
  const intendedText = normalizeRecognizedUiText(intendedValue, { languageClass: "mixed" });
  if (!intendedText || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return null;
  const elements = observation?.elements ?? observation?.observation?.elements ?? [];
  if (!Array.isArray(elements)) return null;
  const width = Number(observation?.coordinateBounds?.width ?? observation?.window?.bounds?.width);
  const height = Number(observation?.coordinateBounds?.height ?? observation?.window?.bounds?.height);
  const horizontalTolerance = Number.isFinite(width) ? Math.max(96, width * 0.22) : 176;
  const verticalTolerance = Number.isFinite(height) ? Math.max(96, height * 0.16) : 112;

  return collectObservedTextElements(observation, intendedText)
    .filter((element) => {
      const bounds = observedElementBounds(element);
      return !preexistingOccurrences.some((occurrence) => (
        sameObservedTextOccurrence(bounds, occurrence)
      ));
    })
    .map((element) => {
      const bounds = observedElementBounds(element);
      const nearestX = Math.max(bounds.x, Math.min(target.x, bounds.x + bounds.width));
      const nearestY = Math.max(bounds.y, Math.min(target.y, bounds.y + bounds.height));
      return {
        element,
        dx: Math.abs(target.x - nearestX),
        dy: Math.abs(target.y - nearestY),
      };
    })
    .filter((candidate) => (
      candidate.dx <= horizontalTolerance
      && candidate.dy <= verticalTolerance
    ))
    .sort((left, right) => (
      Math.hypot(left.dx, left.dy) - Math.hypot(right.dx, right.dy)
    ))[0]?.element ?? null;
}

function collectObservedTextOccurrences(observation, intendedValue) {
  const intendedText = normalizeRecognizedUiText(intendedValue, { languageClass: "mixed" });
  if (!intendedText) return [];
  return collectObservedTextElements(observation, intendedText)
    .map(observedElementBounds)
    .filter(Boolean);
}

function collectObservedTextElements(observation, intendedText) {
  const elements = observation?.elements ?? observation?.observation?.elements ?? [];
  if (!Array.isArray(elements)) return [];
  return elements.filter((element) => {
    const observedValue = typeof element?.value === "string"
      ? element.value
      : typeof element?.name === "string"
        ? element.name
        : "";
    if (normalizeRecognizedUiText(observedValue, { languageClass: "mixed" }) !== intendedText) {
      return false;
    }
    return observedElementBounds(element) !== null;
  });
}

function observedElementBounds(element) {
  const bounds = element?.sourceRegion ?? element?.bounds;
  if (!Number.isFinite(bounds?.x) || !Number.isFinite(bounds?.y)
    || !Number.isFinite(bounds?.width) || !Number.isFinite(bounds?.height)) {
    return null;
  }
  return bounds;
}

function sameObservedTextOccurrence(left, right) {
  if (!left || !right) return false;
  const leftCenterX = left.x + (left.width / 2);
  const leftCenterY = left.y + (left.height / 2);
  const rightCenterX = right.x + (right.width / 2);
  const rightCenterY = right.y + (right.height / 2);
  return Math.abs(leftCenterX - rightCenterX) <= 12
    && Math.abs(leftCenterY - rightCenterY) <= 12
    && Math.abs(left.width - right.width) <= 24
    && Math.abs(left.height - right.height) <= 16;
}

function describeActionExecution({
  action,
  element,
  focusReceipt,
  result,
  effectiveDeliveryMode,
}) {
  const resultPath = typeof result?.path === "string" && result.path.trim()
    ? result.path.trim()
    : null;
  const nativeActivationFallback = result?.driverActivation
    && typeof result.driverActivation === "object";
  const declaredFallbackReason = typeof result?.fallbackReason === "string"
    && result.fallbackReason.trim()
    ? result.fallbackReason.trim()
    : null;
  const fallbackReason = declaredFallbackReason
    ?? (nativeActivationFallback ? "cua-driver-foreground-not-confirmed" : null);
  const providerPath = nativeActivationFallback
    ? "windows-foreground-bridge"
    : (resultPath ?? "cua-driver-mcp");

  let targetPath = "controller-window";
  if (focusReceipt) targetPath = "focus-receipt";
  else if (element) targetPath = "semantic-element";
  else if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
    targetPath = "observation-coordinate";
  }

  return {
    schemaVersion: 1,
    targetPath,
    providerPath,
    deliveryMode: effectiveDeliveryMode,
    selectionReason: providerPath.includes("windows_unicode")
      ? "unicode-coordinate-input"
      : null,
    fallback: {
      used: fallbackReason !== null,
      reason: fallbackReason,
    },
  };
}

function createIdentityCoordinateScale(bounds) {
  return {
    schemaVersion: 1,
    sourceSpace: "window-local",
    actionSpace: "window-local",
    actionTransform: {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    },
    observationPixels: {
      width: bounds.width,
      height: bounds.height,
    },
    nativeWindowUnits: {
      width: bounds.width,
      height: bounds.height,
    },
    nativeToObservation: {
      scaleX: 1,
      scaleY: 1,
    },
  };
}

function serializeFocusReceipt(receipt) {
  return {
    id: receipt.id,
    status: receipt.status,
    controllerId: receipt.controllerId,
    windowId: receipt.windowId,
    observationId: receipt.observationId,
    target: receipt.target,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    expiresAtMs: receipt.expiresAtMs,
  };
}

function controllerWindowId(window = {}) {
  return String(window.id ?? window.windowId ?? window.window_id ?? window.title ?? "unknown-window");
}

function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function lifecycleClosedError() {
  return new ComputerUseMcpError(
    "lifecycle.closed",
    "lifecycle.closed: The computer use provider is closing or closed.",
    { includeUserOverlay: false },
  );
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

function repairApprovalMatches(pending, requested) {
  const approvedActions = [...new Set(pending.actionIds ?? [])].sort();
  const requestedActions = [...new Set(requested.actionIds ?? [])].sort();
  return pending.allowNetwork === (requested.allowNetwork === true)
    && approvedActions.length === requestedActions.length
    && approvedActions.every((actionId, index) => actionId === requestedActions[index]);
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
    return "Action requires elementToken/elementIndex or observation-grounded x/y coordinates.";
  }
  if (decision.code === "action.observation_required") {
    return "Coordinate actions require the exact latest observationId.";
  }
  if (decision.code === "action.value_required") {
    return "set_value and type_text require a string value.";
  }
  if (decision.code === "action.text_mode_required") {
    return "type_text requires textMode insert or replace-all.";
  }
  if (decision.code === "action.input_behavior_unsupported") {
    return "type_text inputBehavior must be incremental or commit.";
  }
  if (decision.code === "action.replace_all_requires_pixel_target") {
    return "type_text replace-all requires screenshot-grounded x/y. Use set_value for a semantic editable element.";
  }
  if (decision.code === "action.key_required") {
    return "press_key requires a key.";
  }
  if (decision.code === "delivery_mode.unsupported") {
    return "Unsupported delivery mode.";
  }
  return decision.code;
}
