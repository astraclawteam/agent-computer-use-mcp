import { randomUUID } from "node:crypto";

const TASK_TTL_MS = 120_000;
const MAX_PUBLIC_CANDIDATES = 80;
const MAX_PUBLIC_FACTS = 120;
const pendingTasks = new Map();

export async function runGenericTaskHostContract({
  router,
  args = {},
  requestContext,
  signal,
  acquire,
}) {
  const startedAt = Date.now();
  try {
    const applicationName = requiredText(args.applicationName, "applicationName", 256);
    const goal = requiredText(args.goal, "goal", 2_000);
    const scopeKey = taskScopeKey(requestContext);
    pruneExpiredTasks(startedAt);
    const taskToken = optionalText(args.taskToken);
    const candidateId = optionalText(args.candidateId);
    const decision = optionalText(args.decision);
    if (candidateId && decision) {
      return failureResult(startedAt, {
        code: "task.decision_contract_invalid",
        message: "Supply either one candidateId or one decision, never both.",
      });
    }

    if (!taskToken) {
      if (candidateId || decision || args.text !== undefined) {
        return failureResult(startedAt, {
          code: "task.token_required",
          message: "candidateId, text, and decision require the exact opaque taskToken returned by computer.task.",
        });
      }
      return startTask({
        router,
        acquire,
        applicationName,
        goal,
        scopeKey,
        signal,
        requestContext,
        startedAt,
      });
    }

    const task = pendingTasks.get(taskToken);
    if (!task || task.expiresAt <= startedAt || task.scopeKey !== scopeKey
      || task.applicationName !== applicationName || task.goal !== goal) {
      pendingTasks.delete(taskToken);
      return failureResult(startedAt, {
        code: "task.token_invalid",
        message: "The opaque Host task token is invalid, expired, or belongs to a different goal scope.",
      });
    }
    task.expiresAt = startedAt + TASK_TTL_MS;

    if (decision) {
      return decideTask({ task, decision, startedAt, router, acquire, signal, requestContext });
    }
    if (!candidateId) {
      return taskResult(startedAt, {
        outcome: "not-applied",
        released: true,
        phase: "decision-required",
        taskToken,
        candidates: publicCandidates(task.candidates),
        facts: task.facts,
        factsTruncated: task.factsTruncated,
        allowedDecisions: allowedDecisions(),
        error: {
          code: "task.decision_required",
          message: "Select one current opaque candidate or provide an explicit task decision.",
        },
      });
    }

    const selected = task.candidates.find((candidate) => candidate.candidateId === candidateId);
    if (!selected) {
      return taskResult(startedAt, {
        outcome: "not-applied",
        released: true,
        phase: task.applicationToken ? "decision-required" : "application-selection",
        taskToken,
        candidates: publicCandidates(task.candidates),
        facts: task.facts,
        factsTruncated: task.factsTruncated,
        allowedDecisions: allowedDecisions(),
        error: {
          code: "task.candidate_invalid",
          message: "The opaque Host candidate is invalid or no longer belongs to this task state.",
        },
      });
    }

    if (selected.kind === "application") {
      if (args.text !== undefined) {
        return failureResult(startedAt, {
          code: "task.text_not_allowed",
          message: "Application selection does not accept text input.",
        }, taskToken);
      }
      task.applicationToken = selected.applicationToken;
      task.windowId = null;
      task.candidates = [];
      return observeTask({ task, router, acquire, signal, requestContext, startedAt });
    }
    if (selected.kind === "window") {
      if (args.text !== undefined) {
        return failureResult(startedAt, {
          code: "task.text_not_allowed",
          message: "Window selection does not accept text input.",
        }, taskToken);
      }
      task.applicationToken = null;
      task.windowId = selected.windowId;
      task.candidates = [];
      return observeTask({ task, router, acquire, signal, requestContext, startedAt });
    }

    return actOnTaskCandidate({
      task,
      selected,
      text: args.text,
      router,
      acquire,
      signal,
      requestContext,
      startedAt,
    });
  } catch (error) {
    return failureResult(startedAt, {
      code: error?.code ?? (signal?.aborted ? "task.cancelled" : "task.host_failure"),
      message: error instanceof Error ? error.message : "The Host generic desktop task failed.",
    }, optionalText(args.taskToken), signal?.aborted ? "indeterminate" : "not-applied");
  }
}

async function startTask({
  router,
  acquire,
  applicationName,
  goal,
  scopeKey,
  signal,
  requestContext,
  startedAt,
}) {
  const taskToken = randomUUID();
  const task = {
    taskToken,
    scopeKey,
    applicationName,
    goal,
    applicationToken: null,
    windowId: null,
    candidates: [],
    facts: [],
    factsTruncated: false,
    observed: false,
    expiresAt: startedAt + TASK_TTL_MS,
  };
  const discovery = await abortable(() => router.listState({ includeInstalled: false }), signal);
  const applications = Array.isArray(discovery?.applications) ? discovery.applications : [];
  const exact = applications.filter((application) => normalizeText(application?.name) === normalizeText(applicationName));
  if (exact.length === 1 && typeof exact[0]?.applicationToken === "string") {
    task.applicationToken = exact[0].applicationToken;
    pendingTasks.set(taskToken, task);
    return observeTask({ task, router, acquire, signal, requestContext, startedAt });
  }
  if (applications.length === 0) {
    return failureResult(startedAt, {
      code: "task.application_not_found",
      message: "The Host did not discover a running or recoverable application candidate.",
    });
  }
  task.candidates = targetCandidates(discovery);
  pendingTasks.set(taskToken, task);
  return taskResult(startedAt, {
    outcome: "not-applied",
    released: true,
    phase: "application-selection",
    taskToken,
    candidates: publicCandidates(task.candidates),
    facts: [],
    factsTruncated: false,
    allowedDecisions: ["report", "cancel"],
    error: {
      code: exact.length > 1 ? "task.application_ambiguous" : "task.application_selection_required",
      message: "Select one opaque Host application candidate and call computer.task again with the same taskToken.",
    },
  });
}

