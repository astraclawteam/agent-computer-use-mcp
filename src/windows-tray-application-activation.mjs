import { spawn } from "node:child_process";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const WINDOWS_TRAY_ACTIVATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$identity = $env:AGENT_COMPUTER_USE_TRAY_IDENTITY
if ([string]::IsNullOrWhiteSpace($identity)) { throw "tray identity is required" }
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$match = $null
for ($index = 0; $index -lt $buttons.Count; $index += 1) {
  $candidate = $buttons.Item($index)
  if (
    $candidate.Current.AutomationId -eq "NotifyItemIcon" -and
    $candidate.Current.Name.Trim().Equals($identity.Trim(), [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    $match = $candidate
    break
  }
}
if ($null -eq $match) {
  [pscustomobject]@{ status = "not-found" } | ConvertTo-Json -Compress
  exit 0
}
$pattern = $null
if (-not $match.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
  [pscustomobject]@{ status = "unsupported" } | ConvertTo-Json -Compress
  exit 0
}
$pattern.Invoke()
[pscustomobject]@{ status = "invoked" } | ConvertTo-Json -Compress
`;

export function resolveWindowsPowerShellPath(env = process.env) {
  return env.SystemRoot
    ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export async function activateWindowsTrayApplication(options = {}) {
  const {
    name,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform !== "win32" || typeof name !== "string" || name.trim() === "") {
    return { status: "unavailable" };
  }

  const encodedScript = Buffer.from(WINDOWS_TRAY_ACTIVATION_SCRIPT, "utf16le").toString("base64");
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
      env: {
        ...process.env,
        AGENT_COMPUTER_USE_TRAY_IDENTITY: name.trim(),
      },
    },
  );

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      finish({ status: "timeout" });
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", () => finish({ status: "unavailable" }));
    child.once("close", (code) => {
      if (code !== 0) {
        finish({ status: "failed" });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim() || "{}");
        finish({ status: result.status ?? "failed" });
      } catch {
        finish({ status: "failed" });
      }
    });

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
  });
}
