using System.Text.Json.Serialization;

namespace AgentComputerUse.Installer;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = true)]
[JsonSerializable(typeof(ReleaseManifest))]
[JsonSerializable(typeof(InstallState))]
[JsonSerializable(typeof(InstallerResult))]
[JsonSerializable(typeof(AssetManifest))]
[JsonSerializable(typeof(AssetSignatureEnvelope))]
[JsonSerializable(typeof(AssetTrustKeyring))]
[JsonSerializable(typeof(AssetVerificationResult))]
[JsonSerializable(typeof(AssetOperationResult))]
[JsonSerializable(typeof(AssetPreparedState))]
[JsonSerializable(typeof(AssetActivationState))]
internal partial class InstallerJsonContext : JsonSerializerContext;
