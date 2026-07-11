export const OFFICIAL_CUA_DRIVER_WINDOWS_X64 = Object.freeze({
  version: "0.7.1",
  tag: "cua-driver-rs-v0.7.1",
  fileName: "cua-driver-rs-0.7.1-windows-x86_64.zip",
  url: "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.7.1/cua-driver-rs-0.7.1-windows-x86_64.zip",
  sizeBytes: 7762316,
  sha256: "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab",
  files: Object.freeze([
    Object.freeze({
      path: "cua-driver-rs-0.7.1-windows-x86_64/cua-driver.exe",
      installPath: "bin/cua-driver.exe",
      sizeBytes: 11498496,
      sha256: "6ee5565a36692ee4f4413bbd7336c390d28c7cbdf5c2ec7428024a2e719a54f7",
      executable: true,
    }),
    Object.freeze({
      path: "cua-driver-rs-0.7.1-windows-x86_64/cua-driver-uia.exe",
      installPath: "bin/cua-driver-uia.exe",
      sizeBytes: 7640576,
      sha256: "c6e6748f05fa74e68abbea53b8e8eff1fa981ab7085104f746dfb27a16baa5cd",
      executable: true,
    }),
  ]),
});

export function buildOfficialCuaDriverManifest(options = {}) {
  const release = OFFICIAL_CUA_DRIVER_WINDOWS_X64;
  return {
    schemaVersion: 2,
    packageName: "agent-computer-use-mcp",
    packageVersion: "0.0.1",
    releaseId: `platform-cua-driver-${release.version}-windows-x64`,
    generatedAt: options.generatedAt,
    expiresAt: options.expiresAt,
    developmentOnly: true,
    signing: { algorithm: "sha256-lock", keyId: options.keyId },
    assets: [{
      id: "cua-driver-windows-x64",
      kind: "driver",
      version: release.version,
      platform: { os: "win32", arch: "x64" },
      requiredBeforeFirstEnable: true,
      source: {
        kind: "release-build-only",
        urls: [release.url],
        fileName: release.fileName,
        sizeBytes: release.sizeBytes,
        sha256: release.sha256,
      },
      content: { format: "zip", files: release.files.map((file) => ({ ...file })) },
      provenance: {
        class: "third-party",
        repository: "trycua/cua",
        tag: release.tag,
        assetName: release.fileName,
        upstreamSha256: release.sha256,
      },
      authenticode: { mode: "vendor-unsigned", timestampRequired: false },
      install: { view: "platform-package", entryPoint: "cua-driver/cua-driver.exe" },
    }],
  };
}
