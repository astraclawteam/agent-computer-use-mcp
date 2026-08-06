#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_RESULT_SCHEMA_VERSION } from "./computer-use-mcp-tools.mjs";
import {
  assertToolOnSurface,
  HOST_TOOL_SURFACE,
  listToolsForSurface,
  resolveToolSurface,
} from "./computer-use-tool-surface.mjs";
import { ComputerUseMcpError, serializeToolError } from "./computer-use-errors.mjs";
import { getComputerUseInstallation } from "./computer-use-installation.mjs";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";
import { CuaDriverMcpDriver } from "./cua-driver-mcp-driver.mjs";
import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { createPlatformOcrEnvironment, OcrSidecarSession } from "./ocr-sidecar.mjs";
import {
  sendWindowsUnicodeText,
} from "./windows-unicode-input.mjs";
import { verifyWindowsFocusedProcess } from "./windows-focus-verification.mjs";
import { DeterministicMessagingStateMachine } from "./deterministic-messaging-state-machine.mjs";
import { cancelPendingTasks, runGenericTaskHostContract } from "./generic-task-host-contract.mjs";

const PENDING_MESSAGING_SELECTION_TTL_MS = 60_000;
const PENDING_MESSAGING_REPLAY_FENCE_TTL_MS = 120_000;
const EMPTY_ACQUISITION_DISCOVERY_RETRY_MS = 250;
const pendingMessagingSelections = new Map();
const pendingMessagingReplayFences = new Map();

export async function runComputerUseMcpServer(options = {}) {
  // Resolved once, before any transport exists, from launch arguments the Host
  // owns. Nothing the Agent sends can widen the surface afterwards.
  const { surface: toolSurface } = options.toolSurface
    ? { surface: options.toolSurface }
    : resolveToolSurface({ argv: options.argv, env: options.env });

  const router = new ComputerUseProviderRouter({
    ocrSession: createPlatformOcrSession(options.platformRuntime),
    driver: new CuaDriverMcpDriver({
      driverPath: options.platformRuntime?.paths?.cuaDriverExecutable,
      unicodeInput: sendWindowsUnicodeText,
      focusVerifier: verifyWindowsFocusedProcess,
    }),
    overlayRuntime: {
      start: (args) => startGatewayManagedOverlay({
        ...args,
        executablePath: options.platformRuntime?.paths?.overlayExecutable,
      }),
      stop: (handle) => {
        handle?.stop?.();
        stopGatewayManagedOverlay();
      },
    },
    // Escape is a stop, not a pause: a task left pending would resume on the
    // next step and take the desktop straight back.
    onOperatorStop: () => cancelPendingTasks(),
  });

  const server = new Server(
    {
      name: "agent-computer-use-mcp",
      version: "0.0.28",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolsForSurface(toolSurface),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    return callTool(
      router,
      name,
      args,
      request.params._meta?.["xiaozhiclaw/requestContext"],
      { signal: extra.signal, toolSurface },
    );
  });

  let unregisterShutdownHandlers = () => {};
  const shutdown = createServerShutdown({
    router,
    server,
    cleanup: () => unregisterShutdownHandlers(),
  });
  unregisterShutdownHandlers = registerServerShutdownHandlers({ shutdown });
  await server.connect(new StdioServerTransport());
}

export const main = runComputerUseMcpServer;

export function createPlatformOcrSession(platformRuntime, options = {}) {
  const Session = options.Session ?? OcrSidecarSession;
  const paths = platformRuntime?.paths;
  if (!paths?.ocrModelRoot || !paths?.ocrRuntimeRoot) return new Session();
  const processOptions = platformRuntime?.ocrProcess
    ? {
        node: {
          command: platformRuntime.ocrProcess.command,
          args: platformRuntime.ocrProcess.args ?? [],
          label: "sea",
        },
        sidecarPath: platformRuntime.ocrProcess.sidecarPath,
      }
    : {};
  return new Session({
    ...processOptions,
    environment: createPlatformOcrEnvironment({
      modelRoot: paths.ocrModelRoot,
      runtimeRoot: paths.ocrRuntimeRoot,
      baseEnvironment: options.baseEnvironment ?? process.env,
      networkDisabled: true,
      platform: options.platform ?? process.platform,
    }),
  });
}

/// How long the on-screen indicator outlives the last desktop-touching call.
/// Long enough to cover a model thinking between steps, short enough that an
/// abandoned session hands the desktop back on its own.
const CONTROL_INDICATOR_IDLE_MS = 90_000;

/// What a failed call gets instead. Long enough that a model retrying straight
/// away does not make the indicator blink, short enough that a desktop nobody
/// is driving any more is handed back rather than left announcing a session
/// that has stopped.
const CONTROL_INDICATOR_FAILURE_GRACE_MS = 8_000;

/// Only the tools that actually take the desktop. A health check or an
/// installation lookup has nothing to announce, and computer.release is the
/// operator getting their machine back, so it takes the indicator with it.
const DESKTOP_CONTROL_TOOLS = new Set([
  "computer.acquire",
  "computer.observe",
  "computer.act",
  "computer.task",
  "computer.message",
]);

async function holdControlIndicatorForTool(router, name, requestContext) {
  try {
    if (DESKTOP_CONTROL_TOOLS.has(name)) {
      await router?.setControlIndicatorHold?.({
        id: requestContext?.sessionId ?? requestContext?.agentId ?? "session",
        expiresAt: Date.now() + CONTROL_INDICATOR_IDLE_MS,
      });
    } else if (name === "computer.release") {
      await router?.releaseControlIndicator?.();
    }
  } catch {
    // Advisory only: never fail a tool call over what the desktop displays.
  }
}

/// A step that ended badly gets a short grace window instead of the full idle
/// one. Holding the desktop indicator up for a minute and a half after a
/// failure tells the person at the desk that something is still driving their
/// machine when nothing is.
async function easeControlIndicatorAfterFailure(router, name, structuredContent, { threw = false } = {}) {
  if (!DESKTOP_CONTROL_TOOLS.has(name)) return;
  const failed = threw
    || structuredContent?.status === "error"
    || structuredContent?.outcome === "indeterminate"
    || structuredContent?.phase === "failed"
    || structuredContent?.phase === "cancelled";
  if (!failed) return;
  try {
    await router?.setControlIndicatorHold?.(
      { id: "failed-step", expiresAt: Date.now() + CONTROL_INDICATOR_FAILURE_GRACE_MS },
      { allowShorten: true },
    );
  } catch {
    // Advisory only.
  }
}

export async function callTool(router, name, args, requestContext, options = {}) {
  if (name === "computer.act") args = normalizeComputerActArgs(args);
  let structuredContent;
  try {
    // An unlisted tool must also be uncallable, otherwise the Agent can invoke a
    // host-only name it already knows. Off-surface and unknown are the same error.
    assertToolOnSurface(options.toolSurface ?? HOST_TOOL_SURFACE, name);
    // The indicator belongs to the stretch of work, not to one tool call. A
    // model that switches tools mid-goal - message, then task, then act - was
    // making it blink once per switch, which reads as the Host losing its grip
    // rather than as the deliberate per-step release it is.
    await holdControlIndicatorForTool(router, name, requestContext);
    if (name === "computer.health") {
      structuredContent = await router.health(args);
    } else if (name === "computer.doctor") {
      structuredContent = await router.doctor(args);
    } else if (name === "computer.repair") {
      structuredContent = await router.repair(args);
    } else if (name === "computer.installation") {
      structuredContent = getComputerUseInstallation({
        client: args.client ?? "codex",
        packageRoot: process.cwd(),
      });
    } else if (name === "computer.acquire") {
      structuredContent = await acquireComputer(router, args, requestContext);
    } else if (name === "computer.task") {
      structuredContent = await runGenericTaskTool(router, args, requestContext, options);
    } else if (name === "computer.message") {
      structuredContent = await runDeterministicMessagingTool(router, args, requestContext, options);
    } else if (name === "computer.observe") {
      structuredContent = await observeComputer(router, args, requestContext);
    } else if (name === "computer.act") {
      structuredContent = await router.act({ ...args, requestContext });
    } else if (name === "computer.release") {
      structuredContent = await router.cancel({ ...args, requestContext });
    } else {
      throw new Error(`tool_not_found: ${name}`);
    }
    await easeControlIndicatorAfterFailure(router, name, structuredContent);
  } catch (error) {
    // A throw means nothing is in flight any more. Whatever the caller does
    // next, it will announce itself; the desktop should not keep claiming a
    // session that just ended.
    await easeControlIndicatorAfterFailure(router, name, null, { threw: true });
    const toolError = serializeToolError(error);
    if (name === "computer.observe" && toolError?.code === "observation.step_budget_exhausted") {
      const blocked = withResultContract({
        status: "blocked",
        provider: "gateway-managed",
        source: "observation-step-budget",
        outcome: "blocked",
        executionControl: {
          status: "blocked",
          scope: "interaction-step",
          retryable: false,
          allowedNextTools: ["computer.act", "computer.release"],
          reason: toolError.code,
          observationCount: toolError.detail?.observationCount,
          observationLimit: toolError.detail?.observationLimit,
          nextAction: toolError.message,
        },
      });
      return {
        content: [{ type: "text", text: renderComputerUseTextResult(blocked) }],
        structuredContent: blocked,
        isError: false,
      };
    }
    if (isSafeContractRejection(name, toolError)) {
      const rejected = withResultContract({
        status: name === "computer.act" ? "not-applied" : "blocked",
        provider: "gateway-managed",
        ...(name === "computer.act" ? { action: args?.action?.kind ?? "unknown" } : {}),
        result: name === "computer.act"
          ? {
              outcome: "not-applied",
              applied: false,
              mayHaveSideEffects: false,
              postconditionVerified: false,
              nextAction: toolError.detail?.nextAction ?? null,
            }
          : {
              effect: "not-applied",
              replaySafe: toolError.detail?.replaySafe ?? true,
              nextAction: toolError.detail?.nextAction ?? null,
            },
        pixelLimitedAction: false,
        outcome: name === "computer.act" ? "not-applied" : "blocked",
        effectiveDeliveryMode: "none",
        execution: {
          schemaVersion: 1,
          targetPath: "rejected-precondition",
          providerPath: "host-contract",
          deliveryMode: "none",
          fallback: { used: false, reason: null },
        },
        error: toolError,
      });
      return {
        content: [{ type: "text", text: renderComputerUseTextResult(rejected) }],
        structuredContent: rejected,
        isError: false,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: renderComputerUseTextResult({ error: toolError }),
        },
      ],
      structuredContent: withResultContract({
        status: "error",
        error: toolError,
      }),
      isError: true,
    };
  }

  if (name === "computer.act") structuredContent = normalizePublicComputerActResult(structuredContent);
  let projected;
  try {
    projected = await projectComputerUseMediaResult(router, name, args, structuredContent);
  } catch (error) {
    const toolError = serializeToolError(error);
    return {
      content: [{ type: "text", text: renderComputerUseTextResult({ error: toolError }) }],
      structuredContent: withResultContract({ status: "error", error: toolError }),
      isError: true,
    };
  }
  const compactedStructuredContent = compactComputerUseResult(projected.structuredContent);
  structuredContent = withResultContract(
    stripLegacyObservationAuthorities(compactedStructuredContent),
  );
  const visualUnderstandingEligible = structuredContent?.perceptionRouting?.visualUnderstandingEligible !== false;
  const visualInstruction = typeof args?.visualQuestion === "string" && args.visualQuestion.trim()
    ? args.visualQuestion.trim().slice(0, 1200)
    : (name === "computer.acquire" && projected.imageContent.length > 0
      ? "Identify the major visible interactive regions needed to continue the requested desktop task in one pass. Return separate grounded bounds for every visibly present category that may be needed next: window title or header, each text-entry surface using its full editable bounds, independent action buttons, selectable list rows, and major list or content panes. Do not merge a text field with an embedded or adjacent button. Omit a category only when it is not visibly present. Ground all regions in the returned window-local coordinate space; labels are unverified visual hints, so do not infer exact text or identity beyond visible evidence."
      : null);
  return {
    content: [
      {
        type: "text",
        text: renderComputerUseTextResult(structuredContent),
      },
      ...projected.imageContent,
    ],
    structuredContent,
    ...(projected.imageContent.length > 0 ? {
      _meta: {
        "xiaozhiclaw/visual-understanding-capability": {
          sameTransaction: true,
          requestField: "visualQuestion",
        },
        ...(visualUnderstandingEligible && visualInstruction ? {
        "xiaozhiclaw/visual-understanding": {
          mode: "auto",
          instruction: visualInstruction,
          ...(name === "computer.acquire"
            && !(typeof args?.visualQuestion === "string" && args.visualQuestion.trim())
            ? { latencyBudgetMs: 2_500 }
            : {}),
          ...(structuredContent?.perceptionRouting?.visualRegion
            ? { region: structuredContent.perceptionRouting.visualRegion }
            : {}),
        },
          } : {}),
      },
    } : {}),
    // An indeterminate desktop action is not a protocol/tool failure. The
    // action may already have reached the application and must not be replayed;
    // the caller has to observe the fresh UI state to resolve its outcome.
    // Reserve MCP isError for rejected requests and execution failures caught
    // above so agents do not abandon a healthy connector or retry mutations.
    isError: false,
  };
}

