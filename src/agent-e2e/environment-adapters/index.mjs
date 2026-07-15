import { ENVIRONMENT_ADAPTER_METHODS } from "../environment-adapter.mjs";

export const REGISTERED_ENVIRONMENT_ADAPTER_IDS = Object.freeze([
  "temporary-text-document",
  "temporary-spreadsheet",
  "temporary-presentation",
  "temporary-browser-form",
  "temporary-electron-editor",
  "temporary-system-dialog",
  "temporary-canvas",
  "temporary-multi-window",
  "temporary-recovery-state",
  "temporary-policy-surface",
]);

export function createRegisteredEnvironmentAdapter(adapterId, operations) {
  if (!REGISTERED_ENVIRONMENT_ADAPTER_IDS.includes(adapterId)) {
    throw adapterError("agent_e2e.adapter_not_registered", adapterId);
  }
  if (operations === null || typeof operations !== "object" || Array.isArray(operations)) {
    throw adapterError("agent_e2e.adapter_operations_invalid");
  }
  for (const method of ENVIRONMENT_ADAPTER_METHODS) {
    if (typeof operations[method] !== "function") {
      throw adapterError("agent_e2e.adapter_operation_required", method);
    }
  }
  for (const [key, value] of Object.entries(operations)) {
    if (typeof value === "function" && !ENVIRONMENT_ADAPTER_METHODS.includes(key)) {
      throw adapterError("agent_e2e.adapter_operation_forbidden", key);
    }
  }
  return Object.freeze({
    adapterId,
    discover: (context) => operations.discover(context),
    prepare: (context) => operations.prepare(context),
    launch: (context, fixture) => operations.launch(context, fixture),
    verify: (context, agentResult) => operations.verify(context, agentResult),
    cleanup: (context) => operations.cleanup(context),
  });
}

function adapterError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