async function decideTask({ task, decision, startedAt, router, acquire, signal, requestContext }) {
  if (decision === "complete") {
    if (!task.observed) {
      return taskResult(startedAt, {
        outcome: "not-applied",
        released: true,
        phase: task.applicationToken ? "decision-required" : "application-selection",
        taskToken: task.taskToken,
        candidates: publicCandidates(task.candidates),
        facts: task.facts,
        factsTruncated: task.factsTruncated,
        allowedDecisions: allowedDecisions(),
        error: {
          code: "task.completion_unobserved",
          message: "The Host has not observed a Scene that can establish the requested visible state.",
        },
      });
    }
    pendingTasks.delete(task.taskToken);
    return taskResult(startedAt, {
      outcome: "committed",
      released: true,
      phase: "complete",
      facts: task.facts,
      factsTruncated: task.factsTruncated,
    });
  }
  if (decision === "report" || decision === "cancel") {
    pendingTasks.delete(task.taskToken);
    return taskResult(startedAt, {
      outcome: "not-applied",
      released: true,
      phase: decision === "report" ? "reported" : "cancelled",
      facts: task.facts,
      factsTruncated: task.factsTruncated,
    });
  }
  if (decision !== "reobserve") {
    return failureResult(startedAt, {
      code: "task.decision_invalid",
      message: "decision must be complete, reobserve, report, or cancel.",
    }, task.taskToken);
  }
  if (!hasTargetSelector(task)) {
    return taskResult(startedAt, {
      outcome: "not-applied",
      released: true,
      phase: "application-selection",
      taskToken: task.taskToken,
      candidates: publicCandidates(task.candidates),
      facts: [],
      factsTruncated: false,
      allowedDecisions: ["report", "cancel"],
      error: {
        code: "task.application_selection_required",
        message: "Select an application candidate before requesting a desktop observation.",
      },
    });
  }
  return observeTask({ task, router, acquire, signal, requestContext, startedAt });
}

async function observeTask({ task, router, acquire, signal, requestContext, startedAt }) {
  const lease = await withLease({ task, router, acquire, signal, requestContext }, async ({ scene }) => {
    const projection = projectScene(scene);
    if (projection.messaging) {
      pendingTasks.delete(task.taskToken);
      return {
        outcome: "not-applied",
        phase: "failed",
        error: {
          code: "task.messaging_surface_denied",
          message: "A messaging Scene cannot be operated through computer.task; use computer.message.",
        },
      };
    }
    updateTaskScene(task, projection);
    return {
      outcome: "not-applied",
      phase: "decision-required",
      taskToken: task.taskToken,
      candidates: publicCandidates(task.candidates),
      facts: task.facts,
      factsTruncated: task.factsTruncated,
      allowedDecisions: allowedDecisions(),
    };
  });
  return leaseResult(startedAt, task, lease);
}

