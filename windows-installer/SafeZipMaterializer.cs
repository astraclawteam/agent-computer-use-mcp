using System.IO.Compression;

namespace AgentComputerUse.Installer;

internal sealed class SafeZipMaterializer
{
    public async Task MaterializeAsync(
        AssetEntry asset,
        string blobPath,
        string outputRoot,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(outputRoot);
        if (asset.Content.Format == "raw")
        {
            if (asset.Content.Files.Count != 1)
            {
                throw new InstallerException("asset.content_invalid", "Raw assets must declare one output file");
            }
            var file = asset.Content.Files[0];
            var target = ResolveOutputPath(outputRoot, file.InstallPath);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(blobPath, target);
            await VerifyOutputAsync(target, file, cancellationToken);
            return;
        }

        var declared = asset.Content.Files.ToDictionary(
            file => NormalizeArchivePath(file.Path),
            StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long expandedBytes = 0;
        var maxExpandedBytes = Math.Max(64L * 1024 * 1024, asset.Source.SizeBytes * 200);
        using var archive = ZipFile.OpenRead(blobPath);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            var path = NormalizeArchivePath(entry.FullName);
            if (!seen.Add(path))
            {
                throw new InstallerException("asset.archive_path_duplicate", $"Duplicate archive path: {path}");
            }
            if (!declared.TryGetValue(path, out var file))
            {
                throw new InstallerException("asset.archive_unexpected_file", $"Archive file is not declared: {path}");
            }
            if (IsLinkOrReparsePoint(entry))
            {
                throw new InstallerException("asset.archive_link_forbidden", $"Archive link is forbidden: {path}");
            }
            if (entry.Length != file.SizeBytes)
            {
                throw new InstallerException("asset.payload_size_mismatch", $"Archive file size mismatch: {path}");
            }
            expandedBytes = checked(expandedBytes + entry.Length);
            if (expandedBytes > maxExpandedBytes)
            {
                throw new InstallerException("asset.archive_expanded_size_exceeded", "Archive expanded size exceeds policy");
            }

            var target = ResolveOutputPath(outputRoot, file.InstallPath);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await using (var input = entry.Open())
            await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 64, true))
            {
                await input.CopyToAsync(output, cancellationToken);
                await output.FlushAsync(cancellationToken);
                output.Flush(flushToDisk: true);
            }
            await VerifyOutputAsync(target, file, cancellationToken);
        }
        var missing = declared.Keys.Where(path => !seen.Contains(path)).ToArray();
        if (missing.Length > 0)
        {
            throw new InstallerException("asset.archive_declared_file_missing", $"Archive is missing declared file: {missing[0]}");
        }
    }

    public async Task VerifyMaterializedAsync(MaterializedAsset asset, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(asset.Root))
        {
            throw new InstallerException("asset.activation_incomplete", $"Materialized asset root is missing: {asset.Id}");
        }
        foreach (var file in asset.Files)
        {
            var path = ResolveOutputPath(asset.Root, file.Path);
            await AssetCache.VerifyFileAsync(
                path,
                file.SizeBytes,
                file.Sha256,
                "asset.payload_size_mismatch",
                "asset.payload_hash_mismatch",
                cancellationToken);
        }
        if (!File.Exists(asset.EntryPoint))
        {
            throw new InstallerException("asset.activation_incomplete", $"Asset entry point is missing: {asset.Id}");
        }
    }

    private static async Task VerifyOutputAsync(
        string target,
        AssetContentFile file,
        CancellationToken cancellationToken)
    {
        await AssetCache.VerifyFileAsync(
            target,
            file.SizeBytes,
            file.Sha256,
            "asset.payload_size_mismatch",
            "asset.payload_hash_mismatch",
            cancellationToken);
    }

    private static bool IsLinkOrReparsePoint(ZipArchiveEntry entry)
    {
        var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
        var windowsAttributes = (FileAttributes)(entry.ExternalAttributes & 0xFFFF);
        return unixType == 0xA000 || windowsAttributes.HasFlag(FileAttributes.ReparsePoint);
    }

    private static string NormalizeArchivePath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || Path.IsPathRooted(value))
        {
            throw new InstallerException("asset.archive_path_invalid", $"Archive path is invalid: {value}");
        }
        var normalized = value.Replace('\\', '/');
        if (normalized.Length >= 2 && char.IsLetter(normalized[0]) && normalized[1] == ':')
        {
            throw new InstallerException("asset.archive_path_invalid", $"Archive path is invalid: {value}");
        }
        var segments = normalized.Split('/');
        if (segments.Any(segment => string.IsNullOrEmpty(segment) || segment is "." or ".." || segment.Contains(':')))
        {
            throw new InstallerException("asset.archive_path_invalid", $"Archive path is invalid: {value}");
        }
        return string.Join('/', segments);
    }

    private static string ResolveOutputPath(string root, string relativePath)
    {
        var normalizedRoot = Path.GetFullPath(root);
        var normalized = NormalizeArchivePath(relativePath);
        var fullPath = Path.GetFullPath(Path.Combine(normalizedRoot, normalized.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = normalizedRoot.EndsWith(Path.DirectorySeparatorChar)
            ? normalizedRoot
            : normalizedRoot + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InstallerException("asset.archive_path_invalid", $"Archive path escapes root: {relativePath}");
        }
        return fullPath;
    }
}
