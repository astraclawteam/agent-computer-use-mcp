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
$applications = Get-CimInstance Win32_Process -Filter "SessionId = $currentSessionId" | ForEach-Object {
  try {
    $path = $_.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($path)) { return }
    $fullPath = [System.IO.Path]::GetFullPath($path)
    if ($fullPath.StartsWith($windowsRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return }
    if (-not $fullPath.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { return }
    [pscustomobject]@{
      name = if ($shortcutNames.ContainsKey($fullPath)) {
        $shortcutNames[$fullPath]
      } else {
        [System.IO.Path]::GetFileNameWithoutExtension($fullPath)
      }
      pid = $_.ProcessId
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
      continue;
    }
    applicationsByPath.set(key, {
      name,
      kind: "desktop",
      running: true,
      active: false,
      pid,
      processIds: [pid],
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
