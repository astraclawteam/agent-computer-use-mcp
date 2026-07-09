import { planOverlayPlacement } from "./overlay-placement-planner.mjs";

export function createOverlayTargetTracker(options = {}) {
  let lastPlan = null;
  let lastUpdateMs = 0;
  const displays = options.displays ?? [];
  const minMovementPx = options.minMovementPx ?? 3;
  const debounceMs = options.debounceMs ?? 50;

  function update(updateOptions = {}) {
    const plan = planOverlayPlacement({
      displays: updateOptions.displays ?? displays,
      targetWindow: updateOptions.targetWindow,
    });
    const nowMs = Number(updateOptions.nowMs ?? Date.now());
    const decision = decideAction({
      plan,
      lastPlan,
      nowMs,
      lastUpdateMs,
      minMovementPx,
      debounceMs,
    });

    const result = {
      ...plan,
      action: decision.action,
      reason: decision.reason,
      targetChanged: decision.targetChanged,
      updateTargetRect: decision.updateTargetRect,
      previousDisplayId: lastPlan?.display?.id ?? null,
      includeUserOverlay: false,
      startsDesktopControl: false,
    };

    if (decision.updateState) {
      lastPlan = plan;
      lastUpdateMs = nowMs;
    }
    return result;
  }

  function reset(options = {}) {
    lastPlan = null;
    lastUpdateMs = 0;
    return {
      action: "hide",
      status: "suspended",
      reason: options.reason ?? "tracker-reset",
      visible: false,
      targetFrame: null,
      updateTargetRect: true,
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  function state() {
    return {
      lastPlan,
      lastUpdateMs,
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  return { update, reset, state };
}

function decideAction({ plan, lastPlan, nowMs, lastUpdateMs, minMovementPx, debounceMs }) {
  if (plan.status === "suspended") {
    return {
      action: "hide",
      reason: plan.reason,
      targetChanged: Boolean(lastPlan),
      updateTargetRect: true,
      updateState: true,
    };
  }

  if (plan.status === "degraded") {
    return {
      action: "degrade",
      reason: plan.reason,
      targetChanged: true,
      updateTargetRect: true,
      updateState: true,
    };
  }

  if (!lastPlan || lastPlan.status !== "visible") {
    return {
      action: "show",
      reason: "target-window-visible",
      targetChanged: true,
      updateTargetRect: true,
      updateState: true,
    };
  }

  if (lastPlan.display?.id !== plan.display?.id) {
    return {
      action: "move-display",
      reason: "target-display-changed",
      targetChanged: true,
      updateTargetRect: true,
      updateState: true,
    };
  }

  if (frameDistance(lastPlan.targetFrame, plan.targetFrame) < minMovementPx) {
    return {
      action: "noop",
      reason: "target-frame-stable-within-threshold",
      targetChanged: false,
      updateTargetRect: false,
      updateState: false,
    };
  }

  if (nowMs - lastUpdateMs < debounceMs) {
    return {
      action: "noop",
      reason: "target-frame-update-debounced",
      targetChanged: true,
      updateTargetRect: false,
      updateState: false,
    };
  }

  return {
    action: "update",
    reason: "target-frame-moved",
    targetChanged: true,
    updateTargetRect: true,
    updateState: true,
  };
}

function frameDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
}
