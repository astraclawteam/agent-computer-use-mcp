using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace GatewayComputerUseOverlay;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0)
        {
            try
            {
                var snapshot = ParseSnapshotArguments(args);
                SnapshotCompositor.Render(snapshot);
                return 0;
            }
            catch (ArgumentException error)
            {
                Console.Error.WriteLine($"Invalid arguments: {error.Message}");
                return 2;
            }
            catch (NotSupportedException error)
            {
                Console.Error.WriteLine(error.Message);
                return 3;
            }
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new OverlayForm());
        return 0;
    }

    private static SnapshotOptions ParseSnapshotArguments(string[] args)
    {
        if (args.Length != 8
            || args[0] != "--snapshot"
            || args[2] != "--width"
            || args[4] != "--height"
            || args[6] != "--phase")
        {
            throw new ArgumentException("expected --snapshot <png> --width <int> --height <int> --phase <double>");
        }

        if (string.IsNullOrWhiteSpace(args[1]))
        {
            throw new ArgumentException("snapshot path must not be empty");
        }

        if (!int.TryParse(args[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out var width) || width <= 0)
        {
            throw new ArgumentException("width must be a positive integer");
        }

        if (!int.TryParse(args[5], NumberStyles.Integer, CultureInfo.InvariantCulture, out var height) || height <= 0)
        {
            throw new ArgumentException("height must be a positive integer");
        }

        if (!double.TryParse(args[7], NumberStyles.Float, CultureInfo.InvariantCulture, out var phase) || !double.IsFinite(phase))
        {
            throw new ArgumentException("phase must be a finite number");
        }

        return new SnapshotOptions(args[1], width, height, phase - Math.Floor(phase));
    }

    private sealed record SnapshotOptions(string OutputPath, int Width, int Height, double Phase);

    private static class SnapshotCompositor
    {
        public static void Render(SnapshotOptions options)
        {
            var outputDirectory = Path.GetDirectoryName(Path.GetFullPath(options.OutputPath));
            Directory.CreateDirectory(outputDirectory!);
            using var bitmap = OverlayRenderer.Render(new Size(options.Width, options.Height), options.Phase, null);
            bitmap.Save(options.OutputPath, ImageFormat.Png);
        }
    }
}

internal sealed class OverlayForm : Form
{
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_LAYERED = 0x00080000;

    private readonly System.Windows.Forms.Timer _animationTimer;
    private readonly System.Windows.Forms.Timer _targetRectTimer;
    private readonly Stopwatch _animationClock = Stopwatch.StartNew();
    private readonly LayeredWindowPresenter _presenter = new();
    private readonly string? _targetRectFile;
    private string? _lastTargetRectPayload;
    private RectangleF? _targetRect;

    public OverlayForm()
    {
        Text = "Gateway-managed Computer Use";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        Bounds = SystemInformation.VirtualScreen;
        StartPosition = FormStartPosition.Manual;

        _targetRectFile = Environment.GetEnvironmentVariable("AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE")
            ?? Environment.GetEnvironmentVariable("XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE");
        _animationTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _animationTimer.Tick += (_, _) => PresentFrame();
        _targetRectTimer = new System.Windows.Forms.Timer { Interval = 120 };
        _targetRectTimer.Tick += (_, _) => SyncTargetRect();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        NativeMethods.SetWindowPos(Handle, NativeMethods.HWND_TOPMOST, Left, Top, Width, Height, NativeMethods.SWP_NOACTIVATE);
        SyncTargetRect();
        PresentFrame();
        _animationTimer.Start();
        _targetRectTimer.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _animationTimer.Dispose();
            _targetRectTimer.Dispose();
        }

        base.Dispose(disposing);
    }

    private void PresentFrame()
    {
        if (!IsHandleCreated || IsDisposed) return;

        var phase = OverlayTheme.PhaseAtElapsedMilliseconds(_animationClock.Elapsed.TotalMilliseconds);
        using var frame = OverlayRenderer.Render(ClientSize, phase, _targetRect);
        _presenter.Present(this, frame, new Point(Left, Top));
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
        _targetRect = ToOverlayRelativeRect(payload);
        PresentFrame();
    }

    private RectangleF? ToOverlayRelativeRect(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Null) return null;

            var x = root.GetProperty("x").GetDouble() - Left;
            var y = root.GetProperty("y").GetDouble() - Top;
            var width = root.GetProperty("width").GetDouble();
            var height = root.GetProperty("height").GetDouble();
            if (width <= 0 || height <= 0) return null;

            if (root.TryGetProperty("windowId", out var windowId) && windowId.TryGetInt64(out var hwndValue))
            {
                RaiseTargetWindowNoActivate(new IntPtr(hwndValue));
            }

            var left = Math.Max(0, Math.Min(Width, x));
            var top = Math.Max(0, Math.Min(Height, y));
            var right = Math.Max(left, Math.Min(Width - 1, x + width));
            var bottom = Math.Max(top, Math.Min(Height - 1, y + height));
            return new RectangleF((float)left, (float)top, (float)(right - left), (float)(bottom - top));
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
