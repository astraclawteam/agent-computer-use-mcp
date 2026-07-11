import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const READ_ONLY_CALLS = Object.freeze([
  ["computer.health", { fast: true }],
  ["computer.list_state", {}],
  ["computer.installation", { client: "codex" }],
]);

export async function runRuntimeSoak(options = {}) {
  const durationMs = positiveInteger(options.durationMs ?? 60_000, "durationMs");
  const clientCount = positiveInteger(options.clientCount ?? 2, "clientCount");
  const concurrency = positiveInteger(options.concurrency ?? 2, "concurrency");
  const faultEveryRounds = nonNegativeInteger(options.faultEveryRounds ?? 20, "faultEveryRounds");
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const createSession = options.createSession ?? createStandardMcpSession;
  const processProbe = options.processProbe ?? probeProcesses;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const startedAt = now();
  const sessions = [];
  const allPids = new Set();
  const latencies = [];
  const violations = [];
  let completedCalls = 0;
  let failedCalls = 0;
  let overlayLeakCount = 0;
  let desktopControlStartCount = 0;
  let reconnectCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let round = 0;

  try {
    for (let index = 0; index < clientCount; index += 1) {
      const session = await createSession({ index });
      sessions.push(session);
      if (session.pid) allPids.add(session.pid);
    }
    const initialPids = sessions.map((session) => session.pid).filter(Boolean);
    const initialResources = totalResources(await processProbe(initialPids));

    while (now() - startedAt < durationMs) {
      await Promise.all(sessions.flatMap((session, clientIndex) => (
        Array.from({ length: concurrency }, async (_, workerIndex) => {
          const [name, args] = READ_ONLY_CALLS[(round + clientIndex + workerIndex) % READ_ONLY_CALLS.length];
          const callStarted = now();
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            const response = await session.callTool(name, args);
            latencies.push(Math.max(0, now() - callStarted));
            if (response?.isError) failedCalls += 1;
            else completedCalls += 1;
            if (response?.structuredContent?.includeUserOverlay !== false) overlayLeakCount += 1;
            if (response?.structuredContent?.startsDesktopControl === true) desktopControlStartCount += 1;
          } catch {
            failedCalls += 1;
          } finally {
            inFlight -= 1;
          }
        })
      )));
      round += 1;
      if (faultEveryRounds > 0 && round % faultEveryRounds === 0 && now() - startedAt < durationMs) {
        const index = reconnectCount % sessions.length;
        await sessions[index].fault();
        const replacement = await createSession({ index, reconnect: true });
        sessions[index] = replacement;
        if (replacement.pid) allPids.add(replacement.pid);
        reconnectCount += 1;
      }
      await sleep(Math.min(10, Math.max(1, durationMs - (now() - startedAt))));
    }

    const finalPids = sessions.map((session) => session.pid).filter(Boolean);
    const finalResources = totalResources(await processProbe(finalPids));
    const rssGrowthBytes = finalResources.rssBytes - initialResources.rssBytes;
    const handleGrowth = finalResources.handles - initialResources.handles;
    const maxRssGrowthBytes = options.maxRssGrowthBytes ?? 64 * 1024 * 1024 * clientCount;
    const maxHandleGrowth = options.maxHandleGrowth ?? 256 * clientCount;
    if (rssGrowthBytes > maxRssGrowthBytes) {
      violations.push({ code: "runtime.rss_growth_exceeded", actual: rssGrowthBytes, maximum: maxRssGrowthBytes });
    }
    if (handleGrowth > maxHandleGrowth) {
      violations.push({ code: "runtime.handle_growth_exceeded", actual: handleGrowth, maximum: maxHandleGrowth });
    }
    if (failedCalls > 0) violations.push({ code: "runtime.request_failures", count: failedCalls });
    if (overlayLeakCount > 0) violations.push({ code: "runtime.overlay_observation_leak", count: overlayLeakCount });
    if (desktopControlStartCount > 0) violations.push({ code: "runtime.unexpected_desktop_control", count: desktopControlStartCount });

    await Promise.all(sessions.map((session) => session.close().catch(() => {})));
    await sleep(25);
    const orphanPids = [];
    for (const pid of allPids) if (await isProcessAlive(pid)) orphanPids.push(pid);
    if (orphanPids.length > 0) violations.push({ code: "runtime.orphan_processes", count: orphanPids.length });

    return {
      schemaVersion: 1,
      status: violations.length === 0 ? "passed" : "failed",
      phase: "8.0",
      benchmark: "runtime-soak",
      durationMs: Math.round(now() - startedAt),
      clientCount,
      concurrency,
      rounds: round,
      completedCalls,
      failedCalls,
      reconnectCount,
      maxInFlight,
      p95LatencyMs: percentile(latencies, 0.95),
      rssGrowthBytes,
      handleGrowth,
      overlayLeakCount,
      desktopControlStartCount,
      orphanProcessCount: orphanPids.length,
      violations,
      includeUserOverlay: false,
    };
  } finally {
    await Promise.all(sessions.map((session) => session.close().catch(() => {})));
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

async function probeProcesses(pids) {
  if (pids.length === 0) return {};
  const safePids = pids.map((pid) => positiveInteger(pid, "pid"));
  const script = `$items = Get-Process -Id ${safePids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,HandleCount; $items | ConvertTo-Json -Compress`;
  const output = await run("powershell", ["-NoProfile", "-Command", script]);
  const parsed = output.stdout.trim() ? JSON.parse(output.stdout) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return Object.fromEntries(rows.map((row) => [row.Id, { rssBytes: row.WorkingSet64, handles: row.HandleCount }]));
}

function totalResources(probe) {
  return Object.values(probe).reduce((total, item) => ({
    rssBytes: total.rssBytes + (item.rssBytes ?? 0),
    handles: total.handles + (item.handles ?? 0),
  }), { rssBytes: 0, handles: 0 });
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] * 100) / 100;
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

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(stderr || stdout)));
  });
}
