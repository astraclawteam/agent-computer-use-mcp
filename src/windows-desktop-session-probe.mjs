import { spawn } from "node:child_process";
import { resolveWindowsPowerShellPath } from "./windows-foreground-probe.mjs";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 2 * 1024;

const WINDOWS_DESKTOP_SESSION_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentComputerUseDesktopSessionProbe
{
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;
    private const int UOI_NAME = 2;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(
        uint flags,
        bool inherit,
        uint desiredAccess
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder information,
        int length,
        out int needed
    );

    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr desktop);

    public static string InputDesktopName()
    {
        IntPtr desktop = OpenInputDesktop(
            0,
            false,
            DESKTOP_READOBJECTS | DESKTOP_SWITCHDESKTOP
        );
        if (desktop == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "OpenInputDesktop failed: " + Marshal.GetLastWin32Error()
            );
        }
        try
        {
            int needed;
            GetUserObjectInformation(desktop, UOI_NAME, null, 0, out needed);
            StringBuilder name = new StringBuilder(Math.Max(needed, 64));
            if (!GetUserObjectInformation(
                desktop,
                UOI_NAME,
                name,
                name.Capacity,
                out needed
            ))
            {
                throw new InvalidOperationException(
                    "GetUserObjectInformation failed: " + Marshal.GetLastWin32Error()
                );
            }
            return name.ToString();
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }
}
'@

$name = [AgentComputerUseDesktopSessionProbe]::InputDesktopName()
@{
    status = if ($name -ieq "Default") { "interactive" } else { "locked" }
    inputDesktop = $name
    secureDesktop = ($name -ine "Default")
} | ConvertTo-Json -Compress
`;

export async function queryWindowsDesktopSession(options = {}) {
  const {
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform !== "win32") {
    return {
      status: "unsupported",
      inputDesktop: null,
      secureDesktop: false,
    };
  }

  const encodedScript = Buffer.from(
    WINDOWS_DESKTOP_SESSION_PROBE_SCRIPT,
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
      finish(reject, desktopProbeError(
        "desktop_probe.timeout",
        "The Windows input-desktop probe timed out.",
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
      finish(reject, desktopProbeError(
        "desktop_probe.unavailable",
        "The Windows input-desktop probe could not be started.",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        finish(reject, desktopProbeError(
          "desktop_probe.failed",
          "The Windows input-desktop probe failed.",
        ));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (!["interactive", "locked"].includes(result?.status)
          || typeof result?.secureDesktop !== "boolean"
          || typeof result?.inputDesktop !== "string") {
          throw new Error("invalid desktop probe response");
        }
        finish(resolve, result);
      } catch {
        finish(reject, desktopProbeError(
          "desktop_probe.invalid_response",
          "The Windows input-desktop probe returned an invalid response.",
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

function desktopProbeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
