import { spawn } from "node:child_process";

const EMPTY_PROBE = Object.freeze({
  processIds: [],
  processes: [],
  rssBytes: 0,
  handles: 0,
  listeningPorts: [],
  overlayProcessIds: [],
  cursorProcessIds: [],
});

export async function probeOwnedRuntime(options = {}) {
  const rootPids = validateRootPids(options.rootPids ?? []);
  const rootProcesses = validateRootProcesses(options.rootProcesses ?? []);
  if (rootPids.length > 0 && rootProcesses.length > 0) throw new TypeError("runtime.probe_roots_ambiguous");
  const requestedPids = rootProcesses.length > 0 ? rootProcesses.map((root) => root.pid) : rootPids;
  if (requestedPids.length === 0) return structuredClone(EMPTY_PROBE);
  const runPowerShell = options.runPowerShell ?? defaultRunPowerShell;
  const script = buildProbeScript(requestedPids);
  let raw;
  try {
    raw = await runPowerShell({ rootPids: requestedPids, rootProcesses, script });
  } catch {
    throw new Error("runtime.probe_failed");
  }
  const payload = parsePayload(raw);
  const rows = normalizeProcesses(payload.processes ?? []);
  const owned = collectOwnedPids(rootPids, rootProcesses, rows);
  const processes = rows
    .filter((row) => owned.has(row.pid))
    .sort((left, right) => left.pid - right.pid)
    .map((row) => ({
      pid: row.pid,
      parentPid: row.parentPid,
      name: row.name,
      rssBytes: row.rssBytes,
      handles: row.handles,
      ...(row.startedAtMs === null ? {} : { startedAtMs: row.startedAtMs }),
    }));
  const listeners = normalizeListeners(payload.listeners ?? [])
    .filter((listener) => owned.has(listener.pid));
  return {
    processIds: processes.map((process) => process.pid),
    processes,
    rssBytes: processes.reduce((total, process) => total + process.rssBytes, 0),
    handles: processes.reduce((total, process) => total + process.handles, 0),
    listeningPorts: [...new Set(listeners.map((listener) => listener.port))].sort((left, right) => left - right),
    overlayProcessIds: processes.filter((process) => /overlay/iu.test(process.name)).map((process) => process.pid),
    cursorProcessIds: processes.filter((process) => /cursor/iu.test(process.name)).map((process) => process.pid),
  };
}

function buildProbeScript(rootPids) {
  const roots = rootPids.join(",");
  return `$ErrorActionPreference = 'Stop'
$roots = @(${roots})
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name)
$owned = [System.Collections.Generic.HashSet[int]]::new()
foreach ($root in $roots) { [void]$owned.Add([int]$root) }
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($item in $all) {
    $pidValue = [int]$item.ProcessId
    if ($owned.Contains([int]$item.ParentProcessId) -and -not $owned.Contains($pidValue)) {
      [void]$owned.Add($pidValue)
      $changed = $true
    }
  }
}
$processes = @()
foreach ($item in $all) {
  $pidValue = [int]$item.ProcessId
  if (-not $owned.Contains($pidValue)) { continue }
  $runtime = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($null -eq $runtime) { continue }
  $processes += [pscustomobject]@{
    pid = $pidValue
    parentPid = [int]$item.ParentProcessId
    name = [string]$item.Name
    startedAtMs = [double]([DateTimeOffset]$runtime.StartTime).ToUnixTimeMilliseconds()
    rssBytes = [double]$runtime.WorkingSet64
    handles = [int]$runtime.HandleCount
  }
}
$listeners = @()
foreach ($listener in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
  if ($owned.Contains([int]$listener.OwningProcess)) {
    $listeners += [pscustomobject]@{ pid = [int]$listener.OwningProcess; port = [int]$listener.LocalPort }
  }
}
[pscustomobject]@{ processes = $processes; listeners = $listeners } | ConvertTo-Json -Compress -Depth 4`;
}

