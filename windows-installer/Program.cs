using System.Text.Json;

namespace AgentComputerUse.Installer;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        var operation = args.Length > 0 ? args[0] : "unknown";
        InstallerLayout? layout = null;
        try
        {
            var options = ParseOptions(args.Skip(1).ToArray());
            layout = InstallerLayout.FromOptions(options);
            var engine = new InstallerEngine(layout, new ReleaseVerifier());
            if (operation == "asset-verify-manifest")
            {
                var verified = new AssetManifestVerifier().Verify(
                    RequireOption(options, "manifest"),
                    RequireOption(options, "signature"),
                    RequireOption(options, "trust-keyring"));
                WriteResult(new AssetVerificationResult
                {
                    Status = "verified",
                    Operation = operation,
                    ReleaseId = verified.Manifest.ReleaseId,
                    ManifestSha256 = verified.ManifestSha256,
                    AssetCount = verified.Manifest.Assets.Count,
                    StartsDesktopControl = false,
                    IncludeUserOverlay = false,
                });
                return 0;
            }
            if (operation.StartsWith("asset-", StringComparison.Ordinal))
            {
                var materializer = new SafeZipMaterializer();
                var assetCache = new AssetCache(layout);
                var sourcePolicy = new AssetSourcePolicy();
                var assetEngine = new AssetEngine(
                    layout,
                    new AssetManifestVerifier(),
                    assetCache,
                    new AssetDownloader(layout, assetCache, sourcePolicy),
                    materializer,
                    new AuthenticodeVerifier(),
                    new AssetStateStore(layout, materializer));
                var operationId = options.GetValueOrDefault("operation-id", $"{operation}-{Guid.NewGuid():N}");
                var assetResult = operation switch
                {
                    "asset-prepare" => await assetEngine.PrepareAsync(
                        RequireOption(options, "manifest"),
                        RequireOption(options, "signature"),
                        RequireOption(options, "trust-keyring"),
                        options.GetValueOrDefault("offline-root", ""),
                        ParseAssetIds(options.GetValueOrDefault("asset-ids", "")),
                        operationId,
                        string.Equals(options.GetValueOrDefault("allow-network"), "true", StringComparison.Ordinal),
                        CancellationToken.None),
                    "asset-activate" => await assetEngine.ActivateAsync(
                        RequireOption(options, "release-id"),
                        operationId,
                        CancellationToken.None),
                    "asset-status" => assetEngine.Status(operationId),
                    "asset-rollback" => await assetEngine.RollbackAsync(operationId, CancellationToken.None),
                    _ => throw new InstallerException("installer.operation_invalid", $"Unsupported operation: {operation}"),
                };
                AssetProgressWriter.WriteTerminal(assetResult);
                return 0;
            }
            var result = operation switch
            {
                "install" or "upgrade" => engine.Apply(operation, RequireOption(options, "bundle")),
                "rollback" => engine.Rollback(),
                "status" => engine.Status(),
                _ => throw new InstallerException("installer.operation_invalid", $"Unsupported operation: {operation}"),
            };
            WriteResult(result);
            return 0;
        }
        catch (InstallerException error)
        {
            WriteResult(FailedResult(operation, layout, error.Code, error.Message));
            return 2;
        }
        catch (Exception error)
        {
            WriteResult(FailedResult(operation, layout, "installer.internal_error", error.Message));
            return 2;
        }
    }

    private static Dictionary<string, string> ParseOptions(string[] args)
    {
        if (args.Length % 2 != 0)
        {
            throw new InstallerException("installer.arguments_invalid", "Options must be --name value pairs");
        }
        var options = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index += 2)
        {
            var key = args[index];
            if (!key.StartsWith("--", StringComparison.Ordinal) || key.Length == 2)
            {
                throw new InstallerException("installer.arguments_invalid", $"Invalid option: {key}");
            }
            key = key[2..];
            if (!options.TryAdd(key, args[index + 1]))
            {
                throw new InstallerException("installer.arguments_invalid", $"Duplicate option: --{key}");
            }
        }
        return options;
    }

    private static string RequireOption(IReadOnlyDictionary<string, string> options, string name)
    {
        if (!options.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value))
        {
            throw new InstallerException("installer.argument_missing", $"Missing required option: --{name}");
        }
        return value;
    }

    private static IReadOnlySet<string> ParseAssetIds(string value)
    {
        return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static InstallerResult FailedResult(
        string operation,
        InstallerLayout? layout,
        string code,
        string message)
    {
        return new InstallerResult
        {
            Status = "failed",
            Operation = operation,
            ProgramRoot = layout?.ProgramRoot ?? "",
            DataRoot = layout?.DataRoot ?? "",
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
            Error = new InstallerErrorInfo { Code = code, Message = message },
        };
    }

    private static void WriteResult(InstallerResult result)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(result, InstallerJsonContext.Default.InstallerResult));
    }

    private static void WriteResult(AssetVerificationResult result)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(result, InstallerJsonContext.Default.AssetVerificationResult));
    }
}
