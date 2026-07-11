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
    bool IsRdpUdd,
    string DeviceName,
    string DeviceString,
    string DeviceId,
    string DeviceKey);

internal readonly record struct OverlayDisplayAdapter(
    string DeviceName,
    string DeviceString,
    uint StateFlags,
    string DeviceId,
    string DeviceKey);

internal readonly record struct OverlayScreenDescriptor(
    string DeviceName,
    Rectangle Bounds,
    bool IsPrimary);

internal static class OverlayDisplaySelector
{
    private const uint DISPLAY_DEVICE_ACTIVE = 0x00000001;
    private const uint DISPLAY_DEVICE_MIRRORING_DRIVER = 0x00000008;
    private const uint DISPLAY_DEVICE_RDPUDD = 0x01000000;
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
        if (candidate.IsMirroring || candidate.IsRemote || candidate.IsRdpUdd)
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
        var adapters = EnumerateAdapters(adapterIndex =>
        {
            var device = DisplayDevice.Create();
            if (!NativeMethods.EnumDisplayDevices(null, adapterIndex, ref device, 0)) return null;
            return new OverlayDisplayAdapter(
                device.DeviceName,
                device.DeviceString,
                device.StateFlags,
                device.DeviceId,
                device.DeviceKey);
        });
        var screens = Screen.AllScreens
            .Select(screen => new OverlayScreenDescriptor(screen.DeviceName, screen.Bounds, screen.Primary))
            .ToArray();
        return MapScreensToAdapters(screens, adapters, foregroundDeviceName);
    }

    public static IReadOnlyList<OverlayDisplayAdapter> EnumerateAdapters(
        Func<uint, OverlayDisplayAdapter?> probe)
    {
        var adapters = new List<OverlayDisplayAdapter>();
        for (uint adapterIndex = 0; ; adapterIndex++)
        {
            var adapter = probe(adapterIndex);
            if (adapter is null) break;
            adapters.Add(adapter.Value);
        }

        return adapters;
    }

    public static IReadOnlyList<OverlayDisplayCandidate> MapScreensToAdapters(
        IEnumerable<OverlayScreenDescriptor> screens,
        IEnumerable<OverlayDisplayAdapter> adapters,
        string? foregroundDeviceName)
    {
        var adaptersByName = new Dictionary<string, OverlayDisplayAdapter>(StringComparer.OrdinalIgnoreCase);
        foreach (var adapter in adapters)
        {
            adaptersByName.TryAdd(adapter.DeviceName, adapter);
        }

        var candidates = new List<OverlayDisplayCandidate>();
        foreach (var screen in screens)
        {
            if (!adaptersByName.TryGetValue(screen.DeviceName, out var adapter)) continue;

            var flags = adapter.StateFlags;
            candidates.Add(new OverlayDisplayCandidate(
                screen.Bounds,
                screen.IsPrimary,
                string.Equals(screen.DeviceName, foregroundDeviceName, StringComparison.OrdinalIgnoreCase),
                (flags & DISPLAY_DEVICE_ACTIVE) != 0,
                (flags & DISPLAY_DEVICE_MIRRORING_DRIVER) != 0,
                (flags & DISPLAY_DEVICE_REMOTE) != 0,
                (flags & DISPLAY_DEVICE_RDPUDD) != 0,
                screen.DeviceName,
                adapter.DeviceString,
                adapter.DeviceId,
                adapter.DeviceKey));
        }

        return candidates;
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
