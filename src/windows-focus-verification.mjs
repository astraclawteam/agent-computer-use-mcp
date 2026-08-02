import { spawn } from "node:child_process";

import { resolveWindowsPowerShellPath } from "./windows-unicode-input.mjs";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BRIDGE_OUTPUT_BYTES = 16 * 1024;

const WINDOWS_FOCUS_VERIFICATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AgentComputerUseFocusVerification
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public int cbSize;
        public uint flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public RECT rcCaret;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);

    public static void Verify(long expectedWindow, uint expectedProcess)
    {
        IntPtr foreground = GetForegroundWindow();
        uint foregroundProcess;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcess);
        if (foreground != new IntPtr(expectedWindow))
            throw new InvalidOperationException("The approved target window is not foreground.");
        if (foregroundProcess != expectedProcess)
            throw new InvalidOperationException("The foreground window does not belong to the approved target process.");

        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (!GetGUIThreadInfo(foregroundThread, ref info) || info.hwndFocus == IntPtr.Zero)
            throw new InvalidOperationException("The approved target has no verified focused window.");
        uint focusProcess;
        GetWindowThreadProcessId(info.hwndFocus, out focusProcess);
        if (focusProcess != expectedProcess)
            throw new InvalidOperationException("The focused window does not belong to the approved target process.");
    }
}
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
[AgentComputerUseFocusVerification]::Verify(
    [long]$payload.windowId,
    [uint32]$payload.processId
)
@{
    status = "ok"
    focusVerified = $true
    verificationPath = "windows_user32_foreground_focus"
} | ConvertTo-Json -Compress
`;

export async function verifyWindowsFocusedProcess(options = {}) {
  const {
    windowId,
    processId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    signal,
  } = options;

  if (signal?.aborted === true) {
    throw focusVerificationError("focus_verification.cancelled", "Focus verification was cancelled.", "preflight");
  }
  if (platform !== "win32") {
    throw focusVerificationError(
      "focus_verification.unsupported_platform",
      "Native focus verification is available only on Windows.",
      "validation",
    );
  }
  if (!isValidWindowId(windowId)) {
    throw focusVerificationError(
      "focus_verification.invalid_window",
      "Focus verification requires an approved target window handle.",
      "validation",
    );
  }
  if (!Number.isSafeInteger(Number(processId)) || Number(processId) <= 0) {
    throw focusVerificationError(
      "focus_verification.invalid_process",
      "Focus verification requires an approved target process identifier.",
      "validation",
    );
  }

  const encodedScript = Buffer.from(WINDOWS_FOCUS_VERIFICATION_SCRIPT, "utf16le").toString("base64");
  let child;
  try {
    child = spawnProcess(
      powershellPath,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
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
  } catch {
    throw focusVerificationError(
      "focus_verification.bridge_unavailable",
      "The Windows focus verification bridge could not be started.",
      "bridge-start",
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let outputOverflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, focusVerificationError(
        "focus_verification.timeout",
        "The Windows focus verification bridge timed out.",
        "bridge-execution",
      ));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      child.kill();
      finish(reject, focusVerificationError(
        "focus_verification.cancelled",
        "Focus verification was cancelled.",
        "bridge-execution",
      ));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_BRIDGE_OUTPUT_BYTES) {
        outputOverflow = true;
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.resume();
    child.once("error", () => {
      finish(reject, focusVerificationError(
        "focus_verification.bridge_unavailable",
        "The Windows focus verification bridge could not be started.",
        "bridge-start",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || outputOverflow) {
        finish(reject, focusVerificationError(
          "focus_verification.bridge_failed",
          "The Windows focus verification bridge rejected the operation.",
          "bridge-execution",
        ));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result?.status !== "ok"
          || result.focusVerified !== true
          || result.verificationPath !== "windows_user32_foreground_focus") {
          throw new Error("invalid bridge response");
        }
        finish(resolve, {
          status: "ok",
          focusVerified: true,
          verificationPath: result.verificationPath,
        });
      } catch {
        finish(reject, focusVerificationError(
          "focus_verification.invalid_response",
          "The Windows focus verification bridge returned an invalid response.",
          "bridge-response",
        ));
      }
    });
    child.stdin.once("error", () => {
      finish(reject, focusVerificationError(
        "focus_verification.bridge_input_failed",
        "The Windows focus verification bridge rejected its request.",
        "bridge-input",
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
      signal?.removeEventListener?.("abort", onAbort);
      settle(value);
    }
  });
}

function isValidWindowId(value) {
  try {
    const numeric = typeof value === "bigint" ? value : BigInt(String(value ?? "0"));
    return numeric > 0n && numeric <= BigInt(Number.MAX_SAFE_INTEGER);
  } catch {
    return false;
  }
}

function focusVerificationError(code, message, stage) {
  const error = new Error(message);
  error.code = code;
  error.detail = Object.freeze({ stage, effect: "not-applied", sideEffects: Object.freeze({ none: true }) });
  return error;
}
