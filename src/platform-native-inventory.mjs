const REQUIRED_PREFIXES = Object.freeze([
  "cua-driver/",
  "overlay/",
  "ocr-runtime/",
  "models/pp-ocr-v6/",
]);

export function validatePlatformNativeInventory(manifest = {}) {
  const violations = [];
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const prefix of REQUIRED_PREFIXES) {
    if (!files.some(({ path }) => path?.startsWith(prefix))) {
      violations.push({ code: "platform-component-missing", prefix });
    }
  }
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/u.test(file.sha256 ?? "") || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      violations.push({ code: "platform-file-identity-invalid", path: file.path });
    }
  }
  if (manifest.target?.platform !== "win32" || manifest.target?.arch !== "x64" || manifest.target?.id !== "windows-x64") {
    violations.push({ code: "platform-target-invalid" });
  }
  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.13",
    componentCount: REQUIRED_PREFIXES.length,
    verifiedFileCount: files.length,
    violations,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}
