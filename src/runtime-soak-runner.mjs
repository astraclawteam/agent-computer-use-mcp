import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  buildRuntimeMetrics,
  evaluateRuntimeTargets,
} from "./commercial-runtime-metrics.mjs";
import { probeOwnedRuntime } from "./windows-runtime-probe.mjs";

const SOAK_CALLS = Object.freeze([
  ["computer.health", { fast: true }],
  ["computer.list_state", {}],
  ["computer.installation", { client: "codex" }],
  ["computer.cancel", { reason: "runtime-soak-idle-cancel" }],
  ["computer.revoke", { reason: "runtime-soak-idle-revoke" }],
]);

export async function runRuntimeSoak(options = {}) {
  const durationMs = positiveInteger(options.durationMs ?? 60_000, "durationMs");
  const clientCount = positiveInteger(options.clientCount ?? 2, "clientCount");
  const concurrency = positiveInteger(options.concurrency ?? 2, "concurrency");
  const faultEveryRounds = nonNegativeInteger(options.faultEveryRounds ?? 20, "faultEveryRounds");
  const sampleIntervalMs = positiveInteger(options.sampleIntervalMs ?? 10_000, "sampleIntervalMs");
  const cleanupDelayMs = nonNegativeInteger(options.cleanupDelayMs ?? 0, "cleanupDelayMs");
  const cleanupTimeoutMs = positiveInteger(options.cleanupTimeoutMs ?? 10_000, "cleanupTimeoutMs");
  const cleanupPollIntervalMs = positiveInteger(options.cleanupPollIntervalMs ?? 100, "cleanupPollIntervalMs");
  const now = options.now ?? (() => performance.now());
  const wallClock = options.wallClock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const createSession = options.createSession ?? createStandardMcpSession;
  const probeRuntime = options.probeRuntime ?? probeOwnedRuntime;
  const emit = createEventEmitter(options.eventSink);
  const lifecycleStartedAt = now();
  const sessions = [];
  const processRoots = [];
  const observedProcesses = new Map();
  const samples = [];
  const calls = [];
  const operationalViolations = [];
  let reconnectCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let round = 0;
  let nextSampleAt = 0;
  let observationOverlayLeakCount = 0;
  let desktopControlStartCount = 0;
  let workloadStartedAt = null;
  let workloadEndedAt = null;

  await emit("runtime.soak.started", {
    durationMs,
    clientCount,
    concurrency,
    faultEveryRounds,
    sampleIntervalMs,
  });

  try {
    for (let index = 0; index < clientCount; index += 1) {
      const session = await createSession({ index });
      sessions.push(session);
      registerProcessRoot(session);
      await emit("runtime.session.started", { clientIndex: index, pid: session.pid ?? null, reconnect: false });
    }
    await takeSample("initial", true, 0);
    workloadStartedAt = now();
    nextSampleAt = sampleIntervalMs;

    while (now() - workloadStartedAt < durationMs) {
      await Promise.all(sessions.flatMap((session, clientIndex) => (
        Array.from({ length: concurrency }, (_, workerIndex) => runCall({ session, clientIndex, workerIndex }))
      )));
      round += 1;
      if (faultEveryRounds > 0 && round % faultEveryRounds === 0 && now() - workloadStartedAt < durationMs) {
        const index = reconnectCount % sessions.length;
        const previous = sessions[index];
        const previousPid = previous.pid ?? null;
        await previous.fault();
        retireProcessRoot(previous);
        await emit("runtime.session.faulted", { clientIndex: index, pid: previousPid, round });
        const replacement = await createSession({ index, reconnect: true });
        sessions[index] = replacement;
        registerProcessRoot(replacement);
        reconnectCount += 1;
        await emit("runtime.session.started", { clientIndex: index, pid: replacement.pid ?? null, reconnect: true });
      }
      await takeSample("interval", false);
      const remaining = durationMs - (now() - workloadStartedAt);
      if (remaining > 0) await sleep(Math.min(10, Math.max(1, remaining)));
    }
    workloadEndedAt = now();
    await takeSample("final", true, Math.max(0, workloadEndedAt - workloadStartedAt));
  } catch (error) {
    workloadStartedAt ??= now();
    workloadEndedAt = now();
    operationalViolations.push({ code: "runtime.operational_error", message: safeErrorCode(error) });
    await emit("runtime.soak.error", { code: safeErrorCode(error) }).catch(() => {});
    if (samples.length === 0) await takeSample("error", true).catch(() => {});
  }

  if (samples.length === 0) {
    samples.push({ elapsedMs: 0, rssBytes: 0, handles: 0 });
  }
  workloadStartedAt ??= lifecycleStartedAt;
  workloadEndedAt ??= now();
  const measuredDurationMs = Math.max(0, workloadEndedAt - workloadStartedAt);

  const closeResults = await Promise.allSettled(sessions.map(async (session) => {
    try {
      await session.close();
    } finally {
      retireProcessRoot(session);
    }
  }));
  const closeFailureCount = closeResults.filter((result) => result.status === "rejected").length;
  if (cleanupDelayMs > 0) await sleep(cleanupDelayMs);
  let cleanupProbe = emptyProbe();
  let cleanupProbeCompleted = true;
  let cleanupProbeAttempts = 0;
  const cleanupStartedAt = wallClock();
  const cleanupDeadline = cleanupStartedAt + cleanupTimeoutMs;
  const cleanupIdentities = cleanupProcessIdentities();
  while (true) {
    try {
      cleanupProbe = await probeRuntime({ rootProcesses: cleanupIdentities });
      cleanupProbeAttempts += 1;
    } catch {
      cleanupProbeCompleted = false;
      break;
    }
    if (isProbeClean(cleanupProbe)) break;
    const remainingMs = cleanupDeadline - wallClock();
    if (remainingMs <= 0) break;
    await sleep(Math.min(cleanupPollIntervalMs, remainingMs));
  }
  const cleanup = {
    orphanProcessCount: cleanupProbe.processIds.length,
    residualPortCount: cleanupProbe.listeningPorts.length,
    overlayLeakCount: cleanupProbe.overlayProcessIds.length,
    cursorLeakCount: cleanupProbe.cursorProcessIds.length,
    completed: cleanupProbeCompleted && closeFailureCount === 0,
  };
  await emit("runtime.cleanup.completed", {
    ...cleanup,
    closeFailureCount,
    cleanupProbeAttempts,
    cleanupWaitMs: Math.max(0, wallClock() - cleanupStartedAt),
    processClasses: classifyCleanupProcesses(cleanupProbe.processes, processRoots),
  }).catch(() => {
    cleanup.completed = false;
  });

  const metrics = buildRuntimeMetrics({ samples, calls, cleanup });
  const violations = [
    ...operationalViolations,
    ...evaluateRuntimeTargets(metrics, {
      maxRssGrowthBytes: options.maxRssGrowthBytes,
      maxHandleGrowth: options.maxHandleGrowth,
      maxFailureRate: options.maxFailureRate,
    }),
  ];
  if (observationOverlayLeakCount > 0) {
    violations.push({ code: "runtime.overlay_observation_leak", actual: observationOverlayLeakCount, maximum: 0 });
  }
  if (desktopControlStartCount > 0) {
    violations.push({ code: "runtime.unexpected_desktop_control", actual: desktopControlStartCount, maximum: 0 });
  }
  if (calls.length === 0) violations.push({ code: "runtime.no_calls" });

  return {
    schemaVersion: 2,
    status: violations.length === 0 ? "passed" : "failed",
    phase: "8.0",
    benchmark: "runtime-soak",
    durationMs: Math.round(measuredDurationMs),
    clientCount,
    concurrency,
    rounds: round,
    completedCalls: metrics.calls.passed,
    failedCalls: metrics.calls.failed,
    reconnectCount,
    maxInFlight,
    p95LatencyMs: metrics.calls.latencyMs.p95,
    rssGrowthBytes: metrics.rss.netGrowthBytes,
    handleGrowth: metrics.handles.netGrowth,
    overlayLeakCount: observationOverlayLeakCount,
    desktopControlStartCount,
    orphanProcessCount: cleanup.orphanProcessCount,
    samples,
    calls,
    metrics,
    violations,
    includeUserOverlay: false,
  };

  async function runCall({ session, clientIndex, workerIndex }) {
    const [name, args] = SOAK_CALLS[(round + clientIndex + workerIndex) % SOAK_CALLS.length];
    const callStarted = now();
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    let response;
    let errorCode = null;
    try {
      response = await session.callTool(name, args);
    } catch (error) {
      errorCode = safeErrorCode(error);
    } finally {
      inFlight -= 1;
    }
    const structured = response?.structuredContent ?? {};
    if (structured.includeUserOverlay !== false) observationOverlayLeakCount += 1;
    if (structured.startsDesktopControl === true) desktopControlStartCount += 1;
    const policyError = response?.isError === true && /^policy[._]/u.test(String(structured.code ?? structured.error?.code ?? ""));
    const status = policyError
      ? "policy-blocked"
      : (errorCode || response?.isError === true ? "product-failure" : "passed");
    const call = {
      tool: name,
      clientIndex,
      workerIndex,
      round,
      status,
      durationMs: Math.max(0, now() - callStarted),
      ...(policyError ? { kind: "policy-error", failClosed: true } : {}),
      ...(errorCode ? { errorCode } : {}),
    };
    calls.push(call);
    await emit("runtime.call", call);
  }

  async function takeSample(reason, force, elapsedOverride = undefined) {
    const elapsedMs = elapsedOverride ?? Math.max(0, now() - (workloadStartedAt ?? now()));
    if (!force && elapsedMs < nextSampleAt) return;
    const probe = await probeRuntime({ rootPids: activeProcessIds() });
    rememberObservedProcesses(probe.processes);
    const sample = {
      elapsedMs,
      rssBytes: probe.rssBytes,
      handles: probe.handles,
    };
    samples.push(sample);
    nextSampleAt = elapsedMs + sampleIntervalMs;
    await emit("runtime.sample", {
      ...sample,
      reason,
      processCount: probe.processIds.length,
      listeningPortCount: probe.listeningPorts.length,
      overlayProcessCount: probe.overlayProcessIds.length,
      cursorProcessCount: probe.cursorProcessIds.length,
    });
  }

  function registerProcessRoot(session) {
    if (!session.pid) return;
    processRoots.push({ session, pid: session.pid, notCreatedAfterMs: null });
  }

  function retireProcessRoot(session) {
    const root = processRoots.find((candidate) => candidate.session === session);
    if (root && root.notCreatedAfterMs === null) root.notCreatedAfterMs = wallClock();
  }

  function activeProcessIds() {
    return sessions.map((session) => session.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  }

  function rememberObservedProcesses(processes) {
    for (const process of processes ?? []) {
      if (!Number.isSafeInteger(process?.pid) || !Number.isSafeInteger(process?.startedAtMs)) continue;
      observedProcesses.set(process.pid, {
        pid: process.pid,
        startedAtMs: process.startedAtMs,
      });
    }
  }

  function cleanupProcessIdentities() {
    const identities = [...observedProcesses.values()];
    for (const root of processRoots) {
      if (identities.some((identity) => identity.pid === root.pid)) continue;
      identities.push({
        pid: root.pid,
        notCreatedAfterMs: root.notCreatedAfterMs ?? wallClock(),
      });
    }
    return identities;
  }
}

async function createStandardMcpSession({ index }) {
  const client = new Client({ name: `runtime-soak-${index + 1}`, version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  await client.connect(transport, { timeout: 15_000, maxTotalTimeout: 15_000 });
  return {
    get pid() { return transport.pid; },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args }, undefined, { timeout: 15_000, maxTotalTimeout: 15_000 });
    },
    async fault() {
      const pid = transport.pid;
      if (pid) process.kill(pid);
      await client.close().catch(() => transport.close());
    },
    async close() { await client.close().catch(() => transport.close()); },
  };
}

