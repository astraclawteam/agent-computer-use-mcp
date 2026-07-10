using System.Text.Json;

namespace AgentComputerUse.Installer;

internal sealed class AssetStateStore(InstallerLayout layout, SafeZipMaterializer materializer)
{
    public void WritePrepared(AssetPreparedState state)
    {
        WriteAtomically(
            layout.GetPreparedAssetStatePath(state.ReleaseId),
            state,
            InstallerJsonContext.Default.AssetPreparedState);
    }

    public AssetPreparedState ReadPrepared(string releaseId)
    {
        var path = layout.GetPreparedAssetStatePath(releaseId);
        if (!File.Exists(path))
        {
            throw new InstallerException("asset.activation_incomplete", $"Prepared asset release is missing: {releaseId}");
        }
        return Read(path, InstallerJsonContext.Default.AssetPreparedState, "asset.prepared_state_invalid");
    }

    public AssetActivationState ReadActive()
    {
        if (!File.Exists(layout.AssetStatePath)) return new AssetActivationState();
        return Read(layout.AssetStatePath, InstallerJsonContext.Default.AssetActivationState, "asset.state_invalid");
    }

    public async Task<AssetActivationState> ActivateAsync(string releaseId, CancellationToken cancellationToken)
    {
        var prepared = ReadPrepared(releaseId);
        await VerifyPreparedAsync(prepared, cancellationToken);
        var current = ReadActive();
        if (string.Equals(current.CurrentReleaseId, releaseId, StringComparison.Ordinal)) return current;
        var next = new AssetActivationState
        {
            CurrentReleaseId = releaseId,
            PreviousReleaseId = current.CurrentReleaseId,
            Revision = checked(current.Revision + 1),
            ActivatedAt = DateTimeOffset.UtcNow.ToString("O"),
            Assets = prepared.Assets,
        };
        WriteAtomically(layout.AssetStatePath, next, InstallerJsonContext.Default.AssetActivationState);
        return next;
    }

    public async Task<AssetActivationState> RollbackAsync(CancellationToken cancellationToken)
    {
        var current = ReadActive();
        if (string.IsNullOrWhiteSpace(current.CurrentReleaseId) || string.IsNullOrWhiteSpace(current.PreviousReleaseId))
        {
            throw new InstallerException("asset.rollback_unavailable", "No previous asset release is available");
        }
        var previous = ReadPrepared(current.PreviousReleaseId);
        await VerifyPreparedAsync(previous, cancellationToken);
        var next = new AssetActivationState
        {
            CurrentReleaseId = current.PreviousReleaseId,
            PreviousReleaseId = current.CurrentReleaseId,
            Revision = checked(current.Revision + 1),
            ActivatedAt = DateTimeOffset.UtcNow.ToString("O"),
            Assets = previous.Assets,
        };
        WriteAtomically(layout.AssetStatePath, next, InstallerJsonContext.Default.AssetActivationState);
        return next;
    }

    private async Task VerifyPreparedAsync(AssetPreparedState state, CancellationToken cancellationToken)
    {
        if (state.SchemaVersion != 1 || state.Assets.Count == 0)
        {
            throw new InstallerException("asset.prepared_state_invalid", "Prepared asset state is invalid");
        }
        foreach (var asset in state.Assets)
        {
            await materializer.VerifyMaterializedAsync(asset, cancellationToken);
        }
    }

    private static T Read<T>(
        string path,
        System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo,
        string code)
    {
        try
        {
            return JsonSerializer.Deserialize(File.ReadAllText(path), typeInfo)
                ?? throw new InstallerException(code, "State file is empty");
        }
        catch (JsonException error)
        {
            throw new InstallerException(code, error.Message);
        }
    }

    private static void WriteAtomically<T>(
        string path,
        T value,
        System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, value, typeInfo);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
