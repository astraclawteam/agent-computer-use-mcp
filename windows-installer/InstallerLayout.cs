namespace AgentComputerUse.Installer;

internal sealed class InstallerLayout
{
    public InstallerLayout(string programRoot, string dataRoot)
    {
        ProgramRoot = Path.GetFullPath(programRoot);
        DataRoot = Path.GetFullPath(dataRoot);
        ReleasesRoot = Path.Combine(ProgramRoot, "releases");
        StateRoot = Path.Combine(ProgramRoot, "state");
        StatePath = Path.Combine(StateRoot, "install-state.json");
        TransactionsRoot = Path.Combine(ProgramRoot, "transactions");
        CacheAssetsRoot = Path.Combine(ProgramRoot, "cache", "assets");
        CacheDownloadsRoot = Path.Combine(ProgramRoot, "cache", "downloads");
    }

    public string ProgramRoot { get; }
    public string DataRoot { get; }
    public string ReleasesRoot { get; }
    public string StateRoot { get; }
    public string StatePath { get; }
    public string TransactionsRoot { get; }
    public string CacheAssetsRoot { get; }
    public string CacheDownloadsRoot { get; }

    public void Initialize()
    {
        foreach (var path in new[]
        {
            ReleasesRoot,
            StateRoot,
            TransactionsRoot,
            CacheAssetsRoot,
            CacheDownloadsRoot,
            Path.Combine(DataRoot, "artifacts"),
            Path.Combine(DataRoot, "logs"),
            Path.Combine(DataRoot, "traces"),
            Path.Combine(DataRoot, "models"),
            Path.Combine(DataRoot, "runtime"),
        })
        {
            Directory.CreateDirectory(path);
        }
    }

    public string GetReleaseRoot(string version) => Path.Combine(ReleasesRoot, version);

    public string CreateTransactionRoot() => Path.Combine(TransactionsRoot, Guid.NewGuid().ToString("N"));

    public static InstallerLayout FromOptions(IReadOnlyDictionary<string, string> options)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
        {
            throw new InstallerException("installer.local_app_data_unavailable", "LOCALAPPDATA is unavailable");
        }

        var programRoot = options.GetValueOrDefault(
            "program-root",
            Path.Combine(localAppData, "Programs", "AgentComputerUse"));
        var dataRoot = options.GetValueOrDefault(
            "data-root",
            Path.Combine(localAppData, "AgentComputerUse"));
        return new InstallerLayout(programRoot, dataRoot);
    }
}
