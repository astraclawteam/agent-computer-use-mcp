import { assertReleaseTarget } from "./release-target.mjs";

export const WINDOWS_X64_OFFLINE_MAX_BYTES = 310 * 1024 * 1024;

export function assertOfflineBundleSize({ target, sizeBytes } = {}) {
  assertReleaseTarget(target);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw releaseError("release.offline_bundle_size_invalid", "Offline bundle size must be a non-negative safe integer");
  }
  if (sizeBytes > WINDOWS_X64_OFFLINE_MAX_BYTES) {
    throw releaseError(
      "release.offline_bundle_too_large",
      `Offline bundle exceeds ${WINDOWS_X64_OFFLINE_MAX_BYTES} bytes: ${sizeBytes}`,
    );
  }
  return { sizeBytes, maxBytes: WINDOWS_X64_OFFLINE_MAX_BYTES };
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
