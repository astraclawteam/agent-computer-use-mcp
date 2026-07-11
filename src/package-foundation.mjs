import { readFileSync } from "node:fs";
import { validateProtectedNpmEntries } from "./npm-release-policy.mjs";

export const FORBIDDEN_PACKAGE_PATHS = [
  "src/",
  "test/",
  "scripts/",
  "public/",
  "gateway-overlay/",
  "native-lab/",
  "ocr-sidecar/",
  "docs/",
  "node_modules/",
  "artifacts/",
  "models/",
];

export function getInstallLayout(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "%LOCALAPPDATA%";
    const dataRoot = `${localAppData}\\AgentComputerUse`;
    return {
      platform,
      dataRoot,
      artifactRoot: `${dataRoot}\\artifacts`,
      modelRoot: `${dataRoot}\\cache\\models`,
      logRoot: `${dataRoot}\\logs`,
      traceRoot: `${dataRoot}\\traces`,
      sessionRoot: `${dataRoot}\\sessions`,
      cacheRoot: `${dataRoot}\\cache`,
      driverRoot: `${dataRoot}\\cache\\cua-driver`,
      overlayRoot: `${dataRoot}\\cache\\overlay`,
      runtimeRoot: `${dataRoot}\\cache\\runtime`,
      authoritativeProgramState: false,
    };
  }

  const home = env.XDG_DATA_HOME ?? (env.HOME ? `${env.HOME}/.local/share` : "~/.local/share");
  const dataRoot = `${home}/agent-computer-use`;
  return {
    platform,
    dataRoot,
    artifactRoot: `${dataRoot}/artifacts`,
    modelRoot: `${dataRoot}/models`,
    logRoot: `${dataRoot}/logs`,
    traceRoot: `${dataRoot}/traces`,
    sessionRoot: `${dataRoot}/sessions`,
    cacheRoot: `${dataRoot}/cache`,
    driverRoot: `${dataRoot}/cache/cua-driver`,
    overlayRoot: `${dataRoot}/cache/overlay`,
    runtimeRoot: `${dataRoot}/cache/runtime`,
    authoritativeProgramState: false,
  };
}

export function getVersionPolicy() {
  return {
    versionSource: "package.json",
    channel: "0.x-preview",
    publicContract: "computer.* MCP tools and structuredContent schemas",
    upgradeStrategy: "npm-install-exact-core-and-platform-version",
    rollbackStrategy: "npm-install-previous-exact-version",
    compatibilityAliases: ["XIAOZHICLAW_*"],
    semverRules: {
      patch: "bug fixes and internal implementation changes with no MCP contract change",
      minor: "new tools, optional fields, providers, or compatible capability additions",
      major: "reserved for post-1.0 incompatible MCP contract changes",
    },
  };
}

export function getSigningPolicy() {
  return {
    npm: {
      provenanceRequired: true,
      publishOrder: ["@agent-computer-use/win32-x64", "agent-computer-use-mcp"],
    },
    windowsHelpers: {
      firstPartyAuthenticodeRequired: false,
      firstPartyFiles: ["gateway-overlay"],
      timestampRequired: false,
      verification: "platform-manifest-sha256",
      thirdPartyUnsigned: {
        files: ["cua-driver"],
        requiredVerification: [
          "upstream-release-sha256",
          "extracted-file-sha256",
        ],
      },
    },
    releaseArtifacts: {
      sha256Required: true,
      sbomRequired: true,
      checksumsRequired: true,
    },
    unsignedDevelopmentBuilds: { allowed: true, distribution: "npm-preview" },
  };
}

export function buildOfflineAssetManifest(options = {}) {
  const packageVersion = options.packageVersion ?? readPackageJson().version;
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    schemaVersion: 1,
    packageName: "agent-computer-use-mcp",
    packageVersion,
    generatedAt,
    distribution: {
      corePackage: `agent-computer-use-mcp@${packageVersion}`,
      platformPackage: `@agent-computer-use/win32-x64@${packageVersion}`,
      offlineZip: `agent-computer-use-mcp-${packageVersion}-windows-x64.zip`,
      runtimeDownloadAllowed: false,
    },
    assets: [
      {
        id: "cua-driver-windows-x64",
        kind: "driver",
        platform: "win32-x64",
        targetRoot: "platform-package/cua-driver",
        offlineRequired: true,
        acquisition: "npm-platform-package-or-complete-zip",
        version: "pinned-by-release",
      },
      {
        id: "gateway-overlay-windows",
        kind: "overlay-shell",
        platform: "win32",
        targetRoot: "platform-package/overlay",
        offlineRequired: true,
        acquisition: "npm-platform-package-or-complete-zip",
        version: packageVersion,
      },
      {
        id: "ocr-runtime-onnxruntime-node",
        kind: "runtime",
        platform: "win32-x64",
        targetRoot: "platform-package/ocr-runtime",
        offlineRequired: true,
        acquisition: "npm-platform-package-or-complete-zip",
        version: "from-package-lock",
      },
      {
        id: "ocr-model-pp-ocrv6-small",
        kind: "model-pack",
        platform: "win32-x64",
        targetRoot: "platform-package/models/pp-ocr-v6",
        offlineRequired: true,
        acquisition: "npm-platform-package-or-complete-zip",
        version: "pinned-by-manifest",
      },
    ],
  };
}

export function getPackageFilesPolicy() {
  return {
    kind: "protected-release-staging",
    includeRoots: ["dist/"],
    includeFiles: [
      "package.json",
      "release-integrity.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
    ],
    forbiddenPathPrefixes: FORBIDDEN_PACKAGE_PATHS,
    protection: {
      bundlingRequired: true,
      minificationRequired: true,
      obfuscationRequired: true,
      sourceMap: false,
      sourceWorkspacePublishBlocked: true,
    },
  };
}

export function validatePackEntries(entries) {
  return validateProtectedNpmEntries(entries);
}

export function buildPackageFoundationReport(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  return {
    status: "passed",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    installLayout: {
      windows: getInstallLayout({
        platform: "win32",
        env: { LOCALAPPDATA: "%LOCALAPPDATA%" },
      }),
      unix: getInstallLayout({
        platform: "linux",
        env: { XDG_DATA_HOME: "$XDG_DATA_HOME" },
      }),
    },
    versionPolicy: getVersionPolicy(),
    signingPolicy: getSigningPolicy(),
    offlineAssetManifest: buildOfflineAssetManifest({
      packageVersion: packageJson.version,
      generatedAt: options.generatedAt,
    }),
    packageFilesPolicy: getPackageFilesPolicy(),
  };
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
