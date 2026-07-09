#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedRuntimePaths = new Set([
  "dist/computer-use-mcp-server.mjs",
  "dist/ocr-sidecar.mjs",
]);

try {
  const result = verifyReleaseIntegrity();
  process.env.AGENT_COMPUTER_USE_RELEASE_INTEGRITY_VERIFIED = "1";
  if (process.argv.includes("--verify-only")) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const serverUrl = new URL("./computer-use-mcp-server.mjs", import.meta.url);
    await import(serverUrl.href);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function verifyReleaseIntegrity() {
  const manifestPath = resolve(packageRoot, "release-integrity.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("release.integrity_manifest_invalid");
  }

  for (const file of manifest.files) {
    const path = normalizeRuntimePath(file.path);
    if (!allowedRuntimePaths.has(path)) {
      throw new Error(`release.integrity_path_forbidden: ${path}`);
    }
    const fullPath = resolve(packageRoot, ...path.split("/"));
    const rootPrefix = `${packageRoot}${sep}`;
    if (!fullPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
      throw new Error(`release.integrity_path_forbidden: ${path}`);
    }
    const contents = readFileSync(fullPath);
    const fileStat = statSync(fullPath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    if (fileStat.size !== file.bytes || sha256 !== file.sha256) {
      throw new Error(`release.integrity_mismatch: ${path}`);
    }
  }

  return {
    status: "passed",
    schemaVersion: manifest.schemaVersion,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    fileCount: manifest.files.length,
  };
}

function normalizeRuntimePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("release.integrity_path_forbidden");
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`release.integrity_path_forbidden: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`release.integrity_path_forbidden: ${value}`);
  }
  return segments.join("/");
}
