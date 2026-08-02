import { spawn } from "node:child_process";

export async function captureWindowPngByTitle(titlePart, outputPath, options = {}) {
  return captureWindowPng({ titlePart, outputPath, allowScreenFallback: true }, options);
}

export async function captureWindowPngById(windowId, outputPath, options = {}) {
  let normalizedWindowId;
  try {
    normalizedWindowId = BigInt(windowId).toString();
  } catch {
    throw new Error("window_capture.invalid_window_id");
  }
  if (normalizedWindowId === "0" || normalizedWindowId.startsWith("-")) {
    throw new Error("window_capture.invalid_window_id");
  }
  return captureWindowPng({
    windowId: normalizedWindowId,
    expectedProcessId: normalizeProcessId(options.expectedProcessId),
    outputPath,
    allowScreenFallback: false,
  }, options);
}

async function captureWindowPng(request, options) {
  const platform = options.platform ?? globalThis.process?.platform;
  if (platform !== "win32") {
    throw new Error("window_capture.unsupported_platform");
  }

  const script = buildCaptureRequestScript(request);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = await runJson("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ], options.timeoutMs ?? 10000);

  if (result.status !== "ok") {
    throw new Error(`window_capture.failed: ${result.reason ?? "unknown"}`);
  }
  return result;
}

export function buildCaptureScript(titlePart, outputPath) {
  return buildCaptureRequestScript({ titlePart, outputPath, allowScreenFallback: true });
}

export function buildCaptureRequestScript(request) {
  return `
$ErrorActionPreference = "Stop"
$request = @'
${JSON.stringify(request)}
'@ | ConvertFrom-Json
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public sealed class CaptureWindowResult {
    public string status { get; set; }
    public string title { get; set; }
    public string path { get; set; }
    public string method { get; set; }
    public long hwnd { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public long processId { get; set; }
}

public static class CaptureWindowPngByTitle {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);

    public static CaptureWindowResult Capture(
        string titlePart,
        long requestedWindowId,
        long expectedProcessId,
        string outputPath,
        bool allowScreenFallback
    ) {
        IntPtr found = IntPtr.Zero;
        string foundTitle = "";

        if (requestedWindowId > 0) {
            found = new IntPtr(requestedWindowId);
            if (!IsWindow(found)) {
                throw new InvalidOperationException("window_not_found");
            }
        } else if (String.Equals(titlePart == null ? "" : titlePart.Trim(), "*", StringComparison.Ordinal)) {
            found = GetForegroundWindow();
            if (found != IntPtr.Zero) {
                var text = new StringBuilder(512);
                GetWindowText(found, text, text.Capacity);
                foundTitle = text.ToString();
            }
        } else {
            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
                if (!IsWindowVisible(hWnd)) return true;
                var text = new StringBuilder(512);
                GetWindowText(hWnd, text, text.Capacity);
                var title = text.ToString();
                if (title.IndexOf(titlePart, StringComparison.OrdinalIgnoreCase) < 0) return true;
                found = hWnd;
                foundTitle = title;
                return false;
            }, IntPtr.Zero);
        }

        if (found == IntPtr.Zero) {
            throw new InvalidOperationException("window_not_found: " + titlePart);
        }
        if (!IsWindowVisible(found)) {
            throw new InvalidOperationException("window_not_visible: " + titlePart);
        }
        uint processId;
        GetWindowThreadProcessId(found, out processId);
        if (expectedProcessId > 0 && processId != expectedProcessId) {
            throw new InvalidOperationException("window_process_mismatch");
        }
        RECT rect;
        if (!GetWindowRect(found, out rect)) {
            throw new InvalidOperationException("get_window_rect_failed");
        }

        int width = Math.Max(1, rect.Right - rect.Left);
        int height = Math.Max(1, rect.Bottom - rect.Top);
        using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap)) {
            IntPtr hdc = graphics.GetHdc();
            bool printed = PrintWindow(found, hdc, 2);
            graphics.ReleaseHdc(hdc);
            if (!printed) {
                if (!allowScreenFallback) {
                    throw new InvalidOperationException("print_window_failed");
                }
                graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
            }
            bitmap.Save(outputPath, ImageFormat.Png);
        }

        return new CaptureWindowResult {
            status = "ok",
            title = foundTitle,
            path = outputPath,
            method = "PrintWindow",
            hwnd = found.ToInt64(),
            x = rect.Left,
            y = rect.Top,
            width = width,
            height = height,
            processId = processId
        };
    }
}
'@
[CaptureWindowPngByTitle]::Capture(
  [string]$request.titlePart,
  [long]$request.windowId,
  [long]$request.expectedProcessId,
  [string]$request.outputPath,
  [bool]$request.allowScreenFallback
) | ConvertTo-Json -Compress
`;
}

function normalizeProcessId(value) {
  const processId = Number(value);
  return Number.isSafeInteger(processId) && processId > 0 ? processId : 0;
}

function runJson(command, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `exit ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid json: ${error.message}; stdout=${stdout}; stderr=${stderr}`));
      }
    });
  });
}