export async function runGenericTaskTool(router, args = {}, requestContext, options = {}) {
  return runGenericTaskHostContract({
    router,
    args,
    requestContext,
    signal: options.signal,
    acquire: (acquireArgs, acquireOptions) => acquireComputer(
      router,
      acquireArgs,
      requestContext,
      acquireOptions,
    ),
  });
}

export async function runDeterministicMessagingTool(router, args = {}, requestContext, options = {}) {
  let startedAt = Date.now();
  let machine;
  let access;
  let preMachineReleaseAttempted = false;
  let replayFenceKey = null;
  try {
    const applicationName = requiredMessagingInput(args.applicationName, "applicationName", 256);
    const query = requiredMessagingInput(args.query, "query", 512);
    const message = requiredMessagingInput(args.message, "message", 20_000);
    const scopeKey = messagingSelectionScopeKey(requestContext);
    prunePendingMessagingSelections(startedAt);
    prunePendingMessagingReplayFences(startedAt);
    replayFenceKey = messagingReplayFenceKey({ scopeKey, applicationName, query, message });
    const pendingSelection = resolvePendingMessagingSelection({
      args,
      scopeKey,
      applicationName,
      query,
      message,
      now: startedAt,
    });
    if (Number.isFinite(pendingSelection?.startedAt)) startedAt = pendingSelection.startedAt;
    const replayFence = pendingSelection === null
      ? pendingMessagingReplayFences.get(replayFenceKey)
      : null;
    if (replayFence?.expiresAt > Date.now()) {
      return messagingToolResult({
        outcome: "not-applied",
        released: true,
        startedAt,
        phase: "replay-blocked",
        replayAllowed: false,
        error: {
          code: "workflow.indeterminate_replay_blocked",
          message: "The Host blocked replay of an identical messaging goal after an indeterminate action. Report or reobserve in a new user task; do not retry this mutation.",
        },
      });
    }
    const applicationSelection = pendingSelection?.kind === "application"
      ? resolveSelectedMessagingApplication(args, pendingSelection)
      : await createMessagingApplicationSelection({
          router,
          scopeKey,
          applicationName,
          query,
          message,
          startedAt,
        });
    if (applicationSelection.selection) {
      return messagingToolResult({
        outcome: "not-applied",
        released: true,
        startedAt,
        phase: "selection-required",
        replayAllowed: true,
        selectionToken: applicationSelection.selection.selectionToken,
        candidates: applicationSelection.selection.candidates,
        error: {
          code: "llm.application_selection_required",
          message: "Select one opaque Host application candidate and call computer.message again with selectionToken and candidateId.",
        },
      });
    }
    access = await acquireComputer(router, {
      applicationToken: applicationSelection.applicationToken,
      tier: "full",
      agentId: requestContext?.agentId ?? "deterministic-messaging-host",
      reason: "Host-owned deterministic messaging workflow",
    }, requestContext, { initialObservationMode: "screenshot" });
    if (pendingSelection?.kind === "application") {
      pendingMessagingSelections.delete(args.selectionToken);
    }
    if (access?.status !== "granted" && access?.status !== "reused") {
      return messagingToolResult({
        outcome: "not-applied",
        released: access?.controller == null,
        startedAt,
        phase: "acquire",
        error: {
          code: "workflow.acquire_not_granted",
          message: "The Host did not grant the deterministic messaging controller lease.",
        },
      });
    }
    const decisionPort = createMessagingDecisionPort({
      args,
      pendingSelection: pendingSelection?.kind === "conversation" ? pendingSelection : null,
      scopeKey,
      applicationName,
      query,
      message,
      startedAt,
    });
    let latestScene = access.initialObservation?.scene ?? null;
    let latestScenePending = latestScene !== null;
    let lastObservedStep = null;
    machine = new DeterministicMessagingStateMachine({
      host: {
        observe: async ({ step, signal, requiredRole, requiredSemanticKey }) => {
          if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          const requiresRoleRefresh = typeof requiredRole === "string"
            && !hasUniqueConsistentSceneRole(latestScene, requiredRole, requiredSemanticKey);
          if (latestScene && !requiresRoleRefresh && (latestScenePending || step !== lastObservedStep)) {
            latestScenePending = false;
            lastObservedStep = step;
            return latestScene;
          }
          const refinement = requiresRoleRefresh
            && requiredRole === "send"
            && typeof router.refineLatestScreenshotScene === "function"
            ? await router.refineLatestScreenshotScene({
                requestContext,
                messagingSceneIntent: "send",
              })
            : null;
          const observation = refinement ?? await router.capture({
            mode: "screenshot",
            requestContext,
            ...requiredRoleObservationCrop(latestScene, requiredRole),
            ...(requiredRole === "send" ? { messagingSceneIntent: "send" } : {}),
          });
          latestScene = observation.scene;
          latestScenePending = false;
          lastObservedStep = step;
          return latestScene;
        },
        act: async ({ step, action, signal }) => {
          if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          const receipt = await router.act({
            action: { ...action, captureAfter: true },
            requestContext,
            signal,
          });
          if (receipt?.capture?.scene) {
            latestScene = receipt.capture.scene;
            latestScenePending = true;
            lastObservedStep = step;
          }
          return normalizePublicComputerActResult(receipt);
        },
        release: async ({ reason }) => {
          const release = await router.cancel({ reason, requestContext });
          return release?.status === "cancelled" || release?.status === "idle"
            ? { status: "committed", outcome: "committed" }
            : { status: "indeterminate", outcome: "indeterminate" };
        },
      },
      goal: { query, message },
      decisionPort,
      pollIntervalMs: 50,
      signal: options.signal,
    });
    const result = await machine.run();
    if (typeof args.selectionToken === "string") pendingMessagingSelections.delete(args.selectionToken);
    return messagingToolResult({
      outcome: "committed",
      released: result.released === true,
      startedAt,
      phase: "complete",
      replayAllowed: false,
      history: result.history,
      toolErrorCount: 0,
      wrongSendCount: 0,
    });
  } catch (error) {
    if (!machine && access?.controller && !preMachineReleaseAttempted) {
      preMachineReleaseAttempted = true;
      await router.cancel({ reason: error?.code ?? "workflow.failed_before_machine", requestContext }).catch(() => {});
    }
    const snapshot = machine?.snapshot;
    if (error?.selection) {
      return messagingToolResult({
        outcome: "not-applied",
        released: snapshot?.released === true,
        startedAt,
        phase: "selection-required",
        replayAllowed: true,
        history: error.history,
        selectionToken: error.selection.selectionToken,
        candidates: error.selection.candidates,
        error: { code: error.code, message: error.message },
      });
    }
    const outcome = canonicalActionOutcome(error?.outcome ?? "not-applied");
    if (outcome === "indeterminate" && replayFenceKey !== null) {
      pendingMessagingReplayFences.set(replayFenceKey, Object.freeze({
        expiresAt: Date.now() + PENDING_MESSAGING_REPLAY_FENCE_TTL_MS,
      }));
    }
    return messagingToolResult({
      outcome,
      released: snapshot?.released === true || access?.controller == null,
      startedAt,
      phase: error?.step ?? "failed",
      replayAllowed: false,
      history: error?.history,
      error: {
        code: error?.code ?? "workflow.host_failure",
        message: error instanceof Error ? error.message : "The deterministic messaging workflow failed.",
        ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
      },
    });
  }
}

