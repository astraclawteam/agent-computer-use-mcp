using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentComputerUse.Installer;

internal sealed partial class AssetManifestVerifier
{
    private const int SupportedSchemaVersion = 2;
    private const string SupportedAlgorithm = "ecdsa-p256-sha256";

    public VerifiedAssetManifest Verify(string manifestPath, string signaturePath, string keyringPath)
    {
        var manifestBytes = ReadRequiredFile(manifestPath, "asset.manifest_missing");
        var envelope = Deserialize(
            ReadRequiredFile(signaturePath, "asset.manifest_signature_missing"),
            InstallerJsonContext.Default.AssetSignatureEnvelope,
            "asset.manifest_signature_invalid");
        var keyring = Deserialize(
            ReadRequiredFile(keyringPath, "asset.manifest_keyring_missing"),
            InstallerJsonContext.Default.AssetTrustKeyring,
            "asset.manifest_keyring_invalid");

        ValidateEnvelope(envelope);
        if (keyring.SchemaVersion != 1)
        {
            throw new InstallerException("asset.manifest_keyring_invalid", "Unsupported asset keyring schema");
        }
        var key = keyring.Keys.SingleOrDefault(candidate =>
            string.Equals(candidate.KeyId, envelope.KeyId, StringComparison.Ordinal)
            && string.Equals(candidate.Status, "trusted", StringComparison.Ordinal));
        if (key is null || !string.Equals(key.Algorithm, SupportedAlgorithm, StringComparison.Ordinal))
        {
            throw new InstallerException("asset.manifest_key_unknown", "Manifest key is not trusted");
        }

        byte[] signature;
        try
        {
            signature = Convert.FromBase64String(envelope.Signature);
        }
        catch (FormatException)
        {
            throw new InstallerException("asset.manifest_signature_invalid", "Manifest signature encoding is invalid");
        }

        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportFromPem(key.PublicKeyPem);
            if (!ecdsa.VerifyData(
                manifestBytes,
                signature,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence))
            {
                throw new InstallerException("asset.manifest_signature_invalid", "Manifest signature is invalid");
            }
        }
        catch (InstallerException)
        {
            throw;
        }
        catch (CryptographicException)
        {
            throw new InstallerException("asset.manifest_signature_invalid", "Manifest signature is invalid");
        }

