const ACTION_PROGRESS_KINDS = {
  driver: "install-cache",
  "overlay-shell": "install-cache",
  runtime: "install-cache",
  "model-pack": "model-cache",
  "system-runtime": "system-runtime",
  permission: "permission",
  "process-restart": "local-restart",
};

export function createRepairProgressPlan(options = {}) {
  const repairPlan = options.repairPlan ?? { actions: [] };
  const actions = repairPlan.actions ?? [];
  const approved = options.approved === true || options.approval?.status === "approved";
  const operationId = options.operationId ?? "repair-progress-plan";
  const dryRun = options.dryRun !== false;
  const status = deriveStatus({ actions, approved, approval: options.approval });
  const actionStatus = status === "ready_to_execute" ? "scheduled"
    : status === "not_needed" ? "complete"
    : "waiting_for_approval";
  const plannedActions = actions.map((action, index) => ({
    id: action.id,
    kind: action.kind ?? "repair",
    progressKind: ACTION_PROGRESS_KINDS[action.kind] ?? "repair",
    status: actionStatus,
    reason: action.reason ?? "repair-requested",
    order: index,
    timeoutMs: timeoutForAction(action),
    cancellable: true,
    executesImmediately: false,
  }));

  return {
    phase: "7.2",
    operationId,
    status,
    mode: "repair-progress",
    dryRun,
    approved,
    actions: plannedActions,
    events: buildEvents({ status, operationId, plannedActions, approval: options.approval }),
    policy: {
      requiresApprovalBeforeNetwork: true,
      downloadsRequireHostExecutor: true,
      longOperationsRequireProgress: true,
      progressIntervalMs: 1000,
      cancellable: true,
      timeoutMs: plannedActions.reduce((total, action) => total + action.timeoutMs, 0),
    },
    executesImmediately: false,
    downloadOnFirstEnable: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

export function cancelRepairProgressPlan(plan, options = {}) {
  return {
    ...plan,
    status: "cancelled",
    actions: (plan.actions ?? []).map((action) => ({
      ...action,
      status: action.status === "complete" ? "complete" : "cancelled",
    })),
    events: [
      ...(plan.events ?? []),
      {
        seq: plan.events?.length ?? 0,
        type: "repair.progress",
        operationId: plan.operationId,
        state: "cancelled",
        percent: plan.events?.at(-1)?.percent ?? 0,
        reason: options.reason ?? "cancelled",
        terminal: true,
      },
    ],
    executesImmediately: false,
    downloadOnFirstEnable: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function deriveStatus({ actions, approved, approval }) {
  if (actions.length === 0) return "not_needed";
  if (approval?.status === "denied") return "cancelled";
  if (approval?.status === "expired" || approval?.status === "invalid") return "blocked";
  if (approved) return "ready_to_execute";
  return "waiting_for_approval";
}

function buildEvents({ status, operationId, plannedActions, approval }) {
  const events = [
    {
      seq: 0,
      type: "repair.progress",
      operationId,
      state: "queued",
      percent: 0,
      actionCount: plannedActions.length,
      terminal: false,
    },
  ];

  if (status === "not_needed") {
    events.push({
      seq: 1,
      type: "repair.progress",
      operationId,
      state: "complete",
      percent: 100,
      terminal: true,
    });
    return events;
  }

  if (status === "ready_to_execute") {
    events.push({
      seq: 1,
      type: "repair.progress",
      operationId,
      state: "approved",
      percent: 10,
      terminal: false,
    });
    events.push({
      seq: 2,
      type: "repair.progress",
      operationId,
      state: "ready_to_execute",
      percent: 15,
      terminal: false,
    });
    return events;
  }

  events.push({
    seq: 1,
    type: "repair.progress",
    operationId,
    state: "waiting_for_approval",
    percent: 5,
    approvalStatus: approval?.status ?? "not_requested",
    terminal: false,
  });
  events.push({
    seq: 2,
    type: "repair.progress",
    operationId,
    state: "blocked",
    percent: 5,
    reason: approval?.status ? `approval-${approval.status}` : "approval-required",
    terminal: true,
  });
  return events;
}

function timeoutForAction(action) {
  if (action.kind === "model-pack") return 300000;
  if (action.kind === "system-runtime") return 600000;
  if (action.kind === "permission") return 120000;
  if (action.kind === "process-restart") return 30000;
  return 180000;
}
