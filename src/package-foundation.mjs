import { readFileSync } from "node:fs";

export const FORBIDDEN_PACKAGE_PATHS = [
  "node_modules/",
  "gateway-overlay/bin/",
  "gateway-overlay/obj/",
  "native-lab/bin/",
  "native-lab/obj/",
  "ocr-sidecar/__pycache__/",
  "artifacts/",
  "models/",
];

export function getInstallLayout(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "%LOCALAPPDATA%";
    const programCacheRoot = `${localAppData}\\Programs\\AgentComputerUse`;
    const dataRoot = `${localAppData}\\AgentComputerUse`;
    return {
      platform,
      dataRoot,
      artifactRoot: `${dataRoot}\\artifacts`,
      modelRoot: `${dataRoot}\\models`,
      logRoot: `${dataRoot}\\logs`,
      traceRoot: `${dataRoot}\\traces`,
      cacheRoot: programCacheRoot,
      driverRoot: `${programCacheRoot}\\cua-driver`,
      overlayRoot: `${programCacheRoot}\\overlay`,
      runtimeRoot: `${programCacheRoot}\\runtime`,
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
    cacheRoot: `${dataRoot}/cache`,
    driverRoot: `${dataRoot}/cache/cua-driver`,
    overlayRoot: `${dataRoot}/cache/overlay`,
    runtimeRoot: `${dataRoot}/cache/runtime`,
  };
}

export function getVersionPolicy() {
  return {
    versionSource: "package.json",
    channel: "0.x-preview",
    publicContract: "computer.* MCP tools and structuredContent schemas",
    upgradeStrategy: "side-by-side-assets-in-place-package",
    rollbackStrategy: "retain previous asset manifest until next successful doctor run",
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
    windowsHelpers: {
      signingRequired: true,
      files: [
        "gateway-overlay",
        "cua-driver",
        "future-native-sidecars",
      ],
      certificateSource: "release-secret-or-hardware-backed-code-signing",
      timestampRequired: true,
      verification: "signtool verify /pa",
    },
    unsignedDevelopmentBuilds: {
      allowed: true,
      distribution: "blocked",
      marker: "development-only",
    },
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
    installRoots: {
      windows: {
        dataRoot: "%LOCALAPPDATA%\\AgentComputerUse",
        cacheRoot: "%LOCALAPPDATA%\\Programs\\AgentComputerUse",
      },
      unix: {
        dataRoot: "$XDG_DATA_HOME/agent-computer-use",
        cacheRoot: "$XDG_DATA_HOME/agent-computer-use/cache",
      },
    },
    assets: [
      {
        id: "cua-driver-windows-x64",
        kind: "driver",
        platform: "win32-x64",
        targetRoot: "cacheRoot/cua-driver",
        offlineRequired: true,
        acquisition: "bundle-or-install-cache",
        version: "pinned-by-release",
      },
      {
        id: "gateway-overlay-windows",
        kind: "overlay-shell",
        platform: "win32",
        targetRoot: "cacheRoot/overlay",
        offlineRequired: true,
        acquisition: "build-or-signed-bundle",
        version: packageVersion,
      },
      {
        id: "ocr-runtime-onnxruntime-node",
        kind: "runtime",
        platform: "all",
        targetRoot: "package/node_modules/onnxruntime-node",
        offlineRequired: true,
        acquisition: "npm-package-cache",
        version: "from-package-lock",
      },
      {
        id: "ocr-model-pp-ocrv6-small",
        kind: "model-pack",
        platform: "all",
        targetRoot: "modelRoot/pp-ocrv6-small",
        offlineRequired: false,
        acquisition: "bundle-or-first-run-cache",
        version: "pinned-by-manifest",
      },
      {
        id: "webview2-runtime",
        kind: "system-runtime",
        platform: "win32",
        targetRoot: "system",
        offlineRequired: false,
        acquisition: "system-installed-or-offline-evergreen-bootstrapper",
        version: "system-detected",
      },
    ],
  };
}

export function getPackageFilesPolicy() {
  return {
    includeRoots: [
      "src/",
      "scripts/",
      "public/",
      "gateway-overlay/",
      "native-lab/",
      "ocr-sidecar/",
      "README.md",
      "LICENSE",
      "package.json",
    ],
    forbiddenPathPrefixes: FORBIDDEN_PACKAGE_PATHS,
  };
}

export function validatePackEntries(entries) {
  const violations = [];
  for (const entry of entries) {
    const normalized = normalizePackEntry(entry);
    const matchedPrefix = FORBIDDEN_PACKAGE_PATHS.find((prefix) => normalized.startsWith(prefix));
    if (matchedPrefix) {
      violations.push({ entry, normalized, matchedPrefix });
    }
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    entryCount: entries.length,
    violations,
  };
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

function normalizePackEntry(entry) {
  return entry.replace(/\\/g, "/").replace(/^package\//, "");
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