function createMessagingDecisionPort({
  args,
  pendingSelection,
  scopeKey,
  applicationName,
  query,
  message,
  startedAt,
}) {
  return {
    async selectCandidate({ candidates }) {
      const exact = candidates.filter((candidate) => normalizeMessagingText(candidate.label) === normalizeMessagingText(query));
      if (exact.length === 1 && !pendingSelection) return { candidateId: exact[0].candidateId };
      if (pendingSelection) {
        const selected = pendingSelection.candidates.find((candidate) => candidate.candidateId === args.candidateId);
        const current = candidates.filter((candidate) => sameMessagingCandidate(candidate, selected));
        if (current.length !== 1) throw boundedMessagingError(
          "llm.selection_stale",
          "The selected Host candidate is no longer present in the current stable Scene.",
        );
        pendingMessagingSelections.delete(args.selectionToken);
        return { candidateId: current[0].candidateId };
      }
      const selectionToken = randomUUID();
      const publicCandidates = candidates.map((candidate) => Object.freeze({
        candidateId: candidate.candidateId,
        label: candidate.label,
        role: candidate.role,
        parentRole: candidate.parentRole,
        evidenceSources: Object.freeze([...candidate.evidenceSources]),
      }));
      pendingMessagingSelections.set(selectionToken, Object.freeze({
        kind: "conversation",
        scopeKey,
        applicationName,
        query,
        message,
        startedAt,
        expiresAt: Date.now() + PENDING_MESSAGING_SELECTION_TTL_MS,
        candidates: Object.freeze(publicCandidates),
      }));
      const error = boundedMessagingError(
        "llm.selection_required",
        "Select one opaque Host candidate and call computer.message again with selectionToken and candidateId.",
      );
      error.selection = Object.freeze({ selectionToken, candidates: Object.freeze(publicCandidates) });
      throw error;
    },
    async decideFailure() {
      return { decision: "report" };
    },
  };
}

async function createMessagingApplicationSelection({
  router,
  scopeKey,
  applicationName,
  query,
  message,
  startedAt,
}) {
  const discovery = await freshAcquisitionTargets(router);
  const normalizedApplicationName = normalizeMessagingText(applicationName);
  const exact = discovery.applications.filter((application) => (
    normalizeMessagingText(application?.name) === normalizedApplicationName
  ));
  if (exact.length === 1) {
    return { applicationToken: exact[0].applicationToken };
  }
  if (discovery.applications.length === 0) {
    throw boundedMessagingError(
      "workflow.application_not_found",
      "The Host did not discover a running or recoverable application candidate.",
    );
  }
  const selectionToken = randomUUID();
  const candidates = discovery.applications.map((application, index) => Object.freeze({
    candidateId: `application:${index + 1}`,
    label: application.name,
    role: "application",
    parentRole: "desktop",
    evidenceSources: Object.freeze(["host.application-inventory"]),
  }));
  const privateCandidates = candidates.map((candidate, index) => Object.freeze({
    ...candidate,
    applicationToken: discovery.applications[index].applicationToken,
  }));
  pendingMessagingSelections.set(selectionToken, Object.freeze({
    kind: "application",
    scopeKey,
    applicationName,
    query,
    message,
    startedAt,
    expiresAt: Date.now() + PENDING_MESSAGING_SELECTION_TTL_MS,
    candidates: Object.freeze(privateCandidates),
  }));
  return {
    selection: Object.freeze({ selectionToken, candidates: Object.freeze(candidates) }),
  };
}

function resolveSelectedMessagingApplication(args, pendingSelection) {
  const selected = pendingSelection.candidates.find((candidate) => candidate.candidateId === args.candidateId);
  if (!selected?.applicationToken) {
    throw boundedMessagingError(
      "llm.application_selection_invalid",
      "The selected Host application candidate is invalid or expired.",
    );
  }
  return { applicationToken: selected.applicationToken };
}

function resolvePendingMessagingSelection({ args, scopeKey, applicationName, query, message, now }) {
  const token = typeof args.selectionToken === "string" ? args.selectionToken.trim() : "";
  const candidateId = typeof args.candidateId === "string" ? args.candidateId.trim() : "";
  if (!token && !candidateId) return null;
  if (!token || !candidateId) throw boundedMessagingError(
    "llm.selection_contract_invalid",
    "selectionToken and candidateId must be supplied together.",
  );
  const pending = pendingMessagingSelections.get(token);
  if (!pending || pending.expiresAt <= now || pending.scopeKey !== scopeKey
    || pending.applicationName !== applicationName || pending.query !== query || pending.message !== message
    || !pending.candidates.some((candidate) => candidate.candidateId === candidateId)) {
    pendingMessagingSelections.delete(token);
    throw boundedMessagingError("llm.selection_invalid", "The opaque Host candidate selection is invalid or expired.");
  }
  return pending;
}

function messagingToolResult({
  outcome,
  released,
  startedAt,
  phase,
  history,
  selectionToken,
  candidates,
  error,
  toolErrorCount,
  wrongSendCount,
  replayAllowed,
}) {
  return {
    status: outcome,
    outcome,
    released: released === true,
    terminalControllerState: released === true ? "idle" : "active",
    ...(typeof replayAllowed === "boolean" ? { replayAllowed } : {}),
    elapsedMs: Math.max(0, Date.now() - startedAt),
    ...(phase ? { phase } : {}),
    ...(Array.isArray(history) ? { history } : {}),
    ...(selectionToken ? { selectionToken } : {}),
    ...(Array.isArray(candidates) ? { candidates } : {}),
    ...(error ? { error } : {}),
    ...(Number.isInteger(toolErrorCount) ? { toolErrorCount } : {}),
    ...(Number.isInteger(wrongSendCount) ? { wrongSendCount } : {}),
  };
}

function requiredMessagingInput(value, field, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw boundedMessagingError("workflow.invalid_goal", `${field} must be a non-empty string within ${maxLength} characters.`);
  }
  return value;
}

function messagingSelectionScopeKey(requestContext) {
  return JSON.stringify([
    requestContext?.ownerId ?? null,
    requestContext?.agentId ?? null,
    requestContext?.projectId ?? null,
    requestContext?.sessionId ?? null,
  ]);
}

function prunePendingMessagingSelections(now) {
  for (const [token, pending] of pendingMessagingSelections) {
    if (pending.expiresAt <= now) pendingMessagingSelections.delete(token);
  }
}

function messagingReplayFenceKey({ scopeKey, applicationName, query, message }) {
  return JSON.stringify([scopeKey, applicationName, query, message]);
}

function prunePendingMessagingReplayFences(now) {
  for (const [key, fence] of pendingMessagingReplayFences) {
    if (fence.expiresAt <= now) pendingMessagingReplayFences.delete(key);
  }
}

function normalizeMessagingText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function hasUniqueConsistentSceneRole(scene, role, semanticKey) {
  if (!Array.isArray(scene?.elements)) return false;
  const matching = scene.elements.filter((element) => (
      element?.role === role
      && element.evidenceConsistency === "consistent"
      && (typeof semanticKey !== "string" || element.semanticKey === semanticKey)
    ));
  return matching.length === 1;
}

function requiredRoleObservationCrop(scene, role) {
  if (role !== "conversation-title" || !Array.isArray(scene?.elements)) return {};
  const title = scene.elements.find((element) => element?.role === "conversation-title");
  const parent = title
    ? scene.elements.find((element) => element?.id === title.parentId)
    : null;
  const bounds = parent?.coordinate?.bounds;
  return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0
    ? { crop: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }
    : {};
}

function sameMessagingCandidate(left, right) {
  return right && left.label === right.label && left.role === right.role
    && left.parentRole === right.parentRole
    && JSON.stringify([...left.evidenceSources].sort()) === JSON.stringify([...right.evidenceSources].sort());
}

function boundedMessagingError(code, message) {
  const error = new Error(message);
  error.name = "BoundedLlmInteractionError";
  error.code = code;
  error.outcome = "not-applied";
  error.replayAllowed = false;
  return error;
}

function normalizePublicComputerActResult(value = {}) {
  const outcome = canonicalActionOutcome(value.outcome ?? value.status);
  const result = value.result && typeof value.result === "object" ? value.result : {};
  if (result.outcome === outcome && result.effect === undefined && result.replaySafe === undefined) {
    return { ...value, status: outcome, outcome };
  }
  const {
    effect: _legacyEffect,
    replaySafe: _legacyReplaySafe,
    completionEligible: _legacyCompletionEligible,
    delivered: _legacyDelivered,
    status: providerStatus,
    ...detail
  } = result;
  return {
    ...value,
    status: outcome,
    outcome,
    result: {
      ...detail,
      outcome,
      applied: outcome === "committed" ? true : outcome === "not-applied" ? false : null,
      mayHaveSideEffects: outcome !== "not-applied",
      postconditionVerified: detail.verified === true,
      ...(typeof providerStatus === "string" ? { providerStatus } : {}),
    },
  };
}

function stripLegacyObservationAuthorities(value) {
  if (Array.isArray(value)) return value.map(stripLegacyObservationAuthorities);
  if (!value || typeof value !== "object") return value;
  const isObservation = value.observationId !== undefined || value.scene !== undefined;
  const stripped = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isObservation && (key === "elements" || key === "localObservation" || key === "semanticProbe")) {
      continue;
    }
    stripped[key] = key === "scene" ? publicHostScene(entry) : stripLegacyObservationAuthorities(entry);
  }
  return stripped;
}

