using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentComputerUse.Installer;

internal sealed partial class ReleaseVerifier
{
    public static bool HasSamePayload(VerifiedRelease left, VerifiedRelease right)
    {
        if (!string.Equals(left.Manifest.PackageName, right.Manifest.PackageName, StringComparison.Ordinal)
            || !string.Equals(left.Manifest.Version, right.Manifest.Version, StringComparison.Ordinal)
            || left.Manifest.Files.Count != right.Manifest.Files.Count)
        {
            return false;
        }

        var rightFiles = right.Manifest.Files.ToDictionary(file => file.Path, StringComparer.OrdinalIgnoreCase);
        return left.Manifest.Files.All(file => rightFiles.TryGetValue(file.Path, out var candidate)
            && candidate.Bytes == file.Bytes
            && string.Equals(candidate.Sha256, file.Sha256, StringComparison.Ordinal));
    }

    public VerifiedRelease Verify(string releaseRoot)
    {
        var normalizedRoot = Path.GetFullPath(releaseRoot);
        var manifestPath = Path.Combine(normalizedRoot, "release-manifest.json");
        if (!File.Exists(manifestPath))
        {
            throw new InstallerException("installer.manifest_missing", "release-manifest.json is missing");
        }

        ReleaseManifest manifest;
        try
        {
            manifest = JsonSerializer.Deserialize(
                File.ReadAllText(manifestPath),
                InstallerJsonContext.Default.ReleaseManifest)
                ?? throw new InstallerException("installer.manifest_invalid", "Release manifest is empty");
        }
        catch (JsonException error)
        {
            throw new InstallerException("installer.manifest_invalid", error.Message);
        }

        ValidateManifest(manifest);
        var payloadRoot = Path.Combine(normalizedRoot, "payload");
        var expectedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            var normalizedPath = NormalizeRelativePath(file.Path);
            if (!expectedPaths.Add(normalizedPath))
            {
                throw new InstallerException("installer.path_duplicate", $"Duplicate payload path: {file.Path}");
            }
            if (!string.Equals(normalizedPath, file.Path, StringComparison.Ordinal))
            {
                throw new InstallerException("installer.path_not_normalized", $"Payload path is not normalized: {file.Path}");
            }
            if (file.Bytes < 0)
            {
                throw new InstallerException("installer.size_invalid", $"Invalid payload size: {file.Path}");
            }
            if (!Sha256Pattern().IsMatch(file.Sha256))
            {
                throw new InstallerException("installer.hash_invalid", $"Invalid SHA-256: {file.Path}");
            }

            var fullPath = ResolvePayloadPath(payloadRoot, normalizedPath);
            if (!File.Exists(fullPath))
            {
                throw new InstallerException("installer.payload_missing", $"Payload file is missing: {file.Path}");
            }
            var fileInfo = new FileInfo(fullPath);
            if (fileInfo.Length != file.Bytes)
            {
                throw new InstallerException("installer.size_mismatch", $"Payload size mismatch: {file.Path}");
            }
            var actualHash = HashFile(fullPath);
            if (!string.Equals(actualHash, file.Sha256, StringComparison.Ordinal))
            {
                throw new InstallerException("installer.hash_mismatch", $"Payload hash mismatch: {file.Path}");
            }
        }

        if (Directory.Exists(payloadRoot))
        {
            foreach (var filePath in Directory.EnumerateFiles(payloadRoot, "*", SearchOption.AllDirectories))
            {
                var relativePath = Path.GetRelativePath(payloadRoot, filePath).Replace('\\', '/');
                if (!expectedPaths.Contains(relativePath))
                {
                    throw new InstallerException("installer.unexpected_payload", $"Unexpected payload file: {relativePath}");
                }
            }
        }

        return new VerifiedRelease(manifest, normalizedRoot, payloadRoot);
    }

    private static void ValidateManifest(ReleaseManifest manifest)
    {
        if (manifest.SchemaVersion != 1)
        {
            throw new InstallerException("installer.schema_unsupported", $"Unsupported manifest schema: {manifest.SchemaVersion}");
        }
        if (!string.Equals(manifest.PackageName, "agent-computer-use-mcp", StringComparison.Ordinal))
        {
            throw new InstallerException("installer.package_mismatch", $"Unexpected package: {manifest.PackageName}");
        }
        if (!VersionPattern().IsMatch(manifest.Version))
        {
            throw new InstallerException("installer.version_invalid", $"Invalid release version: {manifest.Version}");
        }
        if (manifest.Files.Count == 0)
        {
            throw new InstallerException("installer.files_empty", "Release manifest contains no payload files");
        }
    }

    private static string NormalizeRelativePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path) || DrivePrefixPattern().IsMatch(path))
        {
            throw new InstallerException("installer.path_invalid", $"Invalid payload path: {path}");
        }
        var normalized = path.Replace('\\', '/');
        var segments = normalized.Split('/');
        if (segments.Any(segment => string.IsNullOrEmpty(segment) || segment is "." or ".." || segment.Contains(':')))
        {
            throw new InstallerException("installer.path_invalid", $"Invalid payload path: {path}");
        }
        return string.Join('/', segments);
    }

    private static string ResolvePayloadPath(string payloadRoot, string relativePath)
    {
        var root = Path.GetFullPath(payloadRoot);
        var fullPath = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        var rootPrefix = root.EndsWith(Path.DirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InstallerException("installer.path_invalid", $"Payload path escapes root: {relativePath}");
        }
        return fullPath;
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    [GeneratedRegex(@"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex VersionPattern();

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    [GeneratedRegex("^[A-Za-z]:", RegexOptions.CultureInvariant)]
    private static partial Regex DrivePrefixPattern();
}
