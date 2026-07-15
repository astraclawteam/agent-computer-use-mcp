import { FAILURE_CLASSES } from "./qualification-contract.mjs";

export const ENVIRONMENT_ADAPTER_METHODS = Object.freeze([
  "discover",
  "prepare",
  "launch",
  "verify",
  "cleanup",
]);

const FORBIDDEN_METHODS = new Set([
  "observe",
  "act",
  "click",
  "type",
  "setValue",
  "navigate",
  "evaluate",
  "save",
  "closeDialog",
  "selectElement",
]);

export function assertEnvironmentAdapter(adapter) {
  if (adapter === null || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw adapterError("agent_e2e.adapter_invalid");
  }
  for (const method of ENVIRONMENT_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw adapterError("agent_e2e.adapter_method_required", method);
    }
  }
  for (const [key, value] of Object.entries(adapter)) {
    if (typeof value === "function" && !ENVIRONMENT_ADAPTER_METHODS.includes(key)) {
      const code = FORBIDDEN_METHODS.has(key)
        ? "agent_e2e.adapter_method_forbidden"
        : "agent_e2e.adapter_method_unrecognized";
      throw adapterError(code, key);
    }
  }
  return true;
}

export async function runEnvironmentLifecycle(adapter, context = {}, executeAgent) {
  assertEnvironmentAdapter(adapter);
  if (typeof executeAgent !== "function") throw adapterError("agent_e2e.agent_executor_required");
  const lifecycle = {};
  const adapterContext = Object.freeze({ ...context, lifecycle });
  let result;

  try {
    lifecycle.discovery = await adapter.discover(adapterContext);
    lifecycle.preparation = await adapter.prepare(adapterContext);
    lifecycle.launch = await adapter.launch(adapterContext, lifecycle.preparation?.fixture);
    lifecycle.agent = await executeAgent(Object.freeze({
      scope: lifecycle.discovery?.scope,
      fixture: lifecycle.preparation?.fixture,
      app: lifecycle.launch?.app,
    }));
    lifecycle.verification = await adapter.verify(adapterContext, lifecycle.agent);
    result = resultFromVerification(lifecycle.verification);
  } catch (error) {
    result = resultFromError(error, lifecycle);
  }

  const cleanup = await runCleanup(adapter, adapterContext);
  if (cleanup.status === "failed") {
    result = Object.freeze({
      status: "failed",
      failureClass: "cleanup-failure",
      reason: cleanup.reason,
    });
  }

  return Object.freeze({
    ...result,
    ...(lifecycle.verification ? { verification: deepFreeze({ ...lifecycle.verification }) } : {}),
    cleanup,
  });
}

function resultFromVerification(verification) {
  if (verification?.status === "passed") {
    return Object.freeze({ status: "passed", failureClass: null, reason: null });
  }
  const failureClass = validFailureClass(verification?.failureClass)
    ? verification.failureClass
    : "verification-failure";
  return Object.freeze({
    status: "failed",
    failureClass,
    reason: stringValue(verification?.reason) ?? "agent_e2e.verification_failed",
  });
}

function resultFromError(error, lifecycle) {
  const defaultClass = lifecycle.launch === undefined
    ? "infrastructure-failure"
    : lifecycle.agent === undefined
      ? "agent-decision-failure"
      : "verification-failure";
  return Object.freeze({
    status: "failed",
    failureClass: validFailureClass(error?.failureClass) ? error.failureClass : defaultClass,
    reason: stringValue(error?.code) ?? "agent_e2e.environment_lifecycle_failed",
  });
}

async function runCleanup(adapter, context) {
  try {
    await adapter.cleanup(context);
    return Object.freeze({ status: "passed", reason: null });
  } catch (error) {
    return Object.freeze({
      status: "failed",
      reason: stringValue(error?.code) ?? "agent_e2e.cleanup_failed",
    });
  }
}

function validFailureClass(value) {
  return FAILURE_CLASSES.includes(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function adapterError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
