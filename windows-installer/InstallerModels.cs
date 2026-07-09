namespace AgentComputerUse.Installer;

internal sealed class ReleaseManifest
{
    public int SchemaVersion { get; set; }
    public string PackageName { get; set; } = "";
    public string Version { get; set; } = "";
    public string GeneratedAt { get; set; } = "";
    public List<ReleaseFile> Files { get; set; } = [];
}

internal sealed class ReleaseFile
{
    public string Path { get; set; } = "";
    public long Bytes { get; set; }
    public string Sha256 { get; set; } = "";
}

internal sealed class InstallState
{
    public int SchemaVersion { get; set; } = 1;
    public string? CurrentVersion { get; set; }
    public string? PreviousVersion { get; set; }
    public long Revision { get; set; }
    public string ActivatedAt { get; set; } = "";
}

internal sealed class InstallerResult
{
    public string Status { get; set; } = "";
    public string Operation { get; set; } = "";
    public string? CurrentVersion { get; set; }
    public string? PreviousVersion { get; set; }
    public long Revision { get; set; }
    public string? ActivePayloadRoot { get; set; }
    public string ProgramRoot { get; set; } = "";
    public string DataRoot { get; set; } = "";
    public bool StartsDesktopControl { get; set; }
    public bool IncludeUserOverlay { get; set; }
    public InstallerErrorInfo? Error { get; set; }
}

internal sealed class InstallerErrorInfo
{
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
}

internal sealed record VerifiedRelease(
    ReleaseManifest Manifest,
    string ReleaseRoot,
    string PayloadRoot);

internal sealed class InstallerException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