function publicHostScene(scene) {
  const sourceElements = Array.isArray(scene?.elements) ? scene.elements : [];
  const byId = new Map(sourceElements.map((element) => [element.id, element]));
  const retainedIds = new Set(sourceElements
    .filter((element) => (
      element.evidenceConsistency === "consistent"
      && element.role !== "message-bubble"
    ))
    .map((element) => element.id));
  for (const id of [...retainedIds]) {
    let parentId = byId.get(id)?.parentId;
    while (typeof parentId === "string" && !retainedIds.has(parentId)) {
      retainedIds.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return {
    ...scene,
    elements: sourceElements
      .filter((element) => retainedIds.has(element.id))
      .map(({ binding: _hostOnlyBinding, evidence, ...element }) => ({
        ...element,
        evidence: [...new Set((Array.isArray(evidence) ? evidence : [])
          .map((item) => item?.source)
          .filter((source) => typeof source === "string" && source.length > 0))]
          .map((source) => ({ source })),
      })),
  };
}

function canonicalActionOutcome(value) {
  if (value === "committed" || value === "not-applied" || value === "indeterminate") return value;
  if (value === "applied" || value === "completed" || value === "ok") return "committed";
  if (value === "blocked" || value === "rejected") return "not-applied";
  return "indeterminate";
}

function isSafeContractRejection(name, toolError) {
  if (name === "computer.act") {
    return (
      toolError?.detail?.allowed === false
      && toolError?.detail?.pixelLimitedAction === false
    ) || new Set([
      "action.observation_required",
      "action.surface_receipt_mismatch",
      "action.fresh_observation_required",
      "action.observation_required_after_unverified_mutation",
      "focus.receipt_required",
      "focus.receipt_invalid",
      "focus.receipt_expired",
      "focus.receipt_target_mismatch",
    ]).has(toolError?.code);
  }
  return name === "computer.acquire"
    && toolError?.code === "window.not_found"
    && toolError?.detail?.retryable === true
    && toolError?.detail?.nextTool === "computer.observe";
}

/**
 * Project the exact structured result into compact Markdown for the Agent
 * channel. The Host and UI retain structuredContent as the lossless contract;
 * this projection removes pretty-JSON punctuation and indentation from the
 * model-visible copy without asking the Agent to read a local file.
 */
export function renderComputerUseTextResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `# Computer Use Result\n\n- **value**: ${compactMarkdownValue(value)}`;
  }
  const modelValue = projectComputerUseModelResult(value);
  const lines = ["# Computer Use Result"];
  for (const [key, entry] of Object.entries(modelValue)) {
    if (
      (key === "localObservation" || key === "initialObservation")
      && entry
      && typeof entry === "object"
      && !Array.isArray(entry)
    ) {
      lines.push("", `## ${key}`);
      for (const [nestedKey, nestedEntry] of Object.entries(entry)) {
        if (nestedKey === "elements" && Array.isArray(nestedEntry)) {
          lines.push("", `### elements (${nestedEntry.length})`);
          if (nestedEntry.length === 0) {
            lines.push("- none");
          } else {
            for (const item of nestedEntry) lines.push(`- ${renderModelArrayItem("elements", item)}`);
          }
          continue;
        }
        lines.push(`- **${nestedKey}**: ${compactMarkdownValue(nestedEntry)}`);
      }
      continue;
    }
    if (Array.isArray(entry)) {
      lines.push("", `## ${key} (${entry.length})`);
      if (entry.length === 0) {
        lines.push("- none");
      } else {
        for (const item of entry) lines.push(`- ${renderModelArrayItem(key, item)}`);
      }
      continue;
    }
    lines.push(`- **${key}**: ${compactMarkdownValue(entry)}`);
  }
  return lines.join("\n");
}

const MODEL_TEXT_OMITTED_KEYS = new Set([
  "auditEvents",
  "coordinateScale",
  "interactionContract",
  "surfaceProvenance",
]);

const MODEL_TEXT_PROTOCOL_ONLY_KEYS = new Set([
  "applicationCount",
  "controllerId",
  "expiresAt",
  "includeUserOverlay",
  "interactionStep",
  "resultSchemaVersion",
  "startsDesktopControl",
]);

/**
 * Keep structuredContent complete for the Host while projecting only the
 * evidence needed for the next model decision into the text channel.
 * In particular, state observations must not replay a previous full OCR frame,
 * and the text-entry contract is stated once instead of being nested under
 * both the screenshot and local OCR observation.
 */
export function projectComputerUseModelResult(value, contextKey = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => projectComputerUseModelResult(entry, contextKey));
  }
  if (!value || typeof value !== "object") return value;
  if (contextKey === "lastCapture") return summarizePriorCapture(value);
  if (contextKey === "localObservation") return summarizeLocalObservation(value);
  if (contextKey === "initialObservation") return summarizeEmbeddedObservation(value);
  if (contextKey === "perceptionRouting") return summarizePerceptionRouting(value);
  if (contextKey === "capture" && isObservationEnvelope(value)) {
    return summarizeEmbeddedObservation(value);
  }
  if (contextKey === "result") return summarizeDriverActionResult(value);

  const projected = contextKey === ""
      ? {
        ...(value.initialObservation ? {
          initialObservationGuidance: "A fresh initial observation is already included. Use its OCR and Host-grounded layout evidence directly. Never call semantic observe merely to reconfirm the current title or screenshot: an empty semantic probe cannot add evidence. If the next interaction is grounded, act now. If one exact editable or selectable bound is missing, ask one bounded visual question for every remaining region in a single observe call, then act; do not insert semantic or screenshot refreshes before it.",
        } : {}),
        ...(value?.perceptionRouting?.suggestedVisualRegion
          && value?.perceptionRouting?.visualRegion == null
          ? {
              visualGuidance: "If the remaining ambiguity is entirely inside perceptionRouting.suggestedVisualRegion, copy that exact rectangle into the single visual observation as crop. Otherwise omit crop for full context. Never silently reuse an older crop.",
            }
          : {}),
        ...(hasOcrObservation(value) ? {
        observationGuidance: "LIMIT: OCR is text evidence only and cannot authorize a click or keyboard target. Act only through a consistent actionable element in the current Host Scene. If structure or bounded visual evidence cannot establish the parent control and its action, release control and report the blocker.",
        } : {}),
      }
    : {};
  for (const [key, entry] of Object.entries(value)) {
    if (MODEL_TEXT_OMITTED_KEYS.has(key)) continue;
    if (contextKey === "" && shouldOmitTopLevelModelEntry(key, entry)) continue;
    if (contextKey === "" && key === "foregroundWindow" && entry && typeof entry === "object") {
      projected.foregroundWindow = summarizeStateWindow(entry);
      continue;
    }
    if (contextKey === "" && key === "windows" && Array.isArray(entry)) {
      const windows = summarizeStateWindows(entry, value.foregroundWindow);
      projected.windows = windows;
      if (windows.length < entry.length) projected.omittedWindowCount = entry.length - windows.length;
      continue;
    }
    if (contextKey === "" && key === "applications" && Array.isArray(entry)) {
      const applications = summarizeStateApplications(entry, value.windows, value.foregroundWindow);
      projected.applications = applications;
      if (applications.length < entry.length) {
        projected.omittedApplicationCount = entry.length - applications.length;
      }
      continue;
    }
    if (contextKey === "" && key === "controller" && entry && typeof entry === "object") {
      projected.controller = summarizeController(entry);
      continue;
    }
    if (contextKey === "" && key === "window" && entry && typeof entry === "object") {
      projected.window = summarizeStateWindow(entry);
      continue;
    }
    if (key === "surfaceReceipt" && entry && typeof entry === "object") {
      projected.surfaceReceipt = {
        ...(entry.id !== undefined ? { id: entry.id } : {}),
        ...(entry.generation !== undefined ? { generation: entry.generation } : {}),
        ...(entry.observationId !== undefined ? { observationId: entry.observationId } : {}),
      };
      continue;
    }
    if (key === "elements" && Array.isArray(entry)) {
      if (value.scene) continue;
      if (entry.length === 0) continue;
      const compacted = compactModelPerceptionElements(entry);
      projected.elements = limitModelPerceptionElements(compacted);
      if (projected.elements.length < compacted.length) {
        projected.modelElementCount = projected.elements.length;
        projected.omittedModelElementCount = compacted.length - projected.elements.length;
      }
      continue;
    }
    if (key === "scene" && entry && typeof entry === "object") {
      projected.scene = entry;
      continue;
    }
    if (
      key === "localObservation"
      && value?.perceptionRouting?.selectedMode === "semantic-fallback-existing-screenshot"
      && entry
      && typeof entry === "object"
    ) {
      projected.localObservation = {
        source: entry.source ?? "ocr",
        reusedFromFreshScreenshot: true,
        detectedElementCount: Array.isArray(entry.elements) ? entry.elements.length : 0,
      };
      continue;
    }
    if (key === "localObservation" && entry && typeof entry === "object") {
      projected.localObservation = summarizeLocalObservation(entry, {
        preferredRegion: value?.perceptionRouting?.secondaryOcrRegion,
      });
      continue;
    }
    projected[key] = projectComputerUseModelResult(entry, key);
  }

  if (hasTextEntryContract(value) && hasOcrObservation(value)) {
    projected.actionGuidance = "Use one atomic type_text with the fresh observationId and full editable targetBounds. OCR bounds are observation-only.";
  }
  if (value?.perceptionRouting?.noProgress?.status === "blocked") {
    projected.nextAction = value.perceptionRouting.noProgress.nextAction;
  }
  if (
    value.status === "idle"
    && Array.isArray(value.applications)
    && Array.isArray(value.windows)
  ) {
    projected.controlGuidance = projected.omittedApplicationCount > 0
      ? "This state inventory is intentionally compressed. Do not repeat the same state observation to reveal omitted entries. If the user already identified the target application, call computer.acquire now with applicationName set to that product name; the Host resolves it against the full fresh inventory and fails closed on no or ambiguous matches. Otherwise use a shown fresh applicationToken."
      : "Next, call computer.acquire with the matching fresh applicationToken. If the user already identified the target application but it is absent here, call computer.acquire with applicationName instead of repeating state.";
  }
  return projected;
}

