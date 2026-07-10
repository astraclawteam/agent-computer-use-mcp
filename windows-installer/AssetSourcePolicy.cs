using System.Net;
using System.Net.Sockets;

namespace AgentComputerUse.Installer;

internal sealed class AssetSourcePolicy
{
    public static bool AllowsManifestUri(Uri uri, bool developmentOnly)
    {
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        if (string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return true;
        return developmentOnly
            && string.Equals(Environment.GetEnvironmentVariable("AGENT_COMPUTER_USE_TEST_ALLOW_PRIVATE_NETWORK"), "1", StringComparison.Ordinal)
            && string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && uri.IsLoopback;
    }

    public async Task ValidateNetworkUriAsync(Uri uri, bool developmentOnly, CancellationToken cancellationToken)
    {
        if (!AllowsManifestUri(uri, developmentOnly))
        {
            throw new InstallerException("asset.source_forbidden", "Asset network source is forbidden");
        }
        if (developmentOnly && uri.IsLoopback) return;
        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken);
        }
        catch (SocketException error)
        {
            throw new InstallerException("asset.download_interrupted", error.Message);
        }
        if (addresses.Length == 0 || addresses.Any(IsPrivateAddress))
        {
            throw new InstallerException("asset.source_forbidden", "Asset source resolves to a private network");
        }
    }

    private static bool IsPrivateAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address) || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal) return true;
        if (address.AddressFamily == AddressFamily.InterNetworkV6 && address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        var bytes = address.GetAddressBytes();
        return bytes[0] == 10
            || bytes[0] == 127
            || bytes[0] == 0
            || bytes[0] == 169 && bytes[1] == 254
            || bytes[0] == 172 && bytes[1] is >= 16 and <= 31
            || bytes[0] == 192 && bytes[1] == 168;
    }
}
