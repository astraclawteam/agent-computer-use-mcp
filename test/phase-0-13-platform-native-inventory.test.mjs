import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validatePlatformNativeInventory } from "../src/platform-native-inventory.mjs";

test("platform native inventory requires every Windows component and file hash", () => {
  const report = validatePlatformNativeInventory({
    target: { platform: "win32", arch: "x64", id: "windows-x64" },
    files: [
      file("cua-driver/cua-driver.exe", "a"),
      file("overlay/GatewayComputerUseOverlay.exe", "b"),
      file("ocr-runtime/onnxruntime.dll", "c"),
      file("models/pp-ocr-v6/det.onnx", "d"),
    ],
  });
  assert.equal(report.status, "passed");
  assert.equal(report.componentCount, 4);
  assert.equal(report.verifiedFileCount, 4);
});

test("platform native inventory fails closed for missing or unverified files", () => {
  const report = validatePlatformNativeInventory({
    target: { platform: "win32", arch: "x64", id: "windows-x64" },
    files: [file("cua-driver/cua-driver.exe", "x")],
  });
  assert.equal(report.status, "failed");
  assert.equal(report.violations.some(({ code }) => code === "platform-file-identity-invalid"), true);
  assert.equal(report.violations.filter(({ code }) => code === "platform-component-missing").length, 3);
});

test("Phase 0.13 exposes the platform native inventory gate", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.13"], "node src/phase-0-13-platform-native-inventory.mjs");
  const result = await runNode("src/phase-0-13-platform-native-inventory.mjs");
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.benchmark, "platform-native-inventory");
  assert.equal(report.startsDesktopControl, false);
});

function file(path, seed) {
  return { path, sizeBytes: 1, sha256: seed.repeat(64).slice(0, 64) };
}

function runNode(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
