using System.Text.Json;

namespace AgentComputerUse.Installer;

internal sealed class InstallerEngine(InstallerLayout layout, ReleaseVerifier verifier)
{
    public InstallerResult Apply(string operation, string bundleRoot)
    {
        layout.Initialize();
        var sourceRelease = verifier.Verify(bundleRoot);
        var current = ReadState();
        ValidateOperation(operation, current, sourceRelease.Manifest.Version);

        if (string.Equals(current.CurrentVersion, sourceRelease.Manifest.Version, StringComparison.Ordinal))
        {
            verifier.Verify(layout.GetReleaseRoot(sourceRelease.Manifest.Version));
            return BuildResult("installed", operation, current);
        }

        var finalReleaseRoot = layout.GetReleaseRoot(sourceRelease.Manifest.Version);
        var transactionRoot = layout.CreateTransactionRoot();
        var movedToFinal = false;
        try
        {
            CopyRelease(sourceRelease, transactionRoot);
            verifier.Verify(transactionRoot);

            if (Directory.Exists(finalReleaseRoot))
            {
                verifier.Verify(finalReleaseRoot);
                Directory.Delete(transactionRoot, recursive: true);
            }
            else
            {
                Directory.Move(transactionRoot, finalReleaseRoot);
                movedToFinal = true;
            }

            var next = new InstallState
            {
                SchemaVersion = 1,
                CurrentVersion = sourceRelease.Manifest.Version,
                PreviousVersion = current.CurrentVersion,
                Revision = checked(current.Revision + 1),
                ActivatedAt = DateTimeOffset.UtcNow.ToString("O"),
            };
            WriteState(next);
            movedToFinal = false;
            return BuildResult("installed", operation, next);
        }
        catch
        {
            if (movedToFinal && Directory.Exists(finalReleaseRoot))
            {
                Directory.Delete(finalReleaseRoot, recursive: true);
            }
            throw;
        }
        finally
        {
            if (Directory.Exists(transactionRoot))
            {
                Directory.Delete(transactionRoot, recursive: true);
            }
        }
    }

    public InstallerResult Rollback()
    {
        layout.Initialize();
        var current = ReadState();
        if (string.IsNullOrWhiteSpace(current.CurrentVersion) || string.IsNullOrWhiteSpace(current.PreviousVersion))
        {
            throw new InstallerException("installer.rollback_unavailable", "No previous verified release is available");
        }

        verifier.Verify(layout.GetReleaseRoot(current.CurrentVersion));
        verifier.Verify(layout.GetReleaseRoot(current.PreviousVersion));
        var next = new InstallState
        {
            SchemaVersion = 1,
            CurrentVersion = current.PreviousVersion,
            PreviousVersion = current.CurrentVersion,
            Revision = checked(current.Revision + 1),
            ActivatedAt = DateTimeOffset.UtcNow.ToString("O"),
        };
        WriteState(next);
        return BuildResult("rolled_back", "rollback", next);
    }

    public InstallerResult Status()
    {
        layout.Initialize();
        var state = ReadState();
        if (!string.IsNullOrWhiteSpace(state.CurrentVersion))
        {
            verifier.Verify(layout.GetReleaseRoot(state.CurrentVersion));
        }
        return BuildResult("ready", "status", state);
    }

    private InstallState ReadState()
    {
        if (!File.Exists(layout.StatePath))
        {
            return new InstallState { ActivatedAt = "" };
        }
        try
        {
            var state = JsonSerializer.Deserialize(
                File.ReadAllText(layout.StatePath),
                InstallerJsonContext.Default.InstallState)
                ?? throw new InstallerException("installer.state_invalid", "Install state is empty");
            if (state.SchemaVersion != 1 || state.Revision < 0)
            {
                throw new InstallerException("installer.state_invalid", "Install state schema or revision is invalid");
            }
            return state;
        }
        catch (JsonException error)
        {
            throw new InstallerException("installer.state_invalid", error.Message);
        }
    }

    private void WriteState(InstallState state)
    {
        var temporaryPath = Path.Combine(layout.StateRoot, $"install-state.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 4096,
                FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, state, InstallerJsonContext.Default.InstallState);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, layout.StatePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static void CopyRelease(VerifiedRelease source, string targetRoot)
    {
        Directory.CreateDirectory(Path.Combine(targetRoot, "payload"));
        File.Copy(
            Path.Combine(source.ReleaseRoot, "release-manifest.json"),
            Path.Combine(targetRoot, "release-manifest.json"));
        foreach (var file in source.Manifest.Files)
        {
            var sourcePath = Path.Combine(source.PayloadRoot, file.Path.Replace('/', Path.DirectorySeparatorChar));
            var targetPath = Path.Combine(targetRoot, "payload", file.Path.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            File.Copy(sourcePath, targetPath);
        }
    }

    private static void ValidateOperation(string operation, InstallState state, string version)
    {
        if (operation == "install" && !string.IsNullOrWhiteSpace(state.CurrentVersion)
            && !string.Equals(state.CurrentVersion, version, StringComparison.Ordinal))
        {
            throw new InstallerException("installer.already_installed", "Use upgrade to activate a different version");
        }
        if (operation == "upgrade" && string.IsNullOrWhiteSpace(state.CurrentVersion))
        {
            throw new InstallerException("installer.not_installed", "Install a release before upgrading");
        }
    }

    private InstallerResult BuildResult(string status, string operation, InstallState state)
    {
        return new InstallerResult
        {
            Status = status,
            Operation = operation,
            CurrentVersion = state.CurrentVersion,
            PreviousVersion = state.PreviousVersion,
            Revision = state.Revision,
            ActivePayloadRoot = string.IsNullOrWhiteSpace(state.CurrentVersion)
                ? null
                : Path.Combine(layout.GetReleaseRoot(state.CurrentVersion), "payload"),
            ProgramRoot = layout.ProgramRoot,
            DataRoot = layout.DataRoot,
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
        };
    }
}
