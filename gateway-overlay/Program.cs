using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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
            throw new NotSupportedException("Snapshot rendering is not supported until the compositor is implemented.");
        }
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
    private const int PointStep = 18;

    private static readonly Color TransparencyColor = Color.FromArgb(1, 2, 3);
    private static readonly Color BrandColor = Color.FromArgb(217, 119, 87);

    private readonly System.Windows.Forms.Timer _animationTimer;
    private readonly System.Windows.Forms.Timer _targetRectTimer;
    private readonly Stopwatch _animationClock = Stopwatch.StartNew();
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
        BackColor = TransparencyColor;
        TransparencyKey = TransparencyColor;
        DoubleBuffered = true;

        _targetRectFile = Environment.GetEnvironmentVariable("AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE")
            ?? Environment.GetEnvironmentVariable("XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE");
        _animationTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _animationTimer.Tick += (_, _) => Invalidate();
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

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        NativeMethods.SetWindowPos(Handle, NativeMethods.HWND_TOPMOST, Left, Top, Width, Height, NativeMethods.SWP_NOACTIVATE);
        SyncTargetRect();
        _animationTimer.Start();
        _targetRectTimer.Start();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.Clear(TransparencyColor);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        using var river = CreateClosedRiverPath(ClientSize.Width, ClientSize.Height, _animationClock.Elapsed.TotalMilliseconds);
        using var riverBrush = new LinearGradientBrush(
            ClientRectangle,
            Color.FromArgb(190, 255, 255, 255),
            Color.FromArgb(225, BrandColor),
            24f);
        graphics.FillPath(riverBrush, river);
        DrawCurrents(graphics, _animationClock.Elapsed.TotalMilliseconds);
        DrawTargetFrame(graphics);
    }

    private static GraphicsPath CreateClosedRiverPath(int width, int height, double time)
    {
        var path = new GraphicsPath(FillMode.Alternate);
        path.AddRectangle(new Rectangle(0, 0, Math.Max(1, width), Math.Max(1, height)));
        var inner = BuildInnerBoundary(width, height, time);
        if (inner.Length >= 4)
        {
            path.AddPolygon(inner);
        }
        return path;
    }

    private static PointF[] BuildInnerBoundary(int width, int height, double time)
    {
        var points = new List<PointF>();
        var horizontalCount = Math.Max(8, (int)Math.Ceiling((double)Math.Max(1, width) / PointStep));
        var verticalCount = Math.Max(8, (int)Math.Ceiling((double)Math.Max(1, height) / PointStep));

        for (var index = 0; index <= horizontalCount; index++)
        {
            var x = width * index / (float)horizontalCount;
            points.Add(new PointF(x, WaveThickness(index, time, 0.1)));
        }
        for (var index = 0; index <= verticalCount; index++)
        {
            var y = height * index / (float)verticalCount;
            points.Add(new PointF(width - WaveThickness(index, time, 1.4), y));
        }
        for (var index = horizontalCount; index >= 0; index--)
        {
            var x = width * index / (float)horizontalCount;
            points.Add(new PointF(x, height - WaveThickness(index, time, 2.7)));
        }
        for (var index = verticalCount; index >= 0; index--)
        {
            var y = height * index / (float)verticalCount;
            points.Add(new PointF(WaveThickness(index, time, 4.1), y));
        }
        return points.ToArray();
    }

    private static float WaveThickness(int index, double time, double phase)
    {
        var wave = Math.Sin(index * 0.72 + time * 0.0018 + phase) * 0.55
            + Math.Sin(index * 1.37 - time * 0.0011 + phase * 0.7) * 0.32
            + Math.Sin(index * 2.41 + time * 0.0007 + phase * 1.9) * 0.13;
        var normalized = (wave + 1) / 2;
        return (float)(MinWaveThickness + normalized * (MaxWaveThickness - MinWaveThickness));
    }

    private void DrawCurrents(Graphics graphics, double time)
    {
        using var primary = new Pen(Color.FromArgb(145, 255, 255, 255), 1.4f) { DashPattern = [12, 15, 4, 13] };
        using var secondary = new Pen(Color.FromArgb(100, 184, 89, 59), 1.1f) { DashPattern = [8, 17, 3, 11] };
        primary.DashOffset = (float)(-time * 0.018 % 44);
        secondary.DashOffset = (float)(time * 0.013 % 39);
        var inset = RestWaveThickness;
        graphics.DrawRectangle(primary, inset, inset, Math.Max(1, Width - inset * 2), Math.Max(1, Height - inset * 2));
        graphics.DrawRectangle(secondary, inset + 2, inset + 2, Math.Max(1, Width - (inset + 2) * 2), Math.Max(1, Height - (inset + 2) * 2));
    }

    private void DrawTargetFrame(Graphics graphics)
    {
        if (_targetRect is not { } target || target.Width < 24 || target.Height < 24) return;

        using var glow = new Pen(Color.FromArgb(74, BrandColor), 8f);
        using var outer = new Pen(Color.FromArgb(210, BrandColor), 2f);
        using var inner = new Pen(Color.FromArgb(140, 255, 255, 255), 1f);
        graphics.DrawRectangle(glow, target.X, target.Y, target.Width, target.Height);
        graphics.DrawRectangle(outer, target.X, target.Y, target.Width, target.Height);
        graphics.DrawRectangle(inner, target.X + 3, target.Y + 3, Math.Max(1, target.Width - 6), Math.Max(1, target.Height - 6));
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
        Invalidate();
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