async function actOnTaskCandidate({
  task,
  selected,
  text,
  router,
  acquire,
  signal,
  requestContext,
  startedAt,
}) {
  if (selected.inputRequired && (typeof text !== "string" || text.length > 20_000)) {
    return taskResult(startedAt, {
      outcome: "not-applied",
      released: true,
      phase: "decision-required",
      taskToken: task.taskToken,
      candidates: publicCandidates(task.candidates),
      facts: task.facts,
      factsTruncated: task.factsTruncated,
      allowedDecisions: allowedDecisions(),
      error: {
        code: "task.text_required",
        message: "The selected Host candidate requires exact text input within 20000 characters.",
      },
    });
  }
  if (!selected.inputRequired && text !== undefined) {
    return taskResult(startedAt, {
      outcome: "not-applied",
      released: true,
      phase: "decision-required",
      taskToken: task.taskToken,
      candidates: publicCandidates(task.candidates),
      facts: task.facts,
      factsTruncated: task.factsTruncated,
      allowedDecisions: allowedDecisions(),
      error: {
        code: "task.text_not_allowed",
        message: "The selected Host candidate does not accept text input.",
      },
    });
  }

  const lease = await withLease({ task, router, acquire, signal, requestContext }, async ({ scene }) => {
    const current = projectScene(scene);
    if (current.messaging) {
      pendingTasks.delete(task.taskToken);
      return {
        outcome: "not-applied",
        phase: "failed",
        error: {
          code: "task.messaging_surface_denied",
          message: "A messaging Scene cannot be operated through computer.task; use computer.message.",
        },
      };
    }
    const matching = current.candidates.filter((candidate) => sameCandidate(candidate, selected));
    if (matching.length !== 1) {
      updateTaskScene(task, current);
      return {
        outcome: "not-applied",
        phase: "decision-required",
        taskToken: task.taskToken,
        candidates: publicCandidates(task.candidates),
        facts: task.facts,
        factsTruncated: task.factsTruncated,
        allowedDecisions: allowedDecisions(),
        error: {
          code: "task.candidate_stale",
          message: "The selected Host candidate no longer resolves uniquely in the fresh Scene. Select from the refreshed candidates; no action was applied.",
        },
      };
    }

    const currentCandidate = matching[0];
    const action = actionForCandidate(currentCandidate, text);
    const navigationClick = isNavigationClickCandidate(currentCandidate);
    let receipt;
    try {
      receipt = await abortable(() => router.act({
        action: { ...action, captureAfter: true },
        requestContext,
        signal,
      }), signal);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.mutationMayHaveStarted = true;
      throw failure;
    }
    const providerOutcome = canonicalOutcome(receipt?.outcome ?? receipt?.status);
    if (providerOutcome === "indeterminate" && !navigationClick) {
      pendingTasks.delete(task.taskToken);
      return {
        outcome: providerOutcome,
        phase: "failed",
        action: publicAction(currentCandidate, providerOutcome),
        error: {
          code: "task.action_indeterminate",
          message: "The Host cannot prove whether the action was applied. The action was not replayed and the task was closed.",
          replayAllowed: false,
        },
      };
    }

    let postScene = receipt?.capture?.scene;
    if (!isFreshSceneAfter(postScene, scene)) {
      try {
        postScene = (await abortable(
          () => router.capture({ mode: "screenshot", requestContext }),
          signal,
        ))?.scene;
      } catch (error) {
        if (!navigationClick || signal?.aborted) throw error;
        return navigationVerificationFailure({
          task,
          candidate: currentCandidate,
          providerOutcome,
          beforeScene: scene,
          afterScene: postScene,
          code: "task.navigation_verification_unavailable",
          message: "The navigation click may have been applied, but the Host could not obtain a fresh post-action Scene. The task was closed and the click was not replayed.",
        });
      }
    }
    if (navigationClick && !isFreshSceneAfter(postScene, scene)) {
      return navigationVerificationFailure({
        task,
        candidate: currentCandidate,
        providerOutcome,
        beforeScene: scene,
        afterScene: postScene,
        code: "task.navigation_verification_stale",
        message: "The navigation click may have been applied, but the Host did not receive a newer post-action Scene. The task was closed and the click was not replayed.",
      });
    }
    let post;
    try {
      post = projectScene(postScene);
    } catch (error) {
      if (!navigationClick) throw error;
      return navigationVerificationFailure({
        task,
        candidate: currentCandidate,
        providerOutcome,
        beforeScene: scene,
        afterScene: postScene,
        code: "task.navigation_verification_invalid",
        message: "The navigation click may have been applied, but its fresh post-action Scene was invalid. The task was closed and the click was not replayed.",
      });
    }
    if (post.messaging) {
      pendingTasks.delete(task.taskToken);
      return {
        outcome: "not-applied",
        phase: "failed",
        action: publicAction(currentCandidate, "not-applied"),
        error: {
          code: "task.messaging_surface_denied",
          message: "The action reached a messaging Scene. The generic task was closed without further interaction.",
        },
      };
    }

    let navigationVerification = navigationClick
      ? verifyNavigationClickPostcondition({
          beforeScene: scene,
          afterScene: postScene,
          candidate: currentCandidate,
        })
      : null;
    if (navigationClick && navigationVerification?.verified !== true) {
      const relatedSurfaceAnchor = navigationSurfaceAnchor(scene, currentCandidate);
      try {
        const forcedScene = (await abortable(() => router.capture({
          mode: "screenshot",
          forceScreenshotSurfaceCapture: true,
          includeRelatedSurfaces: true,
          ...(relatedSurfaceAnchor ? { relatedSurfaceAnchor } : {}),
          requestContext,
        }), signal))?.scene;
        if (isFreshSceneAfter(forcedScene, postScene)) {
          const forcedPost = projectScene(forcedScene);
          if (forcedPost.messaging) {
            pendingTasks.delete(task.taskToken);
            return {
              outcome: "not-applied",
              phase: "failed",
              action: publicAction(currentCandidate, "not-applied"),
              error: {
                code: "task.messaging_surface_denied",
                message: "The action reached a messaging Scene. The generic task was closed without further interaction.",
              },
            };
          }
          postScene = forcedScene;
          post = forcedPost;
          navigationVerification = verifyNavigationClickPostcondition({
            beforeScene: scene,
            afterScene: postScene,
            candidate: currentCandidate,
          });
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    const outcome = navigationVerification?.verified === true
      ? "committed"
      : navigationClick && providerOutcome === "committed"
        ? "indeterminate"
        : providerOutcome;
    const publicReceipt = navigationVerification
      ? navigationReceipt(providerOutcome, outcome, navigationVerification)
      : null;
    if (navigationClick && outcome === "indeterminate") {
      pendingTasks.delete(task.taskToken);
      return {
        outcome,
        phase: "failed",
        action: publicAction(currentCandidate, outcome, publicReceipt),
        error: {
          code: providerOutcome === "committed"
            ? "task.navigation_postcondition_unverified"
            : "task.action_indeterminate",
          message: providerOutcome === "committed"
            ? "The provider reported the navigation click as committed, but the fresh Host Scene did not prove its navigation postcondition. The task was closed and the click was not replayed."
            : "The Host cannot prove whether the navigation click was applied. The action was not replayed and the task was closed.",
          replayAllowed: false,
        },
      };
    }
    updateTaskScene(task, post);
    return {
      outcome,
      phase: "decision-required",
      taskToken: task.taskToken,
      candidates: publicCandidates(task.candidates),
      facts: task.facts,
      factsTruncated: task.factsTruncated,
      action: publicAction(currentCandidate, outcome, publicReceipt),
      allowedDecisions: allowedDecisions(),
      ...(outcome === "not-applied" ? {
        error: {
          code: "task.action_not_applied",
          message: "The selected action was not applied. Reobserve or report; the Host did not replay it.",
          replayAllowed: false,
        },
      } : {}),
    };
  });
  return leaseResult(startedAt, task, lease);
}

async function withLease({ task, router, acquire, signal, requestContext }, operation) {
  let acquired = false;
  let released = true;
  let value;
  let error;
  try {
    const access = await abortable(() => acquire({
      ...(task.applicationToken ? { applicationToken: task.applicationToken } : {}),
      ...(task.windowId !== null && task.windowId !== undefined ? { windowId: task.windowId } : {}),
      tier: "full",
      agentId: requestContext?.agentId ?? "generic-desktop-task-host",
      reason: "Host-owned generic desktop task",
    }, { initialObservationMode: "screenshot" }), signal);
    acquired = access?.status === "granted" || access?.status === "reused";
    if (!acquired) {
      if (Array.isArray(access?.applications) && access.applications.length > 0) {
        const failedApplicationToken = task.applicationToken;
        task.applicationToken = null;
        task.windowId = null;
        task.candidates = targetCandidates(
          { applications: access.applications },
          { excludeApplicationTokens: [failedApplicationToken] },
        );
        task.facts = [];
        task.factsTruncated = false;
        value = {
          outcome: "not-applied",
          phase: "application-selection",
          taskToken: task.taskToken,
          candidates: publicCandidates(task.candidates),
          facts: [],
          factsTruncated: false,
          allowedDecisions: ["report", "cancel"],
          error: {
            code: "task.application_stale",
            message: "The application identity changed. Select one fresh Host application candidate; no action was applied.",
          },
        };
      } else {
        value = {
          outcome: "not-applied",
          phase: "failed",
          error: {
            code: "task.acquire_not_granted",
            message: "The Host did not grant a controller lease for the selected application.",
          },
        };
      }
    } else {
      const scene = access?.initialObservation?.scene
        ?? (await abortable(() => router.capture({ mode: "screenshot", requestContext }), signal))?.scene;
      assertScene(scene);
      value = await operation({ scene });
    }
  } catch (caught) {
    if (!acquired && !signal?.aborted && isUnavailableTargetError(caught)) {
      try {
        const discovery = await router.listState({ includeInstalled: false });
        const failedApplicationToken = task.applicationToken;
        task.applicationToken = null;
        task.windowId = null;
        const semanticOwner = await probeForegroundSemanticOwner({
          discovery,
          applicationName: task.applicationName,
          router,
          acquire,
          signal,
          requestContext,
        });
        if (!semanticOwner.released) released = false;
        if (semanticOwner.match) {
          task.windowId = semanticOwner.windowId;
          updateTaskScene(task, semanticOwner.projection);
          value = {
            outcome: "not-applied",
            phase: "decision-required",
            taskToken: task.taskToken,
            candidates: publicCandidates(task.candidates),
            facts: task.facts,
            factsTruncated: task.factsTruncated,
            allowedDecisions: allowedDecisions(),
          };
        } else {
          task.candidates = targetCandidates(
            discovery,
            { excludeApplicationTokens: [failedApplicationToken] },
          );
          task.facts = [];
          task.factsTruncated = false;
          task.expiresAt = Date.now() + TASK_TTL_MS;
          pendingTasks.set(task.taskToken, task);
          value = {
            outcome: "not-applied",
            phase: "application-selection",
            taskToken: task.taskToken,
            candidates: publicCandidates(task.candidates),
            facts: [],
            factsTruncated: false,
            allowedDecisions: ["report", "cancel"],
            error: {
              code: "task.target_selection_required",
              message: "The exact process identity had no controllable window and the foreground Scene did not prove a unique semantic owner. Select one fresh opaque visible-window candidate when its owning product is semantically related to the goal. Report only when no candidate is a defensible semantic match. No action was applied.",
            },
          };
        }
      } catch (discoveryError) {
        error = discoveryError;
      }
    } else {
      error = caught;
    }
  } finally {
    if (acquired) {
      try {
        const release = await router.cancel({
          reason: signal?.aborted ? "operator-stop" : "generic-task-step-complete",
          requestContext,
        });
        released = release?.status === "cancelled" || release?.status === "idle";
      } catch {
        released = false;
      }
    }
  }
  return { value, error, released };
}

function leaseResult(startedAt, task, lease) {
  if (!lease.released) {
    pendingTasks.delete(task.taskToken);
    return taskResult(startedAt, {
      outcome: "indeterminate",
      released: false,
      phase: "failed",
      error: {
        code: "task.release_failed",
        message: "The Host could not confirm controller release. The task was closed and no action may be replayed.",
        replayAllowed: false,
      },
    });
  }
  if (lease.error) {
    const cancelled = lease.error?.name === "AbortError" || lease.error?.code === "task.cancelled";
    const mutationMayHaveStarted = cancelled || lease.error?.mutationMayHaveStarted === true;
    pendingTasks.delete(task.taskToken);
    return taskResult(startedAt, {
      outcome: mutationMayHaveStarted ? "indeterminate" : "not-applied",
      released: true,
      phase: cancelled ? "cancelled" : "failed",
      error: {
        code: cancelled
          ? "task.cancelled"
          : mutationMayHaveStarted
            ? "task.action_failed_indeterminate"
            : (lease.error?.code ?? "task.host_failure"),
        message: cancelled
          ? "The in-flight Host action was cancelled, was not replayed, and control was released."
          : mutationMayHaveStarted
            ? "The Host action failed without a canonical receipt. Its effect is indeterminate, it was not replayed, and control was released."
            : (lease.error instanceof Error ? lease.error.message : "The Host generic desktop task failed."),
        replayAllowed: false,
      },
    });
  }
  return taskResult(startedAt, { ...lease.value, released: true });
}

function projectScene(scene) {
  assertScene(scene);
  const elements = scene.elements;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const messaging = elements.some((element) => new Set([
    "conversation", "conversation-title", "message-editor", "send", "message-bubble", "transcript",
  ]).has(element?.role));
  const facts = [];
  const candidates = [];
  for (const element of elements) {
    if (element?.evidenceConsistency !== "consistent" || !hasConsistentOwnership(element, byId)) continue;
    const label = elementLabel(element);
    const parentRole = typeof element.parentId === "string" ? byId.get(element.parentId)?.role ?? null : null;
    const evidenceSources = evidenceSourcesFor(element);
    if (label && facts.length < MAX_PUBLIC_FACTS) {
      facts.push(Object.freeze({ label, role: String(element.role ?? "unknown"), parentRole, evidenceSources }));
    }
    if (element?.actionable !== true || !label || candidates.length >= MAX_PUBLIC_CANDIDATES) continue;
    for (const action of candidateActions(element)) {
      if (candidates.length >= MAX_PUBLIC_CANDIDATES) break;
      candidates.push(Object.freeze({
        kind: "scene",
        candidateId: `candidate:${randomUUID()}`,
        label,
        role: String(element.role ?? "unknown"),
        parentRole,
        action: action.publicAction,
        actionKind: action.actionKind,
        inputRequired: action.actionKind === "type_text",
        evidenceSources,
        semanticKey: typeof element.semanticKey === "string" ? element.semanticKey : null,
        elementId: element.id,
      }));
    }
  }
  return {
    messaging,
    candidates,
    facts,
    factsTruncated: elements.filter((element) => (
      element?.evidenceConsistency === "consistent" && elementLabel(element)
    )).length > facts.length,
  };
}

function candidateActions(element) {
  const actions = new Set(Array.isArray(element?.actions) ? element.actions : []);
  const result = [];
  if (actions.has("activate_window")) result.push({ publicAction: "activate", actionKind: "activate_window" });
  if (actions.has("click")) result.push({ publicAction: "select", actionKind: "click" });
  if (element?.type === "Editable" && actions.has("type_text")) {
    result.push({ publicAction: "edit", actionKind: "type_text" });
  }
  return result;
}

function actionForCandidate(candidate, text) {
  if (candidate.actionKind === "activate_window") {
    return { kind: "activate_window", elementId: candidate.elementId };
  }
  if (candidate.actionKind === "type_text") {
    return {
      kind: "type_text",
      elementId: candidate.elementId,
      value: text,
      textMode: "replace-all",
      inputBehavior: "commit",
    };
  }
  return {
    kind: "click",
    elementId: candidate.elementId,
    interactionIntent: interactionIntent(candidate),
    targetRole: targetRole(candidate),
  };
}

function interactionIntent(candidate) {
  if (candidate.role === "editable" || candidate.role.includes("search") || candidate.role.includes("input")) {
    return "focus-editable";
  }
  if (candidate.role.includes("item") || candidate.role.includes("result") || candidate.role.includes("tab")) {
    return "select-item";
  }
  return "activate-control";
}

function targetRole(candidate) {
  if (candidate.role.includes("menu")) return "menu-item";
  if (candidate.role.includes("item") || candidate.role.includes("result") || candidate.role.includes("tab")) return "list-item";
  if (candidate.role.includes("toggle") || candidate.role.includes("switch") || candidate.role.includes("checkbox")) return "toggle";
  if (candidate.role === "editable" || candidate.role.includes("search") || candidate.role.includes("input")) return "editable";
  if (candidate.role.includes("button") || candidate.role.includes("command")) return "button";
  return "other";
}

function isNavigationClickCandidate(candidate) {
  if (candidate?.actionKind !== "click") return false;
  return !["editable", "toggle"].includes(targetRole(candidate));
}

function navigationSurfaceAnchor(scene, candidate) {
  const target = scene?.elements?.find((element) => element?.id === candidate?.elementId);
  const bounds = target?.coordinate?.bounds;
  if (!isCoordinateBox(bounds)) return null;
  return {
    role: candidate.role,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

function isCoordinateBox(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

function verifyNavigationClickPostcondition({ beforeScene, afterScene, candidate }) {
  const method = "host-scene-navigation-transition";
  const beforeVersion = beforeScene?.observationVersion;
  const afterVersion = afterScene?.observationVersion;
  if (!isFreshSceneAfter(afterScene, beforeScene)) {
    return {
      status: "unavailable",
      verified: false,
      method,
      evidence: [],
      beforeObservationVersion: Number.isInteger(beforeVersion) ? beforeVersion : null,
      afterObservationVersion: Number.isInteger(afterVersion) ? afterVersion : null,
    };
  }

  const before = consistentSceneIndex(beforeScene);
  const after = consistentSceneIndex(afterScene);
  const matchingAfterTargets = after.elements.filter((element) => sceneElementMatchesCandidate(
    element,
    after.byId,
    candidate,
  ));
  if (matchingAfterTargets.length === 1
    && navigationStateAdvanced(
      before.byId.get(candidate.elementId)?.state,
      matchingAfterTargets[0]?.state,
    )) {
    return confirmedNavigationVerification(
      method,
      "target-navigation-state-advanced",
      beforeVersion,
      afterVersion,
    );
  }

  const beforeSurfaces = new Set(before.elements
    .filter(isNavigationSurface)
    .map((element) => navigationSurfaceSignature(element, before.byId)));
  const addedSurfaces = after.elements.filter((element) => (
    isNavigationSurface(element)
    && !beforeSurfaces.has(navigationSurfaceSignature(element, after.byId))
  ));
  const targetLabel = normalizeText(candidate.label);
  if (targetLabel && addedSurfaces.some((element) => normalizeText(elementLabel(element)) === targetLabel)) {
    return confirmedNavigationVerification(
      method,
      "target-labelled-destination-added",
      beforeVersion,
      afterVersion,
    );
  }

  if (addedSurfaces.some((element) => (
    element.type === "TransientSurface"
    && hasConsistentActionableDescendant(element, after.elements, after.byId)
  ))) {
    return confirmedNavigationVerification(
      method,
      "owned-actionable-transient-added",
      beforeVersion,
      afterVersion,
    );
  }

  const beforeTarget = before.byId.get(candidate.elementId);
  const beforeAnchor = beforeTarget?.parentId ? before.byId.get(beforeTarget.parentId) : null;
  const beforeAnchorSignature = beforeAnchor
    ? navigationAnchorSignature(beforeAnchor, before.byId)
    : null;
  if (matchingAfterTargets.length === 0 && beforeAnchorSignature
    && addedSurfaces.some((element) => {
      const parent = typeof element.parentId === "string" ? after.byId.get(element.parentId) : null;
      return parent
        && navigationAnchorSignature(parent, after.byId) === beforeAnchorSignature
        && hasConsistentActionableDescendant(element, after.elements, after.byId);
    })) {
    return confirmedNavigationVerification(
      method,
      "target-replaced-by-owned-navigation-surface",
      beforeVersion,
      afterVersion,
    );
  }

  return {
    status: "not-confirmed",
    verified: false,
    method,
    evidence: [],
    beforeObservationVersion: beforeVersion,
    afterObservationVersion: afterVersion,
  };
}

function unavailableNavigationVerification(beforeScene, afterScene) {
  return {
    status: "unavailable",
    verified: false,
    method: "host-scene-navigation-transition",
    evidence: [],
    beforeObservationVersion: Number.isInteger(beforeScene?.observationVersion)
      ? beforeScene.observationVersion
      : null,
    afterObservationVersion: Number.isInteger(afterScene?.observationVersion)
      ? afterScene.observationVersion
      : null,
  };
}

function navigationVerificationFailure({
  task,
  candidate,
  providerOutcome,
  beforeScene,
  afterScene,
  code,
  message,
}) {
  pendingTasks.delete(task.taskToken);
  const verification = unavailableNavigationVerification(beforeScene, afterScene);
  return {
    outcome: "indeterminate",
    phase: "failed",
    action: publicAction(
      candidate,
      "indeterminate",
      navigationReceipt(providerOutcome, "indeterminate", verification),
    ),
    error: {
      code,
      message,
      replayAllowed: false,
    },
  };
}

function confirmedNavigationVerification(method, evidence, beforeObservationVersion, afterObservationVersion) {
  return {
    status: "confirmed",
    verified: true,
    method,
    evidence: [evidence],
    beforeObservationVersion,
    afterObservationVersion,
  };
}

function consistentSceneIndex(scene) {
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  return {
    byId,
    elements: scene.elements.filter((element) => hasConsistentOwnership(element, byId)),
  };
}

function isNavigationSurface(element) {
  return element?.type === "Container"
    || element?.type === "TransientSurface"
    || element?.type === "Editable";
}

function navigationSurfaceSignature(element, byId) {
  const parent = typeof element?.parentId === "string" ? byId.get(element.parentId) : null;
  return JSON.stringify([
    String(element?.type ?? ""),
    normalizeText(element?.role),
    normalizeText(element?.semanticKey),
    normalizeText(elementLabel(element)),
    parent ? navigationAnchorSignature(parent, byId) : null,
  ]);
}

function navigationAnchorSignature(element, byId) {
  const parent = typeof element?.parentId === "string" ? byId.get(element.parentId) : null;
  return JSON.stringify([
    String(element?.type ?? ""),
    normalizeText(element?.role),
    normalizeText(element?.semanticKey),
    normalizeText(elementLabel(element)),
    parent ? normalizeText(parent.role) : null,
  ]);
}

function sceneElementMatchesCandidate(element, byId, candidate) {
  if (String(element?.role ?? "unknown") !== candidate.role) return false;
  const parentRole = typeof element?.parentId === "string" ? byId.get(element.parentId)?.role ?? null : null;
  if (parentRole !== candidate.parentRole) return false;
  if (candidate.semanticKey) return element?.semanticKey === candidate.semanticKey;
  return elementLabel(element) === candidate.label;
}

function navigationStateAdvanced(beforeState, afterState) {
  const affirmative = new Set([true, 1, "true", "active", "current", "expanded", "open", "pressed", "selected"]);
  for (const key of ["active", "current", "expanded", "open", "pressed", "selected"]) {
    const before = beforeState?.[key];
    const after = afterState?.[key];
    if (before !== after && affirmative.has(after)) return true;
  }
  return false;
}

function hasConsistentActionableDescendant(surface, elements, byId) {
  return elements.some((element) => (
    element?.actionable === true
    && element.id !== surface.id
    && isDescendantOf(element, surface.id, byId)
  ));
}

function isDescendantOf(element, ancestorId, byId) {
  const visited = new Set();
  let parentId = element?.parentId;
  while (typeof parentId === "string" && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

function isFreshSceneAfter(afterScene, beforeScene) {
  return Number.isInteger(beforeScene?.observationVersion)
    && Number.isInteger(afterScene?.observationVersion)
    && afterScene.observationVersion > beforeScene.observationVersion;
}

function applicationCandidates(applications) {
  return applications
    .filter((application) => typeof application?.applicationToken === "string" && typeof application?.name === "string")
    .slice(0, MAX_PUBLIC_CANDIDATES)
    .map((application) => Object.freeze({
      kind: "application",
      candidateId: `application:${randomUUID()}`,
      label: application.name,
      role: "application",
      parentRole: "desktop",
      action: "select",
      inputRequired: false,
      evidenceSources: Object.freeze(["host.application-inventory"]),
      applicationToken: application.applicationToken,
    }));
}

function windowCandidates(windows) {
  return windows
    .filter((window) => (typeof window?.windowId === "string" || typeof window?.windowId === "number")
      && typeof window?.title === "string" && window.title.trim() !== ""
      && Number(window?.bounds?.width) > 1 && Number(window?.bounds?.height) > 1)
    .slice(0, MAX_PUBLIC_CANDIDATES)
    .map((window) => Object.freeze({
      kind: "window",
      candidateId: `window:${randomUUID()}`,
      label: window.title,
      role: "window",
      parentRole: "desktop",
      action: "select",
      inputRequired: false,
      evidenceSources: Object.freeze(["host.window-inventory"]),
      windowId: window.windowId,
    }));
}

function targetCandidates(discovery = {}, { excludeApplicationTokens = [] } = {}) {
  const visibleWindows = windowCandidates(Array.isArray(discovery?.windows) ? discovery.windows : []);
  const excluded = new Set(excludeApplicationTokens.filter((token) => typeof token === "string" && token));
  const applications = applicationCandidates(
    (Array.isArray(discovery?.applications) ? discovery.applications : [])
      .filter((application) => !excluded.has(application?.applicationToken)),
  );
  return [...visibleWindows, ...applications].slice(0, MAX_PUBLIC_CANDIDATES);
}

function hasTargetSelector(task) {
  return Boolean(task.applicationToken)
    || (task.windowId !== null && task.windowId !== undefined && task.windowId !== "");
}

function isUnavailableTargetError(error) {
  return error?.code === "window.not_found"
    || error?.code === "application.not_found"
    || error?.code === "application.token_invalid";
}

async function probeForegroundSemanticOwner({
  discovery,
  applicationName,
  router,
  acquire,
  signal,
  requestContext,
}) {
  const windowId = discovery?.foregroundWindow?.windowId ?? discovery?.foregroundWindow?.id;
  if (windowId === undefined || windowId === null || windowId === "") {
    return { match: false, released: true };
  }
  let acquired = false;
  let released = true;
  let result = { match: false };
  try {
    const access = await abortable(() => acquire({
      windowId,
      tier: "full",
      agentId: requestContext?.agentId ?? "generic-desktop-task-host",
      reason: "Host-owned semantic application resolution",
    }, { initialObservationMode: "screenshot" }), signal);
    acquired = access?.status === "granted" || access?.status === "reused";
    if (acquired) {
      const scene = access?.initialObservation?.scene
        ?? (await abortable(() => router.capture({ mode: "screenshot", requestContext }), signal))?.scene;
      const projection = projectScene(scene);
      result = {
        match: projection.messaging === false
          && projection.facts.some((fact) => semanticOwnerFactMatches(fact, applicationName)),
        projection,
        windowId,
      };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  } finally {
    if (acquired) {
      try {
        const release = await router.cancel({
          reason: signal?.aborted ? "operator-stop" : "semantic-owner-probe-complete",
          requestContext,
        });
        released = release?.status === "cancelled" || release?.status === "idle";
      } catch {
        released = false;
      }
    }
  }
  return { ...result, released };
}

function semanticOwnerFactMatches(fact, applicationName) {
  if (!["window", "main-window", "application", "document"].includes(fact?.role)) return false;
  const requested = normalizeText(applicationName);
  const observed = normalizeText(fact?.label);
  if (requested.length < 2 || observed.length < 2) return false;
  return requested === observed || observed.includes(requested) || requested.includes(observed);
}

function updateTaskScene(task, projection) {
  task.candidates = projection.candidates;
  task.facts = projection.facts;
  task.factsTruncated = projection.factsTruncated;
  task.observed = true;
  task.expiresAt = Date.now() + TASK_TTL_MS;
  pendingTasks.set(task.taskToken, task);
}

function publicCandidates(candidates = []) {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    label: candidate.label,
    role: candidate.role,
    parentRole: candidate.parentRole,
    action: candidate.action,
    inputRequired: candidate.inputRequired,
    evidenceSources: [...candidate.evidenceSources],
  }));
}

function publicAction(candidate, outcome, receipt = null) {
  return {
    label: candidate.label,
    role: candidate.role,
    parentRole: candidate.parentRole,
    action: candidate.action,
    outcome,
    ...(receipt ? { receipt } : {}),
  };
}

function navigationReceipt(providerOutcome, outcome, verification) {
  return {
    providerOutcome,
    outcome,
    postconditionVerified: verification?.verified === true,
    verificationMethod: verification?.method ?? "host-scene-navigation-transition",
    evidence: Array.isArray(verification?.evidence) ? [...verification.evidence] : [],
    beforeObservationVersion: verification?.beforeObservationVersion ?? null,
    afterObservationVersion: verification?.afterObservationVersion ?? null,
  };
}

function sameCandidate(left, right) {
  return left.kind === "scene"
    && right.kind === "scene"
    && left.label === right.label
    && left.role === right.role
    && left.parentRole === right.parentRole
    && left.actionKind === right.actionKind
    && left.semanticKey === right.semanticKey
    && JSON.stringify([...left.evidenceSources].sort()) === JSON.stringify([...right.evidenceSources].sort());
}

function evidenceSourcesFor(element) {
  return Object.freeze([...new Set((Array.isArray(element?.evidence) ? element.evidence : [])
    .map((evidence) => evidence?.source)
    .filter((source) => typeof source === "string" && source.length > 0))]);
}

function elementLabel(element) {
  for (const value of [element?.name, element?.value, element?.semanticKey, element?.role]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 1_000);
  }
  return "";
}

function assertScene(scene) {
  if (!scene || !Number.isInteger(scene.observationVersion) || scene.observationVersion < 0
    || !Array.isArray(scene.elements)) {
    const error = new Error("The Host did not return one valid versioned Scene.");
    error.code = "task.invalid_scene";
    throw error;
  }
  const ids = new Set();
  for (const element of scene.elements) {
    if (typeof element?.id !== "string" || !element.id || ids.has(element.id)
      || element.observationVersion !== scene.observationVersion) {
      const error = new Error("The Host Scene contains a duplicate, missing, or stale element identity.");
      error.code = "task.invalid_scene";
      throw error;
    }
    ids.add(element.id);
  }
  if (typeof scene.rootId !== "string" || !ids.has(scene.rootId)
    || scene.elements.some((element) => element.parentId !== null
      && (typeof element.parentId !== "string" || !ids.has(element.parentId)))) {
    const error = new Error("The Host Scene contains an invalid root or parent ownership relationship.");
    error.code = "task.invalid_scene";
    throw error;
  }
}

function hasConsistentOwnership(element, byId) {
  const visited = new Set();
  let current = element;
  while (current) {
    if (current.evidenceConsistency !== "consistent" || visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === null) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

function taskResult(startedAt, {
  outcome,
  released,
  phase,
  taskToken,
  candidates,
  facts,
  factsTruncated,
  action,
  allowedDecisions: decisions,
  error,
}) {
  return {
    status: canonicalOutcome(outcome),
    outcome: canonicalOutcome(outcome),
    released: released === true,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    phase,
    executionControl: {
      status: "blocked",
      scope: "interaction-step",
      retryable: false,
      allowedNextTools: ["computer.task"],
      reason: "generic-desktop-task-next-step-host-owned",
      nextAction: "Continue only through computer.task with the returned opaque task state. If the goal is not directly visible, choose one reversible navigation candidate such as an account/profile/menu/navigation control that is semantically likely to reveal it; do not report merely because the final target is not yet exposed. When a named surface is hosted by a differently labelled desktop product, select that semantically related owning-window candidate. Shell, raw-targeting, lifecycle, and alternate GUI tools are not authorized fallbacks.",
    },
    ...(taskToken ? { taskToken } : {}),
    ...(Array.isArray(candidates) ? { candidates } : {}),
    ...(Array.isArray(facts) ? { facts } : {}),
    ...(typeof factsTruncated === "boolean" ? { factsTruncated } : {}),
    ...(action ? { action } : {}),
    ...(Array.isArray(decisions) ? { allowedDecisions: decisions } : {}),
    ...(error ? { error } : {}),
  };
}

function failureResult(startedAt, error, taskToken, outcome = "not-applied") {
  return taskResult(startedAt, {
    outcome,
    released: true,
    phase: "failed",
    taskToken,
    error,
  });
}

function allowedDecisions() {
  return ["complete", "reobserve", "report", "cancel"];
}

function canonicalOutcome(value) {
  if (value === "committed" || value === "not-applied" || value === "indeterminate") return value;
  if (value === "completed" || value === "applied" || value === "ok") return "committed";
  if (value === "blocked" || value === "rejected") return "not-applied";
  return "indeterminate";
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    const error = new Error(`${field} must be a non-empty string within ${maxLength} characters.`);
    error.code = "task.invalid_goal";
    throw error;
  }
  return value;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function taskScopeKey(requestContext) {
  return JSON.stringify([
    requestContext?.ownerId ?? null,
    requestContext?.agentId ?? null,
    requestContext?.projectId ?? null,
    requestContext?.sessionId ?? null,
  ]);
}

function pruneExpiredTasks(now) {
  for (const [token, task] of pendingTasks) {
    if (task.expiresAt <= now) pendingTasks.delete(token);
  }
}

function abortable(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) return Promise.reject(abortError(signal.reason));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then((value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

function abortError(reason) {
  const error = new Error(typeof reason === "string" && reason ? reason : "The operator stopped the desktop task.");
  error.name = "AbortError";
  error.code = "task.cancelled";
  return error;
}
