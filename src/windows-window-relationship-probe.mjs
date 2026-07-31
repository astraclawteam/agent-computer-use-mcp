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

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr window);
}
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$relationships = @()
foreach ($rawWindow in @($payload.windowIds)) {
  $window = [IntPtr]::new([long]$rawWindow)
  if (-not [AgentComputerUseWindowRelationshipProbe]::IsWindow($window)) { continue }
  $owner = [AgentComputerUseWindowRelationshipProbe]::GetWindow($window, 4)
  $relationships += [pscustomobject]@{
    windowId = $window.ToInt64().ToString([System.Globalization.CultureInfo]::InvariantCulture)
    ownerWindowId = if ($owner -eq [IntPtr]::Zero) {
      $null
    } else {
      $owner.ToInt64().ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    enabled = [AgentComputerUseWindowRelationshipProbe]::IsWindowEnabled($window)
  }
}
@{ relationships = $relationships } | ConvertTo-Json -Compress
`;

export async function queryWindowsWindowRelationships(options = {}) {
  const {
    windowIds,
    platform = process.platform,
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
        finish(normalizeRelationships(payload.relationships, normalizedWindowIds));
      } catch {
        finish([]);
      }
    });
    child.stdin.end(JSON.stringify({ windowIds: normalizedWindowIds }));

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

function normalizeRelationships(relationships, requestedWindowIds) {
  const requested = new Set(requestedWindowIds);
  const result = [];
  for (const relationship of Array.isArray(relationships) ? relationships : []) {
    const windowId = normalizeWindowId(relationship?.windowId);
    const ownerWindowId = normalizeWindowId(relationship?.ownerWindowId);
    if (!windowId || !requested.has(windowId)) continue;
    result.push({
      windowId,
      ownerWindowId,
      enabled: relationship?.enabled === true,
    });
  }
  return result;
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
