import { spawn } from "node:child_process";
import { join } from "node:path";

const MAX_TEXT_CODE_UNITS = 32_768;
const MAX_BRIDGE_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const POWERSHELL_STDIN_BOOTSTRAP = String.raw`
$ErrorActionPreference = "Stop"
$envelope = [Console]::In.ReadToEnd() | ConvertFrom-Json
$global:AgentComputerUsePayload = $envelope.payload
$script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$envelope.scriptBase64))
Invoke-Expression $script
`;

const WINDOWS_INCREMENTAL_INPUT_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class AgentComputerUseIncrementalInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_A = 0x41;
    private const byte VK_BACK = 0x08;
    private const byte VK_SPACE = 0x20;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint message;
        public ushort low;
        public ushort high;
    }

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
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
	[DllImport("imm32.dll")]
	private static extern IntPtr ImmAssociateContext(IntPtr window, IntPtr inputContext);
    [DllImport("ole32.dll")]
    private static extern int OleGetClipboard(
        out System.Runtime.InteropServices.ComTypes.IDataObject dataObject
    );
    [DllImport("ole32.dll")]
    private static extern int OleSetClipboard(
        System.Runtime.InteropServices.ComTypes.IDataObject dataObject
    );

    public static int Send(string text, long expectedWindow, uint expectedProcess, bool replaceAll)
    {
        IntPtr focusedWindow = VerifyFocusedWindow(expectedWindow, expectedProcess);
        IntPtr previousInputContext = ImmAssociateContext(focusedWindow, IntPtr.Zero);
        try
        {
            if (replaceAll)
            {
                SendChord(0x11, 0x41);
                Thread.Sleep(30);
                SendKey(0x08);
                Thread.Sleep(50);
            }
            foreach (char codeUnit in text)
            {
                SendUnicode(codeUnit);
                Thread.Sleep(18);
            }
            Thread.Sleep(350);
        }
        finally
        {
            if (previousInputContext != IntPtr.Zero)
                ImmAssociateContext(focusedWindow, previousInputContext);
        }
        return text.Length;
    }

    public static int PasteWholeValue(
        string text,
        long expectedWindow,
        uint expectedProcess,
        bool replaceAll
    )
    {
        VerifyFocusedWindow(expectedWindow, expectedProcess);
        System.Runtime.InteropServices.ComTypes.IDataObject originalClipboard;
        if (OleGetClipboard(out originalClipboard) != 0)
            throw new InvalidOperationException("The Windows clipboard could not be snapshotted.");
        bool hadOriginalClipboard = originalClipboard != null;
        bool clipboardRestored = false;
        try
        {
            DataObject replacement = new DataObject();
            replacement.SetData(DataFormats.UnicodeText, true, text);
            Clipboard.SetDataObject(replacement, true);
            if (replaceAll)
            {
                SendChord(VK_CONTROL, VK_A);
                Thread.Sleep(30);
            }
            SendChord(VK_CONTROL, 0x56);
            Thread.Sleep(100);
            SendKey(VK_SPACE);
            Thread.Sleep(50);
            SendKey(VK_BACK);
            Thread.Sleep(300);
        }
        finally
        {
            if (hadOriginalClipboard)
            {
                for (int attempt = 0; attempt < 10 && !clipboardRestored; attempt++)
                {
                    clipboardRestored = OleSetClipboard(originalClipboard) == 0;
                    if (!clipboardRestored) Thread.Sleep(25);
                }
            }
            else
            {
                Clipboard.Clear();
                clipboardRestored = true;
            }
        }
        if (!clipboardRestored)
            throw new InvalidOperationException("The Windows clipboard could not be restored.");
        return text.Length;
    }

    private static IntPtr VerifyFocusedWindow(long expectedWindow, uint expectedProcess)
    {
        IntPtr foreground = GetForegroundWindow();
        uint foregroundProcess;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcess);
        if (foreground != new IntPtr(expectedWindow))
            throw new InvalidOperationException("The approved target window is not foreground.");
        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (!GetGUIThreadInfo(foregroundThread, ref info) || info.hwndFocus == IntPtr.Zero)
            throw new InvalidOperationException("The approved target has no verified focused window.");
        uint focusProcess;
        GetWindowThreadProcessId(info.hwndFocus, out focusProcess);
        if (foregroundProcess != expectedProcess || focusProcess != expectedProcess)
            throw new InvalidOperationException("The focused window does not belong to the approved target process.");
        return info.hwndFocus;
    }

    private static void SendKey(byte key)
    {
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static void SendUnicode(char codeUnit)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].data.keyboard.scanCode = codeUnit;
        inputs[0].data.keyboard.flags = KEYEVENTF_UNICODE;
        inputs[1] = inputs[0];
        inputs[1].data.keyboard.flags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
            throw new InvalidOperationException("Windows rejected focused Unicode input.");
    }

    private static void SendChord(byte modifier, byte key)
    {
        keybd_event(modifier, 0, 0, UIntPtr.Zero);
        SendKey(key);
        keybd_event(modifier, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
'@ -ReferencedAssemblies System.Windows.Forms

$payload = $global:AgentComputerUsePayload
$text = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String([string]$payload.textBase64)
)
$inputBehavior = [string]$payload.inputBehavior
if ($inputBehavior -eq "commit") {
    $utf16CodeUnits = [AgentComputerUseIncrementalInput]::PasteWholeValue(
        $text,
        [long]$payload.windowId,
        [uint32]$payload.processId,
        [bool]$payload.replaceAll
    )
    $deliveryPath = "windows_clipboard_transaction"
}
else {
    $utf16CodeUnits = [AgentComputerUseIncrementalInput]::Send(
        $text,
        [long]$payload.windowId,
        [uint32]$payload.processId,
        [bool]$payload.replaceAll
    )
    $deliveryPath = "windows_sendinput_unicode_ime_neutral"
}
@{
    status = "ok"
    utf16CodeUnits = $utf16CodeUnits
    clipboardRestored = $true
    changeSignalDelivered = $true
    focusVerified = $true
    deliveryPath = $deliveryPath
} | ConvertTo-Json -Compress
`;

export function resolveWindowsPowerShellPath(env = process.env) {
  return env.SystemRoot
    ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export async function sendWindowsUnicodeText(options = {}) {
  const {
    windowId,
    processId,
    focusX,
    focusY,
    text,
    replaceAll = false,
    inputBehavior = "incremental",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    signal,
  } = options;

  if (signal?.aborted === true) throw unicodeInputAbortError({
    stage: "preflight",
    effect: "not-applied",
    sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "not-applied" }),
  });

  if (platform !== "win32") {
    throw unicodeInputError(
      "unicode_input.unsupported_platform",
      "Secure Unicode input is available only on Windows.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (typeof text !== "string") {
    throw unicodeInputError(
      "unicode_input.invalid_text",
      "Unicode input requires a text string.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (!["incremental", "commit"].includes(inputBehavior)) {
    throw unicodeInputError(
      "unicode_input.invalid_behavior",
      "Unicode input behavior must be incremental or commit.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (text.length > MAX_TEXT_CODE_UNITS) {
    throw unicodeInputError(
      "unicode_input.payload_too_large",
      `Unicode input exceeds the ${MAX_TEXT_CODE_UNITS} UTF-16 code-unit limit.`,
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (!isValidWindowId(windowId)) {
    throw unicodeInputError(
      "unicode_input.invalid_window",
      "Unicode input requires an approved target window handle.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (!isValidProcessId(processId)) {
    throw unicodeInputError(
      "unicode_input.invalid_process",
      "Unicode input requires an approved target process identifier.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }
  if (!Number.isFinite(focusX) || !Number.isFinite(focusY)) {
    throw unicodeInputError(
      "unicode_input.invalid_focus_point",
      "Unicode input requires the approved editable focus point.",
      validationFailureDetail({ inputBehavior, replaceAll }),
    );
  }

  // Both Host behaviors use one focused-window bridge. Incremental entry emits
  // per-character edits for live search; commit entry uses one whole-value
  // clipboard transaction and restores the complete OLE clipboard snapshot.
  const bridgeScript = WINDOWS_INCREMENTAL_INPUT_SCRIPT;
  const encodedBootstrap = Buffer.from(POWERSHELL_STDIN_BOOTSTRAP, "utf16le").toString("base64");
  const child = spawnProcess(
    powershellPath,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedBootstrap,
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
    let outputOverflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, unicodeInputError(
        "unicode_input.timeout",
        "The Windows Unicode input bridge timed out.",
        executionFailureDetail({ inputBehavior, replaceAll }),
      ));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      child.kill();
      finish(reject, unicodeInputAbortError(executionFailureDetail({ inputBehavior, replaceAll })));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    const appendOutput = (current, chunk) => {
      if (Buffer.byteLength(current) + chunk.length > MAX_BRIDGE_OUTPUT_BYTES) {
        outputOverflow = true;
        return current;
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", () => {
      finish(reject, unicodeInputError(
        "unicode_input.bridge_unavailable",
        "The Windows Unicode input bridge could not be started.",
        {
          stage: "bridge-start",
          effect: "not-applied",
          sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "not-applied" }),
        },
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || outputOverflow) {
        finish(reject, unicodeInputError(
          "unicode_input.bridge_process_failed",
          "The Windows Unicode input bridge rejected the operation.",
          {
            ...executionFailureDetail({ inputBehavior, replaceAll }),
            exitCode: Number.isInteger(code) ? code : null,
            outputOverflow,
            bridgeFailure: classifyPowerShellBridgeFailure(stderr),
          },
        ));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result?.status !== "ok"
          || !Number.isInteger(result.utf16CodeUnits)
          || typeof result.clipboardRestored !== "boolean"
          || typeof result.changeSignalDelivered !== "boolean"
          || typeof result.focusVerified !== "boolean"
          || !["windows_sendinput_unicode_ime_neutral", "windows_clipboard_transaction"]
            .includes(result.deliveryPath)) {
          throw new Error("invalid bridge response");
        }
        finish(resolve, {
          status: "ok",
          utf16CodeUnits: result.utf16CodeUnits,
          clipboardRestored: result.clipboardRestored,
          changeSignalDelivered: result.changeSignalDelivered,
          focusVerified: result.focusVerified,
          ...(typeof result.exactValueVerified === "boolean"
            ? { exactValueVerified: result.exactValueVerified }
            : {}),
          ...(typeof result.readBackStatus === "string"
            ? { readBackStatus: result.readBackStatus }
            : {}),
          ...(typeof result.readBackComparison === "string"
            ? { readBackComparison: result.readBackComparison }
            : {}),
          ...(Number.isInteger(result.readBackUtf16CodeUnits)
            ? { readBackUtf16CodeUnits: result.readBackUtf16CodeUnits }
            : {}),
          ...(typeof result.readBackSource === "string"
            ? { readBackSource: result.readBackSource }
            : {}),
          deliveryPath: result.deliveryPath,
        });
      } catch {
        finish(reject, unicodeInputError(
          "unicode_input.invalid_response",
          "The Windows Unicode input bridge returned an invalid response.",
          {
            stage: "bridge-response",
            effect: "indeterminate",
            sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "indeterminate" }),
          },
        ));
      }
    });
    child.stdin.once("error", () => {
      finish(reject, unicodeInputError(
        "unicode_input.bridge_input_failed",
        "The Windows Unicode input bridge rejected the operation.",
        {
          stage: "bridge-input",
          effect: "not-applied",
          sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "not-applied" }),
        },
      ));
    });
    child.stdin.end(JSON.stringify({
      scriptBase64: Buffer.from(bridgeScript, "utf8").toString("base64"),
      payload: {
        windowId: String(windowId),
        processId: Number(processId),
        focusX,
        focusY,
        textBase64: Buffer.from(text, "utf8").toString("base64"),
        replaceAll: replaceAll === true,
        inputBehavior,
      },
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

function classifyPowerShellBridgeFailure(value) {
  const text = String(value ?? "");
  const compilerCode = text.match(/\berror\s+(CS\d{4})\b/iu)?.[1];
  if (compilerCode) return `powershell-add-type-${compilerCode.toLocaleLowerCase()}`;
  if (/clipboard/iu.test(text)) return "clipboard-operation-failed";
  if (/foreground/iu.test(text)) return "foreground-verification-failed";
  if (/focused window|no verified focused/iu.test(text)) return "focus-verification-failed";
  if (/MethodInvocationException/iu.test(text)) return "powershell-method-invocation-failed";
  return "bridge-process-rejected";
}

function unicodeInputAbortError(detail) {
  const error = unicodeInputError(
    "unicode_input.cancelled",
    "The Windows Unicode input operation was cancelled.",
    detail,
  );
  error.name = "AbortError";
  return error;
}

function isValidWindowId(value) {
  if (typeof value === "bigint") return value > 0n;
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function isValidProcessId(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0xffff_ffff;
}

function validationFailureDetail({ inputBehavior, replaceAll }) {
  return {
    stage: "validate",
    effect: "not-applied",
    sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "not-applied" }),
  };
}

function executionFailureDetail({ inputBehavior, replaceAll }) {
  return {
    stage: "bridge-execution",
    effect: "indeterminate",
    sideEffects: unicodeInputSideEffects({ inputBehavior, replaceAll, effect: "indeterminate" }),
  };
}

function unicodeInputSideEffects({ inputBehavior, replaceAll, effect }) {
  if (effect === "not-applied") {
    return {
      focus: "not-applied",
      selection: "not-applied",
      text: "not-applied",
      clipboard: "not-used",
      ime: "not-used",
    };
  }
  return {
    focus: "indeterminate",
    selection: replaceAll ? "indeterminate" : "not-used",
    text: "indeterminate",
    clipboard: inputBehavior === "commit" ? "indeterminate" : "not-used",
    ime: inputBehavior === "incremental" ? "indeterminate" : "not-used",
  };
}

function unicodeInputError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  return error;
}
