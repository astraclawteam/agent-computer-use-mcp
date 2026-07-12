const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;

export const WINDOWS_X64_TARGET = Object.freeze({
  platform: "win32",
  arch: "x64",
  id: "windows-x64",
});

const WINDOWS_X64_PACKAGE = "@xiaozhiclaw/agent-computer-use-win32-x64";

export function platformPackageName(target) {
  if (target?.platform === WINDOWS_X64_TARGET.platform
    && target?.arch === WINDOWS_X64_TARGET.arch
    && target?.id === WINDOWS_X64_TARGET.id) {
    return WINDOWS_X64_PACKAGE;
  }
  throw contractError("platform.unsupported_target", JSON.stringify(target));
}

export function createCoreOptionalDependencies(version) {
  assertReleaseVersion(version);
  return { [WINDOWS_X64_PACKAGE]: version };
}

export function createPlatformPackageJson({ version } = {}) {
  assertReleaseVersion(version);
  return {
    name: WINDOWS_X64_PACKAGE,
    version,
    private: false,
    license: "MIT",
    os: ["win32"],
    cpu: ["x64"],
    files: [
      "cua-driver",
      "overlay",
      "ocr-runtime",
      "models",
      "platform-manifest.json",
      "THIRD_PARTY_LICENSES.txt",
      "SBOM.cdx.json",
    ],
  };
}

export function releaseAssetNames(version) {
  assertReleaseVersion(version);
  return [
    `agent-computer-use-mcp-${version}.tgz`,
    `agent-computer-use-win32-x64-${version}.tgz`,
    `agent-computer-use-mcp-${version}-windows-x64.zip`,
    "checksums.txt",
    "release-manifest.json",
    "SBOM.cdx.json",
  ];
}

function assertReleaseVersion(version) {
  if (typeof version !== "string" || !RELEASE_VERSION_PATTERN.test(version)) {
    throw contractError("platform.version_invalid", String(version));
  }
}

function contractError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
