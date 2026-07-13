import { basename } from "node:path";

import { REAL_APP_RESULT_STATUSES } from "../real-app-catalog.mjs";

export const APP_ADAPTER_METHODS = Object.freeze([
  "discover",
  "prepare",
  "launch",
  "observe",
  "act",
  "verify",
  "cleanup",
]);

const FINAL_STATE_KINDS = new Set([
  "file-bytes",
  "accessibility-value",
  "window-state",
  "policy-event",
]);

export async function runAppAdapter(adapter, context = {}) {
  assertAppAdapter(adapter);
  const lifecycle = {};
  const adapterContext = Object.freeze({ ...context, lifecycle });
  let result;

  try {
    const discovery = await adapter.discover(adapterContext);
    lifecycle.discovery = discovery;
    result = terminalResult(discovery);
    if (!result) {
      lifecycle.executable = sanitizeExecutableIdentity(discovery?.executable);

      const preparation = await adapter.prepare(adapterContext);
      lifecycle.preparation = preparation;
      result = terminalResult(preparation);
      if (!result) {
        lifecycle.fixture = preparation?.fixture;

        const launch = await adapter.launch(adapterContext, lifecycle.fixture);
        lifecycle.launch = launch;
        result = terminalResult(launch);
        if (!result) {
          lifecycle.app = launch?.app;

          const observation = await adapter.observe(adapterContext, lifecycle.app);
          lifecycle.observation = observation;
          result = terminalResult(observation);
          if (!result) {
            if (!hasActiveControlLease(context.controlLease)) {
              result = failureResult("app.control_lease_required");
            } else {
              const action = await adapter.act(adapterContext, observation?.observation);
              lifecycle.action = action;
              result = terminalResult(action);
              if (!result) {
                const verification = await adapter.verify(adapterContext, action?.action);
                lifecycle.verification = verification;
                result = verificationResult(verification);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    result = errorResult(error);
  }

  const cleanup = await runCleanup(adapter, adapterContext);
  if (cleanup.status === "failed" && (!result || result.status === "pass")) {
    result = failureResult(cleanup.reason);
  }

  return Object.freeze({
    ...(result ?? failureResult("app.adapter_result_missing")),
    ...(lifecycle.executable ? { executable: lifecycle.executable } : {}),
    cleanup,
  });
}

export function assertAppAdapter(adapter) {
  if (adapter === null || typeof adapter !== "object") {
    throw adapterError("app.adapter_invalid");
  }
  for (const method of APP_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw adapterError("app.adapter_method_required", method);
    }
  }
  return adapter;
}

export function sanitizeExecutableIdentity(executable) {
  if (executable === null || typeof executable !== "object") {
    throw adapterError("app.executable_identity_required");
  }
  const fileName = stringValue(executable.fileName)
    ?? (stringValue(executable.path) ? basename(executable.path) : null);
  const version = stringValue(executable.version);
  const sizeBytes = executable.sizeBytes;
  const sha256 = stringValue(executable.sha256)?.toLowerCase();
  if (!fileName || !version || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0
    || !/^[a-f0-9]{64}$/u.test(sha256 ?? "")) {
    throw adapterError("app.executable_identity_invalid");
  }
  return Object.freeze({ fileName, version, sizeBytes, sha256 });
}

function verificationResult(verification) {
  const status = verification?.status ?? "pass";
  if (!REAL_APP_RESULT_STATUSES.includes(status)) {
    return failureResult("app.adapter_status_invalid");
  }
  if (!isFinalState(verification?.finalState)) {
    return failureResult("app.final_state_required");
  }
  if (status !== "pass" && status !== "policy-blocked") {
    return failureResult("app.verification_status_invalid");
  }
  return Object.freeze({
    status,
    reason: status === "pass" ? null : reasonOf(verification, "app.policy_blocked"),
    finalState: Object.freeze({ ...verification.finalState }),
  });
}

function terminalResult(value) {
  const status = value?.status;
  if (status === undefined) return null;
  if (!REAL_APP_RESULT_STATUSES.includes(status) || status === "pass") {
    return failureResult("app.adapter_status_invalid");
  }
  if (status === "policy-blocked") {
    if (!isFinalState(value.finalState) || value.finalState.kind !== "policy-event") {
      return failureResult("app.final_state_required");
    }
    return Object.freeze({
      status,
      reason: reasonOf(value, "app.policy_blocked"),
      finalState: Object.freeze({ ...value.finalState }),
    });
  }
  return Object.freeze({ status, reason: reasonOf(value, `app.${status}`) });
}

async function runCleanup(adapter, context) {
  try {
    await adapter.cleanup(context);
    return Object.freeze({ status: "passed", reason: null });
  } catch (error) {
    return Object.freeze({ status: "failed", reason: errorCode(error, "app.cleanup_failed") });
  }
}

function errorResult(error) {
  const status = REAL_APP_RESULT_STATUSES.includes(error?.status) && error.status !== "pass"
    ? error.status
    : "product-failure";
  return Object.freeze({ status, reason: errorCode(error, "app.adapter_failed") });
}

function failureResult(reason) {
  return Object.freeze({ status: "product-failure", reason });
}

function isFinalState(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && FINAL_STATE_KINDS.has(value.kind);
}

function hasActiveControlLease(lease) {
  return lease !== null
    && typeof lease === "object"
    && stringValue(lease.id) !== null
    && lease.status === "active";
}

function reasonOf(value, fallback) {
  return stringValue(value?.reason) ?? fallback;
}

function errorCode(error, fallback) {
  return stringValue(error?.code) ?? fallback;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function adapterError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