function shouldOmitTopLevelModelEntry(key, entry) {
  if (entry === null || entry === undefined) return true;
  if (MODEL_TEXT_PROTOCOL_ONLY_KEYS.has(key)) return true;
  if (key === "overlay" || key === "previousController") return true;
  if (key === "approval" && entry?.status === "not_required") return true;
  if (key === "windowDiscovery" && entry?.status === "ready") return true;
  if (key === "applicationDiscovery" && entry?.status === "ready") return true;
  if (
    key === "desktopState"
    && entry?.status === "interactive"
    && entry?.secureDesktop !== true
  ) {
    return true;
  }
  if (
    key === "truncation"
    && entry?.truncated !== true
    && entry?.elementLimitReached !== true
    && entry?.depthLimitReached !== true
  ) {
    return true;
  }
  if (key === "coordinateTransform" && entry === "identity") return true;
  if (key === "text" && typeof entry === "string" && entry.trim() === "") return true;
  return false;
}

function summarizeController(controller) {
  return {
    ...(controller.tier !== undefined ? { tier: controller.tier } : {}),
    ...(controller.status !== undefined ? { status: controller.status } : {}),
    ...(controller.window && typeof controller.window === "object"
      ? { window: summarizeStateWindow(controller.window) }
      : {}),
  };
}

function summarizeEmbeddedObservation(value) {
  const compactedElements = Array.isArray(value.elements)
    ? compactModelPerceptionElements(value.elements)
    : [];
  const elements = limitModelPerceptionElements(compactedElements);
  return {
    ...(value.status !== undefined ? { status: value.status } : {}),
    ...(value.observationId !== undefined ? { observationId: value.observationId } : {}),
    ...(value.surfaceReceipt !== undefined
      ? { surfaceReceipt: projectComputerUseModelResult(value.surfaceReceipt, "surfaceReceipt") }
      : {}),
    ...(value.coordinateSpace !== undefined ? { coordinateSpace: value.coordinateSpace } : {}),
    ...(value.coordinateBounds !== undefined
      ? { coordinateBounds: projectComputerUseModelResult(value.coordinateBounds, "coordinateBounds") }
      : {}),
    ...(elements.length > 0 ? { elements } : {}),
    ...(elements.length < compactedElements.length
      ? {
          modelElementCount: elements.length,
          omittedModelElementCount: compactedElements.length - elements.length,
        }
      : {}),
    ...(value.localObservation !== undefined
      ? { localObservation: summarizeLocalObservation(value.localObservation, {
          preferredRegion: value?.perceptionRouting?.secondaryOcrRegion,
        }) }
      : {}),
    ...(value.perceptionRouting !== undefined
      ? { perceptionRouting: summarizePerceptionRouting(value.perceptionRouting) }
      : {}),
    ...(value.mutationVerification !== undefined
      ? { mutationVerification: projectComputerUseModelResult(value.mutationVerification, "mutationVerification") }
      : {}),
    ...(value.executionControl !== undefined
      ? { executionControl: projectComputerUseModelResult(value.executionControl, "executionControl") }
      : {}),
    ...(value.actionGuidance !== undefined ? { actionGuidance: value.actionGuidance } : {}),
  };
}

function summarizeDriverActionResult(value) {
  const keys = [
    "status",
    "characters",
    "utf16CodeUnits",
    "clipboardRestored",
    "changeSignalDelivered",
    "textMode",
    "inputBehavior",
    "effect",
    "verified",
    "focusVerified",
    "replaySafe",
    "verificationRequired",
    "nextAction",
  ];
  const projected = {};
  for (const key of keys) {
    if (value[key] !== undefined) projected[key] = projectComputerUseModelResult(value[key], key);
  }
  if (value.foregroundWindow && typeof value.foregroundWindow === "object") {
    projected.foregroundWindow = summarizeStateWindow(value.foregroundWindow);
  }
  return projected;
}

const MODEL_STATE_WINDOW_LIMIT = 6;
// A tray-only application has no window evidence, so its opaque selector can
// only survive through the application inventory. Keep a bounded but complete
// typical running-process set; the per-entry projection already removes pid,
// paths, and launch metadata. Six entries was too lossy on a normal Windows
// desktop and made recoverable tray applications undiscoverable.
const MODEL_STATE_APPLICATION_LIMIT = 48;

