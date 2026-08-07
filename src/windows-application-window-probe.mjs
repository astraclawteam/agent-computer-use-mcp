import { spawn } from "node:child_process";
import { resolveWindowsPowerShellPath } from "./windows-foreground-probe.mjs";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

const WINDOWS_APPLICATION_WINDOW_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentComputerUseApplicationWindowProbe
{
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const uint GW_OWNER = 4;
    private const uint DWMWA_CLOAKED = 14;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public sealed class WindowCandidate
    {
        public long WindowId { get; set; }
        public uint ProcessId { get; set; }
        public string Title { get; set; }
        public string ClassName { get; set; }
        public long OwnerWindowId { get; set; }
        public bool Visible { get; set; }
        public bool Minimized { get; set; }
        public bool Enabled { get; set; }
        public bool ToolWindow { get; set; }
        public bool Cloaked { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLongPtr32(IntPtr window, int index);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out int value, int size);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLongPtr32(window, index);
    }

    private static string ReadWindowText(IntPtr window)
    {
        int length = GetWindowTextLength(window);
        var text = new StringBuilder(Math.Max(length + 1, 2));
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }

    private static string ReadClassName(IntPtr window)
    {
        var text = new StringBuilder(512);
        GetClassName(window, text, text.Capacity);
        return text.ToString();
    }

    public static WindowCandidate[] Enumerate(uint[] processIds)
    {
        var allowed = new HashSet<uint>(processIds ?? Array.Empty<uint>());
        var candidates = new List<WindowCandidate>();
        EnumWindows((window, state) => {
            uint processId;
            if (GetWindowThreadProcessId(window, out processId) == 0 || !allowed.Contains(processId)) return true;
            Rect rect;
            if (!GetWindowRect(window, out rect)) return true;
            long extendedStyle = GetWindowLongPtr(window, GWL_EXSTYLE).ToInt64();
            int cloaked = 0;
            bool hasCloakedValue = DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                out cloaked,
                Marshal.SizeOf<int>()
            ) == 0;
            candidates.Add(new WindowCandidate {
                WindowId = window.ToInt64(),
                ProcessId = processId,
                Title = ReadWindowText(window),
                ClassName = ReadClassName(window),
                OwnerWindowId = GetWindow(window, GW_OWNER).ToInt64(),
                Visible = IsWindowVisible(window),
                Minimized = IsIconic(window),
                Enabled = IsWindowEnabled(window),
                ToolWindow = (extendedStyle & WS_EX_TOOLWINDOW) != 0,
                Cloaked = hasCloakedValue && cloaked != 0,
                X = rect.Left,
                Y = rect.Top,
                Width = Math.Max(0, rect.Right - rect.Left),
                Height = Math.Max(0, rect.Bottom - rect.Top),
            });
            return true;
        }, IntPtr.Zero);
        return candidates.ToArray();
    }
}
'@

$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$processIds = @($payload.processIds | ForEach-Object { [uint32]$_ })
@([AgentComputerUseApplicationWindowProbe]::Enumerate($processIds)) | ConvertTo-Json -Compress
`;

export async function queryWindowsApplicationWindows(options = {}) {
  const {
    processIds,
    platform = process.platform,
    powershellPath = resolveWindowsPowerShellPath(),
    spawnProcess = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const normalizedProcessIds = normalizeProcessIds(processIds);
  if (platform !== "win32" || normalizedProcessIds.length === 0) return [];

  const encodedScript = Buffer.from(
    WINDOWS_APPLICATION_WINDOW_PROBE_SCRIPT,
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

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, probeError(
        "application_window_probe.timeout",
        "The Windows application window probe timed out.",
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
    child.once("error", () => finish(reject, probeError(
      "application_window_probe.unavailable",
      "The Windows application window probe could not be started.",
    )));
    child.once("close", (code) => {
      if (code !== 0 || overflow) {
        const error = probeError(
          "application_window_probe.failed",
          "The Windows application window probe failed.",
        );
        error.diagnostic = stderr.trim().slice(-1_024);
        finish(reject, error);
        return;
      }
      try {
        finish(resolve, normalizeWindowCandidates(JSON.parse(stdout.trim() || "[]"), normalizedProcessIds));
      } catch {
        finish(reject, probeError(
          "application_window_probe.invalid_response",
          "The Windows application window probe returned invalid data.",
        ));
      }
    });
    child.stdin.once("error", () => finish(reject, probeError(
      "application_window_probe.failed",
      "The Windows application window probe rejected the process identity.",
    )));
    child.stdin.end(JSON.stringify({ processIds: normalizedProcessIds }));

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    }
  });
}

function normalizeWindowCandidates(value, allowedProcessIds) {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const allowed = new Set(allowedProcessIds);
  return entries.flatMap((entry) => {
    const windowId = Number(entry?.WindowId ?? entry?.windowId);
    const processId = Number(entry?.ProcessId ?? entry?.processId);
    const width = Number(entry?.Width ?? entry?.width);
    const height = Number(entry?.Height ?? entry?.height);
    const x = Number(entry?.X ?? entry?.x);
    const y = Number(entry?.Y ?? entry?.y);
    if (!Number.isSafeInteger(windowId) || windowId <= 0
      || !Number.isSafeInteger(processId) || !allowed.has(processId)
      || ![x, y, width, height].every(Number.isFinite)) return [];
    return [{
      windowId,
      pid: processId,
      title: String(entry?.Title ?? entry?.title ?? ""),
      className: String(entry?.ClassName ?? entry?.className ?? ""),
      ownerWindowId: Number(entry?.OwnerWindowId ?? entry?.ownerWindowId) || 0,
      visible: Boolean(entry?.Visible ?? entry?.visible),
      minimized: Boolean(entry?.Minimized ?? entry?.minimized),
      enabled: Boolean(entry?.Enabled ?? entry?.enabled),
      toolWindow: Boolean(entry?.ToolWindow ?? entry?.toolWindow),
      cloaked: Boolean(entry?.Cloaked ?? entry?.cloaked),
      bounds: { x, y, width, height },
    }];
  });
}

function normalizeProcessIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(Number)
    .filter((entry) => Number.isSafeInteger(entry) && entry > 0))];
}

function probeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
