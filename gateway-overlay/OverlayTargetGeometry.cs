using System.Drawing;

namespace GatewayComputerUseOverlay;

internal static class OverlayTargetGeometry
{
    public static RectangleF? ToOverlayRelativeRect(Rectangle selectedBounds, RectangleF targetBounds)
    {
        if (selectedBounds.Width <= 0
            || selectedBounds.Height <= 0
            || targetBounds.Width <= 0
            || targetBounds.Height <= 0)
        {
            return null;
        }

        var selected = new RectangleF(
            selectedBounds.X,
            selectedBounds.Y,
            selectedBounds.Width,
            selectedBounds.Height);
        var visible = RectangleF.Intersect(selected, targetBounds);
        if (visible.Width <= 0 || visible.Height <= 0) return null;

        return new RectangleF(
            visible.X - selected.X,
            visible.Y - selected.Y,
            visible.Width,
            visible.Height);
    }
}