function summarizeStateWindows(windows, foregroundWindow) {
  return windows
    .filter(isModelRelevantStateWindow)
    .map((window, index) => ({
      window,
      index,
      rank: stateWindowRank(window, foregroundWindow),
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, MODEL_STATE_WINDOW_LIMIT)
    .map(({ window }) => summarizeStateWindow(window));
}

function summarizeStateApplications(applications, windows, foregroundWindow) {
  const relevantWindowTitles = summarizeStateWindows(
    Array.isArray(windows) ? windows : [],
    foregroundWindow,
  )
    .map((window) => normalizeStateIdentity(window.title))
    .filter(Boolean);
  return applications
    .map((application, index) => ({
      application,
      index,
      rank: stateApplicationRank(application, relevantWindowTitles),
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, MODEL_STATE_APPLICATION_LIMIT)
    .map(({ application }) => projectComputerUseModelResult(application, "application"));
}

function stateWindowRank(window, foregroundWindow) {
  if (
    window?.isForeground === true
    || sameStateWindowId(window, foregroundWindow)
  ) {
    return 0;
  }
  if (
    window?.pid !== undefined
    && foregroundWindow?.pid !== undefined
    && String(window.pid) === String(foregroundWindow.pid)
  ) {
    return 1;
  }
  return 2;
}

function sameStateWindowId(left, right) {
  const leftId = left?.windowId ?? left?.id;
  const rightId = right?.windowId ?? right?.id;
  return leftId !== undefined
    && rightId !== undefined
    && String(leftId) === String(rightId);
}

function stateApplicationRank(application, relevantWindowTitles) {
  const stateRank = application?.state === "active"
    ? 0
    : application?.state === "visible"
      ? 1
      : application?.state === "recoverable"
        ? 3
        : 5;
  const applicationName = normalizeStateIdentity(application?.name);
  const matchesObservedWindow = applicationName !== ""
    && relevantWindowTitles.some((title) => (
      title === applicationName
      || title.includes(applicationName)
      || applicationName.includes(title)
    ));
  return matchesObservedWindow ? Math.max(0, stateRank - 2) : stateRank;
}

function normalizeStateIdentity(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function summarizeStateWindow(window) {
  return {
    ...(window.windowId !== undefined ? { windowId: window.windowId } : {}),
    ...(window.id !== undefined && window.windowId === undefined ? { windowId: window.id } : {}),
    ...(window.title !== undefined ? { title: window.title } : {}),
  };
}

function isModelRelevantStateWindow(window) {
  if (!window || typeof window !== "object") return false;
  const bounds = window.bounds;
  if (!bounds || typeof bounds !== "object") return true;
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  if (![width, height, x, y].every(Number.isFinite)) return true;
  return width >= 48
    && height >= 32
    && Math.abs(x) < 16_384
    && Math.abs(y) < 16_384;
}

function summarizeLocalObservation(value, options = {}) {
  const compactedElements = Array.isArray(value.elements)
    ? compactModelPerceptionElements(value.elements)
    : [];
  const elements = limitModelPerceptionElements(compactedElements, options);
  return {
    ...(value.source !== undefined ? { source: value.source } : {}),
    ...(value.crop !== undefined ? { crop: projectComputerUseModelResult(value.crop, "crop") } : {}),
    elements,
    ...(elements.length < compactedElements.length
      ? {
          modelElementCount: elements.length,
          omittedModelElementCount: compactedElements.length - elements.length,
        }
      : {}),
    detectedElementCount: Number.isFinite(value.elementCount)
      ? value.elementCount
      : Array.isArray(value.elements)
        ? value.elements.length
        : 0,
  };
}

function summarizePerceptionRouting(value) {
  const keys = [
    "selectedMode",
    "frameStatus",
    "visualSceneChanged",
    "dirtyRegion",
    "ocrRegion",
    "secondaryOcrRegion",
    "visualRegion",
    "suggestedVisualRegion",
    "localElementCount",
    "reason",
    "unchangedInterpretation",
  ];
  const projected = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      projected[key] = projectComputerUseModelResult(value[key], key);
    }
  }
  return projected;
}

const MODEL_PERCEPTION_ELEMENT_LIMIT = 8;

function limitModelPerceptionElements(elements, options = {}) {
  if (elements.length <= MODEL_PERCEPTION_ELEMENT_LIMIT) return elements;
  const preferredRegion = options.preferredRegion;
  if (isCoordinateBox(preferredRegion)) {
    const preferred = elements.filter((element) => boxesIntersect(
      element?.bounds ?? element?.representativeTextAnchor?.bounds,
      preferredRegion,
    ));
    if (preferred.length > 0) {
      const preferredLimit = Math.min(preferred.length, Math.ceil(MODEL_PERCEPTION_ELEMENT_LIMIT * 0.625));
      const selectedPreferred = samplePerceptionElements(preferred, preferredLimit);
      const selectedSet = new Set(selectedPreferred);
      const remaining = elements.filter((element) => !selectedSet.has(element));
      return [
        ...selectedPreferred,
        ...samplePerceptionElements(remaining, MODEL_PERCEPTION_ELEMENT_LIMIT - selectedPreferred.length),
      ].sort(comparePerceptionGeometry);
    }
  }
  const semantic = elements.filter((element) => element?.source !== "ocr");
  const ocr = elements
    .filter((element) => element?.source === "ocr")
    .sort(comparePerceptionGeometry);
  const semanticLimit = Math.min(semantic.length, Math.floor(MODEL_PERCEPTION_ELEMENT_LIMIT / 2));
  const selected = semantic.slice(0, semanticLimit);
  const remaining = MODEL_PERCEPTION_ELEMENT_LIMIT - selected.length;
  if (remaining <= 0 || ocr.length === 0) return selected;
  if (ocr.length <= remaining) return [...selected, ...ocr];
  if (remaining === 1) return [...selected, ocr[0]];
  const sampled = ocr.slice(0, Math.min(3, remaining - 1));
  const used = new Set(sampled.map((entry) => ocr.indexOf(entry)));
  if (sampled.length < remaining) {
    used.add(ocr.length - 1);
    sampled.push(ocr.at(-1));
  }
  const interiorSlots = remaining - sampled.length;
  for (let index = 0; index < interiorSlots; index += 1) {
    const sourceIndex = Math.round(
      3 + index * Math.max(0, ocr.length - 5) / Math.max(1, interiorSlots - 1),
    );
    if (!used.has(sourceIndex) && ocr[sourceIndex]) {
      used.add(sourceIndex);
      sampled.push(ocr[sourceIndex]);
    }
  }
  sampled.sort(comparePerceptionGeometry);
  return [...selected, ...sampled].slice(0, MODEL_PERCEPTION_ELEMENT_LIMIT);
}

function samplePerceptionElements(elements, limit) {
  if (limit <= 0 || elements.length === 0) return [];
  if (elements.length <= limit) return [...elements];
  if (limit === 1) return [elements[0]];
  const selected = [];
  const used = new Set();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (elements.length - 1) / (limit - 1));
    if (!used.has(sourceIndex)) {
      used.add(sourceIndex);
      selected.push(elements[sourceIndex]);
    }
  }
  return selected;
}

function isCoordinateBox(value) {
  return value && typeof value === "object"
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width > 0
    && value.height > 0;
}

function boxesIntersect(left, right) {
  if (!isCoordinateBox(left) || !isCoordinateBox(right)) return false;
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function summarizePriorCapture(value) {
  return {
    ...(value.status !== undefined ? { status: value.status } : {}),
    ...(value.observationId !== undefined ? { observationId: value.observationId } : {}),
    ...(value.source !== undefined ? { source: value.source } : {}),
    ...(value.window !== undefined ? { window: projectComputerUseModelResult(value.window, "window") } : {}),
    ...(Array.isArray(value.elements) ? { elementCount: value.elements.length } : {}),
    ...(value.localObservation && typeof value.localObservation === "object"
      ? { localElementCount: Array.isArray(value.localObservation.elements) ? value.localObservation.elements.length : 0 }
      : {}),
    ...(value.perceptionRouting !== undefined
      ? { perceptionRouting: projectComputerUseModelResult(value.perceptionRouting, "perceptionRouting") }
      : {}),
  };
}

function hasTextEntryContract(value) {
  return Boolean(
    value?.interactionContract?.textEntry
    || value?.localObservation?.interactionContract?.textEntry
    || value?.capture?.interactionContract?.textEntry,
  );
}

function hasOcrObservation(value) {
  return Boolean(
    value?.elements?.some?.((element) => element?.source === "ocr")
    || value?.localObservation?.elements?.some?.((element) => element?.source === "ocr")
    || value?.capture?.elements?.some?.((element) => element?.source === "ocr")
    || value?.capture?.localObservation?.elements?.some?.((element) => element?.source === "ocr"),
  );
}

function renderModelArrayItem(key, value) {
  if (key === "elements" && value && typeof value === "object") {
    const bounds = value.bounds;
    const location = bounds && typeof bounds === "object"
      ? ` @ [${bounds.x},${bounds.y},${bounds.width},${bounds.height}]`
      : "";
    const textAnchor = value.representativeTextAnchor;
    const textAnchorBounds = textAnchor?.bounds;
    const representative = textAnchorBounds && typeof textAnchorBounds === "object"
      ? ` textAnchor=${compactMarkdownValue(textAnchor.name)}@[${textAnchorBounds.x},${textAnchorBounds.y},${textAnchorBounds.width},${textAnchorBounds.height}]`
      : "";
    const flags = [
      value.source ? `source=${value.source}` : "",
      value.observationOnly === true ? "observationOnly" : "",
    ].filter(Boolean);
    return `${compactMarkdownValue(value.name ?? value.value ?? "")}${location}${representative}${flags.length ? ` ${flags.join(" ")}` : ""}`;
  }
  if (key === "applications" && value && typeof value === "object") {
    return [
      compactMarkdownValue(value.name ?? ""),
      value.state ? `state=${value.state}` : "",
      value.applicationToken ? `token=${value.applicationToken}` : "",
    ].filter(Boolean).join(" ");
  }
  return compactMarkdownValue(value);
}

/**
 * OCR tokens are observation-only and can never authorize an action. Merge
 * nearby tokens into visual rows for the model text channel while retaining
 * the full token geometry in structuredContent for Host-side verification.
 * A merged row is a text summary, not an interaction target, so it must not
 * expose a union rectangle that could be mistaken for actionable geometry.
 * This is geometric compression only: no application names, keywords, or
 * regular-expression routing participate in the grouping.
 */
export function compactModelPerceptionElements(elements) {
  const passthrough = [];
  const positionedOcr = [];
  for (const element of elements) {
    const bounds = element?.bounds;
    if (
      element?.source !== "ocr"
      || !Number.isFinite(bounds?.x)
      || !Number.isFinite(bounds?.y)
      || !Number.isFinite(bounds?.width)
      || !Number.isFinite(bounds?.height)
    ) {
      passthrough.push(projectComputerUseModelResult(element, "element"));
      continue;
    }
    positionedOcr.push(element);
  }
  positionedOcr.sort((left, right) => (
    left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x
  ));

  const rows = [];
  for (const element of positionedOcr) {
    const row = rows.find((candidate) => ocrElementBelongsToRow(candidate, element.bounds));
    if (!row) {
      rows.push({
        names: [element.name ?? element.value ?? ""],
        tokens: [{
          name: element.name ?? element.value ?? "",
          bounds: { ...element.bounds },
        }],
        bounds: { ...element.bounds },
        baselineCenterY: element.bounds.y + (element.bounds.height / 2),
        baselineHeight: element.bounds.height,
        exact: element.exact === true,
        count: 1,
      });
      continue;
    }
    row.names.push(element.name ?? element.value ?? "");
    row.tokens.push({
      name: element.name ?? element.value ?? "",
      bounds: { ...element.bounds },
    });
    row.bounds = unionBounds(row.bounds, element.bounds);
    row.exact = row.exact && element.exact === true;
    row.baselineCenterY = (
      (row.baselineCenterY * row.count)
      + element.bounds.y
      + (element.bounds.height / 2)
    ) / (row.count + 1);
    row.baselineHeight = (
      (row.baselineHeight * row.count)
      + element.bounds.height
    ) / (row.count + 1);
    row.count += 1;
  }

  const compressedOcr = rows.map((row) => ({
    name: row.names.filter((name) => name !== "").join(" "),
    ...(row.count === 1 ? { bounds: row.bounds } : {}),
    source: "ocr",
    observationOnly: true,
    ...(row.count === 1 && row.exact ? { exact: true } : {}),
    ...(row.count > 1
      ? {
          mergedTokenCount: row.count,
          geometryKind: "text-row-summary",
          actionableGeometry: false,
          representativeTextAnchor: selectRepresentativeTextAnchor(row.tokens),
        }
      : {}),
  }));
  return [...deduplicateSemanticElements(passthrough), ...compressedOcr].sort(comparePerceptionGeometry);
}

function deduplicateSemanticElements(elements) {
  const retained = [];
  for (const element of elements) {
    const duplicateIndex = retained.findIndex((candidate) => (
      semanticElementsMateriallyDuplicate(candidate, element)
    ));
    if (duplicateIndex === -1) {
      retained.push(element);
      continue;
    }
    if (semanticElementUtility(element) > semanticElementUtility(retained[duplicateIndex])) {
      retained[duplicateIndex] = element;
    }
  }
  return retained;
}

function semanticElementsMateriallyDuplicate(left, right) {
  const leftName = normalizeStateIdentity(left?.name ?? left?.value);
  const rightName = normalizeStateIdentity(right?.name ?? right?.value);
  if (leftName !== rightName) return false;
  const leftBounds = left?.bounds;
  const rightBounds = right?.bounds;
  if (!isFiniteModelBounds(leftBounds) || !isFiniteModelBounds(rightBounds)) return false;
  if (leftName === "") return sameModelBounds(leftBounds, rightBounds);
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
  const smallerArea = Math.min(
    leftBounds.width * leftBounds.height,
    rightBounds.width * rightBounds.height,
  );
  return smallerArea > 0 && (intersectionWidth * intersectionHeight) / smallerArea >= 0.8;
}

function semanticElementUtility(element) {
  return (Array.isArray(element?.actions) ? element.actions.length * 10 : 0)
    + (element?.elementToken ? 4 : 0)
    + (element?.role ? 2 : 0)
    + (element?.exact === true ? 1 : 0);
}

function isFiniteModelBounds(bounds) {
  return bounds
    && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}

function sameModelBounds(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function comparePerceptionGeometry(left, right) {
  const leftBounds = left?.bounds ?? left?.representativeTextAnchor?.bounds;
  const rightBounds = right?.bounds ?? right?.representativeTextAnchor?.bounds;
  if (!leftBounds || !rightBounds) return leftBounds ? -1 : rightBounds ? 1 : 0;
  return leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
}

function selectRepresentativeTextAnchor(tokens) {
  const selected = tokens
    .filter((token) => token.name !== "")
    .sort((left, right) => (
      anchorInformationScore(right.name) - anchorInformationScore(left.name)
      || (right.bounds.width * right.bounds.height)
        - (left.bounds.width * left.bounds.height)
    ))[0];
  return selected
    ? { name: selected.name, bounds: selected.bounds }
    : undefined;
}

function anchorInformationScore(value) {
  let score = 0;
  for (const character of Array.from(value.trim())) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character.trim() === "") continue;
    if (codePoint >= 48 && codePoint <= 57) {
      score += 0.25;
    } else if (
      (codePoint >= 65 && codePoint <= 90)
      || (codePoint >= 97 && codePoint <= 122)
      || codePoint > 127
    ) {
      score += 1;
    } else {
      score += 0.1;
    }
  }
  return score;
}

function ocrElementBelongsToRow(row, bounds) {
  const baselineTop = row.baselineCenterY - (row.baselineHeight / 2);
  const baselineBottom = row.baselineCenterY + (row.baselineHeight / 2);
  const overlap = Math.max(
    0,
    Math.min(baselineBottom, bounds.y + bounds.height) - Math.max(baselineTop, bounds.y),
  );
  const minHeight = Math.min(row.baselineHeight, bounds.height);
  const centerDistance = Math.abs(
    row.baselineCenterY - (bounds.y + (bounds.height / 2)),
  );
  const verticalMatch = minHeight > 0
    && (
      overlap / minHeight >= 0.5
      || centerDistance <= Math.max(row.baselineHeight, bounds.height) * 0.6
    );
  if (!verticalMatch) return false;
  const horizontalGap = Math.max(
    0,
    Math.max(row.bounds.x, bounds.x)
      - Math.min(row.bounds.x + row.bounds.width, bounds.x + bounds.width),
  );
  return horizontalGap <= Math.min(
    48,
    Math.max(20, Math.max(row.baselineHeight, bounds.height) * 2),
  );
}

function unionBounds(left, right) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const endX = Math.max(left.x + left.width, right.x + right.width);
  const endY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: endX - x, height: endY - y };
}

