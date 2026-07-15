export const HOST_DRIVER_METHODS = Object.freeze([
  "discover",
  "createSession",
  "configureMcp",
  "submitPrompt",
  "waitForTerminal",
  "collectEvidence",
  "cancel",
  "close",
]);

const FORBIDDEN_METHODS = new Set([
  "callTool",
  "clickTarget",
  "typeTarget",
  "injectToolResult",
  "observeTarget",
  "alterObservation",
]);

export function assertHostDriver(driver) {
  if (driver === null || typeof driver !== "object" || Array.isArray(driver)) {
    throw hostError("agent_e2e.host_invalid");
  }
  for (const method of HOST_DRIVER_METHODS) {
    if (typeof driver[method] !== "function") {
      throw hostError("agent_e2e.host_method_required", method);
    }
  }
  for (const [key, value] of Object.entries(driver)) {
    if (typeof value === "function" && !HOST_DRIVER_METHODS.includes(key)) {
      const code = FORBIDDEN_METHODS.has(key)
        ? "agent_e2e.host_method_forbidden"
        : "agent_e2e.host_method_unrecognized";
      throw hostError(code, key);
    }
  }
  return true;
}

function hostError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
