import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { smokeOfflineBundle } from "../scripts/offline-platform-smoke.mjs";
import { comparePlatformInventories } from "./platform-release-assembly.mjs";

export async function runOfflinePackageIdentityPhase(options = {}) {
  const compare = options.compare ?? (() => comparePlatformInventories(
    resolve(required(options.platformPackageRoot, "release.platform_package_missing")),
    resolve(required(options.offlinePlatformRoot, "release.offline_platform_missing")),
  ));
  const smoke = options.smoke ?? (() => smokeOfflineBundle({
    zipPath: resolve(required(options.zipPath, "release.offline_zip_missing")),
  }));
  const identity = await compare();
  const offline = await smoke();
  const platformInventoryIdentical = identity.status === "identical";
  const offlineMcpStarted = offline.status === "passed" && offline.desktopControlStarted === false;
  return {
    status: platformInventoryIdentical && offlineMcpStarted && offline.networkDisabled ? "passed" : "failed",
    phase: "7.9",
    benchmark: "offline-package-identity",
    platformInventoryIdentical,
    verifiedFileCount: identity.files.length,
    offlineMcpStarted,
    networkDisabled: offline.networkDisabled === true,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runOfflinePackageIdentityPhase({
    platformPackageRoot: process.env.AGENT_COMPUTER_USE_PLATFORM_PACKAGE_ROOT,
    offlinePlatformRoot: process.env.AGENT_COMPUTER_USE_OFFLINE_PLATFORM_ROOT,
    zipPath: process.env.AGENT_COMPUTER_USE_OFFLINE_ZIP,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
