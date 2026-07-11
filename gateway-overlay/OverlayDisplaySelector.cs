using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace GatewayComputerUseOverlay;

internal readonly record struct OverlayDisplayCandidate(
    Rectangle Bounds,
    bool IsPrimary,
    bool IsForeground,
    bool IsActive,
    bool IsMirroring,
    bool IsRemote,
    string DeviceName,
    string DeviceString,
    string DeviceId,
    string DeviceKey);

internal static class OverlayDisplaySelector
{
    private const uint DISPLAY_DEVICE_ACTIVE = 0x00000001;
    private const uint DISPLAY_DEVICE_MIRRORING_DRIVER = 0x00000008;
    private const uint DISPLAY_DEVICE_REMOTE = 0x04000000;

    public static OverlayDisplayCandidate? Select(
        IEnumerable<OverlayDisplayCandidate> candidates,
        bool allowVirtualDisplays)
    {
        var eligible = candidates
            .Where(candidate => candidate.IsActive && (allowVirtualDisplays || !IsExcludedAdapter(candidate)))
            .ToArray();

        foreach (var candidate in eligible)
        {
            if (candidate.IsForeground)
            {
                return candidate;
            }
        }

        foreach (var candidate in eligible)
        {
            if (candidate.IsPrimary)
            {
                return candidate;
            }
        }

        return eligible.Length > 0 ? eligible[0] : null;
    }

    public static Rectangle SelectDesktopBounds(bool allowVirtualDisplays)
    {
        var selected = Select(ProbeDesktopDisplays(), allowVirtualDisplays);
        return selected?.Bounds
            ?? throw new InvalidOperationException(
                "No eligible physical display is available. Set AGENT_COMPUTER_USE_OVERLAY_ALLOW_VIRTUAL_DISPLAYS=1 to opt in to virtual displays.");
    }

    private static bool IsExcludedAdapter(OverlayDisplayCandidate candidate)
    {
        if (candidate.IsMirroring || candidate.IsRemote)
        {
            return true;
        }

        var descriptor = string.Join(
            ' ',
            candidate.DeviceName,
            candidate.DeviceString,
            candidate.DeviceId,
            candidate.DeviceKey).ToLowerInvariant();
        if (descriptor.Contains("virtual", StringComparison.Ordinal)
            || descriptor.Contains("remote", StringComparison.Ordinal)
            || descriptor.Contains("mirroring", StringComparison.Ordinal)
            || descriptor.Contains("indirect", StringComparison.Ordinal))
        {
            return true;
        }

        var tokens = descriptor.Split(
            [' ', '\\', '/', '-', '_', '.', ':', '{', '}', '(', ')'],
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return tokens.Any(token => token is "vdd" or "idd" or "rdp" || token.StartsWith("iddsample", StringComparison.Ordinal));
    }

    private static IReadOnlyList<OverlayDisplayCandidate> ProbeDesktopDisplays()
    {
        var foregroundWindow = NativeMethods.GetForegroundWindow();
        var foregroundDeviceName = foregroundWindow == IntPtr.Zero
            ? null
            : Screen.FromHandle(foregroundWindow).DeviceName;

        return Screen.AllScreens.Select(screen =>
        {
            var device = DisplayDevice.Create();
            var probed = NativeMethods.EnumDisplayDevices(screen.DeviceName, 0, ref device, 0);
            var flags = probed ? device.StateFlags : DISPLAY_DEVICE_ACTIVE;
            return new OverlayDisplayCandidate(
                screen.Bounds,
                screen.Primary,
                string.Equals(screen.DeviceName, foregroundDeviceName, StringComparison.OrdinalIgnoreCase),
                (flags & DISPLAY_DEVICE_ACTIVE) != 0,
                (flags & DISPLAY_DEVICE_MIRRORING_DRIVER) != 0,
                (flags & DISPLAY_DEVICE_REMOTE) != 0,
                screen.DeviceName,
                probed ? device.DeviceString : string.Empty,
                probed ? device.DeviceId : string.Empty,
                probed ? device.DeviceKey : string.Empty);
        }).ToArray();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public int Size;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;

        public uint StateFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceId;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;

        public static DisplayDevice Create() => new() {
            Size = Marshal.SizeOf<DisplayDevice>(),
            DeviceName = string.Empty,
            DeviceString = string.Empty,
            DeviceId = string.Empty,
            DeviceKey = string.Empty,
        };
    }

    private static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EnumDisplayDevices(
            string? lpDevice,
            uint iDevNum,
            ref DisplayDevice lpDisplayDevice,
            uint dwFlags);
    }
}
