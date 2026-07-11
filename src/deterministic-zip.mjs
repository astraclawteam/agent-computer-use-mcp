import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function createDeterministicZip({ sourceRoot, outputPath, generatedAt }) {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", resolve("scripts/create-deterministic-zip.ps1"),
    "-SourcePath", resolve(sourceRoot),
    "-OutputPath", resolve(outputPath),
    "-GeneratedAt", generatedAt,
  ]);
  if (result.exitCode !== 0) {
    const error = new Error(`release.offline_zip_failed: ${(result.stderr || result.stdout).trim().slice(-2000)}`);
    error.code = "release.offline_zip_failed";
    throw error;
  }
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}
