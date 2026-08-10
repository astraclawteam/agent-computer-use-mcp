import { randomUUID } from "node:crypto";

const TASK_TTL_MS = 120_000;
const MAX_PUBLIC_CANDIDATES = 80;
const MAX_PUBLIC_FACTS = 120;
const pendingTasks = new Map();

export async function runGenericTaskHostContract(options) {
  const { router, requestContext } = options;
  const scopeKey = taskScopeKey(requestContext);
  // Held before the step runs, because the step is what releases control and
  // by then it is too late to keep the indicator from blinking. Whether the
  // hold was warranted is settled below, once the step has decided if the task
  // survives.
  try {
    return await runTaskContractStep(options);
  } finally {
    // Only ever extends. Taking the indicator down is the tool dispatcher's
    // job, on its own idle deadline - a task reaching its terminal step does
    // not mean the model has finished with the desktop, and pulling the
    // indicator here would make it blink before the next tool call.
    await extendControlIndicator(router, liveTaskHoldForScope(scopeKey));
  }
}

/// The indicator is a statement to the person at the desk, never a step of the
/// task. Awaiting it keeps a rejected hook from escaping as an unobserved
/// rejection, and swallowing it keeps a cosmetic failure from claiming the
/// task failed.
async function extendControlIndicator(router, hold) {
  if (!hold) return;
  try {
    await router?.setControlIndicatorHold?.(hold);
  } catch {
    // Deliberately silent: see above.
  }
}

/// Drops every task that could still take another step. Called when the
/// operator stops the desktop: a task left pending would quietly resume on the
/// next step, which is the opposite of what they asked for. Returns how many
/// were dropped so the caller can report an honest count.
export function cancelPendingTasks() {
  const dropped = pendingTasks.size;
  pendingTasks.clear();
  return dropped;
}

/// The indicator belongs up for as long as this caller has a task that can
/// still take another step, which is exactly its presence in `pendingTasks`.
function liveTaskHoldForScope(scopeKey) {
  let expiresAt = 0;
  for (const task of pendingTasks.values()) {
    if (task.scopeKey === scopeKey && task.expiresAt > expiresAt) expiresAt = task.expiresAt;
  }
  return expiresAt > Date.now() ? { id: scopeKey, expiresAt } : null;
}

