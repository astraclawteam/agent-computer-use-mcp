namespace AgentComputerUse.Installer;

internal sealed class AssetEngine(
    InstallerLayout layout,
    AssetManifestVerifier manifestVerifier,
    AssetCache cache,
    AssetDownloader downloader,
    SafeZipMaterializer materializer,
    AuthenticodeVerifier authenticodeVerifier,
    AssetStateStore stateStore)
{
    public async Task<AssetOperationResult> PrepareAsync(
        string manifestPath,
        string signaturePath,
        string keyringPath,
        string offlineRoot,
        IReadOnlySet<string> selectedIds,
        string operationId,
        bool allowNetwork,
        CancellationToken cancellationToken)
    {
        layout.Initialize();
        var verified = manifestVerifier.Verify(manifestPath, signaturePath, keyringPath);
        var selected = selectedIds.Count == 0
            ? verified.Manifest.Assets
            : verified.Manifest.Assets.Where(asset => selectedIds.Contains(asset.Id)).ToList();
        if (selected.Count == 0 || selected.Count != selectedIds.Count && selectedIds.Count > 0)
        {
            throw new InstallerException("asset.selection_invalid", "Selected asset IDs are not present in the manifest");
        }

        var transactionRoot = Path.Combine(layout.TransactionsRoot, $"asset-{Guid.NewGuid():N}");
        var preparedAssets = new List<MaterializedAsset>();
        var cacheHitCount = 0;
        var cacheMissCount = 0;
        var resumeUsed = false;
        Directory.CreateDirectory(transactionRoot);
        try
        {
            foreach (var asset in selected)
            {
                cancellationToken.ThrowIfCancellationRequested();
                CachedAssetBlob blob;
                if (cache.OfflineBlobExists(asset, offlineRoot))
                {
                    blob = await cache.ImportOfflineAsync(asset, offlineRoot, transactionRoot, cancellationToken);
                }
                else if (allowNetwork)
                {
                    blob = await downloader.DownloadAsync(verified.Manifest, asset, cancellationToken);
                }
                else
                {
                    throw new InstallerException("asset.offline_blob_missing", $"Offline blob is missing: {asset.Id}");
                }
                if (blob.CacheHit) cacheHitCount += 1;
                else cacheMissCount += 1;
                resumeUsed |= blob.ResumeUsed;
                preparedAssets.Add(await MaterializeAssetAsync(asset, blob.Path, transactionRoot, cancellationToken));
            }

            var cachedManifest = CacheManifestFiles(verified, keyringPath);
            var prepared = new AssetPreparedState
            {
                ReleaseId = verified.Manifest.ReleaseId,
                ManifestSha256 = verified.ManifestSha256,
                ManifestPath = cachedManifest.ManifestPath,
                SignaturePath = cachedManifest.SignaturePath,
                KeyringPath = cachedManifest.KeyringPath,
                PreparedAt = DateTimeOffset.UtcNow.ToString("O"),
                Assets = preparedAssets,
            };
            stateStore.WritePrepared(prepared);
            return BuildResult("prepared", "asset-prepare", operationId, prepared, stateStore.ReadActive(), cacheHitCount, cacheMissCount, resumeUsed);
        }
        finally
        {
            if (Directory.Exists(transactionRoot)) Directory.Delete(transactionRoot, recursive: true);
        }
    }

    public async Task<AssetOperationResult> ActivateAsync(string releaseId, string operationId, CancellationToken cancellationToken)
    {
        layout.Initialize();
        var state = await stateStore.ActivateAsync(releaseId, cancellationToken);
        var prepared = stateStore.ReadPrepared(releaseId);
        return BuildResult("activated", "asset-activate", operationId, prepared, state, 0, 0, false);
    }

    public AssetOperationResult Status(string operationId)
    {
        layout.Initialize();
        var state = stateStore.ReadActive();
        return new AssetOperationResult
        {
            Status = "ready",
            Operation = "asset-status",
            OperationId = operationId,
            CurrentReleaseId = state.CurrentReleaseId,
            PreviousReleaseId = state.PreviousReleaseId,
            Revision = state.Revision,
            Assets = state.Assets,
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
        };
    }

    public async Task<AssetOperationResult> RollbackAsync(string operationId, CancellationToken cancellationToken)
    {
        layout.Initialize();
        var state = await stateStore.RollbackAsync(cancellationToken);
        var prepared = stateStore.ReadPrepared(state.CurrentReleaseId!);
        return BuildResult("rolled_back", "asset-rollback", operationId, prepared, state, 0, 0, false);
    }

    private async Task<MaterializedAsset> MaterializeAssetAsync(
        AssetEntry asset,
        string blobPath,
        string transactionRoot,
        CancellationToken cancellationToken)
    {
        var versionRoot = Path.Combine(layout.AssetsRoot, asset.Id, asset.Version);
        var finalRoot = layout.GetAssetVersionRoot(asset.Id, asset.Version, asset.Source.Sha256);
        if (Directory.Exists(versionRoot))
        {
            var existing = Directory.EnumerateDirectories(versionRoot)
                .Where(path => !string.Equals(Path.GetFullPath(path), Path.GetFullPath(finalRoot), StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (existing.Length > 0)
            {
                throw new InstallerException("asset.version_conflict", $"Asset version has a different payload: {asset.Id}@{asset.Version}");
            }
        }

        var materialized = BuildMaterializedAsset(asset, finalRoot);
        if (Directory.Exists(finalRoot))
        {
            await materializer.VerifyMaterializedAsync(materialized, cancellationToken);
            VerifyWindowsTrust(asset, finalRoot);
            return materialized;
        }

        var stagedRoot = Path.Combine(transactionRoot, "materialized", asset.Id);
        await materializer.MaterializeAsync(asset, blobPath, stagedRoot, cancellationToken);
        var staged = BuildMaterializedAsset(asset, stagedRoot);
        await materializer.VerifyMaterializedAsync(staged, cancellationToken);
        VerifyWindowsTrust(asset, stagedRoot);
        Directory.CreateDirectory(Path.GetDirectoryName(finalRoot)!);
        try
        {
            Directory.Move(stagedRoot, finalRoot);
        }
        catch (IOException) when (Directory.Exists(finalRoot))
        {
            await materializer.VerifyMaterializedAsync(materialized, cancellationToken);
        }
        return materialized;
    }

    private void VerifyWindowsTrust(AssetEntry asset, string root)
    {
        if (string.Equals(asset.Authenticode.Mode, "vendor-unsigned", StringComparison.Ordinal)) return;
        foreach (var file in asset.Content.Files.Where(file => file.Executable))
        {
            var path = Path.Combine(root, file.InstallPath.Replace('/', Path.DirectorySeparatorChar));
            authenticodeVerifier.Verify(path, asset.Authenticode);
        }
    }

    private (string ManifestPath, string SignaturePath, string KeyringPath) CacheManifestFiles(
        VerifiedAssetManifest verified,
        string keyringPath)
    {
        var root = layout.GetCachedManifestRoot(verified.Manifest.ReleaseId);
        Directory.CreateDirectory(root);
        var targetManifest = Path.Combine(root, "asset-manifest.json");
        var targetSignature = Path.Combine(root, "asset-manifest.sig");
        var targetKeyring = Path.Combine(root, "asset-keyring.json");
        CopyExact(verified.ManifestPath, targetManifest);
        CopyExact(verified.SignaturePath, targetSignature);
        CopyExact(keyringPath, targetKeyring);
        manifestVerifier.Verify(targetManifest, targetSignature, targetKeyring);
        return (targetManifest, targetSignature, targetKeyring);
    }

    private static void CopyExact(string source, string target)
    {
        if (File.Exists(target))
        {
            if (!File.ReadAllBytes(source).AsSpan().SequenceEqual(File.ReadAllBytes(target)))
            {
                throw new InstallerException("asset.version_conflict", $"Cached manifest file conflicts: {Path.GetFileName(target)}");
            }
            return;
        }
        File.Copy(source, target);
    }

    private static MaterializedAsset BuildMaterializedAsset(AssetEntry asset, string root)
    {
        return new MaterializedAsset
        {
            Id = asset.Id,
            Version = asset.Version,
            BlobSha256 = asset.Source.Sha256,
            Root = root,
            EntryPoint = Path.Combine(root, asset.Install.EntryPoint.Replace('/', Path.DirectorySeparatorChar)),
            Files = asset.Content.Files.Select(file => new MaterializedAssetFile
            {
                Path = file.InstallPath,
                SizeBytes = file.SizeBytes,
                Sha256 = file.Sha256,
            }).ToList(),
        };
    }

    private static AssetOperationResult BuildResult(
        string status,
        string operation,
        string operationId,
        AssetPreparedState prepared,
        AssetActivationState active,
        int cacheHitCount,
        int cacheMissCount,
        bool resumeUsed)
    {
        return new AssetOperationResult
        {
            Status = status,
            Operation = operation,
            OperationId = operationId,
            ReleaseId = prepared.ReleaseId,
            CurrentReleaseId = active.CurrentReleaseId,
            PreviousReleaseId = active.PreviousReleaseId,
            Revision = active.Revision,
            ManifestSha256 = prepared.ManifestSha256,
            CacheHitCount = cacheHitCount,
            CacheMissCount = cacheMissCount,
            ResumeUsed = resumeUsed,
            Assets = operation == "asset-prepare" ? prepared.Assets : active.Assets,
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
        };
    }
}
