import { spawn } from "node:child_process";
import { resolveWindowsPowerShellPath } from "./windows-foreground-probe.mjs";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 4 * 1024;

const WINDOWS_FOREGROUND_ACTIVATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class AgentComputerUseForegroundActivation
{
    private const int SW_RESTORE = 9;
    private const byte VK_MENU = 0x12;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool enabled);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern void SwitchToThisWindow(IntPtr window, bool altTab);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    public sealed class ActivationResult
    {
        public long PreviousWindow { get; set; }
        public long CurrentWindow { get; set; }
        public long TargetWindow { get; set; }
        public bool LandedOnTarget { get; set; }
        public bool Restored { get; set; }
        public bool Raised { get; set; }
    }

    public static ActivationResult Activate(long rawWindow, uint expectedProcess)
    {
        IntPtr target = new IntPtr(rawWindow);
        uint actualProcess;
        uint targetThread = GetWindowThreadProcessId(target, out actualProcess);
        if (targetThread == 0 || actualProcess != expectedProcess)
        {
            throw new InvalidOperationException("The approved target window no longer belongs to the expected process.");
        }

        IntPtr previous = GetForegroundWindow();
        uint previousProcess;
        uint previousThread = GetWindowThreadProcessId(previous, out previousProcess);
        uint currentThread = GetCurrentThreadId();
        bool attachedPrevious = previousThread != 0 && previousThread != currentThread
            && AttachThreadInput(currentThread, previousThread, true);
        bool attachedTarget = targetThread != currentThread
            && AttachThreadInput(currentThread, targetThread, true);
        bool restored = false;
        bool raised = false;
        try
        {
            restored = ShowWindowAsync(target, SW_RESTORE);
            keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            raised = BringWindowToTop(target);
            SetForegroundWindow(target);
            SwitchToThisWindow(target, true);
        }
        finally
        {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedPrevious) AttachThreadInput(currentThread, previousThread, false);
        }

        IntPtr current = GetForegroundWindow();
        for (int attempt = 0; current != target && attempt < 10; attempt++)
        {
            Thread.Sleep(50);
            current = GetForegroundWindow();
        }
        return new ActivationResult {
            PreviousWindow = previous.ToInt64(),
            CurrentWindow = current.ToInt64(),
            TargetWindow = target.ToInt64(),
            LandedOnTarget = current == target,
            Restored = restored,
            Raised = raised
        };
    }
}
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$result = [AgentComputerUseForegroundActivation]::Activate(
    [long]$payload.windowId,
    [uint32]$payload.processId
)
@{
    status = if ($result.LandedOnTarget) { "ok" } else { "indeterminate" }
    path = "windows-foreground-bridge"
    landed_on_target = $result.LandedOnTarget
    previous_fg_hwnd = ("0x{0:x}" -f $result.PreviousWindow)
    now_fg_hwnd = ("0x{0:x}" -f $result.CurrentWindow)
    target_hwnd = ("0x{0:x}" -f $result.TargetWindow)
    restored = $result.Restored
    raised = $result.Raised
} | ConvertTo-Json -Compress
`;

export async function activateWindowsForeground(options = {}) {
  const {
    windowId,
    processId,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform !== "win32") {
    throw activationError(
      "foreground_activation.unsupported_platform",
      "Foreground activation is available only on Windows.",
    );
  }
  if (!isPositiveSafeInteger(windowId) || !isPositiveSafeInteger(processId)) {
    throw activationError(
      "foreground_activation.invalid_target",
      "Foreground activation requires an approved window and process.",
    );
  }

  const encodedScript = Buffer.from(WINDOWS_FOREGROUND_ACTIVATION_SCRIPT, "utf16le").toString("base64");
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

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, activationError(
        "foreground_activation.timeout",
        "The Windows foreground activation bridge timed out.",
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
    child.stderr.on("data", (chunk) => {
      if (Buffer.byteLength(stderr) + chunk.length <= MAX_OUTPUT_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });
    child.once("error", () => {
      finish(reject, activationError(
        "foreground_activation.unavailable",
        "The Windows foreground activation bridge could not be started.",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        const error = activationError(
          "foreground_activation.failed",
          "The Windows foreground activation bridge failed.",
        );
        error.diagnostic = stderr.trim().slice(-1_024);
        finish(reject, error);
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (typeof result?.landed_on_target !== "boolean"
          || typeof result?.now_fg_hwnd !== "string"
          || typeof result?.target_hwnd !== "string") {
          throw new Error("invalid activation response");
        }
        finish(resolve, result);
      } catch {
        finish(reject, activationError(
          "foreground_activation.invalid_response",
          "The Windows foreground activation bridge returned an invalid response.",
        ));
      }
    });
    child.stdin.once("error", () => {
      finish(reject, activationError(
        "foreground_activation.failed",
        "The Windows foreground activation bridge rejected the target.",
      ));
    });
    child.stdin.end(JSON.stringify({
      windowId: String(windowId),
      processId: Number(processId),
    }));

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    }
  });
}

function isPositiveSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0;
}

function activationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
