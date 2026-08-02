import { spawn } from "node:child_process";
import { resolveWindowsPowerShellPath } from "./windows-foreground-probe.mjs";

const DEFAULT_TIMEOUT_MS = 3_000;

const RELATED_SURFACE_CLICK_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class AgentComputerUseRelatedSurfaceClick
{
    private const uint GW_OWNER = 4;
    private const uint GA_ROOT = 2;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const int POINTER_SETTLE_MS = 60;
    private const int CLICK_TRANSITION_MS = 30;
    private const int POST_CLICK_SETTLE_MS = 180;
    private const int DISMISS_POLL_MS = 50;
    private const int DISMISS_POLL_ATTEMPTS = 20;

    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(
        uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo
    );

    public static string Click(long controllerId, long surfaceId, long expectedProcessId, int x, int y)
    {
        IntPtr controller = new IntPtr(controllerId);
        IntPtr surface = new IntPtr(surfaceId);
        if (!IsWindow(controller) || GetForegroundWindow() != controller)
            throw new InvalidOperationException("controller_not_foreground");
        if (!IsWindow(surface) || !IsWindowVisible(surface))
            throw new InvalidOperationException("related_window_unavailable");
        uint processId;
        GetWindowThreadProcessId(surface, out processId);
        if (expectedProcessId <= 0 || processId != expectedProcessId)
            throw new InvalidOperationException("related_window_process_mismatch");
        IntPtr owner = GetWindow(surface, GW_OWNER);
        if (owner != controller && owner != IntPtr.Zero)
            throw new InvalidOperationException("related_window_owner_mismatch");
        Rect rect;
        if (!GetWindowRect(surface, out rect) || x < rect.Left || x >= rect.Right || y < rect.Top || y >= rect.Bottom)
            throw new InvalidOperationException("related_window_point_outside");
        Point point = new Point { X = x, Y = y };
        IntPtr hit = WindowFromPoint(point);
        if (GetAncestor(hit, GA_ROOT) != surface)
            throw new InvalidOperationException("related_window_point_occluded");
        uint hitProcessId;
        GetWindowThreadProcessId(hit, out hitProcessId);
        if (hitProcessId != processId)
            throw new InvalidOperationException("related_window_hit_process_mismatch");
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("set_cursor_failed");
        Thread.Sleep(POINTER_SETTLE_MS);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(CLICK_TRANSITION_MS);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(POST_CLICK_SETTLE_MS);
        for (int attempt = 0; attempt < DISMISS_POLL_ATTEMPTS; attempt++)
        {
            if (!IsWindow(surface) || !IsWindowVisible(surface))
                return "{\"status\":\"ok\",\"effect\":\"verified\",\"verified\":true,\"postcondition\":\"related-surface-dismissed\",\"deliveryPath\":\"windows-related-surface-click\"}";
            Thread.Sleep(DISMISS_POLL_MS);
        }
        return "{\"status\":\"ok\",\"effect\":\"applied\",\"verified\":false,\"deliveryPath\":\"windows-related-surface-click\"}";
    }
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
[Console]::Out.Write([AgentComputerUseRelatedSurfaceClick]::Click(
  [long]$request.controllerWindowId,
  [long]$request.relatedWindowId,
  [long]$request.processId,
  [int]$request.screenX,
  [int]$request.screenY
))
`;

export async function clickWindowsRelatedSurface(options = {}) {
  const platform = options.platform ?? globalThis.process?.platform;
  if (platform !== "win32") throw relatedClickError("related_click.unsupported_platform");
  const payload = {
    controllerWindowId: positiveNativeId(options.controllerWindowId),
    relatedWindowId: positiveNativeId(options.relatedWindowId),
    processId: positiveInteger(options.processId),
    screenX: finiteInteger(options.screenX),
    screenY: finiteInteger(options.screenY),
  };
  if (Object.values(payload).some((value) => value === null)) {
    throw relatedClickError("related_click.invalid_target");
  }
  const powershellPath = options.powershellPath ?? resolveWindowsPowerShellPath();
  const encoded = Buffer.from(RELATED_SURFACE_CLICK_SCRIPT, "utf16le").toString("base64");
  return runClickBridge({
    powershellPath,
    encoded,
    payload,
    signal: options.signal,
    spawnProcess: options.spawnProcess ?? spawn,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

function runClickBridge({ powershellPath, encoded, payload, signal, spawnProcess, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(powershellPath, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", encoded,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      child.kill();
      finish(relatedClickError("related_click.cancelled"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(relatedClickError("related_click.timeout"));
    }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", () => {});
    child.once("error", () => finish(relatedClickError("related_click.bridge_start_failed")));
    child.once("close", (code) => {
      if (code !== 0) return finish(relatedClickError("related_click.bridge_failed"));
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(relatedClickError("related_click.invalid_receipt"));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function positiveNativeId(value) {
  try {
    const id = BigInt(value);
    return id > 0n ? id.toString() : null;
  } catch {
    return null;
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function finiteInteger(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function relatedClickError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