function compactMarkdownValue(value) {
  if (value === undefined) return "undefined";
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

export async function projectComputerUseMediaResult(router, name, args, value) {
  if (name !== "computer.observe" && name !== "computer.acquire") {
    return { structuredContent: value, imageContent: [] };
  }
  const mode = args?.mode;
  const acquisitionObservation = name === "computer.acquire"
    ? value?.initialObservation
    : null;
  const artifactPath = acquisitionObservation?.artifact?.path
    ?? acquisitionObservation?.capture?.path
    ?? value?.artifact?.path
    ?? value?.capture?.path;
  const observationCapture = acquisitionObservation?.capture ?? value?.capture;
  const relatedArtifacts = (Array.isArray(observationCapture?.relatedSurfaces)
    ? observationCapture.relatedSurfaces
    : [])
    .filter((surface) => typeof surface?.path === "string")
    .slice(0, 8);
  const explicitVisualQuestion = typeof args?.visualQuestion === "string"
    && args.visualQuestion.trim() !== "";
  const visualUnderstandingEligible = value?.perceptionRouting?.visualUnderstandingEligible !== false;
  const shouldAttachAcquisitionImage = name === "computer.acquire"
    && acquisitionObservation?.localObservation?.source === "ocr";
  const shouldAttachImage = (shouldAttachAcquisitionImage
    || mode === "capture-window"
    || (mode === "visual" && explicitVisualQuestion && visualUnderstandingEligible))
    && typeof artifactPath === "string";
  const structuredContent = sanitizeObservationMediaPaths(value, shouldAttachImage);
  if (!shouldAttachImage) return { structuredContent, imageContent: [] };
  if (typeof router?.readOwnedArtifact !== "function") {
    throw new Error("artifact.bridge_unavailable: Computer Use cannot safely read its capture asset");
  }
  const artifacts = [{
    path: artifactPath,
    screenshotId: acquisitionObservation?.scene?.screenshotId ?? value?.scene?.screenshotId,
    windowId: acquisitionObservation?.scene?.windowId ?? value?.scene?.windowId,
    zIndex: 0,
  }, ...relatedArtifacts.map((surface) => ({
    path: surface.path,
    screenshotId: surface.screenshotId,
    windowId: String(surface.hwnd),
    zIndex: surface.zIndex,
    originX: surface.x,
    originY: surface.y,
    width: surface.width,
    height: surface.height,
  }))];
  const imageContent = [];
  for (const artifact of artifacts) {
    const bytes = await router.readOwnedArtifact(artifact.path, { maxBytes: 20 * 1024 * 1024 });
    if (!Buffer.isBuffer(bytes)
      || bytes.byteLength < 8
      || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      throw new Error("artifact.invalid: Computer Use capture is not a PNG image");
    }
    const hasScreenshotIdentity = artifact.screenshotId !== undefined
      && artifact.windowId !== undefined;
    imageContent.push({
      type: "image",
      data: bytes.toString("base64"),
      mimeType: "image/png",
      ...(hasScreenshotIdentity ? { _meta: {
        "computerUse/screenshot": {
          screenshotId: String(artifact.screenshotId),
          windowId: String(artifact.windowId),
          zIndex: Number.isFinite(artifact.zIndex) ? artifact.zIndex : 0,
          ...(Number.isFinite(artifact.originX) ? { originX: artifact.originX } : {}),
          ...(Number.isFinite(artifact.originY) ? { originY: artifact.originY } : {}),
          ...(Number.isFinite(artifact.width) ? { width: artifact.width } : {}),
          ...(Number.isFinite(artifact.height) ? { height: artifact.height } : {}),
        },
      } } : {}),
    });
  }
  return {
    structuredContent,
    imageContent,
  };
}

function sanitizeObservationMediaPaths(value, hasImageContent) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeObservationMediaPaths(entry, hasImageContent));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "path" || key === "imagePath" || key === "outputPath") && typeof entry === "string") continue;
    result[key] = sanitizeObservationMediaPaths(entry, hasImageContent);
  }
  if (value.artifact && typeof value.artifact === "object") {
    result.artifact = {
      ...result.artifact,
      ...(hasImageContent ? { delivery: "mcp-image-content" } : {}),
    };
  }
  return result;
}

/**
 * Keep the provider's full observation in memory for admission and action
 * grounding, but expose a compact model-facing projection over MCP. OCR
 * elements otherwise repeat provenance, hashes, and identical geometry for
 * every recognized fragment, which can turn one screen into a result large
 * enough to require several unrelated file reads before the agent can act.
 */
export function compactComputerUseResult(value) {
  if (Array.isArray(value)) return value.map(compactComputerUseResult);
  if (!value || typeof value !== "object") return value;

  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (value.scene && (key === "elements" || key === "localObservation" || key === "semanticProbe")) {
      continue;
    }
    if (key === "capture" && entry && typeof entry === "object") {
      // `computer.act` embeds a complete automatic post-action observation
      // under `capture`; only a raw screenshot payload should be reduced to
      // width/height metadata. Dropping the nested OCR evidence here forces the
      // Agent to observe again, allowing unrelated dynamic regions to steal
      // verification from the action target.
      compacted.capture = isObservationEnvelope(entry)
        ? compactComputerUseResult(entry)
        : compactCapture(entry);
      continue;
    }
    if (key === "window" && entry && typeof entry === "object") {
      compacted.window = compactWindow(entry);
      continue;
    }
    if (key === "windows" && Array.isArray(entry)) {
      compacted.windows = entry.map(compactWindow);
      continue;
    }
    if (key === "surfaceReceipt" && entry && typeof entry === "object") {
      compacted.surfaceReceipt = compactSurfaceReceipt(entry);
      continue;
    }
    if (key === "surfaceProvenance" && entry && typeof entry === "object") {
      compacted.surfaceProvenance = compactSurfaceProvenance(entry);
      continue;
    }
    if (key === "auditEvents" && Array.isArray(entry)) {
      compacted.auditEvents = entry.slice(-12).map((event) => (
        event && typeof event === "object"
          ? {
              ...(event.type !== undefined ? { type: event.type } : {}),
              ...(event.at !== undefined ? { at: event.at } : {}),
            }
          : event
      ));
      continue;
    }
    if (key === "coordinateScale" || key === "timings") {
      continue;
    }
    if (key === "applications" && Array.isArray(entry)) {
      compacted.applications = entry.map(compactApplication);
      compacted.applicationCount = entry.length;
      continue;
    }
    if (key === "elements" && Array.isArray(entry)) {
      compacted.elements = entry.map(compactPerceptionElement);
      compacted.elementCount = entry.length;
      continue;
    }
    if (key === "scene" && entry && typeof entry === "object") {
      compacted.scene = entry;
      continue;
    }
    compacted[key] = compactComputerUseResult(entry);
  }

  if (Array.isArray(value.elements) && value.elements.length > 0) {
    const repeatedText = value.elements.map((element) => element?.name).filter(Boolean).join("\n");
    if (compacted.text === repeatedText) delete compacted.text;
  }
  return compacted;
}

function isObservationEnvelope(value) {
  return value && typeof value === "object" && (
    value.observationId !== undefined
    || value.localObservation !== undefined
    || value.perceptionRouting !== undefined
    || value.surfaceReceipt !== undefined
  );
}

function compactApplication(application) {
  if (!application || typeof application !== "object") return application;
  return {
    applicationToken: application.applicationToken,
    name: application.name,
    state: application.state ?? (
      application.active ? "active" : application.running ? "recoverable" : "installed"
    ),
  };
}

function compactWindow(window) {
  if (!window || typeof window !== "object") return window;
  return {
    ...(window.id !== undefined ? { id: window.id } : {}),
    ...(window.windowId !== undefined && window.id === undefined ? { windowId: window.windowId } : {}),
    ...(window.title !== undefined ? { title: window.title } : {}),
    ...(window.pid !== undefined ? { pid: window.pid } : {}),
    ...(window.bounds !== undefined ? { bounds: compactComputerUseResult(window.bounds) } : {}),
  };
}

function compactCapture(capture) {
  if (!capture || typeof capture !== "object") return capture;
  return {
    ...(capture.status !== undefined ? { status: capture.status } : {}),
    ...(capture.title !== undefined ? { title: capture.title } : {}),
    ...(capture.method !== undefined ? { method: capture.method } : {}),
    ...(capture.hwnd !== undefined ? { hwnd: capture.hwnd } : {}),
    ...(capture.width !== undefined ? { width: capture.width } : {}),
    ...(capture.height !== undefined ? { height: capture.height } : {}),
  };
}

function compactSurfaceReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return receipt;
  return {
    ...(receipt.id !== undefined ? { id: receipt.id } : {}),
    ...(receipt.generation !== undefined ? { generation: receipt.generation } : {}),
    ...(receipt.windowId !== undefined ? { windowId: receipt.windowId } : {}),
    ...(receipt.observationId !== undefined ? { observationId: receipt.observationId } : {}),
    ...(receipt.screenshotId !== undefined && receipt.screenshotId !== receipt.observationId
      ? { screenshotId: receipt.screenshotId }
      : {}),
    ...(receipt.capturedAt !== undefined ? { capturedAt: receipt.capturedAt } : {}),
  };
}

function compactSurfaceProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") return provenance;
  return {
    ...(provenance.identityVerified !== undefined
      ? { identityVerified: provenance.identityVerified }
      : {}),
    ...(provenance.binding !== undefined ? { binding: provenance.binding } : {}),
  };
}

function compactPerceptionElement(element) {
  if (!element || typeof element !== "object") return element;
  if (element.source === "ocr") {
    return {
      ...(element.name !== undefined ? { name: element.name } : {}),
      ...(element.bounds !== undefined ? { bounds: compactComputerUseResult(element.bounds) } : {}),
      source: "ocr",
      observationOnly: true,
      ...(element.exact === true ? { exact: true } : {}),
    };
  }
  const compacted = {};
  for (const key of [
    "elementToken",
    "elementIndex",
    "role",
    "name",
    "actions",
    "bounds",
    "confidence",
    "source",
  ]) {
    if (element[key] !== undefined) compacted[key] = compactComputerUseResult(element[key]);
  }
  if (element.value !== undefined && element.value !== element.name) compacted.value = element.value;
  if (element.state && Object.keys(element.state).length > 0) compacted.state = compactComputerUseResult(element.state);
  for (const flag of [
    "exact",
    "approvedActionLabel",
    "passwordRegion",
    "paymentRegion",
    "privateRegion",
  ]) {
    if (element[flag] === true) compacted[flag] = true;
  }
  return compacted;
}

export async function observeComputer(router, args, requestContext) {
  const { mode, ...options } = args;
  if (mode === "state") return router.listState(options);
  if (mode === "semantic" || mode === "ocr-region") {
    return router.capture({
      ...options,
      mode,
      ...(requestContext === undefined ? {} : { requestContext }),
    });
  }
  if (mode === "screenshot") {
    const { visualQuestion: _ignoredVisualQuestion, ...screenshotOptions } = options;
    return router.capture({
      ...screenshotOptions,
      mode,
      ...(requestContext === undefined ? {} : { requestContext }),
    });
  }
  if (mode === "visual") {
    const visualQuestion = typeof options.visualQuestion === "string"
      ? options.visualQuestion.trim()
      : "";
    if (!visualQuestion) {
      throw new Error("visual_question_required: mode=visual requires one concrete unresolved visual question");
    }
    return router.capture({
      ...options,
      visualQuestion,
      mode: "screenshot",
      requestedMode: "visual",
      ...(requestContext === undefined ? {} : { requestContext }),
    });
  }
  if (mode === "capture-window") {
    return router.capture({
      ...options,
      mode: "screenshot",
      requestedMode: "capture-window",
      ...(requestContext === undefined ? {} : { requestContext }),
    });
  }
  if (mode === "diff") return router.observeDiff(options);
  throw new Error(`observe_mode_not_found: ${mode}`);
}

export async function acquireComputer(router, args, requestContext, options = {}) {
  if (typeof args.applicationName === "string" && args.applicationName.trim() !== "") {
    const resolved = await resolveFreshApplicationName(router, args.applicationName);
    if (!resolved.applicationToken) return resolved;
    const { applicationName: _applicationName, ...remainingArgs } = args;
    args = { ...remainingArgs, applicationToken: resolved.applicationToken };
  }
  if (acquisitionSelectorCount(args) === 0) {
    return freshAcquisitionTargets(router);
  }
  let access;
  try {
    access = await router.requestAccess({
      ...args,
      requestContext,
      ...(options.activationPolicy ? { activationPolicy: options.activationPolicy } : {}),
    });
  } catch (error) {
    if (error instanceof ComputerUseMcpError && error.code === "application.token_invalid") {
      return freshAcquisitionTargets(router);
    }
    throw error;
  }
  if (
    (access?.status !== "granted" && access?.status !== "reused")
    || typeof router.capture !== "function"
  ) {
    return access;
  }
  try {
    const initialObservationMode = options.initialObservationMode === "screenshot"
      ? "screenshot"
      : "semantic";
    let initialObservation = await router.capture({
      mode: initialObservationMode,
      ...(requestContext === undefined ? {} : { requestContext }),
    });
    if (initialObservationMode === "semantic" && (
      initialObservation?.elementCount === 0
      || (Array.isArray(initialObservation?.elements) && initialObservation.elements.length === 0)
    )) {
      initialObservation = await router.capture({
        mode: "screenshot",
        ...(requestContext === undefined ? {} : { requestContext }),
      });
    }
    return {
      ...access,
      initialObservation,
    };
  } catch {
    // Access remains valid when the optional first semantic observation is
    // unavailable. The caller can fall back to computer.observe without
    // replaying or abandoning the controller acquisition.
    return access;
  }
}

async function resolveFreshApplicationName(router, requestedName) {
  const discovery = await freshAcquisitionTargets(router);
  const normalizedRequestedName = requestedName.trim().normalize("NFC");
  const matches = discovery.applications.filter((application) => (
    typeof application?.name === "string"
    && application.name.trim().normalize("NFC") === normalizedRequestedName
  ));
  if (matches.length === 1) return matches[0];
  return {
    ...discovery,
    requestedApplicationName: requestedName,
    nextAction: matches.length === 0
      ? "No exact current application name matched. Select a fresh applicationToken or windowId from this result."
      : "The exact application name is ambiguous. Select the intended fresh applicationToken or windowId from this result.",
  };
}

async function freshAcquisitionTargets(router) {
  if (typeof router.listState !== "function") {
    throw new ComputerUseMcpError(
      "window.selector_required",
      "Fresh target discovery is unavailable; select a target from computer.observe mode=\"state\".",
      { retryable: true, nextTool: "computer.observe" },
    );
  }
  let state = await router.listState({ includeInstalled: false });
  const applications = Array.isArray(state?.applications) ? state.applications : [];
  if (applications.length === 0 && state?.desktopState?.status !== "locked") {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, EMPTY_ACQUISITION_DISCOVERY_RETRY_MS));
    state = await router.listState({ includeInstalled: false });
  }
  return {
    status: "target_required",
    approval: null,
    controller: null,
    overlay: null,
    foregroundWindow: state?.foregroundWindow ?? null,
    windows: Array.isArray(state?.windows) ? state.windows : [],
    applications: Array.isArray(state?.applications) ? state.applications : [],
    nextAction: "Select the matching fresh applicationToken or windowId from this result, then call computer.acquire again.",
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function normalizeComputerActArgs(args = {}) {
  const outerAction = args?.action;
  const nestedAction = outerAction?.action;
  if (!outerAction || typeof outerAction !== "object" || Array.isArray(outerAction)
    || typeof outerAction.kind === "string"
    || !nestedAction || typeof nestedAction !== "object" || Array.isArray(nestedAction)
    || typeof nestedAction.kind !== "string") {
    return args;
  }
  const { action: _discardedWrapper, ...forwardedActionFields } = outerAction;
  return {
    ...args,
    action: {
      ...forwardedActionFields,
      ...nestedAction,
    },
  };
}

function acquisitionSelectorCount(args = {}) {
  return [
    args.target === "foreground",
    args.windowId !== undefined,
    typeof args.titlePart === "string" && args.titlePart.trim() !== "",
    typeof args.applicationToken === "string" && args.applicationToken.trim() !== "",
    typeof args.applicationName === "string" && args.applicationName.trim() !== "",
  ].filter(Boolean).length;
}

function withResultContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
      value,
      includeUserOverlay: false,
    };
  }
  return {
    ...value,
    resultSchemaVersion: MCP_RESULT_SCHEMA_VERSION,
    includeUserOverlay: false,
  };
}

export function createServerShutdown({
  router,
  server,
  cleanup = () => {},
  setExitCode = (code) => {
    process.exitCode = code;
  },
}) {
  let requestedExitCode = 0;
  let shutdownPromise = null;
  let shutdownComplete = false;
  return function shutdown(code = 0) {
    requestedExitCode = Math.max(requestedExitCode, code);
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        try {
          await router.close();
        } catch {
          // Continue shutting down the MCP transport even if provider cleanup fails.
        }
        try {
          await server.close();
        } catch {
          // Exit after both independent cleanup stages have been attempted.
        }
        try {
          await cleanup();
        } catch {
          // Handler cleanup must not prevent the process from receiving its exit code.
        }
        shutdownComplete = true;
        setExitCode(requestedExitCode);
      })();
    } else if (shutdownComplete) {
      setExitCode(requestedExitCode);
    }
    return shutdownPromise;
  };
}

export function registerServerShutdownHandlers({
  shutdown,
  stdin = process.stdin,
  processTarget = process,
}) {
  const onEnd = () => {
    void shutdown(0);
  };
  const onClose = () => {
    void shutdown(0);
  };
  const onSigint = () => {
    void shutdown(0);
  };
  const onSigterm = () => {
    void shutdown(0);
  };
  const onUncaughtException = (error) => {
    processTarget.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    void shutdown(1);
  };
  stdin.on("end", onEnd);
  stdin.on("close", onClose);
  processTarget.on("SIGINT", onSigint);
  processTarget.on("SIGTERM", onSigterm);
  processTarget.on("uncaughtException", onUncaughtException);

  let registered = true;
  return function unregister() {
    if (!registered) return;
    registered = false;
    stdin.off("end", onEnd);
    stdin.off("close", onClose);
    processTarget.off("SIGINT", onSigint);
    processTarget.off("SIGTERM", onSigterm);
    processTarget.off("uncaughtException", onUncaughtException);
  };
}

export function shouldAutoStartComputerUseMcpServer(options = {}) {
  const argv = options.argv ?? process.argv;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  return Boolean(argv[1]) && resolve(argv[1]) === fileURLToPath(moduleUrl);
}

if (shouldAutoStartComputerUseMcpServer()) {
  await main();
}
