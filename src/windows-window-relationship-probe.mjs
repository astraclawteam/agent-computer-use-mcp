import { spawn } from "node:child_process";
import { resolveWindowsPowerShellPath } from "./windows-foreground-probe.mjs";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 32 * 1024;

const WINDOWS_WINDOW_RELATIONSHIP_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AgentComputerUseWindowRelationshipProbe
{
    private const uint GW_OWNER = 4;

    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr window, out Rect rect);

    public static int[] ReadWindowBounds(IntPtr window)
    {
        Rect rect;
        if (!GetWindowRect(window, out rect)) return null;
        return new[] { rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top };
    }

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

}
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$requested = [System.Collections.Generic.HashSet[long]]::new()
foreach ($rawWindow in @($payload.windowIds)) { [void]$requested.Add([long]$rawWindow) }
$requestedProcesses = [System.Collections.Generic.HashSet[uint32]]::new()
foreach ($rawProcess in @($payload.processIds)) { [void]$requestedProcesses.Add([uint32]$rawProcess) }
$includeOwnedWindows = $payload.includeOwnedWindows -eq $true
$relationships = @()
$candidateWindows = [System.Collections.Generic.List[System.IntPtr]]::new()
if ($includeOwnedWindows) {
  $callback = [AgentComputerUseWindowRelationshipProbe+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$parameter)
    $candidateWindows.Add($window)
    return $true
  }
  [void][AgentComputerUseWindowRelationshipProbe]::EnumWindows($callback, [IntPtr]::Zero)
} else {
  foreach ($rawWindow in @($payload.windowIds)) {
    $candidateWindows.Add([IntPtr]::new([long]$rawWindow))
  }
}
foreach ($window in $candidateWindows) {
  if (-not [AgentComputerUseWindowRelationshipProbe]::IsWindow($window)) { continue }
  $owner = [AgentComputerUseWindowRelationshipProbe]::GetWindow($window, 4)
  $processId = [uint32]0
  [void][AgentComputerUseWindowRelationshipProbe]::GetWindowThreadProcessId($window, [ref]$processId)
  $windowId = $window.ToInt64()
  $ownerId = if ($owner -eq [IntPtr]::Zero) { 0 } else { $owner.ToInt64() }
  $ownedByRequestedWindow = $ownerId -ne 0 -and $requested.Contains($ownerId)
  $sameRequestedProcess = $requestedProcesses.Contains($processId)
  if (-not $requested.Contains($windowId) -and -not $ownedByRequestedWindow -and -not $sameRequestedProcess) {
    continue
  }
  $bounds = [AgentComputerUseWindowRelationshipProbe]::ReadWindowBounds($window)
  $relationships += [pscustomobject]@{
    windowId = $windowId.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    ownerWindowId = if ($owner -eq [IntPtr]::Zero) {
      $null
    } else {
      $owner.ToInt64().ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    enabled = [AgentComputerUseWindowRelationshipProbe]::IsWindowEnabled($window)
    visible = [AgentComputerUseWindowRelationshipProbe]::IsWindowVisible($window)
    processId = [int64]$processId
    ownedByRequestedWindow = $ownedByRequestedWindow
    sameRequestedProcess = $sameRequestedProcess
    boundsX = if ($null -ne $bounds) { $bounds[0] } else { $null }
    boundsY = if ($null -ne $bounds) { $bounds[1] } else { $null }
    boundsWidth = if ($null -ne $bounds) { $bounds[2] } else { $null }
    boundsHeight = if ($null -ne $bounds) { $bounds[3] } else { $null }
  }
}
@{ relationships = $relationships } | ConvertTo-Json -Compress
`;

export async function queryWindowsWindowRelationships(options = {}) {
  const {
    windowIds,
    processIds,
    includeOwnedWindows = false,
    platform = globalThis.process?.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const normalizedWindowIds = normalizeWindowIds(windowIds);
  if (platform !== "win32" || normalizedWindowIds.length === 0) {
    return [];
  }

  const encodedScript = Buffer.from(
    WINDOWS_WINDOW_RELATIONSHIP_SCRIPT,
    "utf16le",
  ).toString("base64");
  const child = spawnProcess(
    powershellPath,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish([]);
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", () => {});
    child.once("error", () => finish([]));
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        finish([]);
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim() || "{}");
        finish(normalizeRelationships(payload.relationships, normalizedWindowIds, {
          includeOwnedWindows,
          processIds: normalizeProcessIds(processIds),
        }));
      } catch {
        finish([]);
      }
    });
    child.stdin.end(JSON.stringify({
      windowIds: normalizedWindowIds,
      processIds: normalizeProcessIds(processIds),
      includeOwnedWindows,
    }));

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
  });
}

function normalizeWindowIds(windowIds) {
  const result = [];
  for (const rawWindowId of Array.isArray(windowIds) ? windowIds : []) {
    try {
      const windowId = BigInt(rawWindowId);
      if (windowId > 0n) {
        const value = windowId.toString();
        if (!result.includes(value)) result.push(value);
      }
    } catch {
      // Invalid handles are omitted from the bounded native probe.
    }
  }
  return result;
}

function normalizeRelationships(relationships, requestedWindowIds, options = {}) {
  const requested = new Set(requestedWindowIds);
  const requestedProcesses = new Set(options.processIds ?? []);
  const result = [];
  for (const relationship of Array.isArray(relationships) ? relationships : []) {
    const windowId = normalizeWindowId(relationship?.windowId);
    const ownerWindowId = normalizeWindowId(relationship?.ownerWindowId);
    const processId = normalizeProcessId(relationship?.processId);
    const requestedRelationship = requested.has(windowId);
    const ownedRelationship = options.includeOwnedWindows === true
      && ownerWindowId !== null
      && requested.has(ownerWindowId)
      && relationship?.ownedByRequestedWindow === true;
    const sameProcessRelationship = options.includeOwnedWindows === true
      && processId !== null
      && requestedProcesses.has(processId)
      && relationship?.sameRequestedProcess === true;
    if (!windowId || (!requestedRelationship && !ownedRelationship && !sameProcessRelationship)) continue;
    result.push({
      windowId,
      ownerWindowId,
      enabled: relationship?.enabled === true,
      ...(options.includeOwnedWindows === true ? {
        visible: relationship?.visible === true,
        processId,
        ownedByRequestedWindow: ownedRelationship,
        sameRequestedProcess: sameProcessRelationship,
        bounds: normalizeBounds(relationship?.bounds ?? {
          x: relationship?.boundsX,
          y: relationship?.boundsY,
          width: relationship?.boundsWidth,
          height: relationship?.boundsHeight,
        }),
      } : {}),
    });
  }
  return result;
}

function normalizeProcessIds(processIds) {
  const result = [];
  for (const rawProcessId of Array.isArray(processIds) ? processIds : []) {
    const processId = normalizeProcessId(rawProcessId);
    if (processId !== null && !result.includes(processId)) result.push(processId);
  }
  return result;
}

function normalizeProcessId(value) {
  const processId = Number(value);
  return Number.isSafeInteger(processId) && processId > 0 ? processId : null;
}

function normalizeBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function normalizeWindowId(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const windowId = BigInt(value);
    return windowId > 0n ? windowId.toString() : null;
  } catch {
    return null;
  }
}
