import { spawn } from "node:child_process";

export async function captureWindowPngByTitle(titlePart, outputPath, options = {}) {
  if (process.platform !== "win32") {
    throw new Error("window_capture.unsupported_platform");
  }

  const script = buildCaptureScript(titlePart, outputPath);
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

function buildCaptureScript(titlePart, outputPath) {
  return `
$ErrorActionPreference = "Stop"
$request = @'
${JSON.stringify({ titlePart, outputPath })}
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
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);

    public static CaptureWindowResult Capture(string titlePart, string outputPath) {
        IntPtr found = IntPtr.Zero;
        string foundTitle = "";
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

        if (found == IntPtr.Zero) {
            throw new InvalidOperationException("window_not_found: " + titlePart);
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
            height = height
        };
    }
}
'@
[CaptureWindowPngByTitle]::Capture([string]$request.titlePart, [string]$request.outputPath) | ConvertTo-Json -Compress
`;
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
