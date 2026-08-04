using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace GatewayComputerUseOverlay;

internal static class OverlayRenderer
{
    private const int PointStep = 18;

    /// <summary>
    /// Said plainly at the top of the screen, because a breathing border tells
    /// someone that something is happening but not what, and a person whose
    /// desktop is being driven should not have to infer it.
    /// </summary>
    internal const string StatusText = "计算机操控进行中";

    /// <summary>
    /// Used only when the keyboard hook is actually installed. A banner that
    /// names a key nothing is listening for is worse than one that stays quiet.
    /// </summary>
    internal const string StatusTextWithEscape = "计算机操控进行中 · 按 Esc 退出";

    public static Bitmap Render(Size size, double phase, RectangleF? targetRect, bool escapeStops = false)
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
        DrawStatusBanner(graphics, width, state, escapeStops ? StatusTextWithEscape : StatusText);
        return bitmap;
    }

    private static void DrawStatusBanner(Graphics graphics, int width, OverlayFrameState state, string statusText)
    {
        // ClearType cannot composite onto a transparent layered surface; it
        // leaves opaque colour fringes on every glyph.
        graphics.TextRenderingHint = TextRenderingHint.AntiAlias;
        using var font = new Font("Microsoft YaHei UI", 20f, FontStyle.Regular, GraphicsUnit.Point);
        var textSize = graphics.MeasureString(statusText, font);
        var bannerWidth = textSize.Width + 56;
        var bannerHeight = textSize.Height + 26;
        if (bannerWidth > width - 24) return;

        var banner = new RectangleF((width - bannerWidth) / 2f, 18f, bannerWidth, bannerHeight);
        // The surface stays see-through so it never hides what it sits over,
        // but it is kept clear of the border's own ceiling so it still reads as
        // a distinct thing rather than another patch of the frame.
        var opacity = 0.62 + 0.08 * state.Breath;
        using var path = RoundedRectangle(banner, bannerHeight / 2f);
        using var fill = new SolidBrush(WithAlpha(OverlayTheme.ClayDeep, opacity));
        using var rim = new Pen(WithAlpha(OverlayTheme.ClaySoft, opacity), 1.5f);
        // The wording carries the message, so it stays near solid even as the
        // surface under it thins out.
        using var text = new SolidBrush(WithAlpha(Color.White, 0.96));
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        graphics.FillPath(fill, path);
        graphics.DrawPath(rim, path);
        graphics.DrawString(statusText, font, text, banner, format);
    }

    private static GraphicsPath RoundedRectangle(RectangleF bounds, float radius)
    {
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
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
        using var fill = new SolidBrush(WithAlpha(OverlayTheme.RiverFill, state.FillAlpha));
        graphics.FillPath(fill, river);
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
