import { spawn } from "node:child_process";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 128;

const WINDOWS_FOREGROUND_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AgentComputerUseForegroundProbe
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@

$window = [AgentComputerUseForegroundProbe]::GetForegroundWindow()
[Console]::Out.Write($window.ToInt64().ToString(
    [System.Globalization.CultureInfo]::InvariantCulture
))
`;

export function resolveWindowsPowerShellPath(env = process.env) {
  return env.SystemRoot
    ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export async function queryWindowsForegroundWindowId(options = {}) {
  const {
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform !== "win32") {
    throw foregroundProbeError(
      "foreground_probe.unsupported_platform",
      "Foreground window verification is available only on Windows.",
    );
  }

  const encodedScript = Buffer.from(WINDOWS_FOREGROUND_PROBE_SCRIPT, "utf16le").toString("base64");
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
      finish(reject, foregroundProbeError(
        "foreground_probe.timeout",
        "The Windows foreground probe timed out.",
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
      finish(reject, foregroundProbeError(
        "foreground_probe.unavailable",
        "The Windows foreground probe could not be started.",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        finish(reject, foregroundProbeError(
          "foreground_probe.failed",
          "The Windows foreground probe failed.",
        ));
        return;
      }
      const value = stdout.trim();
      try {
        const windowId = BigInt(value);
        if (windowId <= 0n) throw new Error("invalid foreground window");
        finish(resolve, windowId.toString());
      } catch {
        finish(reject, foregroundProbeError(
          "foreground_probe.invalid_response",
          "The Windows foreground probe returned an invalid window handle.",
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

function foregroundProbeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
