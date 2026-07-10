using System.Security.Cryptography;

namespace AgentComputerUse.Installer;

internal sealed class AssetCache(InstallerLayout layout)
{
    public bool OfflineBlobExists(AssetEntry asset, string? offlineRoot)
    {
        if (string.IsNullOrWhiteSpace(offlineRoot)) return false;
        var path = Path.Combine(Path.GetFullPath(offlineRoot), "blobs", "sha256", asset.Source.Sha256);
        return File.Exists(path);
    }

    public async Task<CachedAssetBlob?> TryGetCachedAsync(AssetEntry asset, CancellationToken cancellationToken)
    {
        var path = layout.GetAssetBlobPath(asset.Source.Sha256);
        if (!File.Exists(path)) return null;
        await VerifyFileAsync(
            path,
            asset.Source.SizeBytes,
            asset.Source.Sha256,
            "asset.download_size_mismatch",
            "asset.download_hash_mismatch",
            cancellationToken);
        return new CachedAssetBlob(path, CacheHit: true);
    }

    public async Task<CachedAssetBlob> PromoteDownloadedAsync(
        AssetEntry asset,
        string verifiedPartialPath,
        bool resumeUsed,
        CancellationToken cancellationToken)
    {
        await VerifyFileAsync(
            verifiedPartialPath,
            asset.Source.SizeBytes,
            asset.Source.Sha256,
            "asset.download_size_mismatch",
            "asset.download_hash_mismatch",
            cancellationToken);
        var cachePath = layout.GetAssetBlobPath(asset.Source.Sha256);
        Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
        try
        {
            File.Move(verifiedPartialPath, cachePath);
        }
        catch (IOException) when (File.Exists(cachePath))
        {
            File.Delete(verifiedPartialPath);
            await VerifyFileAsync(
                cachePath,
                asset.Source.SizeBytes,
                asset.Source.Sha256,
                "asset.download_size_mismatch",
                "asset.download_hash_mismatch",
                cancellationToken);
        }
        return new CachedAssetBlob(cachePath, CacheHit: false, ResumeUsed: resumeUsed);
    }

    public async Task<CachedAssetBlob> ImportOfflineAsync(
        AssetEntry asset,
        string offlineRoot,
        string transactionRoot,
        CancellationToken cancellationToken)
    {
        var sourcePath = ResolveInside(
            offlineRoot,
            Path.Combine("blobs", "sha256", asset.Source.Sha256),
            "asset.offline_blob_missing");
        await VerifyFileAsync(
            sourcePath,
            asset.Source.SizeBytes,
            asset.Source.Sha256,
            "asset.download_size_mismatch",
            "asset.download_hash_mismatch",
            cancellationToken);

        var cachePath = layout.GetAssetBlobPath(asset.Source.Sha256);
        if (File.Exists(cachePath))
        {
            await VerifyFileAsync(
                cachePath,
                asset.Source.SizeBytes,
                asset.Source.Sha256,
                "asset.download_size_mismatch",
                "asset.download_hash_mismatch",
                cancellationToken);
            return new CachedAssetBlob(cachePath, CacheHit: true);
        }

        var stagedPath = Path.Combine(transactionRoot, $"blob-{asset.Source.Sha256}");
        Directory.CreateDirectory(Path.GetDirectoryName(stagedPath)!);
        await CopyFileDurablyAsync(sourcePath, stagedPath, cancellationToken);
        await VerifyFileAsync(
            stagedPath,
            asset.Source.SizeBytes,
            asset.Source.Sha256,
            "asset.download_size_mismatch",
            "asset.download_hash_mismatch",
            cancellationToken);
        Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
        try
        {
            File.Move(stagedPath, cachePath);
        }
        catch (IOException) when (File.Exists(cachePath))
        {
            File.Delete(stagedPath);
            await VerifyFileAsync(
                cachePath,
                asset.Source.SizeBytes,
                asset.Source.Sha256,
                "asset.download_size_mismatch",
                "asset.download_hash_mismatch",
                cancellationToken);
        }
        return new CachedAssetBlob(cachePath, CacheHit: false);
    }

    public static async Task VerifyFileAsync(
        string path,
        long expectedSize,
        string expectedSha256,
        string sizeCode,
        string hashCode,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            throw new InstallerException("asset.offline_blob_missing", $"Asset blob is missing: {Path.GetFileName(path)}");
        }
        var info = new FileInfo(path);
        if (info.Length != expectedSize)
        {
            throw new InstallerException(sizeCode, $"Asset size mismatch: {Path.GetFileName(path)}");
        }
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 64,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        var actual = Convert.ToHexString(hash).ToLowerInvariant();
        if (!string.Equals(actual, expectedSha256, StringComparison.Ordinal))
        {
            throw new InstallerException(hashCode, $"Asset hash mismatch: {Path.GetFileName(path)}");
        }
    }

    private static string ResolveInside(string root, string relativePath, string code)
    {
        var normalizedRoot = Path.GetFullPath(root);
        var fullPath = Path.GetFullPath(Path.Combine(normalizedRoot, relativePath));
        var prefix = normalizedRoot.EndsWith(Path.DirectorySeparatorChar)
            ? normalizedRoot
            : normalizedRoot + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InstallerException(code, "Offline asset path escapes its root");
        }
        return fullPath;
    }

    private static async Task CopyFileDurablyAsync(string source, string target, CancellationToken cancellationToken)
    {
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 64, true);
        await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 64, true);
        await input.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
        output.Flush(flushToDisk: true);
    }
}
