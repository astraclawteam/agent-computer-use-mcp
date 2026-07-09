import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { materializeReleaseBundle } from "./release-bundle.mjs";
import { ensureWindowsInstallerBuilt, runWindowsInstaller } from "./windows-installer-host.mjs";

const root = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-7-8-"));

try {
  await ensureWindowsInstallerBuilt();
  const programRoot = join(root, "program");
  const dataRoot = join(root, "data");
  const v1 = await fixtureBundle(root, 1, "0.0.1", "v1");
  const v2 = await fixtureBundle(root, 2, "0.0.2", "v2");
  const corrupted = await fixtureBundle(root, 3, "0.0.3", "v3");

  const install = await execute("install", { bundleRoot: v1, programRoot, dataRoot });
  const upgrade = await execute("upgrade", { bundleRoot: v2, programRoot, dataRoot });
  const rollback = await execute("rollback", { programRoot, dataRoot });

  await writeFile(join(corrupted, "payload/package/version.txt"), "tampered", "utf8");
  const rejected = await runWindowsInstaller("upgrade", {
    bundleRoot: corrupted,
    programRoot,
    dataRoot,
  });
  const status = await execute("status", { programRoot, dataRoot });
  const transactionRootsClean = (await readdir(join(programRoot, "transactions"))).length === 0;
  const corruptedBundleRejected = rejected.exitCode === 2
    && rejected.report.status === "failed"
    && rejected.report.error?.code === "installer.size_mismatch";

  const passed = install.currentVersion === "0.0.1"
    && install.revision === 1
    && upgrade.currentVersion === "0.0.2"
    && upgrade.previousVersion === "0.0.1"
    && rollback.currentVersion === "0.0.1"
    && rollback.previousVersion === "0.0.2"
    && status.currentVersion === "0.0.1"
    && corruptedBundleRejected
    && transactionRootsClean;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "7.8",
    benchmark: "windows-installer-transaction",
    install: summarize(install),
    upgrade: summarize(upgrade),
    rollback: summarize(rollback),
    activeAfterRejectedUpgrade: status.currentVersion,
    corruptedBundleRejected,
    transactionRootsClean,
    networkRequired: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "failed",
    phase: "7.8",
    benchmark: "windows-installer-transaction",
    error: error instanceof Error ? error.message : String(error),
    networkRequired: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}

async function fixtureBundle(root, sequence, version, contents) {
  const sourceRoot = join(root, `source-${sequence}`);
  const bundleRoot = join(root, `bundle-${sequence}`);
  const target = join(sourceRoot, "package/version.txt");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  await materializeReleaseBundle({
    packageName: "agent-computer-use-mcp",
    version,
    sourceRoot,
    outputRoot: bundleRoot,
    files: ["package/version.txt"],
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  return bundleRoot;
}

async function execute(operation, options) {
  const result = await runWindowsInstaller(operation, options);
  if (result.exitCode !== 0) {
    throw new Error(`installer.${operation}_failed: ${result.stderr || result.stdout}`);
  }
  return result.report;
}

function summarize(report) {
  return {
    status: report.status,
    operation: report.operation,
    currentVersion: report.currentVersion,
    previousVersion: report.previousVersion,
    revision: report.revision,
  };
}
