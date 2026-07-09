import { spawnSync } from "node:child_process";
import { validatePackEntries } from "../src/package-foundation.mjs";

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
const args = npmExecPath
  ? [npmExecPath, "pack", "--dry-run", "--json"]
  : ["pack", "--dry-run", "--json"];

const result = spawnSync(command, args, {
  encoding: "utf8",
  shell: false,
});

if (result.status !== 0) {
  console.error((result.stderr ?? result.error?.message ?? "npm pack --dry-run failed").trim());
  process.exit(result.status ?? 1);
}

const packReport = JSON.parse(result.stdout)[0];
const entries = packReport.files.map((file) => `package/${file.path}`);
const validation = validatePackEntries(entries);
const report = {
  status: validation.status,
  packageName: packReport.name,
  packageVersion: packReport.version,
  filename: packReport.filename,
  unpackedSize: packReport.unpackedSize,
  entryCount: validation.entryCount,
  violations: validation.violations,
};

console.log(JSON.stringify(report, null, 2));

if (validation.status !== "passed") {
  process.exitCode = 1;
}
