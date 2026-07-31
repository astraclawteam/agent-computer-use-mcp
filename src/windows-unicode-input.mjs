import { spawn } from "node:child_process";
import { join } from "node:path";

const MAX_TEXT_CODE_UNITS = 32_768;
const MAX_BRIDGE_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

const WINDOWS_INCREMENTAL_INPUT_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class AgentComputerUseIncrementalInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

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

    public static int Send(string text, long expectedWindow, uint expectedProcess, bool replaceAll)
    {
        IntPtr foreground = GetForegroundWindow();
        uint foregroundProcess;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcess);
        if (foreground != new IntPtr(expectedWindow) && foregroundProcess != expectedProcess)
            throw new InvalidOperationException("The approved target process is not foreground.");

        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (!GetGUIThreadInfo(foregroundThread, ref info) || info.hwndFocus == IntPtr.Zero)
            throw new InvalidOperationException("The approved target has no verified focused window.");
        uint focusProcess;
        GetWindowThreadProcessId(info.hwndFocus, out focusProcess);
        if (focusProcess != expectedProcess)
            throw new InvalidOperationException("The focused window does not belong to the approved target process.");

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
            Thread.Sleep(8);
        }
        Thread.Sleep(75);
        SendKey(0x20);
        Thread.Sleep(75);
        SendKey(0x08);
        Thread.Sleep(250);
        return text.Length;
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
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$text = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String([string]$payload.textBase64)
)
$utf16CodeUnits = [AgentComputerUseIncrementalInput]::Send(
    $text,
    [long]$payload.windowId,
    [uint32]$payload.processId,
    [bool]$payload.replaceAll
)
@{
    status = "ok"
    utf16CodeUnits = $utf16CodeUnits
    clipboardRestored = $true
    changeSignalDelivered = $true
    deliveryPath = "windows_sendinput_unicode_incremental"
} | ConvertTo-Json -Compress
`;

const WINDOWS_UNICODE_INPUT_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class AgentComputerUseUnicodeInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_A = 0x41;
    private const ushort VK_BACK = 0x08;
    private const ushort VK_SPACE = 0x20;
    private const uint WM_CHAR = 0x0102;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)]
        public KEYBDINPUT keyboard;

        [FieldOffset(0)]
        public MOUSEINPUT mouse;

        [FieldOffset(0)]
        public HARDWAREINPUT hardware;
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
        public ushort parameterLow;
        public ushort parameterHigh;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

    [DllImport("ole32.dll")]
    private static extern int OleGetClipboard(
        out System.Runtime.InteropServices.ComTypes.IDataObject dataObject
    );

    [DllImport("ole32.dll")]
    private static extern int OleSetClipboard(
        System.Runtime.InteropServices.ComTypes.IDataObject dataObject
    );

    public sealed class PasteResult
    {
        public int Utf16CodeUnits { get; set; }
        public bool ClipboardRestored { get; set; }
        public bool ChangeSignalDelivered { get; set; }
    }

    public static PasteResult PasteUnicode(
        string text,
        long expectedWindow,
        uint expectedProcess,
        bool replaceAll
    )
    {
        IntPtr expected = new IntPtr(expectedWindow);
        IntPtr foreground = GetForegroundWindow();
        if (foreground != expected)
        {
            uint foregroundProcess;
            GetWindowThreadProcessId(foreground, out foregroundProcess);
            if (foregroundProcess != expectedProcess)
            {
                throw new InvalidOperationException("The approved target process is not foreground.");
            }
        }

        int inputSize = Marshal.SizeOf(typeof(INPUT));
        System.Runtime.InteropServices.ComTypes.IDataObject originalClipboard;
        int snapshotResult = OleGetClipboard(out originalClipboard);
        if (snapshotResult != 0)
        {
            throw new InvalidOperationException("The Windows clipboard could not be snapshotted.");
        }
        bool hadOriginalClipboard = originalClipboard != null;

        bool pasted = false;
        bool clipboardRestored = false;
        try
        {
            if (replaceAll)
            {
                SendChord(VK_CONTROL, VK_A, inputSize, "replace-all selection");
            }
            DataObject replacement = new DataObject();
            replacement.SetData(DataFormats.UnicodeText, true, text);
            Clipboard.SetDataObject(replacement, true);
            SendChord(VK_CONTROL, 0x56, inputSize, "clipboard paste");
            pasted = true;
            Thread.Sleep(50);
            EmitChangeBoundary(inputSize);
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

        if (!pasted)
        {
            throw new InvalidOperationException("Windows rejected clipboard text input.");
        }
        return new PasteResult {
            Utf16CodeUnits = text.Length,
            ClipboardRestored = clipboardRestored,
            ChangeSignalDelivered = true
        };
    }

    private static void SendKey(ushort key, int inputSize, string label)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].data.keyboard.virtualKey = key;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].data.keyboard.virtualKey = key;
        inputs[1].data.keyboard.flags = KEYEVENTF_KEYUP;
        uint sent = SendInput(2, inputs, inputSize);
        if (sent != 2)
        {
            throw new InvalidOperationException("Windows rejected " + label + ".");
        }
    }

    private static void SendChord(ushort modifier, ushort key, int inputSize, string label)
    {
        INPUT[] inputs = new INPUT[4];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].data.keyboard.virtualKey = modifier;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].data.keyboard.virtualKey = key;
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].data.keyboard.virtualKey = key;
        inputs[2].data.keyboard.flags = KEYEVENTF_KEYUP;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].data.keyboard.virtualKey = modifier;
        inputs[3].data.keyboard.flags = KEYEVENTF_KEYUP;
        uint sent = SendInput(4, inputs, inputSize);
        if (sent != 4)
        {
            throw new InvalidOperationException("Windows rejected " + label + ".");
        }
    }

    private static void EmitChangeBoundary(int inputSize)
    {
        // Some custom-drawn desktop edit controls render injected Unicode or
        // clipboard text without invalidating their search/composition model.
        // Emit a reversible native edit so those controls receive a real change
        // boundary while preserving the exact requested value.
        SendKey(VK_SPACE, inputSize, "text change signal");
        Thread.Sleep(75);
        SendKey(VK_BACK, inputSize, "text change rollback");
        Thread.Sleep(250);
    }
}
'@ -ReferencedAssemblies System.Windows.Forms

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$text = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String([string]$payload.textBase64)
)
$result = [AgentComputerUseUnicodeInput]::PasteUnicode(
    $text,
    [long]$payload.windowId,
    [uint32]$payload.processId,
    [bool]$payload.replaceAll
)
@{
    status = "ok"
    utf16CodeUnits = $result.Utf16CodeUnits
    clipboardRestored = $result.ClipboardRestored
    changeSignalDelivered = $result.ChangeSignalDelivered
    deliveryPath = "windows_clipboard_transaction"
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
    text,
    replaceAll = false,
    inputBehavior = "incremental",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
  } = options;

  if (platform !== "win32") {
    throw unicodeInputError(
      "unicode_input.unsupported_platform",
      "Secure Unicode input is available only on Windows.",
    );
  }
  if (typeof text !== "string") {
    throw unicodeInputError("unicode_input.invalid_text", "Unicode input requires a text string.");
  }
  if (!["incremental", "commit"].includes(inputBehavior)) {
    throw unicodeInputError(
      "unicode_input.invalid_behavior",
      "Unicode input behavior must be incremental or commit.",
    );
  }
  if (text.length > MAX_TEXT_CODE_UNITS) {
    throw unicodeInputError(
      "unicode_input.payload_too_large",
      `Unicode input exceeds the ${MAX_TEXT_CODE_UNITS} UTF-16 code-unit limit.`,
    );
  }
  if (!isValidWindowId(windowId)) {
    throw unicodeInputError(
      "unicode_input.invalid_window",
      "Unicode input requires an approved target window handle.",
    );
  }
  if (!isValidProcessId(processId)) {
    throw unicodeInputError(
      "unicode_input.invalid_process",
      "Unicode input requires an approved target process identifier.",
    );
  }

  const bridgeScript = inputBehavior === "incremental"
    ? WINDOWS_INCREMENTAL_INPUT_SCRIPT
    : WINDOWS_UNICODE_INPUT_SCRIPT;
  const encodedScript = Buffer.from(bridgeScript, "utf16le").toString("base64");
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
    let outputOverflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, unicodeInputError(
        "unicode_input.timeout",
        "The Windows Unicode input bridge timed out.",
      ));
    }, timeoutMs);
    timer.unref?.();

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
      appendOutput("", chunk);
    });
    child.once("error", () => {
      finish(reject, unicodeInputError(
        "unicode_input.bridge_unavailable",
        "The Windows Unicode input bridge could not be started.",
      ));
    });
    child.once("close", (code) => {
      if (code !== 0 || outputOverflow) {
        finish(reject, unicodeInputError(
          "unicode_input.bridge_failed",
          "The Windows Unicode input bridge rejected the operation.",
        ));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result?.status !== "ok"
          || !Number.isInteger(result.utf16CodeUnits)
          || typeof result.clipboardRestored !== "boolean"
          || typeof result.changeSignalDelivered !== "boolean"
          || !["windows_sendinput_unicode_incremental", "windows_clipboard_transaction"].includes(result.deliveryPath)) {
          throw new Error("invalid bridge response");
        }
        finish(resolve, {
          status: "ok",
          utf16CodeUnits: result.utf16CodeUnits,
          clipboardRestored: result.clipboardRestored,
          changeSignalDelivered: result.changeSignalDelivered,
          deliveryPath: result.deliveryPath,
        });
      } catch {
        finish(reject, unicodeInputError(
          "unicode_input.invalid_response",
          "The Windows Unicode input bridge returned an invalid response.",
        ));
      }
    });
    child.stdin.once("error", () => {
      finish(reject, unicodeInputError(
        "unicode_input.bridge_failed",
        "The Windows Unicode input bridge rejected the operation.",
      ));
    });
    child.stdin.end(JSON.stringify({
      windowId: String(windowId),
      processId: Number(processId),
      textBase64: Buffer.from(text, "utf8").toString("base64"),
      replaceAll: replaceAll === true,
      inputBehavior,
    }));

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    }
  });
}

function isValidWindowId(value) {
  if (typeof value === "bigint") return value > 0n;
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function isValidProcessId(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0xffff_ffff;
}

function unicodeInputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