function createEventEmitter(eventSink) {
  if (!eventSink) return async () => {};
  if (typeof eventSink === "function") return eventSink;
  if (typeof eventSink.append === "function") return (type, payload) => eventSink.append(type, payload);
  throw new TypeError("runtime.event_sink_invalid");
}

function emptyProbe() {
  return {
    processIds: [],
    processes: [],
    rssBytes: 0,
    handles: 0,
    listeningPorts: [],
    overlayProcessIds: [],
    cursorProcessIds: [],
  };
}

function isProbeClean(probe) {
  return probe.processIds.length === 0
    && probe.listeningPorts.length === 0
    && probe.overlayProcessIds.length === 0
    && probe.cursorProcessIds.length === 0;
}

function classifyCleanupProcesses(processes, processRoots) {
  const rootPids = new Set(processRoots.map((root) => root.pid));
  const classes = { root: 0, consoleHost: 0, other: 0 };
  for (const process of processes ?? []) {
    if (rootPids.has(process.pid)) classes.root += 1;
    else if (/^conhost(?:\.exe)?$/iu.test(String(process.name ?? ""))) classes.consoleHost += 1;
    else classes.other += 1;
  }
  return classes;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^[a-z][a-z0-9_.-]{2,80}/iu.exec(message);
  return match?.[0] ?? "runtime.operation_failed";
}
