import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function expandVerifiedZip({ archivePath, destinationPath }) {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", resolve("scripts/expand-verified-zip.ps1"),
    "-ArchivePath", resolve(archivePath),
    "-DestinationPath", resolve(destinationPath),
  ]);
  if (result.exitCode !== 0) {
    const text = `${result.stderr}\n${result.stdout}`;
    const code = text.includes("release.zip_entry_invalid")
      ? "release.zip_entry_invalid"
      : "release.zip_extract_failed";
    const error = new Error(`${code}: ${text.trim().slice(-1000)}`);
    error.code = code;
    throw error;
  }
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}
