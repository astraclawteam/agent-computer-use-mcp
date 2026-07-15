import { FAILURE_CLASSES, canonicalPrompt } from "./qualification-contract.mjs";
import { assertHostDriver } from "./host-driver.mjs";

export async function runAgentAttempt(options = {}) {
  const { driver, lane, task, packageIdentity, expectedModel, scope } = options;
  assertHostDriver(driver);
  assertAttemptOptions({ lane, task, packageIdentity, expectedModel, scope });
  let session;
  let result;

  try {
    const hostIdentity = await driver.discover({ lane });
    session = await driver.createSession({ lane, taskId: task.taskId ?? null });
    await driver.configureMcp(session, {
      lane,
      packageIdentity: deepFreeze(structuredClone(packageIdentity)),
      scope: deepFreeze(structuredClone(scope)),
    });
    await driver.submitPrompt(session, canonicalPrompt(task));
    const terminal = await waitWithTimeout(
      driver.waitForTerminal(session, { timeoutMs: task.timeoutMs }),
      task.timeoutMs,
    );
    const evidence = await driver.collectEvidence(session);
    result = resultFromTerminal({ terminal, evidence, hostIdentity, packageIdentity, expectedModel });
  } catch (error) {
    if (error?.code === "agent_e2e.host_timeout" && session) {
      await driver.cancel(session).catch(() => {});
    }
    result = failureResult(
      validFailureClass(error?.failureClass) ? error.failureClass : "infrastructure-failure",
      stringValue(error?.code) ?? "agent_e2e.host_failed",
    );
  }

  try {
    await driver.close(session);
  } catch (error) {
    result = failureResult("cleanup-failure", stringValue(error?.code) ?? "agent_e2e.host_close_failed");
  }
  return deepFreeze(result);
}

function resultFromTerminal({ terminal, evidence, hostIdentity, packageIdentity, expectedModel }) {
  if (terminal?.status !== "completed") {
    return failureResult(
      validFailureClass(terminal?.failureClass) ? terminal.failureClass : "agent-decision-failure",
      stringValue(terminal?.reason) ?? "agent_e2e.agent_terminal_failure",
    );
  }
  if (!sameIdentity(evidence?.modelIdentity, expectedModel)) {
    return failureResult("infrastructure-failure", "agent_e2e.model_identity_mismatch");
  }
  if (!sameIdentity(evidence?.mcpIdentity, packageIdentity)) {
    return failureResult("infrastructure-failure", "agent_e2e.mcp_identity_mismatch");
  }
  return {
    status: "passed",
    failureClass: null,
    reason: null,
    hostIdentity: structuredClone(hostIdentity),
    modelIdentity: structuredClone(evidence.modelIdentity),
    mcpIdentity: structuredClone(evidence.mcpIdentity),
    transcript: structuredClone(evidence.transcript ?? []),
    mcpEvents: structuredClone(evidence.mcpEvents ?? []),
  };
}

function waitWithTimeout(operation, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(attemptError("agent_e2e.host_timeout")), timeoutMs);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
}

function assertAttemptOptions({ lane, task, packageIdentity, expectedModel, scope }) {
  if (typeof lane !== "string" || lane === "") throw attemptError("agent_e2e.lane_required");
  if (typeof task?.goal !== "string" || !Number.isSafeInteger(task?.timeoutMs) || task.timeoutMs < 1) {
    throw attemptError("agent_e2e.task_invalid");
  }
  if (!isRecord(packageIdentity) || !isRecord(expectedModel) || !isRecord(scope)) {
    throw attemptError("agent_e2e.attempt_identity_invalid");
  }
}

function sameIdentity(actual, expected) {
  return stableStringify(actual) === stableStringify(expected);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function failureResult(failureClass, reason) {
  return { status: "failed", failureClass, reason };
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function attemptError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
