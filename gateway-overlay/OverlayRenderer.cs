using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace GatewayComputerUseOverlay;

internal static class OverlayRenderer
{
    private const int PointStep = 18;

    public static Bitmap Render(Size size, double phase, RectangleF? targetRect)
    {
        var width = Math.Max(1, size.Width);
        var height = Math.Max(1, size.Height);
        var state = OverlayTheme.AtPhase(phase);
        var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb);

        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.Clear(Color.Transparent);

        var innerBoundary = BuildInnerBoundary(width, height, phase, state);
        using var river = CreateClosedRiverPath(width, height, innerBoundary);
        DrawRiver(graphics, river, state);
        DrawInnerRim(graphics, innerBoundary, state);
        DrawCurrents(graphics, width, height, phase, state);
        DrawTargetFrame(graphics, targetRect, state);
        return bitmap;
    }

    private static GraphicsPath CreateClosedRiverPath(int width, int height, PointF[] innerBoundary)
    {
        var path = new GraphicsPath(FillMode.Alternate);
        path.AddRectangle(new Rectangle(0, 0, width, height));
        path.AddPolygon(innerBoundary);
        return path;
    }

    private static PointF[] BuildInnerBoundary(int width, int height, double phase, OverlayFrameState state)
    {
        var points = new List<PointF>();
        var horizontalCount = Math.Max(8, (int)Math.Ceiling((double)width / PointStep));
        var verticalCount = Math.Max(8, (int)Math.Ceiling((double)height / PointStep));
        var cornerInset = Math.Min((float)OverlayTheme.MaxWaveThickness, Math.Min(width, height) / 3f);
        var horizontalSpan = Math.Max(0, width - cornerInset * 2);
        var verticalSpan = Math.Max(0, height - cornerInset * 2);

        for (var index = 0; index <= horizontalCount; index++)
        {
            var x = cornerInset + horizontalSpan * index / horizontalCount;
            points.Add(new PointF(x, Thickness(index, phase, 0.1, state)));
        }
        for (var index = 0; index <= verticalCount; index++)
        {
            var y = cornerInset + verticalSpan * index / verticalCount;
            points.Add(new PointF(width - Thickness(index, phase, 1.4, state), y));
        }
        for (var index = horizontalCount; index >= 0; index--)
        {
            var x = cornerInset + horizontalSpan * index / horizontalCount;
            points.Add(new PointF(x, height - Thickness(index, phase, 2.7, state)));
        }
        for (var index = verticalCount; index >= 0; index--)
        {
            var y = cornerInset + verticalSpan * index / verticalCount;
            points.Add(new PointF(Thickness(index, phase, 4.1, state), y));
        }
        return points.ToArray();
    }

    private static float Thickness(int index, double phase, double offset, OverlayFrameState state)
    {
        var localWave = Math.Sin(index * 0.72 + phase * 2 * Math.PI + offset) * 0.55
            + Math.Sin(index * 1.37 - phase * 2 * Math.PI * 0.61 + offset * 0.7) * 0.32
            + Math.Sin(index * 2.41 + phase * 2 * Math.PI * 0.39 + offset * 1.9) * 0.13;
        return (float)Math.Clamp(state.BaseThickness + localWave * 6, 24, 48);
    }

    private static void DrawRiver(Graphics graphics, GraphicsPath river, OverlayFrameState state)
    {
        using var clay = new SolidBrush(WithAlpha(OverlayTheme.Clay, state.FillAlpha));
        using var deep = new SolidBrush(WithAlpha(OverlayTheme.ClayDeep, state.FillAlpha * 0.16));
        using var soft = new SolidBrush(WithAlpha(OverlayTheme.ClaySoft, state.FillAlpha * 0.12));
        graphics.FillPath(clay, river);
        graphics.FillPath(deep, river);
        graphics.FillPath(soft, river);
    }

    private static void DrawInnerRim(Graphics graphics, PointF[] innerBoundary, OverlayFrameState state)
    {
        using var rim = new Pen(WithAlpha(OverlayTheme.ClayDeep, state.FillAlpha * 0.62), 1.5f) {
            LineJoin = LineJoin.Round,
        };
        graphics.DrawPolygon(rim, innerBoundary);
    }

    private static void DrawCurrents(Graphics graphics, int width, int height, double phase, OverlayFrameState state)
    {
        var inset = (float)Math.Max(24, state.BaseThickness - 3);
        var alpha = Math.Max(8, (int)Math.Round(255 * state.FillAlpha * 0.2));
        using var highlight = new Pen(Color.FromArgb(alpha, Color.White), 1.2f) { DashPattern = [12, 15, 4, 13] };
        highlight.DashOffset = (float)(-phase * 44);
        graphics.DrawRectangle(highlight, inset, inset, Math.Max(1, width - inset * 2), Math.Max(1, height - inset * 2));
    }

    private static void DrawTargetFrame(Graphics graphics, RectangleF? targetRect, OverlayFrameState state)
    {
        if (targetRect is not { } target || target.Width < 24 || target.Height < 24) return;

        using var glow = new Pen(WithAlpha(OverlayTheme.Clay, state.FillAlpha * 0.55), 8f);
        using var outer = new Pen(WithAlpha(OverlayTheme.ClayDeep, state.FillAlpha * 1.5), 2f);
        using var inner = new Pen(WithAlpha(OverlayTheme.ClaySoft, state.FillAlpha * 0.9), 1f);
        graphics.DrawRectangle(glow, target.X, target.Y, target.Width, target.Height);
        graphics.DrawRectangle(outer, target.X, target.Y, target.Width, target.Height);
        graphics.DrawRectangle(inner, target.X + 3, target.Y + 3, Math.Max(1, target.Width - 6), Math.Max(1, target.Height - 6));
    }

    private static Color WithAlpha(Color color, double alpha)
        => Color.FromArgb((int)Math.Round(Math.Clamp(alpha, 0, 1) * 255), color);
}
