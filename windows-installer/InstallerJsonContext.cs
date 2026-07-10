using System.Text.Json.Serialization;

namespace AgentComputerUse.Installer;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(ReleaseManifest))]
[JsonSerializable(typeof(InstallState))]
[JsonSerializable(typeof(InstallerResult))]
[JsonSerializable(typeof(AssetManifest))]
[JsonSerializable(typeof(AssetSignatureEnvelope))]
[JsonSerializable(typeof(AssetTrustKeyring))]
[JsonSerializable(typeof(AssetVerificationResult))]
[JsonSerializable(typeof(AssetOperationResult))]
[JsonSerializable(typeof(AssetProgressEvent))]
[JsonSerializable(typeof(AssetPreparedState))]
[JsonSerializable(typeof(AssetActivationState))]
[JsonSerializable(typeof(AssetResumeMetadata))]
internal partial class InstallerJsonContext : JsonSerializerContext;
