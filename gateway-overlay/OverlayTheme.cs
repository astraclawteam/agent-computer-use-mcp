using System.Drawing;

namespace GatewayComputerUseOverlay;

internal readonly record struct OverlayFrameState(double Breath, double BaseThickness, double FillAlpha);

internal static class OverlayTheme
{
    public static readonly Color Clay = Color.FromArgb(217, 119, 87);
    public static readonly Color ClayDeep = Color.FromArgb(184, 89, 59);
    public static readonly Color ClaySoft = Color.FromArgb(247, 210, 195);
    public static readonly Color RiverFill = MixFamilyColor(Clay, ClayDeep, ClaySoft);

    public const double MinWaveThickness = 24;
    public const double MaxWaveThickness = 48;
    public const double MinFillAlpha = 0.24;
    public const double MaxFillAlpha = 0.50;
    public const double BreathPeriodMilliseconds = 3200;

    public static double PhaseAtElapsedMilliseconds(double elapsedMilliseconds)
    {
        if (!double.IsFinite(elapsedMilliseconds))
        {
            throw new ArgumentOutOfRangeException(nameof(elapsedMilliseconds), "elapsed milliseconds must be finite");
        }

        var elapsedInPeriod = elapsedMilliseconds % BreathPeriodMilliseconds;
        if (elapsedInPeriod < 0)
        {
            elapsedInPeriod += BreathPeriodMilliseconds;
        }

        return elapsedInPeriod / BreathPeriodMilliseconds;
    }

    public static OverlayFrameState AtPhase(double phase)
    {
        var normalized = phase - Math.Floor(phase);
        var breath = 0.5 - 0.5 * Math.Cos(2 * Math.PI * normalized);
        var baseThickness = 30 + (42 - 30) * breath;
        var fillAlpha = MinFillAlpha + (MaxFillAlpha - MinFillAlpha) * breath;
        return new OverlayFrameState(breath, baseThickness, fillAlpha);
    }

    private static Color MixFamilyColor(Color clay, Color deep, Color soft)
        => Color.FromArgb(
            (int)Math.Round(clay.R * 0.72 + deep.R * 0.16 + soft.R * 0.12),
            (int)Math.Round(clay.G * 0.72 + deep.G * 0.16 + soft.G * 0.12),
            (int)Math.Round(clay.B * 0.72 + deep.B * 0.16 + soft.B * 0.12));
}
