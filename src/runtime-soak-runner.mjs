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
  const cleanupDelayMs = nonNegativeInteger(options.cleanupDelayMs ?? 250, "cleanupDelayMs");
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const createSession = options.createSession ?? createStandardMcpSession;
  const probeRuntime = options.probeRuntime ?? probeOwnedRuntime;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const emit = createEventEmitter(options.eventSink);
  const startedAt = now();
  const sessions = [];
  const allPids = new Set();
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
      if (session.pid) allPids.add(session.pid);
      await emit("runtime.session.started", { clientIndex: index, pid: session.pid ?? null, reconnect: false });
    }
    await takeSample("initial", true);

    while (now() - startedAt < durationMs) {
      await Promise.all(sessions.flatMap((session, clientIndex) => (
        Array.from({ length: concurrency }, (_, workerIndex) => runCall({ session, clientIndex, workerIndex }))
      )));
      round += 1;
      if (faultEveryRounds > 0 && round % faultEveryRounds === 0 && now() - startedAt < durationMs) {
        const index = reconnectCount % sessions.length;
        const previous = sessions[index];
        await previous.fault();
        await emit("runtime.session.faulted", { clientIndex: index, pid: previous.pid ?? null, round });
        const replacement = await createSession({ index, reconnect: true });
        sessions[index] = replacement;
        if (replacement.pid) allPids.add(replacement.pid);
        reconnectCount += 1;
        await emit("runtime.session.started", { clientIndex: index, pid: replacement.pid ?? null, reconnect: true });
      }
      await takeSample("interval", false);
      const remaining = durationMs - (now() - startedAt);
      if (remaining > 0) await sleep(Math.min(10, Math.max(1, remaining)));
    }
    await takeSample("final", true);
  } catch (error) {
    operationalViolations.push({ code: "runtime.operational_error", message: safeErrorCode(error) });
    await emit("runtime.soak.error", { code: safeErrorCode(error) }).catch(() => {});
    if (samples.length === 0) await takeSample("error", true).catch(() => {});
  }

  if (samples.length === 0) {
    samples.push({ elapsedMs: Math.max(0, now() - startedAt), rssBytes: 0, handles: 0 });
  }
  const measuredDurationMs = Math.max(0, now() - startedAt);

  const closeResults = await Promise.allSettled(sessions.map((session) => session.close()));
  const closeFailureCount = closeResults.filter((result) => result.status === "rejected").length;
  if (cleanupDelayMs > 0) await sleep(cleanupDelayMs);
  let cleanupProbe = emptyProbe();
  let cleanupProbeCompleted = true;
  try {
    cleanupProbe = await probeRuntime({ rootPids: [...allPids] });
  } catch {
    cleanupProbeCompleted = false;
  }
  const orphanPids = [];
  for (const pid of allPids) if (await isProcessAlive(pid)) orphanPids.push(pid);
  const cleanup = {
    orphanProcessCount: Math.max(orphanPids.length, cleanupProbe.processIds.length),
    residualPortCount: cleanupProbe.listeningPorts.length,
    overlayLeakCount: cleanupProbe.overlayProcessIds.length,
    cursorLeakCount: cleanupProbe.cursorProcessIds.length,
    completed: cleanupProbeCompleted && closeFailureCount === 0,
  };
  await emit("runtime.cleanup.completed", {
    ...cleanup,
    closeFailureCount,
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

  async function takeSample(reason, force) {
    const elapsedMs = Math.max(0, now() - startedAt);
    if (!force && elapsedMs < nextSampleAt) return;
    const probe = await probeRuntime({ rootPids: [...allPids] });
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

async function defaultIsProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
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
