using System.Text.Json;

namespace AgentComputerUse.Installer;

internal static class Program
{
    private static int Main(string[] args)
    {
        var operation = args.Length > 0 ? args[0] : "unknown";
        InstallerLayout? layout = null;
        try
        {
            var options = ParseOptions(args.Skip(1).ToArray());
            layout = InstallerLayout.FromOptions(options);
            var engine = new InstallerEngine(layout, new ReleaseVerifier());
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
}
