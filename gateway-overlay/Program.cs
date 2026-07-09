using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace GatewayComputerUseOverlay;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new OverlayForm());
    }
}

internal sealed class OverlayForm : Form
{
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int MinWaveThickness = 8;
    private const int RestWaveThickness = 12;
    private const int MaxWaveThickness = 16;

    private readonly WebView2 _webView;
    private readonly System.Windows.Forms.Timer _targetRectTimer;
    private readonly string? _targetRectFile;
    private string? _lastTargetRectPayload;

    public OverlayForm()
    {
        Text = "Gateway-managed Computer Use";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        Bounds = Screen.PrimaryScreen?.WorkingArea ?? SystemInformation.VirtualScreen;
        StartPosition = FormStartPosition.Manual;
        BackColor = System.Drawing.Color.FromArgb(1, 2, 3);
        TransparencyKey = BackColor;

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = System.Drawing.Color.Transparent,
            AllowExternalDrop = false,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Agent Computer Use",
                    "GatewayComputerUseOverlayWebView2"),
            },
        };

        Controls.Add(_webView);

        _targetRectFile = Environment.GetEnvironmentVariable("AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE")
            ?? Environment.GetEnvironmentVariable("XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE");
        _targetRectTimer = new System.Windows.Forms.Timer { Interval = 120 };
        _targetRectTimer.Tick += (_, _) => SyncTargetRect();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        NativeMethods.SetWindowPos(Handle, NativeMethods.HWND_TOPMOST, Left, Top, Width, Height, NativeMethods.SWP_NOACTIVATE);
        await InitializeOverlayAsync();
    }

    private async Task InitializeOverlayAsync()
    {
        await _webView.EnsureCoreWebView2Async();
        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        var overlayHtmlPath = ResolveOverlayHtmlPath();
        var projectRoot = ResolveProjectRoot(overlayHtmlPath);
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "agent-computer-use-overlay.local",
            projectRoot,
            CoreWebView2HostResourceAccessKind.Allow);
        _webView.CoreWebView2.Navigate("https://agent-computer-use-overlay.local/gateway-overlay/overlay.html");
        _targetRectTimer.Start();
    }

    private void SyncTargetRect()
    {
        if (string.IsNullOrWhiteSpace(_targetRectFile) || !File.Exists(_targetRectFile)) return;

        string payload;
        try
        {
            payload = File.ReadAllText(_targetRectFile);
        }
        catch
        {
            return;
        }

        if (payload == _lastTargetRectPayload) return;
        _lastTargetRectPayload = payload;

        var relativePayload = ToOverlayRelativeRect(payload);
        if (relativePayload is null) return;

        _ = _webView.CoreWebView2?.ExecuteScriptAsync(
            $"window.__setComputerUseTargetRect?.({relativePayload});");
    }

    private string? ToOverlayRelativeRect(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Null) return "null";

            var x = root.GetProperty("x").GetDouble() - Left;
            var y = root.GetProperty("y").GetDouble() - Top;
            var width = root.GetProperty("width").GetDouble();
            var height = root.GetProperty("height").GetDouble();
            if (width <= 0 || height <= 0) return "null";

            if (root.TryGetProperty("windowId", out var windowId) && windowId.TryGetInt64(out var hwndValue))
            {
                RaiseTargetWindowNoActivate(new IntPtr(hwndValue));
            }

            var left = Math.Max(0, Math.Min(Width, x));
            var top = Math.Max(0, Math.Min(Height, y));
            var right = Math.Max(left, Math.Min(Width, x + width));
            var bottom = Math.Max(top, Math.Min(Height, y + height));
            var clamped = new
            {
                x = left,
                y = top,
                width = right - left,
                height = bottom - top,
                title = root.TryGetProperty("title", out var title) ? title.GetString() : null,
            };

            return JsonSerializer.Serialize(clamped);
        }
        catch
        {
            return null;
        }
    }

    private static void RaiseTargetWindowNoActivate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;

        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_SHOWNOACTIVATE);
        NativeMethods.SetWindowPos(
            hwnd,
            NativeMethods.HWND_TOPMOST,
            0,
            0,
            0,
            0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);
        NativeMethods.SetWindowPos(
            hwnd,
            NativeMethods.HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);
    }

    private static string ResolveOverlayHtmlPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "overlay.html"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "overlay.html"),
            Path.Combine(Environment.CurrentDirectory, "gateway-overlay", "overlay.html"),
        };

        foreach (var candidate in candidates)
        {
            var fullPath = Path.GetFullPath(candidate);
            if (File.Exists(fullPath)) return fullPath;
        }

        throw new FileNotFoundException("Gateway overlay HTML asset was not found.", "overlay.html");
    }

    private static string ResolveProjectRoot(string overlayHtmlPath)
    {
        var overlayDirectory = Path.GetDirectoryName(overlayHtmlPath)
            ?? throw new DirectoryNotFoundException("Gateway overlay directory was not found.");
        return Path.GetFullPath(Path.Combine(overlayDirectory, ".."));
    }

    private static class NativeMethods
    {
        public static readonly IntPtr HWND_TOPMOST = new(-1);
        public static readonly IntPtr HWND_NOTOPMOST = new(-2);
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_SHOWWINDOW = 0x0040;
        public const int SW_SHOWNOACTIVATE = 4;

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
