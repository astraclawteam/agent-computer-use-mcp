using System.Runtime.InteropServices;

namespace GatewayComputerUseOverlay;

/// <summary>
/// Watches for the operator pressing Escape and asks the Host to hand the
/// desktop back.
///
/// The hook observes and never swallows. The indicator now stays up for a whole
/// task, so consuming Escape would take it away from every other application
/// for that entire time — someone dismissing a dialog in their editor would
/// find the key dead. Escape keeps doing its ordinary job and additionally
/// counts as a stop request.
/// </summary>
internal sealed class OperatorStopWatcher : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_ESCAPE = 0x1B;
    private const uint LLKHF_INJECTED = 0x00000010;
    private const uint LLKHF_LOWER_IL_INJECTED = 0x00000002;

    private readonly string _stopRequestFile;
    private readonly HookNativeMethods.LowLevelKeyboardProc _callback;
    private IntPtr _hook;
    private bool _requested;

    private OperatorStopWatcher(string stopRequestFile)
    {
        _stopRequestFile = stopRequestFile;
        // Held in a field because the hook outlives this call and the collector
        // would otherwise reclaim the delegate out from under the OS.
        _callback = OnKey;
    }

    public static OperatorStopWatcher? StartFromEnvironment()
    {
        var stopRequestFile = Environment.GetEnvironmentVariable("AGENT_COMPUTER_USE_OVERLAY_STOP_REQUEST_FILE")
            ?? Environment.GetEnvironmentVariable("XIAOZHICLAW_CUA_OVERLAY_STOP_REQUEST_FILE");
        if (string.IsNullOrWhiteSpace(stopRequestFile)) return null;

        var watcher = new OperatorStopWatcher(stopRequestFile);
        watcher._hook = HookNativeMethods.SetWindowsHookExW(WH_KEYBOARD_LL, watcher._callback, IntPtr.Zero, 0);
        // A hook the OS refused leaves the indicator running without an escape
        // route, which is worse than admitting it: the banner must not promise
        // a key that does nothing.
        return watcher._hook == IntPtr.Zero ? null : watcher;
    }

    /// <summary>
    /// The whole decision, separated from the hook so it can be exercised
    /// without a live desktop.
    /// </summary>
    internal static bool IsOperatorStop(int message, int virtualKey, uint flags)
    {
        if (message != WM_KEYDOWN && message != WM_SYSKEYDOWN) return false;
        if (virtualKey != VK_ESCAPE) return false;
        // The Host presses Escape itself to dismiss menus. Treating its own
        // keystroke as a stop request would abort the very task that sent it.
        if ((flags & LLKHF_INJECTED) != 0 || (flags & LLKHF_LOWER_IL_INJECTED) != 0) return false;
        return true;
    }

    private IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            try
            {
                var info = Marshal.PtrToStructure<HookNativeMethods.KeyboardLowLevelHookStruct>(lParam);
                if (IsOperatorStop((int)wParam, (int)info.vkCode, info.flags)) RequestStop();
            }
            catch
            {
                // Never let a stop request break the keyboard for the desktop.
            }
        }

        return HookNativeMethods.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    private void RequestStop()
    {
        if (_requested) return;
        _requested = true;
        try
        {
            File.WriteAllText(_stopRequestFile, "escape");
        }
        catch
        {
            // The Host also tears the indicator down on its own paths; a failed
            // marker must not take the keyboard hook down with it.
            _requested = false;
        }
    }

    public void Dispose()
    {
        if (_hook == IntPtr.Zero) return;
        HookNativeMethods.UnhookWindowsHookEx(_hook);
        _hook = IntPtr.Zero;
    }

    private static class HookNativeMethods
    {
        public delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct KeyboardLowLevelHookStruct
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookExW(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int code, IntPtr wParam, IntPtr lParam);
    }
}
