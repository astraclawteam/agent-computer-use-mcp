import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { smokeOfflineBundle } from "../scripts/offline-platform-smoke.mjs";
import { assemblePlatformRelease } from "./platform-release-assembly.mjs";
import { WINDOWS_X64_OFFLINE_MAX_BYTES } from "./release-size-policy.mjs";
import { buildWindowsPlatformPackage } from "./windows-platform-package.mjs";

export async function runRealReleaseAssemblyPhase(options = {}) {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const version = options.version ?? packageJson.version;
  const sourceCommit = options.sourceCommit ?? process.env.GITHUB_SHA ?? "0".repeat(40);
  const generatedAt = options.generatedAt ?? process.env.AGENT_COMPUTER_USE_RELEASE_GENERATED_AT
    ?? new Date(0).toISOString().replace("1970", "1980");
  const corePackageRoot = resolve(options.corePackageRoot ?? "artifacts/npm-release/package");
  const platformPackageRoot = resolve(options.platformPackageRoot ?? "artifacts/npm-release/platform-win32-x64/package");
  const outputRoot = resolve(options.outputRoot ?? join("artifacts/platform-release", version));
  const buildCore = options.buildCore ?? buildProtectedNpmPackage;
  const buildPlatform = options.buildPlatform ?? buildWindowsPlatformPackage;
  const assemble = options.assemble ?? assemblePlatformRelease;
  const smoke = options.smoke ?? smokeOfflineBundle;

  await buildCore({ outputRoot: corePackageRoot });
  await buildPlatform({
    outputRoot: platformPackageRoot,
    version,
    sourceCommit,
    allowNetwork: options.allowNetwork === true,
    cacheRoot: options.cacheRoot,
  });
  const release = await assemble({
    version,
    sourceCommit,
    generatedAt,
    outputRoot,
    corePackageRoot,
    platformPackageRoot,
  });
  const offlineAsset = release.assets.find(({ name }) => name.endsWith("windows-x64.zip"));
  if (!offlineAsset) throw new Error("release.offline_zip_missing");
  const offlineBundleSizeBytes = (await stat(offlineAsset.path)).size;
  if (offlineBundleSizeBytes > WINDOWS_X64_OFFLINE_MAX_BYTES) {
    throw new Error(`release.offline_bundle_too_large: ${offlineBundleSizeBytes}`);
  }
  const offlineSmoke = await smoke({ zipPath: offlineAsset.path });
  const offlineOcrVerified = offlineSmoke.networkDisabled === true
    && offlineSmoke.ocrInitialized === true
    && offlineSmoke.ocrPrewarmCompleted === true;
  const passed = release.status === "passed"
    && release.inventoryComparison.status === "identical"
    && offlineSmoke.status === "passed"
    && offlineOcrVerified;
  return {
    status: passed ? "passed" : "failed",
    phase: "0.15",
    benchmark: "npm-platform-release-assembly",
    corePackageBuilt: true,
    platformPackageBuilt: true,
    releaseBundleVerified: release.status === "passed",
    platformInventoryIdentical: release.inventoryComparison.status === "identical",
    offlineBundleVerified: offlineSmoke.status === "passed",
    offlineBundleSizeBytes,
    offlineBundleMaxBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
    standardMcpSmokePassed: offlineSmoke.toolsListed && offlineSmoke.healthPassed && offlineSmoke.doctorPassed,
    platformVerifiedBeforeMcp: offlineSmoke.platformVerified,
    offlineOcrVerified,
    firstEnableDownloadCount: 0,
    runtimeNetworkAllowed: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runRealReleaseAssemblyPhase({
    allowNetwork: process.env.AGENT_COMPUTER_USE_RELEASE_ALLOW_NETWORK === "1",
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