        var manifest = Deserialize(
            manifestBytes,
            InstallerJsonContext.Default.AssetManifest,
            "asset.manifest_invalid");
        ValidateManifest(manifest, envelope);
        var manifestSha256 = Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant();
        return new VerifiedAssetManifest(
            manifest,
            manifestSha256,
            Path.GetFullPath(manifestPath),
            Path.GetFullPath(signaturePath));
    }

    private static void ValidateEnvelope(AssetSignatureEnvelope envelope)
    {
        if (envelope.SchemaVersion != 1
            || !string.Equals(envelope.Algorithm, SupportedAlgorithm, StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(envelope.KeyId)
            || string.IsNullOrWhiteSpace(envelope.Signature))
        {
            throw new InstallerException("asset.manifest_signature_invalid", "Manifest signature envelope is invalid");
        }
    }

    private static void ValidateManifest(AssetManifest manifest, AssetSignatureEnvelope envelope)
    {
        if (manifest.SchemaVersion != SupportedSchemaVersion)
        {
            throw new InstallerException("asset.manifest_schema_unsupported", "Unsupported asset manifest schema");
        }
        if (!string.Equals(manifest.PackageName, "agent-computer-use-mcp", StringComparison.Ordinal)
            || !VersionPattern().IsMatch(manifest.PackageVersion)
            || !ReleaseIdPattern().IsMatch(manifest.ReleaseId))
        {
            throw new InstallerException("asset.manifest_identity_invalid", "Asset manifest identity is invalid");
        }
        if (!string.Equals(manifest.Signing.Algorithm, envelope.Algorithm, StringComparison.Ordinal)
            || !string.Equals(manifest.Signing.KeyId, envelope.KeyId, StringComparison.Ordinal))
        {
            throw new InstallerException("asset.manifest_signature_invalid", "Manifest signing metadata does not match signature envelope");
        }
        if (!DateTimeOffset.TryParse(manifest.GeneratedAt, out var generatedAt)
            || !DateTimeOffset.TryParse(manifest.ExpiresAt, out var expiresAt)
            || generatedAt >= expiresAt)
        {
            throw new InstallerException("asset.manifest_time_invalid", "Asset manifest time range is invalid");
        }
        if (expiresAt <= DateTimeOffset.UtcNow)
        {
            throw new InstallerException("asset.manifest_expired", "Asset manifest has expired");
        }
        if (manifest.Assets.Count == 0)
        {
            throw new InstallerException("asset.manifest_assets_empty", "Asset manifest contains no assets");
        }

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in manifest.Assets)
        {
            if (!ids.Add(asset.Id))
            {
                throw new InstallerException("asset.id_duplicate", $"Duplicate asset id: {asset.Id}");
            }
            ValidateAsset(asset, manifest.DevelopmentOnly);
        }
    }

    private static void ValidateAsset(AssetEntry asset, bool developmentOnly)
    {
        if (!IdentifierPattern().IsMatch(asset.Id)
            || !IdentifierPattern().IsMatch(asset.Kind)
            || !VersionPattern().IsMatch(asset.Version))
        {
            throw new InstallerException("asset.identity_invalid", $"Asset identity is invalid: {asset.Id}");
        }
        if (!string.Equals(asset.Platform.Os, "win32", StringComparison.Ordinal)
            || asset.Platform.Arch is not ("x64" or "arm64"))
        {
            throw new InstallerException("asset.platform_unsupported", $"Asset platform is unsupported: {asset.Id}");
        }
        if (!string.Equals(asset.Source.Kind, "https-or-offline", StringComparison.Ordinal)
            || asset.Source.SizeBytes <= 0
            || !Sha256Pattern().IsMatch(asset.Source.Sha256)
            || !SafeFileNamePattern().IsMatch(asset.Source.FileName)
            || asset.Source.Urls.Count == 0)
        {
            throw new InstallerException("asset.source_invalid", $"Asset source is invalid: {asset.Id}");
        }
        foreach (var value in asset.Source.Urls)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
                || !AssetSourcePolicy.AllowsManifestUri(uri, developmentOnly))
            {
                throw new InstallerException("asset.source_forbidden", $"Asset source URL is forbidden: {asset.Id}");
            }
        }
        if (asset.Content.Format is not ("raw" or "zip") || asset.Content.Files.Count == 0)
        {
            throw new InstallerException("asset.content_invalid", $"Asset content is invalid: {asset.Id}");
        }
        var archivePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var installPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in asset.Content.Files)
        {
            var archivePath = NormalizeRelativePath(file.Path);
            var installPath = NormalizeRelativePath(file.InstallPath);
            if (!archivePaths.Add(archivePath) || !installPaths.Add(installPath))
            {
                throw new InstallerException("asset.content_path_duplicate", $"Asset content path is duplicated: {asset.Id}");
            }
            if (file.SizeBytes <= 0 || !Sha256Pattern().IsMatch(file.Sha256))
            {
                throw new InstallerException("asset.content_invalid", $"Asset content file is invalid: {asset.Id}");
            }
        }
        NormalizeRelativePath(asset.Install.EntryPoint);
        if (!installPaths.Contains(asset.Install.EntryPoint) || string.IsNullOrWhiteSpace(asset.Install.View))
        {
            throw new InstallerException("asset.install_invalid", $"Asset install metadata is invalid: {asset.Id}");
        }
        ValidateTrustPolicy(asset, developmentOnly);
    }

    private static void ValidateTrustPolicy(AssetEntry asset, bool developmentOnly)
    {
        if (string.Equals(asset.Authenticode.Mode, "vendor-unsigned", StringComparison.Ordinal))
        {
            if (!string.Equals(asset.Provenance.Class, "third-party", StringComparison.Ordinal)
                || !string.Equals(asset.Provenance.UpstreamSha256, asset.Source.Sha256, StringComparison.Ordinal)
                || !string.Equals(asset.Provenance.AssetName, asset.Source.FileName, StringComparison.Ordinal)
                || string.IsNullOrWhiteSpace(asset.Provenance.Repository)
                || string.IsNullOrWhiteSpace(asset.Provenance.Tag))
            {
                throw new InstallerException("asset.vendor_provenance_mismatch", $"Vendor provenance does not match source: {asset.Id}");
            }
            if (asset.Id.StartsWith("cua-driver-", StringComparison.Ordinal)
                && !string.Equals(asset.Provenance.Repository, "trycua/cua", StringComparison.Ordinal))
            {
                throw new InstallerException("asset.vendor_provenance_mismatch", $"Cua driver repository is not trusted: {asset.Id}");
            }
            return;
        }

        if (asset.Authenticode.Mode is not ("required" or "microsoft")
            || string.IsNullOrWhiteSpace(asset.Authenticode.Publisher))
        {
            if (!developmentOnly)
            {
                throw new InstallerException("asset.authenticode_policy_invalid", $"Authenticode policy is invalid: {asset.Id}");
            }
        }
    }

    private static string NormalizeRelativePath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || Path.IsPathRooted(value) || DrivePrefixPattern().IsMatch(value))
        {
            throw new InstallerException("asset.path_invalid", $"Asset path is invalid: {value}");
        }
        var normalized = value.Replace('\\', '/');
        var segments = normalized.Split('/');
        if (segments.Any(segment => string.IsNullOrEmpty(segment) || segment is "." or ".." || segment.Contains(':')))
        {
            throw new InstallerException("asset.path_invalid", $"Asset path is invalid: {value}");
        }
        return string.Join('/', segments);
    }

    private static byte[] ReadRequiredFile(string path, string errorCode)
    {
        try
        {
            return File.ReadAllBytes(Path.GetFullPath(path));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw new InstallerException(errorCode, error.Message);
        }
    }

    private static T Deserialize<T>(byte[] bytes, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo, string code)
    {
        try
        {
            return JsonSerializer.Deserialize(bytes, typeInfo)
                ?? throw new InstallerException(code, "JSON document is empty");
        }
        catch (JsonException error)
        {
            throw new InstallerException(code, error.Message);
        }
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9.-]{1,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdentifierPattern();

    [GeneratedRegex("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex VersionPattern();

    [GeneratedRegex("^[0-9A-Za-z][0-9A-Za-z._-]{2,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex ReleaseIdPattern();

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    [GeneratedRegex("^[0-9A-Za-z][0-9A-Za-z._-]{0,255}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeFileNamePattern();

    [GeneratedRegex("^[A-Za-z]:", RegexOptions.CultureInvariant)]
    private static partial Regex DrivePrefixPattern();
}