async function runTaskContractStep({
  router,
  args = {},
  requestContext,
  signal,
  acquire,
}) {
  const startedAt = Date.now();
  try {
    const taskToken = optionalText(args.taskToken);
    const applicationName = taskToken
      ? optionalText(args.applicationName)
      : requiredText(args.applicationName, "applicationName", 256);
    const goal = taskToken
      ? optionalText(args.goal)
      : requiredText(args.goal, "goal", 2_000);
    const scopeKey = taskScopeKey(requestContext);
    pruneExpiredTasks(startedAt);
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
    if (!task || task.expiresAt <= startedAt || task.scopeKey !== scopeKey) {
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
      task.boundWindowId = null;
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
      task.boundWindowId = selected.windowId;
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
    boundWindowId: null,
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
    const projection = projectScene(scene, task.applicationName, { goal: task.goal });
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

  const lease = await withLease({ task, router, acquire, signal, requestContext }, async ({ scene, observation }) => {
    let currentScene = scene;
    let current = projectScene(scene, task.applicationName, { goal: task.goal });
    let matching = current.candidates.filter((candidate) => sameCandidate(candidate, selected));
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

    let currentCandidate = matching[0];
    if (currentCandidate.actionKind === "type_text"
      && exactCurrentEditableValue(currentScene, currentCandidate, text)) {
      updateTaskScene(task, current);
      return {
        outcome: "committed",
        phase: "decision-required",
        taskToken: task.taskToken,
        candidates: publicCandidates(task.candidates),
        facts: task.facts,
        factsTruncated: task.factsTruncated,
        action: publicAction(
          currentCandidate,
          "committed",
          editReceipt("not-applied", "committed", currentValueVerification(currentScene)),
        ),
        allowedDecisions: allowedDecisions(),
      };
    }
    const navigationClick = isNavigationClickCandidate(currentCandidate);
    if (navigationClick) {
      const relatedSurfaceAnchor = navigationSurfaceAnchor(currentScene, currentCandidate);
      if (relatedSurfaceAnchor) {
        try {
          const preflightScene = (await abortable(() => router.capture({
            mode: "screenshot",
            forceScreenshotSurfaceCapture: true,
            includeRelatedSurfaces: true,
            relatedSurfaceAnchor,
            preserveActionObservation: true,
            requestContext,
          }), signal))?.scene;
          if (isFreshSceneAfter(preflightScene, currentScene)) {
            const preflight = projectSceneForAnchoredSurface(
              preflightScene,
              task.applicationName,
              relatedSurfaceAnchor.bounds,
              task.goal,
            );
            if (!candidateBelongsToTransientSurface(currentScene, currentCandidate)
              && hasOpenAnchoredTransientSurface(
                preflightScene,
                relatedSurfaceAnchor.bounds,
              )) {
              updateTaskScene(task, preflight);
              rememberOpenSurfaceAnchor(
                task,
                currentScene,
                preflightScene,
                currentCandidate,
              );
              return {
                outcome: "not-applied",
                phase: "decision-required",
                taskToken: task.taskToken,
                candidates: publicCandidates(task.candidates),
                facts: task.facts,
                factsTruncated: task.factsTruncated,
                allowedDecisions: allowedDecisions(),
                // Reported, not silent. Without this the Agent receives an
                // ordinary decision-required, cannot tell that its selection was
                // deliberately not delivered, and reselects the same control
                // forever.
                error: {
                  code: "task.navigation_surface_already_open",
                  message: "The control's own surface is already open, so the Host did not click it again. Its items are in the refreshed candidates; select one of those instead of reselecting this control.",
                  replayAllowed: false,
                },
              };
            }
            // This is a bounded, non-authoritative surface question. The fresh
            // candidate from the lease remains the action authority even when
            // the popup preflight happens to reconstruct a matching row with a
            // newer Scene id. Rebinding to that diagnostic id would make
            // router.act reject it because lastCapture was deliberately
            // preserved for the action.
          }
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
    }
    let grounding = currentCandidate.actionKind === "type_text"
      && typeof observation?.observationId === "string"
      && pixelTargetFor(currentScene, currentCandidate)
      ? { scene: currentScene, observationId: observation.observationId }
      : null;
    if (currentCandidate.actionKind === "type_text") {
      // A semantic observation knows the control exists but not where it is,
      // and replacing everything in an unlocated control is refused - rightly.
      // One screenshot-grounded look is what turns an observable chat box into
      // one that can actually be typed into.
      if (!grounding) {
        try {
          const groundedCapture = await abortable(() => router.capture({
            mode: "screenshot",
            forceScreenshotSurfaceCapture: true,
            requestContext,
          }), signal);
          const groundedScene = groundedCapture?.scene;
          if (isFreshSceneAfter(groundedScene, currentScene)) {
            const regrounded = projectScene(groundedScene, task.applicationName, { goal: task.goal }).candidates
              .filter((candidate) => sameCandidate(candidate, currentCandidate));
            if (regrounded.length === 1) {
              currentScene = groundedScene;
              currentCandidate = regrounded[0];
              grounding = { scene: groundedScene, observationId: groundedCapture?.observationId ?? null };
            }
          }
        } catch {
          // Leave the action ungrounded. It will be refused for exactly the
          // reason it should be, rather than aimed at a guess.
        }
      }
      if (!grounding && currentCandidate.setValueAllowed === true) {
        // The screenshot probe supersedes the semantic Scene even when it
        // cannot rebind this control. Refresh semantic authority before using
        // ValuePattern; otherwise the correct element id is stale by the time
        // it reaches admission. This remains route selection before mutation,
        // not a retry after an uncertain effect.
        const semanticCapture = await abortable(() => router.capture({
          mode: "semantic",
          requestContext,
        }), signal);
        const semanticScene = semanticCapture?.scene;
        if (!isFreshSceneAfter(semanticScene, currentScene)) {
          return staleCandidateAfterEditGrounding(task, current);
        }
        const semanticProjection = projectScene(
          semanticScene,
          task.applicationName,
          { goal: task.goal },
        );
        const semanticMatches = semanticProjection.candidates
          .filter((candidate) => sameCandidate(candidate, currentCandidate));
        if (semanticMatches.length !== 1) {
          updateTaskScene(task, semanticProjection);
          return staleCandidateAfterEditGrounding(task, semanticProjection);
        }
        currentScene = semanticScene;
        currentCandidate = semanticMatches[0];
      }
    }
    const action = actionForCandidate(currentCandidate, text, grounding);
    const editMutation = currentCandidate.actionKind === "type_text";
    let receipt;
    try {
      receipt = await abortable(() => router.act({
        action: { ...action, captureAfter: true },
        requestContext,
        signal,
      }), signal);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      // A refusal raised before the action reached the provider proves nothing
      // was delivered, so the task can be reconsidered rather than closed as an
      // effect that might have landed. Everything else stays indeterminate: an
      // action already in flight must never be reported as safe to repeat.
      if (failure.detail?.delivered !== false) failure.mutationMayHaveStarted = true;
      throw failure;
    }
    const providerOutcome = canonicalOutcome(receipt?.outcome ?? receipt?.status);
    if (providerOutcome === "indeterminate" && !navigationClick && !editMutation) {
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
    if (!isFreshSceneAfter(postScene, currentScene)) {
      try {
        postScene = (await abortable(
          () => router.capture({ mode: "screenshot", requestContext }),
          signal,
        ))?.scene;
      } catch (error) {
        if ((!navigationClick && !editMutation) || signal?.aborted) throw error;
        return interactionVerificationFailure({
          task,
          candidate: currentCandidate,
          providerOutcome,
          beforeScene: currentScene,
          afterScene: postScene,
          kind: editMutation ? "edit" : "navigation",
          code: editMutation
            ? "task.edit_verification_unavailable"
            : "task.navigation_verification_unavailable",
          message: editMutation
            ? "The edit may have been applied, but the Host could not obtain a fresh exact-value observation. The task was closed and the edit was not replayed."
            : "The navigation click may have been applied, but the Host could not obtain a fresh post-action Scene. The task was closed and the click was not replayed.",
        });
      }
    }
    if ((navigationClick || editMutation) && !isFreshSceneAfter(postScene, currentScene)) {
      return interactionVerificationFailure({
        task,
        candidate: currentCandidate,
        providerOutcome,
        beforeScene: currentScene,
        afterScene: postScene,
        kind: editMutation ? "edit" : "navigation",
        code: editMutation ? "task.edit_verification_stale" : "task.navigation_verification_stale",
        message: editMutation
          ? "The edit may have been applied, but the Host did not receive a newer exact-value Scene. The task was closed and the edit was not replayed."
          : "The navigation click may have been applied, but the Host did not receive a newer post-action Scene. The task was closed and the click was not replayed.",
      });
    }
    let post;
    try {
      post = projectScene(postScene, task.applicationName, { goal: task.goal });
    } catch (error) {
      if (!navigationClick && !editMutation) throw error;
      return interactionVerificationFailure({
        task,
        candidate: currentCandidate,
        providerOutcome,
        beforeScene: currentScene,
        afterScene: postScene,
        kind: editMutation ? "edit" : "navigation",
        code: editMutation ? "task.edit_verification_invalid" : "task.navigation_verification_invalid",
        message: editMutation
          ? "The edit may have been applied, but its fresh exact-value Scene was invalid. The task was closed and the edit was not replayed."
          : "The navigation click may have been applied, but its fresh post-action Scene was invalid. The task was closed and the click was not replayed.",
      });
    }
    let navigationVerification = navigationClick
      ? verifyNavigationClickPostcondition({
          beforeScene: currentScene,
          afterScene: postScene,
          candidate: currentCandidate,
        })
      : null;
    if (navigationClick && navigationVerification?.verified !== true) {
      const relatedSurfaceAnchor = navigationSurfaceAnchor(currentScene, currentCandidate);
      try {
        const forcedScene = (await abortable(() => router.capture({
          mode: "screenshot",
          forceScreenshotSurfaceCapture: true,
          includeRelatedSurfaces: true,
          ...(relatedSurfaceAnchor ? { relatedSurfaceAnchor } : {}),
          requestContext,
        }), signal))?.scene;
        if (isFreshSceneAfter(forcedScene, postScene)) {
          const forcedPost = projectScene(forcedScene, task.applicationName, { goal: task.goal });
          postScene = forcedScene;
          post = forcedPost;
          navigationVerification = verifyNavigationClickPostcondition({
            beforeScene: currentScene,
            afterScene: postScene,
            candidate: currentCandidate,
          });
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    const editVerification = editMutation
      ? verifyEditPostcondition({
          receipt,
          beforeScene: currentScene,
          afterScene: postScene,
          candidate: currentCandidate,
          expectedValue: text,
        })
      : null;
    const outcome = navigationVerification?.verified === true || editVerification?.verified === true
      ? "committed"
      : (navigationClick || editMutation) && providerOutcome === "committed"
        ? "indeterminate"
        : providerOutcome;
    const publicReceipt = navigationVerification
      ? navigationReceipt(providerOutcome, outcome, navigationVerification)
      : editVerification
        ? editReceipt(providerOutcome, outcome, editVerification)
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
    if (editMutation && outcome === "indeterminate") {
      pendingTasks.delete(task.taskToken);
      return {
        outcome,
        phase: "failed",
        action: publicAction(currentCandidate, outcome, publicReceipt),
        error: {
          code: providerOutcome === "committed"
            ? "task.edit_postcondition_unverified"
            : "task.action_indeterminate",
          message: providerOutcome === "committed"
            ? "The provider reported the edit as committed, but the fresh Host Scene did not prove the exact requested value. The task was closed and the edit was not replayed."
            : "The Host cannot prove whether the edit was applied. The edit was not replayed and the task was closed.",
          replayAllowed: false,
        },
      };
    }
    if (navigationClick) {
      post = projectSceneForAnchoredSurface(
        postScene,
        task.applicationName,
        candidateAnchorBounds(currentScene, currentCandidate),
        task.goal,
      );
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
      // Remembered so the next step binds the already-foreground window without
      // reactivation and captures the Scene the way this surface was found. The
      // anchor comes from the pre-action Scene because the candidate's element
      // id belongs to it, and a control does not move when its own menu opens
      // against it.
      openSurfaceAnchorRemembered: rememberOpenSurfaceAnchor(task, currentScene, postScene, currentCandidate),
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

function staleCandidateAfterEditGrounding(task, projection) {
  updateTaskScene(task, projection);
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
      message: "The selected Editable could not be rebound to one fresh Host Scene after grounding. No text action was applied.",
    },
  };
}

async function withLease({ task, router, acquire, signal, requestContext }, operation) {
  let acquired = false;
  let released = true;
  let value;
  let error;
  try {
    // A step continuing from a surface the previous step opened has to look for
    // it the way it was found; a plain observation cannot see one, and every
    // candidate it contributed would revalidate as stale.
    const surfaceAnchor = isCoordinateBox(task.openSurfaceAnchor?.bounds) ? task.openSurfaceAnchor : null;
    const boundSurfaceWindowId = surfaceAnchor
      && task.boundWindowId !== null
      && task.boundWindowId !== undefined
      && task.boundWindowId !== ""
      ? task.boundWindowId
      : null;
    const access = await abortable(() => acquire({
      ...(surfaceAnchor && task.applicationToken
        ? { applicationToken: task.applicationToken }
        : boundSurfaceWindowId !== null
        ? { windowId: boundSurfaceWindowId }
        : task.applicationToken
          ? { applicationToken: task.applicationToken }
          : task.windowId !== null && task.windowId !== undefined
            ? { windowId: task.windowId }
            : {}),
      // Re-activating an already-foreground window dismisses its transient menu
      // before the Host can revalidate the item returned by the previous step.
      // Bind the same foreground application without activation instead. The
      // step still obtains and releases a normal controller lease; it merely
      // avoids a redundant focus mutation.
      ...(surfaceAnchor
        ? { activationPolicy: "foreground-only" }
        : {}),
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
        task.boundWindowId = null;
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
      let observation;
      if (surfaceAnchor) {
        try {
          observation = await abortable(() => router.capture({
            mode: "screenshot",
            forceScreenshotSurfaceCapture: true,
            includeRelatedSurfaces: true,
            relatedSurfaceAnchor: surfaceAnchor,
            requestContext,
          }), signal);
        } catch (surfaceCaptureError) {
          if (signal?.aborted) throw surfaceCaptureError;
          // The surface-aware capture is an optimisation for continuing on an
          // open surface; losing it must not fail the step.
          task.openSurfaceAnchor = null;
          observation = await abortable(
            () => router.capture({ mode: "screenshot", requestContext }),
            signal,
          );
        }
      } else {
        observation = access?.initialObservation
          ?? await abortable(() => router.capture({ mode: "screenshot", requestContext }), signal);
      }
      const scene = observation?.scene;
      assertScene(scene);
      value = await operation({ scene, observation });
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
          task.boundWindowId = semanticOwner.windowId;
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
        // The generic sentences above describe how the task ended, not what
        // actually refused it. Without the underlying cause a caller cannot tell
        // an unsupported target from a transient provider failure.
        ...(lease.error?.code || lease.error?.detail?.reason
          ? {
            cause: {
              ...(lease.error.code ? { code: lease.error.code } : {}),
              ...(lease.error.detail?.reason ? { reason: lease.error.detail.reason } : {}),
              ...(lease.error.detail?.nextAction ? { nextAction: lease.error.detail.nextAction } : {}),
            },
          }
          : {}),
        replayAllowed: false,
      },
    });
  }
  return taskResult(startedAt, { ...lease.value, released: lease.released });
}

function projectScene(scene, semanticOwnerName = null, { surfaceId = null, goal = "" } = {}) {
  assertScene(scene);
  const elements = scene.elements;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const matchingSemanticOwners = new Set(elements
    .filter((element) => (
      isSemanticOwnerBoundary(element)
      && semanticOwnerFactMatches({
        role: element.role,
        label: semanticOwnerLabel(element),
      }, semanticOwnerName)
    ))
    .map((element) => element.id));
  const messaging = elements.some((element) => (
    new Set([
      "conversation", "conversation-title", "message-editor", "send", "message-bubble", "transcript",
    ]).has(element?.role)
    && (matchingSemanticOwners.size === 0
      || belongsToSemanticOwner(element, byId, matchingSemanticOwners))
  ));
  const facts = [];
  const candidates = [];
  const candidateOrdinals = new Map();
  let eligibleFactCount = 0;
  for (const element of elements) {
    if (element?.evidenceConsistency !== "consistent" || !hasConsistentOwnership(element, byId)) continue;
    if (surfaceId && element.id !== surfaceId && !isDescendantOf(element, surfaceId, byId)) continue;
    if (!surfaceId
      && matchingSemanticOwners.size > 0
      && !belongsToSemanticOwner(element, byId, matchingSemanticOwners)) continue;
    const label = elementLabel(element);
    const parentRole = typeof element.parentId === "string" ? byId.get(element.parentId)?.role ?? null : null;
    const evidenceSources = evidenceSourcesFor(element);
    const editPrimitive = isNonSubmittingEditable(element);
    const messagingWorkflowElement = messaging
      && !editPrimitive
      && isMessagingWorkflowElement(element, byId);
    if (label) eligibleFactCount += 1;
    if (label && !messagingWorkflowElement && facts.length < MAX_PUBLIC_FACTS) {
      facts.push(Object.freeze({ label, role: String(element.role ?? "unknown"), parentRole, evidenceSources }));
    }
    if (messagingWorkflowElement
      || element?.actionable !== true
      || !label
      || candidates.length >= MAX_PUBLIC_CANDIDATES) continue;
    for (const action of candidateActions(element)) {
      if (candidates.length >= MAX_PUBLIC_CANDIDATES) break;
      const ownershipPath = stableOwnershipPath(element, byId);
      const ordinalKey = JSON.stringify([
        label,
        String(element.role ?? "unknown"),
        parentRole,
        action.actionKind,
        typeof element.semanticKey === "string" ? element.semanticKey : null,
        ownershipPath,
      ]);
      const semanticOrdinal = candidateOrdinals.get(ordinalKey) ?? 0;
      candidateOrdinals.set(ordinalKey, semanticOrdinal + 1);
      candidates.push(Object.freeze({
        kind: "scene",
        candidateId: `candidate:${randomUUID()}`,
        label,
        role: String(element.role ?? "unknown"),
        parentRole,
        action: action.publicAction,
        actionKind: action.actionKind,
        setValueAllowed: action.setValueAllowed === true,
        inputRequired: action.actionKind === "type_text",
        evidenceSources,
        semanticKey: typeof element.semanticKey === "string" ? element.semanticKey : null,
        ownershipPath,
        semanticOrdinal,
        elementId: element.id,
      }));
    }
  }
  return {
    messaging,
    windowId: scene.windowId ?? null,
    candidates: rankCandidatesForGoal(candidates, goal, semanticOwnerName),
    facts,
    factsTruncated: eligibleFactCount > facts.length,
  };
}

function stableOwnershipPath(element, byId) {
  const parts = [];
  const visited = new Set();
  let current = typeof element?.parentId === "string" ? byId.get(element.parentId) : null;
  while (current && !visited.has(current.id) && parts.length < 12) {
    visited.add(current.id);
    parts.push(JSON.stringify([
      normalizeText(current.role),
      normalizeText(current.semanticKey),
      normalizeText(semanticOwnerLabel(current)),
    ]));
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : null;
  }
  return parts.reverse().join(">");
}

/**
 * Once a navigation click opens one proven surface, expose that surface and its
 * descendants as the next decision context. Returning every actionable control
 * in the application makes the new menu only one candidate among dozens and
 * forces the model to infer surface ownership that the Host already knows.
 */
function projectSceneForAnchoredSurface(scene, semanticOwnerName, anchorBounds, goal = "") {
  const surface = anchoredActionableTransientSurface(scene, anchorBounds);
  return projectScene(scene, semanticOwnerName, surface
    ? { surfaceId: surface.id, goal }
    : { goal });
}

function rankCandidatesForGoal(candidates, goal, semanticOwnerName = "") {
  const editIntent = textHasAny(goal, [
    "input", "type", "enter", "write", "paste", "draft", "edit",
    "输入", "键入", "填写", "写入", "粘贴", "草稿", "编辑",
  ]);
  const relevantEditables = new Set(candidates
    .filter((candidate) => isRelevantEditableForGoal(
      candidate,
      goal,
      editIntent,
      semanticOwnerName,
    ))
    .map((candidate) => candidate.candidateId));
  const conversationIntent = textHasAny(goal, [
    "chat", "conversation", "message", "聊天", "会话", "对话", "消息",
  ]);
  return candidates
    .map((candidate, index) => {
      const labelMatchesGoal = candidateLabelMatchesGoal(candidate.label, goal, semanticOwnerName);
      const directConversationRoute = conversationIntent
        && textHasAny(candidate.label, [
          "new conversation", "new chat", "新对话", "新聊天",
        ]);
      const conversationRoute = conversationIntent && textHasAny(candidate.label, [
        "chat", "conversation", "message", "聊天", "会话", "对话", "消息",
      ]);
      const reversibleRoute = editIntent
        && relevantEditables.size === 0
        && (candidate.actionKind === "activate_window"
          || textHasAny(candidate.label, [
            "back", "return", "close", "home", "application", "app",
            "返回", "回到", "关闭", "主页", "应用",
          ])
          || conversationRoute);
      const directEdit = relevantEditables.has(candidate.candidateId);
      const score = directEdit || labelMatchesGoal
        ? 30
        : directConversationRoute
          ? 25
          : conversationRoute
            ? 23
            : reversibleRoute
              ? 20
              : 10;
      return {
        candidate: Object.freeze({
          ...candidate,
          relevance: score === 30 ? "target" : score >= 20 ? "route" : "context",
        }),
        index,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function isRelevantEditableForGoal(candidate, goal, editIntent, semanticOwnerName) {
  if (!editIntent || candidate.actionKind !== "type_text") return false;
  if (candidateLabelMatchesGoal(candidate.label, goal, semanticOwnerName)) return true;
  return !textHasAny(candidate.label, ["search", "filter", "find", "query", "搜索", "筛选", "查找"]);
}

function candidateLabelMatchesGoal(label, goal, semanticOwnerName = "") {
  const normalizedLabel = normalizeText(label);
  const normalizedGoal = normalizeText(goal);
  const normalizedOwner = normalizeText(semanticOwnerName);
  if (normalizedLabel.length < 2 || normalizedGoal.length < 2) return false;
  if (normalizedLabel === normalizedOwner) return false;
  if (normalizedGoal.includes(normalizedLabel)) return true;
  const labelTokens = String(label ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const goalTokens = new Set(String(goal ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const ownerTokens = new Set(String(semanticOwnerName ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return labelTokens.some((token) => (
    token.length >= 2
    && !ownerTokens.has(token)
    && goalTokens.has(token)
  ));
}

function textHasAny(value, terms) {
  const normalized = String(value ?? "").toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function isSemanticOwnerBoundary(element) {
  if (element?.type === "Window") return true;
  if (!semanticOwnerLabel(element)) return false;
  return ["application", "document", "main-window", "window"].includes(element?.role);
}

function semanticOwnerLabel(element) {
  for (const value of [element?.name, element?.value, element?.semanticKey]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function belongsToSemanticOwner(element, byId, matchingSemanticOwners) {
  let current = element;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (isSemanticOwnerBoundary(current)) return matchingSemanticOwners.has(current.id);
    visited.add(current.id);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : null;
  }
  return true;
}

function isMessagingWorkflowElement(element, byId) {
  const workflowRoles = new Set([
    "conversation",
    "conversation-header",
    "conversation-title",
    "message-editor",
    "send",
    "message-bubble",
    "transcript",
    "search",
    "search-results",
    "search-result",
    "target-list",
    "target-candidate",
  ]);
  let current = element;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (workflowRoles.has(current.role)) return true;
    visited.add(current.id);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : null;
  }
  return false;
}

function candidateActions(element) {
  const actions = new Set(Array.isArray(element?.actions) ? element.actions : []);
  const result = [];
  if (actions.has("activate_window")) result.push({ publicAction: "activate", actionKind: "activate_window" });
  if (element?.type !== "Editable" && actions.has("click")) {
    result.push({ publicAction: "select", actionKind: "click" });
  }
  // UI Automation commonly exposes editors through ValuePattern (`set_value`)
  // without advertising a keyboard verb. Prefer the screenshot-grounded text
  // primitive when the Host can locate the editor; retain the semantic value
  // mutation as the preselected route for a proven Editable with no pixel
  // geometry. Route selection happens before mutation and is never a retry.
  if (isNonSubmittingEditable(element)) {
    result.push({
      publicAction: "edit",
      actionKind: "type_text",
      setValueAllowed: actions.has("set_value"),
    });
  }
  return result;
}

function isNonSubmittingEditable(element) {
  if (element?.type !== "Editable") return false;
  const actions = new Set(Array.isArray(element.actions) ? element.actions : []);
  return actions.has("type_text") || actions.has("set_value");
}

function actionForCandidate(candidate, text, grounding = null) {
  if (candidate.actionKind === "activate_window") {
    return { kind: "activate_window", elementId: candidate.elementId };
  }
  if (candidate.actionKind === "type_text") {
    const pixelTarget = grounding?.observationId ? pixelTargetFor(grounding.scene, candidate) : null;
    if (!pixelTarget && candidate.setValueAllowed === true) {
      return {
        kind: "set_value",
        elementId: candidate.elementId,
        value: text,
      };
    }
    return {
      kind: "type_text",
      elementId: candidate.elementId,
      value: text,
      textMode: "replace-all",
      inputBehavior: "commit",
      // Replacing everything in a control is refused without proof of which
      // control that is. A grounded observation supplies it; without one the
      // refusal stands rather than being talked around.
      ...(pixelTarget ? {
        x: pixelTarget.x,
        y: pixelTarget.y,
        // Stated rather than inferred: a point means nothing without the frame
        // it was measured in, and the Host refuses to assume one.
        coordinateSpace: pixelTarget.space,
        observationId: grounding.observationId,
        targetBounds: pixelTarget.bounds,
      } : {}),
    };
  }
  const role = targetRole(candidate);
  return {
    kind: "click",
    elementId: candidate.elementId,
    interactionIntent: interactionIntent(candidate),
    targetRole: role,
    ...(!["editable", "toggle"].includes(role)
      ? { hostDeliveryIntent: "navigation" }
      : {}),
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

function candidateBelongsToTransientSurface(scene, candidate) {
  const target = scene?.elements?.find((element) => element?.id === candidate?.elementId);
  if (!target) return false;
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const visited = new Set();
  let parentId = target.parentId;
  while (typeof parentId === "string" && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (parent?.type === "TransientSurface") return true;
    visited.add(parentId);
    parentId = parent?.parentId;
  }
  return false;
}

/// The centre of the element, in the coordinate space the action is read in.
///
/// `bounds` are already in that space - on a real capture the root document
/// element's bounds come back equal to the window's own screen rectangle, and
/// `scale` turns out to be the ratio between the captured image and those
/// bounds (1378/1376, 820/818), so it describes the screenshot rather than the
/// geometry. Multiplying by it would aim slightly off, further the lower down
/// the window the control sits.
///
/// A non-zero crop offset is a different matter: it would need a transform this
/// file has no evidence for, and a mis-aimed replace-all types into whatever
/// control happens to sit at the wrong point. So that case yields no pixel
/// target and the action is refused rather than guessed at.
function pixelTargetFor(scene, candidate) {
  const element = scene?.elements?.find((item) => item?.id === candidate?.elementId);
  const coordinate = element?.coordinate;
  const bounds = coordinate?.bounds;
  if (!isCoordinateBox(bounds) || coordinate.space !== "window-local") return null;
  const offsetX = coordinate.cropOffset?.x ?? 0;
  const offsetY = coordinate.cropOffset?.y ?? 0;
  if (offsetX !== 0 || offsetY !== 0) return null;
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
    space: coordinate.space,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

function isCoordinateBox(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

/**
 * A popup belongs to the control that opens it, and renders against it: over it,
 * beside it, or directly beneath it. A surface with no geometric relationship to
 * the clicked control is not evidence about that control at all—a capture can
 * include an unrelated application's window, whose flat panels and OCR rows look
 * exactly like a menu. Treating one as the control's own popup both skips the
 * click that was requested and, on the post-action path, confirms a navigation
 * that never happened.
 *
 * The neighbourhood is scaled by the control itself rather than a pixel
 * constant, so a small icon button still admits the large menu that opens
 * against it while rejecting a surface on the other side of the screen.
 */
function isAnchorLocalSurface(element, anchorBounds) {
  const bounds = element?.coordinate?.bounds;
  if (!isCoordinateBox(bounds) || !isCoordinateBox(anchorBounds)) return false;
  const marginX = anchorBounds.width;
  const marginY = anchorBounds.height;
  return bounds.x < anchorBounds.x + anchorBounds.width + marginX
    && bounds.x + bounds.width > anchorBounds.x - marginX
    && bounds.y < anchorBounds.y + anchorBounds.height + marginY
    && bounds.y + bounds.height > anchorBounds.y - marginY;
}

function candidateAnchorBounds(scene, candidate) {
  const target = scene?.elements?.find((element) => element?.id === candidate?.elementId);
  return target?.coordinate?.bounds ?? null;
}

const PIXEL_EVIDENCE_SOURCES = new Set(["visual", "ocr"]);

function sceneCarriesPixelEvidence(scene) {
  return (scene?.elements ?? []).some((element) => (
    evidenceSourcesFor(element).some((source) => PIXEL_EVIDENCE_SOURCES.has(source))
  ));
}

// A before/after transition can only call a surface "added" when both Scenes
// could have observed that kind of evidence. Action-time preflight is different:
// it asks whether an owned surface is open right now, so its independently
// grounded screenshot Scene does not require a semantic-only baseline.
function hasComparableSurfaceBaseline(beforeScene, afterScene) {
  if (!sceneCarriesPixelEvidence(afterScene)) return true;
  return sceneCarriesPixelEvidence(beforeScene);
}

/**
 * Record the anchor of a surface this click opened, so the next step can capture
 * the Scene the same way. The surfaces that produced these candidates only exist
 * in a related-surface capture; revalidating them against a plain observation
 * would drop every one of them and report the offered item as stale.
 */
function rememberOpenSurfaceAnchor(task, beforeScene, afterScene, candidate) {
  const bounds = candidateAnchorBounds(beforeScene, candidate);
  const surface = anchoredActionableTransientSurface(afterScene, bounds);
  if (!surface) {
    task.openSurfaceAnchor = null;
    return false;
  }
  const surfaceBounds = surface.coordinate?.bounds;
  if (!isCoordinateBox(surfaceBounds)) {
    task.openSurfaceAnchor = null;
    return false;
  }
  task.openSurfaceAnchor = {
    role: candidate.role,
    bounds,
    surfaceBounds: { ...surfaceBounds },
  };
  return true;
}

function anchoredActionableTransientSurface(scene, anchorBounds) {
  if (!isCoordinateBox(anchorBounds)) return null;
  const index = consistentSceneIndex(scene);
  const surfaces = index.elements.filter((element) => (
    element?.type === "TransientSurface"
    && isAnchorLocalSurface(element, anchorBounds)
    && hasConsistentActionableDescendant(element, index.elements, index.byId)
  ));
  return surfaces.length === 1 ? surfaces[0] : null;
}

function hasOpenAnchoredTransientSurface(scene, anchorBounds) {
  return anchoredActionableTransientSurface(scene, anchorBounds) !== null;
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
  // "Added" is only meaningful against a baseline that could see the same kind
  // of surface. A post-action capture detects surfaces from pixels and OCR that
  // a semantic baseline never reports, so comparing the two marks panels that
  // were on screen all along as newly opened—and a panel adjacent to the
  // clicked control would then confirm a click that changed nothing.
  const addedSurfaces = hasComparableSurfaceBaseline(beforeScene, afterScene)
    ? after.elements.filter((element) => (
      isNavigationSurface(element)
      && !beforeSurfaces.has(navigationSurfaceSignature(element, after.byId))
    ))
    : [];
  const targetLabel = normalizeText(candidate.label);
  if (targetLabel && addedSurfaces.some((element) => normalizeText(elementLabel(element)) === targetLabel)) {
    return confirmedNavigationVerification(
      method,
      "target-labelled-destination-added",
      beforeVersion,
      afterVersion,
    );
  }

  // Anchored to the clicked control. An unanchored surface anywhere in the frame
  // would let an unrelated application's panel confirm a click that never
  // reached this control.
  const candidateAnchor = candidateAnchorBounds(beforeScene, candidate);
  if (addedSurfaces.some((element) => (
    element.type === "TransientSurface"
    && isAnchorLocalSurface(element, candidateAnchor)
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

  if (hasOwnedActionablePageTransition({ before, after, candidate })) {
    return confirmedNavigationVerification(
      method,
      "owned-actionable-page-transition",
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

function hasOwnedActionablePageTransition({ before, after, candidate }) {
  const target = before.byId.get(candidate?.elementId);
  const beforeOwner = nearestSemanticOwner(target, before.byId);
  if (!beforeOwner) return false;
  const ownerSignature = semanticOwnerSignature(beforeOwner);
  const afterOwners = after.elements.filter((element) => (
    isSemanticOwnerBoundary(element)
    && semanticOwnerSignature(element) === ownerSignature
  ));
  if (afterOwners.length !== 1) return false;
  const beforeActions = actionableDescendantSignatures(beforeOwner, before.elements, before.byId);
  const afterActions = actionableDescendantSignatures(afterOwners[0], after.elements, after.byId);
  const added = [...afterActions].some((signature) => !beforeActions.has(signature));
  const removed = [...beforeActions].some((signature) => !afterActions.has(signature));
  return added && removed;
}

function nearestSemanticOwner(element, byId) {
  let current = element;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (isSemanticOwnerBoundary(current)) return current;
    visited.add(current.id);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : null;
  }
  return null;
}

function semanticOwnerSignature(element) {
  return JSON.stringify([
    element?.type ?? null,
    normalizeText(element?.role),
    normalizeText(semanticOwnerLabel(element)),
  ]);
}

function actionableDescendantSignatures(owner, elements, byId) {
  return new Set(elements
    .filter((element) => (
      element?.actionable === true
      && hasAncestorOrSelf(element, owner.id, byId)
    ))
    .map((element) => {
      const parent = typeof element.parentId === "string" ? byId.get(element.parentId) : null;
      return JSON.stringify([
        element.type ?? null,
        normalizeText(element.role),
        normalizeText(element.semanticKey),
        normalizeText(elementLabel(element)),
        normalizeText(parent?.role),
        [...(element.actions ?? [])].sort(),
      ]);
    }));
}

function hasAncestorOrSelf(element, ancestorId, byId) {
  let current = element;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : null;
  }
  return false;
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

function interactionVerificationFailure({
  task,
  candidate,
  providerOutcome,
  beforeScene,
  afterScene,
  kind,
  code,
  message,
}) {
  pendingTasks.delete(task.taskToken);
  const verification = kind === "edit"
    ? unavailableEditVerification(beforeScene, afterScene)
    : unavailableNavigationVerification(beforeScene, afterScene);
  return {
    outcome: "indeterminate",
    phase: "failed",
    action: publicAction(
      candidate,
      "indeterminate",
      kind === "edit"
        ? editReceipt(providerOutcome, "indeterminate", verification)
        : navigationReceipt(providerOutcome, "indeterminate", verification),
    ),
    error: {
      code,
      message,
      replayAllowed: false,
    },
  };
}

function verifyEditPostcondition({ receipt, beforeScene, afterScene, candidate, expectedValue }) {
  const method = "host-exact-edit-readback";
  const providerVerified = receipt?.result?.verified === true
    || receipt?.result?.postconditionVerified === true;
  const receiptSceneVerified = receipt?.capture?.mutationVerification?.status === "confirmed";
  const freshSceneVerified = exactEditableValueAtSameTarget({
    beforeScene,
    afterScene,
    candidate,
    expectedValue,
  });
  const sceneVerified = receiptSceneVerified || freshSceneVerified;
  return {
    status: providerVerified || sceneVerified ? "confirmed" : "not-confirmed",
    verified: providerVerified || sceneVerified,
    method,
    evidence: providerVerified
      ? ["provider-exact-value-readback"]
      : sceneVerified
        ? ["fresh-scene-exact-value-readback"]
        : [],
    beforeObservationVersion: Number.isInteger(beforeScene?.observationVersion)
      ? beforeScene.observationVersion
      : null,
    afterObservationVersion: Number.isInteger(afterScene?.observationVersion)
      ? afterScene.observationVersion
      : null,
  };
}

function exactCurrentEditableValue(scene, candidate, expectedValue) {
  if (typeof expectedValue !== "string") return false;
  const index = consistentSceneIndex(scene);
  const element = index.byId.get(candidate?.elementId);
  return element?.type === "Editable" && element.value === expectedValue;
}

function currentValueVerification(scene) {
  const version = Number.isInteger(scene?.observationVersion) ? scene.observationVersion : null;
  return {
    status: "confirmed",
    verified: true,
    method: "host-exact-edit-readback",
    evidence: ["current-scene-exact-value-readback"],
    beforeObservationVersion: version,
    afterObservationVersion: version,
  };
}

function exactEditableValueAtSameTarget({ beforeScene, afterScene, candidate, expectedValue }) {
  if (typeof expectedValue !== "string" || !isFreshSceneAfter(afterScene, beforeScene)) return false;
  const before = consistentSceneIndex(beforeScene);
  const after = consistentSceneIndex(afterScene);
  const original = before.byId.get(candidate?.elementId);
  const originalBounds = original?.coordinate?.bounds;
  if (original?.type !== "Editable" || !isCoordinateBox(originalBounds)) return false;
  const matches = after.elements.filter((element) => {
    if (element?.type !== "Editable" || element?.role !== candidate.role) return false;
    const parent = typeof element.parentId === "string" ? after.byId.get(element.parentId) : null;
    if ((parent?.role ?? null) !== candidate.parentRole) return false;
    if (candidate.semanticKey && element.semanticKey !== candidate.semanticKey) return false;
    const exactValue = [element.value, element.name].some((value) => value === expectedValue);
    return exactValue && sameOwnedTargetBounds(originalBounds, element?.coordinate?.bounds);
  });
  return matches.length === 1;
}

function sameOwnedTargetBounds(left, right) {
  if (!isCoordinateBox(left) || !isCoordinateBox(right)) return false;
  const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = intersectionWidth * intersectionHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 && intersection / smallerArea >= 0.8;
}

function unavailableEditVerification(beforeScene, afterScene) {
  return {
    status: "unavailable",
    verified: false,
    method: "host-exact-edit-readback",
    evidence: [],
    beforeObservationVersion: Number.isInteger(beforeScene?.observationVersion)
      ? beforeScene.observationVersion
      : null,
    afterObservationVersion: Number.isInteger(afterScene?.observationVersion)
      ? afterScene.observationVersion
      : null,
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
      const projection = projectScene(scene, applicationName);
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
  if (projection.windowId !== null && projection.windowId !== undefined && projection.windowId !== "") {
    task.boundWindowId = projection.windowId;
  }
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
    relevance: candidate.relevance ?? "context",
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

function editReceipt(providerOutcome, outcome, verification) {
  return {
    providerOutcome,
    outcome,
    postconditionVerified: verification?.verified === true,
    verificationMethod: verification?.method ?? "host-exact-edit-readback",
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
    && left.ownershipPath === right.ownershipPath
    && left.semanticOrdinal === right.semanticOrdinal;
}

function evidenceSourcesFor(element) {
  return Object.freeze([...new Set((Array.isArray(element?.evidence) ? element.evidence : [])
    .map((evidence) => evidence?.source)
    .filter((source) => typeof source === "string" && source.length > 0))]);
}

function elementLabel(element) {
  const values = element?.type === "Editable"
    ? [element?.value, element?.name, element?.semanticKey, element?.role]
    : [element?.name, element?.value, element?.semanticKey, element?.role];
  for (const value of values) {
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
    terminalControllerState: released === true ? "idle" : "active",
    toolErrorCount: 0,
    wrongSendCount: 0,
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
