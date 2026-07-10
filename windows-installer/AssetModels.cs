namespace AgentComputerUse.Installer;

internal sealed class AssetManifest
{
    public int SchemaVersion { get; set; }
    public string PackageName { get; set; } = "";
    public string PackageVersion { get; set; } = "";
    public string ReleaseId { get; set; } = "";
    public string GeneratedAt { get; set; } = "";
    public string ExpiresAt { get; set; } = "";
    public bool DevelopmentOnly { get; set; }
    public AssetSigningInfo Signing { get; set; } = new();
    public List<AssetEntry> Assets { get; set; } = [];
}

internal sealed class AssetSigningInfo
{
    public string Algorithm { get; set; } = "";
    public string KeyId { get; set; } = "";
}

internal sealed class AssetEntry
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Version { get; set; } = "";
    public AssetPlatform Platform { get; set; } = new();
    public bool RequiredBeforeFirstEnable { get; set; }
    public AssetSource Source { get; set; } = new();
    public AssetContent Content { get; set; } = new();
    public AssetProvenance Provenance { get; set; } = new();
    public AssetAuthenticodePolicy Authenticode { get; set; } = new();
    public AssetInstall Install { get; set; } = new();
}

internal sealed class AssetPlatform
{
    public string Os { get; set; } = "";
    public string Arch { get; set; } = "";
}

internal sealed class AssetSource
{
    public string Kind { get; set; } = "";
    public List<string> Urls { get; set; } = [];
    public string FileName { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
}

internal sealed class AssetContent
{
    public string Format { get; set; } = "";
    public List<AssetContentFile> Files { get; set; } = [];
}

internal sealed class AssetContentFile
{
    public string Path { get; set; } = "";
    public string InstallPath { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
    public bool Executable { get; set; }
}

internal sealed class AssetProvenance
{
    public string Class { get; set; } = "";
    public string Repository { get; set; } = "";
    public string Tag { get; set; } = "";
    public string AssetName { get; set; } = "";
    public string UpstreamSha256 { get; set; } = "";
}

internal sealed class AssetAuthenticodePolicy
{
    public string Mode { get; set; } = "";
    public string? Publisher { get; set; }
    public bool TimestampRequired { get; set; }
}

internal sealed class AssetInstall
{
    public string View { get; set; } = "";
    public string EntryPoint { get; set; } = "";
}

internal sealed class AssetSignatureEnvelope
{
    public int SchemaVersion { get; set; }
    public string Algorithm { get; set; } = "";
    public string KeyId { get; set; } = "";
    public string Signature { get; set; } = "";
}

internal sealed class AssetTrustKeyring
{
    public int SchemaVersion { get; set; }
    public List<AssetTrustKey> Keys { get; set; } = [];
}

internal sealed class AssetTrustKey
{
    public string KeyId { get; set; } = "";
    public string Algorithm { get; set; } = "";
    public string PublicKeyPem { get; set; } = "";
    public string Status { get; set; } = "";
}

internal sealed class AssetVerificationResult
{
    public string Status { get; set; } = "";
    public string Operation { get; set; } = "";
    public string ReleaseId { get; set; } = "";
    public string ManifestSha256 { get; set; } = "";
    public int AssetCount { get; set; }
    public bool StartsDesktopControl { get; set; }
    public bool IncludeUserOverlay { get; set; }
}

internal sealed class AssetOperationResult
{
    public string Type { get; set; } = "terminal";
    public string Status { get; set; } = "";
    public string Operation { get; set; } = "";
    public string OperationId { get; set; } = "";
    public int Sequence { get; set; }
    public string State { get; set; } = "";
    public int Percent { get; set; } = 100;
    public bool Terminal { get; set; } = true;
    public string? ReleaseId { get; set; }
    public string? CurrentReleaseId { get; set; }
    public string? PreviousReleaseId { get; set; }
    public long Revision { get; set; }
    public string? ManifestSha256 { get; set; }
    public int CacheHitCount { get; set; }
    public int CacheMissCount { get; set; }
    public bool ResumeUsed { get; set; }
    public List<MaterializedAsset> Assets { get; set; } = [];
    public bool StartsDesktopControl { get; set; }
    public bool IncludeUserOverlay { get; set; }
    public InstallerErrorInfo? Error { get; set; }
}

internal sealed class AssetProgressEvent
{
    public string Type { get; set; } = "progress";
    public string Operation { get; set; } = "";
    public string OperationId { get; set; } = "";
    public int Sequence { get; set; }
    public string State { get; set; } = "";
    public int Percent { get; set; }
    public string? AssetId { get; set; }
    public bool Terminal { get; set; }
    public bool StartsDesktopControl { get; set; }
    public bool IncludeUserOverlay { get; set; }
}

internal sealed class AssetPreparedState
{
    public int SchemaVersion { get; set; } = 1;
    public string ReleaseId { get; set; } = "";
    public string ManifestSha256 { get; set; } = "";
    public string ManifestPath { get; set; } = "";
    public string SignaturePath { get; set; } = "";
    public string KeyringPath { get; set; } = "";
    public string PreparedAt { get; set; } = "";
    public List<MaterializedAsset> Assets { get; set; } = [];
}

internal sealed class AssetActivationState
{
    public int SchemaVersion { get; set; } = 1;
    public string? CurrentReleaseId { get; set; }
    public string? PreviousReleaseId { get; set; }
    public long Revision { get; set; }
    public string ActivatedAt { get; set; } = "";
    public List<MaterializedAsset> Assets { get; set; } = [];
}

internal sealed class MaterializedAsset
{
    public string Id { get; set; } = "";
    public string Version { get; set; } = "";
    public string BlobSha256 { get; set; } = "";
    public string Root { get; set; } = "";
    public string EntryPoint { get; set; } = "";
    public List<MaterializedAssetFile> Files { get; set; } = [];
}

internal sealed class MaterializedAssetFile
{
    public string Path { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
}

internal sealed class AssetResumeMetadata
{
    public int SchemaVersion { get; set; } = 1;
    public string SourceUrl { get; set; } = "";
    public string ExpectedSha256 { get; set; } = "";
    public long ExpectedSizeBytes { get; set; }
    public string? ETag { get; set; }
    public string? LastModified { get; set; }
    public long DownloadedBytes { get; set; }
}

internal sealed record VerifiedAssetManifest(
    AssetManifest Manifest,
    string ManifestSha256,
    string ManifestPath,
    string SignaturePath);

internal sealed record CachedAssetBlob(string Path, bool CacheHit, bool ResumeUsed = false);
