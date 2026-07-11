import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { platformRepairDiagnostic, resolveVerifiedPlatform } from "./platform-package-resolver.mjs";

export async function runPlatformPackageIntegrityPhase(options = {}) {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const coreVersion = options.coreVersion ?? packageJson.version;
  const platformRoot = resolve(options.platformRoot ?? "artifacts/npm-release/platform-win32-x64/package");
  const verify = options.verify ?? (() => resolveVerifiedPlatform({
    platform: "win32",
    arch: "x64",
    coreVersion,
    resolvePackageJson: () => join(platformRoot, "package.json"),
  }));
  const diagnose = options.diagnose ?? ((error) => platformRepairDiagnostic(error, coreVersion));
  const verified = await verify();
  const diagnosis = diagnose(Object.assign(new Error("platform.package_missing"), { code: "platform.package_missing" }));
  const exactVersionVerified = verified.status === "verified" && verified.packageVersion === coreVersion;
  const repairIsReadOnly = diagnosis.reinstallCommand === `npm install agent-computer-use-mcp@${coreVersion}`
    && diagnosis.executesImmediately === false
    && diagnosis.networkAccessed === false
    && diagnosis.packageFilesModified === false;
  return {
    status: exactVersionVerified && repairIsReadOnly ? "passed" : "failed",
    phase: "7.8",
    benchmark: "platform-package-integrity",
    exactVersionVerified,
    repairIsReadOnly,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runPlatformPackageIntegrityPhase();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}
