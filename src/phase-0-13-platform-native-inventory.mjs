import { validatePlatformNativeInventory } from "./platform-native-inventory.mjs";

const manifest = {
  target: { platform: "win32", arch: "x64", id: "windows-x64" },
  files: [
    { path: "cua-driver/cua-driver.exe", sizeBytes: 1, sha256: "a".repeat(64) },
    { path: "overlay/GatewayComputerUseOverlay.exe", sizeBytes: 1, sha256: "b".repeat(64) },
    { path: "ocr-runtime/onnxruntime.dll", sizeBytes: 1, sha256: "c".repeat(64) },
    { path: "models/pp-ocr-v6/det.onnx", sizeBytes: 1, sha256: "d".repeat(64) },
  ],
};
const validation = validatePlatformNativeInventory(manifest);
process.stdout.write(`${JSON.stringify({
  ...validation,
  benchmark: "platform-native-inventory",
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
