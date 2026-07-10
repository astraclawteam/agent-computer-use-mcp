using System.Text.Json;

namespace AgentComputerUse.Installer;

internal sealed class AssetProgressWriter(string operation, string operationId)
{
    private int sequence;

    public void WriteProgress(string state, int percent, string? assetId = null)
    {
        var progress = new AssetProgressEvent
        {
            Operation = operation,
            OperationId = operationId,
            Sequence = sequence++,
            State = state,
            Percent = Math.Clamp(percent, 0, 99),
            AssetId = assetId,
            Terminal = false,
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
        };
        Console.Out.WriteLine(JsonSerializer.Serialize(progress, InstallerJsonContext.Default.AssetProgressEvent));
    }

    public void WriteTerminal(AssetOperationResult result)
    {
        result.Type = "terminal";
        result.Sequence = sequence++;
        result.State = result.Status;
        result.Percent = result.Status == "failed" ? 0 : 100;
        result.Terminal = true;
        Console.Out.WriteLine(JsonSerializer.Serialize(result, InstallerJsonContext.Default.AssetOperationResult));
    }

    public void WriteFailure(string code, string message)
    {
        WriteTerminal(new AssetOperationResult
        {
            Status = "failed",
            Operation = operation,
            OperationId = operationId,
            StartsDesktopControl = false,
            IncludeUserOverlay = false,
            Error = new InstallerErrorInfo { Code = code, Message = message },
        });
    }
}
