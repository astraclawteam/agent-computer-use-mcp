using System.Text.Json.Serialization;

namespace AgentComputerUse.Installer;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = true)]
[JsonSerializable(typeof(ReleaseManifest))]
[JsonSerializable(typeof(InstallState))]
[JsonSerializable(typeof(InstallerResult))]
internal partial class InstallerJsonContext : JsonSerializerContext;