function defaultRunPowerShell({ script }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      settle(reject, new Error("runtime.probe_timeout"));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 2 * 1024 * 1024) {
        child.kill();
        settle(reject, new Error("runtime.probe_output_too_large"));
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.resume();
    child.on("error", (error) => settle(reject, error));
    child.on("close", (code) => {
      if (code === 0) settle(resolvePromise, stdout);
      else settle(reject, new Error("runtime.probe_failed"));
    });

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    }
  });
}

function validateRootPids(values) {
  if (!Array.isArray(values)) throw new TypeError("runtime.probe_pids_invalid");
  const roots = values.map((value) => {
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("runtime.probe_pid_invalid");
    return pid;
  });
  if (new Set(roots).size !== roots.length) throw new TypeError("runtime.probe_pid_duplicate");
  return roots.sort((left, right) => left - right);
}

function validateRootProcesses(values) {
  if (!Array.isArray(values)) throw new TypeError("runtime.probe_process_roots_invalid");
  const seen = new Set();
  return values.map((value) => {
    const pid = positiveInteger(value?.pid, "runtime.probe_pid_invalid");
    if (seen.has(pid)) throw new TypeError("runtime.probe_pid_duplicate");
    seen.add(pid);
    const hasExactStart = value?.startedAtMs !== undefined;
    const hasRetirementBoundary = value?.notCreatedAfterMs !== undefined;
    if (hasExactStart === hasRetirementBoundary) throw new TypeError("runtime.probe_process_identity_invalid");
    return {
      pid,
      ...(hasExactStart
        ? { startedAtMs: nonNegativeInteger(value.startedAtMs, "runtime.probe_process_start_invalid") }
        : { notCreatedAfterMs: nonNegativeInteger(value.notCreatedAfterMs, "runtime.probe_process_boundary_invalid") }),
    };
  });
}

function parsePayload(raw) {
  try {
    const payload = JSON.parse(String(raw).replace(/^\uFEFF/u, "").trim());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("shape");
    return payload;
  } catch {
    throw new Error("runtime.probe_output_invalid");
  }
}

function normalizeProcesses(rows) {
  if (!Array.isArray(rows)) throw new Error("runtime.probe_processes_invalid");
  const seen = new Set();
  return rows.map((row) => {
    const pid = positiveInteger(row?.pid, "runtime.probe_process_pid_invalid");
    if (seen.has(pid)) throw new Error("runtime.probe_process_duplicate");
    seen.add(pid);
    return {
      pid,
      parentPid: nonNegativeInteger(row?.parentPid, "runtime.probe_parent_pid_invalid"),
      name: sanitizeName(row?.name),
      startedAtMs: row?.startedAtMs === undefined
        ? null
        : nonNegativeInteger(row.startedAtMs, "runtime.probe_process_start_invalid"),
      rssBytes: nonNegativeNumber(row?.rssBytes, "runtime.probe_rss_invalid"),
      handles: nonNegativeInteger(row?.handles, "runtime.probe_handles_invalid"),
    };
  });
}

function normalizeListeners(rows) {
  if (!Array.isArray(rows)) throw new Error("runtime.probe_listeners_invalid");
  return rows.map((row) => ({
    pid: positiveInteger(row?.pid, "runtime.probe_listener_pid_invalid"),
    port: portNumber(row?.port),
  }));
}

function collectOwnedPids(rootPids, rootProcesses, rows) {
  const owned = new Set(rootPids);
  for (const root of rootProcesses) {
    const row = rows.find((candidate) => candidate.pid === root.pid);
    if (!row || row.startedAtMs === null) continue;
    const matches = root.startedAtMs !== undefined
      ? row.startedAtMs === root.startedAtMs
      : row.startedAtMs <= root.notCreatedAfterMs;
    if (matches) owned.add(root.pid);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (owned.has(row.parentPid) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  return owned;
}

function sanitizeName(value) {
  const name = String(value ?? "");
  if (!name || name.length > 260 || /[\\/]/u.test(name)) throw new Error("runtime.probe_process_name_invalid");
  return name;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(code);
  return number;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(code);
  return number;
}

function nonNegativeNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(code);
  return number;
}

function portNumber(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError("runtime.probe_port_invalid");
  return port;
}
