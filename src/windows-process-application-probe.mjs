import { spawn } from "node:child_process";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

const WINDOWS_PROCESS_APPLICATION_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$currentSessionId = (Get-Process -Id $PID).SessionId
$windowsRoot = [System.IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\') + '\'
$shortcutNames = @{}
try {
  $shortcutShell = New-Object -ComObject WScript.Shell
  $startMenuRoots = @(
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  Get-ChildItem -LiteralPath $startMenuRoots -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $shortcutShell.CreateShortcut($_.FullName)
      if (-not [string]::IsNullOrWhiteSpace($shortcut.TargetPath)) {
        $shortcutTarget = [System.IO.Path]::GetFullPath($shortcut.TargetPath)
        if (-not $shortcutNames.ContainsKey($shortcutTarget)) {
          $shortcutNames[$shortcutTarget] = $_.BaseName
        }
      }
    } catch {
      # Broken and non-filesystem shortcuts are intentionally omitted.
    }
  }
} catch {
  # Start Menu identity enrichment is best-effort; process discovery remains available.
}
$allProcesses = @(Get-CimInstance Win32_Process -Filter "SessionId = $currentSessionId")
$processById = @{}
$allProcesses | ForEach-Object { $processById[[int]$_.ProcessId] = $_ }
# A process under the Windows directory is normally OS machinery, but the same
# directory also holds user-facing applications: a packaged app runs inside a
# generic host process shipped with the OS, and the shell, stock editors, and
# viewers live there too. Owning a top-level window is what separates the two.
# Window presence and window title are separate facts: a minimized or tray
# surface can keep a valid HWND while temporarily exposing an empty title.
$windowHandleByPid = @{}
$windowTitleByPid = @{}
try {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
    $windowHandleByPid[[int]$_.Id] = [int64]$_.MainWindowHandle
    $windowTitleByPid[[int]$_.Id] = $_.MainWindowTitle
  }
} catch {
  # Window enumeration is best-effort; process discovery remains available.
}
function Get-WindowsAppsPackageRoot([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $null }
  $match = [regex]::Match($path, '^(.*\\WindowsApps\\[^\\]+)\\', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}
function Test-SameApplicationFamily([string]$childPath, [string]$parentPath) {
  if ([string]::IsNullOrWhiteSpace($childPath) -or [string]::IsNullOrWhiteSpace($parentPath)) { return $false }
  $childRoot = Get-WindowsAppsPackageRoot $childPath
  $parentRoot = Get-WindowsAppsPackageRoot $parentPath
  if ($childRoot -and $parentRoot) {
    return $childRoot.Equals($parentRoot, [System.StringComparison]::OrdinalIgnoreCase)
  }
  return [System.IO.Path]::GetDirectoryName($childPath).Equals(
    [System.IO.Path]::GetDirectoryName($parentPath),
    [System.StringComparison]::OrdinalIgnoreCase
  )
}
$applications = $allProcesses | ForEach-Object {
  try {
    $path = $_.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($path)) { return }
    $fullPath = [System.IO.Path]::GetFullPath($path)
    $windowTitle = $windowTitleByPid[[int]$_.ProcessId]
    $hasWindow = $windowHandleByPid.ContainsKey([int]$_.ProcessId)
    if ($fullPath.StartsWith($windowsRoot, [System.StringComparison]::OrdinalIgnoreCase) -and -not $hasWindow) { return }
    if (-not $fullPath.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { return }
    $parent = $processById[[int]$_.ParentProcessId]
    $ownerPid = $null
    if ($parent -and -not [string]::IsNullOrWhiteSpace($parent.ExecutablePath)) {
      $parentPath = [System.IO.Path]::GetFullPath($parent.ExecutablePath)
      if (Test-SameApplicationFamily $fullPath $parentPath) { $ownerPid = [int]$parent.ProcessId }
    }
    [pscustomobject]@{
      # A Start Menu shortcut is the most stable identity; a packaged app hosted
      # by a generic executable has none, and its window title carries the name
      # the user would say. The executable name is the last resort.
      name = if ($shortcutNames.ContainsKey($fullPath)) {
        $shortcutNames[$fullPath]
      } elseif (-not [string]::IsNullOrWhiteSpace($windowTitle) -and $fullPath.StartsWith($windowsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $windowTitle
      } else {
        [System.IO.Path]::GetFileNameWithoutExtension($fullPath)
      }
      pid = $_.ProcessId
      ownerPid = $ownerPid
      launchPath = $fullPath
    }
  } catch {
    # Protected and terminating processes are intentionally omitted.
  }
}
@($applications) | ConvertTo-Json -Compress
`;

export function resolveWindowsPowerShellPath(env = process.env) {
  return env.SystemRoot
    ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export async function queryWindowsProcessApplications(options = {}) {
  const {
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform !== "win32") return [];

  const encodedScript = Buffer.from(
    WINDOWS_PROCESS_APPLICATION_PROBE_SCRIPT,
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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, processProbeError(
        "process_application_probe.timeout",
        "The Windows process application probe timed out.",
      ));
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
    child.once("error", () => {
      finish(reject, processProbeError(
        "process_application_probe.unavailable",
        "The Windows process application probe could not be started.",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        finish(reject, processProbeError(
          "process_application_probe.failed",
          "The Windows process application probe failed.",
        ));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "[]");
        finish(resolve, normalizeApplications(parsed));
      } catch {
        finish(reject, processProbeError(
          "process_application_probe.invalid_response",
          "The Windows process application probe returned invalid data.",
        ));
      }
    });

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    }
  });
}

function normalizeApplications(value) {
  if (!Array.isArray(value)) throw new TypeError("applications must be an array");
  const applicationsByPath = new Map();
  for (const application of value) {
    const name = String(application?.name ?? "").trim();
    const launchPath = String(application?.launchPath ?? "").trim();
    const pid = Number(application?.pid);
    if (
      !name
      || name.length > 260
      || !launchPath
      || launchPath.length > 32_767
      || !launchPath.toLowerCase().endsWith(".exe")
      || !Number.isSafeInteger(pid)
      || pid <= 0
    ) continue;
    const key = launchPath.toLowerCase();
    const existing = applicationsByPath.get(key);
    if (existing) {
      if (!existing.processIds.includes(pid)) existing.processIds.push(pid);
      const ownerPid = Number(application?.ownerPid);
      if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
        existing.ownerProcessIds ??= [];
        if (!existing.ownerProcessIds.includes(ownerPid)) existing.ownerProcessIds.push(ownerPid);
      }
      continue;
    }
    const ownerPid = Number(application?.ownerPid);
    applicationsByPath.set(key, {
      name,
      kind: "desktop",
      running: true,
      active: false,
      pid,
      processIds: [pid],
      ...(Number.isSafeInteger(ownerPid) && ownerPid > 0 ? { ownerProcessIds: [ownerPid] } : {}),
      lastUsed: null,
      launchPath,
    });
  }
  return [...applicationsByPath.values()];
}

function processProbeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
