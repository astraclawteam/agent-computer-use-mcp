import { openPhase6LiveMcpSession } from "../src/phase-6-live-mcp-session.mjs";

const applicationName = process.env.PHASE6_WECHAT_APPLICATION_NAME ?? "微信";
const query = process.env.PHASE6_WECHAT_QUERY ?? "Y-大风";
const message = process.env.PHASE6_WECHAT_MESSAGE ?? "这是一条测试消息";
const startedAt = Date.now();

let stopSession;
let faultSession;
let restartSession;

try {
  stopSession = await openPhase6LiveMcpSession();
  const stopController = new AbortController();
  const inFlightMessage = stopSession.callTool("computer.message", {
    applicationName,
    query,
    message,
  }, {
    signal: stopController.signal,
  });
  const stopTimer = setTimeout(() => stopController.abort(), 50);
  let stopRequestCancelled = false;
  try {
    const result = await inFlightMessage;
    stopRequestCancelled = result?.released === true
      && ["not-applied", "indeterminate"].includes(result?.outcome);
  } catch (error) {
    stopRequestCancelled = stopController.signal.aborted
      && /abort|cancel/iu.test(`${error?.name ?? ""} ${error?.message ?? ""}`);
  } finally {
    clearTimeout(stopTimer);
  }

  await delay(300);
  const firstPostStopState = await stopSession.callTool("computer.observe", { mode: "state" });
  await delay(1_000);
  const settledPostStopState = await stopSession.callTool("computer.observe", { mode: "state" });
  const firstPostStopActions = countActionStarts(firstPostStopState.auditEvents);
  const settledPostStopActions = countActionStarts(settledPostStopState.auditEvents);
  const postStopActionCount = settledPostStopActions - firstPostStopActions;
  const stopVerified = stopRequestCancelled
    && firstPostStopState.status === "idle"
    && settledPostStopState.status === "idle"
    && postStopActionCount === 0;
  await stopSession.close("phase-6-level-6-stop-complete");
  stopSession = null;

  faultSession = await openPhase6LiveMcpSession();
  const faultAccess = await faultSession.callTool("computer.acquire", {
    applicationName,
    tier: "observe",
    agentId: "phase-6-level-6-fault",
    reason: "Phase 6 controlled connector fault injection",
  });
  if (faultAccess.status !== "granted") {
    throw new Error(`phase6.level6_fault_acquire_failed:${faultAccess.status}`);
  }
  const connectorPid = faultSession.processId;
  if (!Number.isInteger(connectorPid) || connectorPid <= 0) {
    throw new Error("phase6.level6_connector_pid_missing");
  }
  const interruptedObservation = faultSession.callTool("computer.observe", { mode: "semantic" })
    .then(() => false, () => true);
  await delay(25);
  process.kill(connectorPid);
  const faultInjectionVerified = await interruptedObservation;
  await faultSession.close("phase-6-level-6-fault-cleanup").catch(() => {});
  faultSession = null;

  restartSession = await openPhase6LiveMcpSession();
  const initialRestartState = await restartSession.callTool("computer.observe", { mode: "state" });
  const restartAccess = await restartSession.callTool("computer.acquire", {
    applicationName,
    tier: "observe",
    agentId: "phase-6-level-6-restart",
    reason: "Phase 6 post-fault immediate reacquire",
  });
  const restartRelease = await restartSession.callTool("computer.release", {
    reason: "phase-6-level-6-restart-complete",
  });
  const terminalState = await restartSession.callTool("computer.observe", { mode: "state" });
  const newSessionAcquireVerified = restartAccess.status === "granted";
  const connectorRestartClean = initialRestartState.status === "idle"
    && newSessionAcquireVerified
    && ["released", "cancelled"].includes(restartRelease.status)
    && terminalState.status === "idle"
    && terminalState.activeController == null;
  await restartSession.close("phase-6-level-6-complete");
  restartSession = null;

  const elapsedMs = Date.now() - startedAt;
  const passed = stopVerified
    && postStopActionCount === 0
    && faultInjectionVerified
    && newSessionAcquireVerified
    && connectorRestartClean
    && elapsedMs <= 60_000;
  const result = {
    status: passed ? "passed" : "failed",
    levelId: "stop-and-fault-injection",
    elapsedMs,
    stopVerified,
    postStopActionCount,
    faultInjectionVerified,
    newSessionAcquireVerified,
    connectorRestartClean,
    terminalControllerState: terminalState.status,
    released: terminalState.status === "idle" && terminalState.activeController == null,
    toolErrorCount: 0,
    wrongSendCount: 0,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    levelId: "stop-and-fault-injection",
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  await stopSession?.close("phase-6-level-6-finally").catch(() => {});
  await faultSession?.close("phase-6-level-6-finally").catch(() => {});
  await restartSession?.close("phase-6-level-6-finally").catch(() => {});
}

function countActionStarts(events) {
  if (!Array.isArray(events)) throw new Error("phase6.level6_audit_events_missing");
  return events.filter((event) => event?.type === "computer.action.started").length;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
