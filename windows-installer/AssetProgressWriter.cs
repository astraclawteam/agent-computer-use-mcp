using System.Text.Json;

namespace AgentComputerUse.Installer;

internal static class AssetProgressWriter
{
    public static void WriteTerminal(AssetOperationResult result)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(result, InstallerJsonContext.Default.AssetOperationResult));
    }
}
