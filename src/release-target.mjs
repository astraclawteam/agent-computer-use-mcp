const TARGET_FIELDS = Object.freeze(["id", "os", "arch", "libc", "accelerator"]);

export const WINDOWS_X64_RELEASE_TARGET = Object.freeze({
  id: "windows-x64",
  os: "win32",
  arch: "x64",
  libc: null,
  accelerator: "directml-cpu",
});

export function resolveReleaseTarget(id) {
  if (id !== WINDOWS_X64_RELEASE_TARGET.id) {
    throw releaseError("release.target_unsupported", `Unsupported release target: ${id}`);
  }
  return WINDOWS_X64_RELEASE_TARGET;
}

export function assertReleaseTarget(value) {
  if (!sameReleaseTarget(value, WINDOWS_X64_RELEASE_TARGET)) {
    throw releaseError("release.target_invalid", "Release target does not match Windows x64");
  }
  return WINDOWS_X64_RELEASE_TARGET;
}

export function sameReleaseTarget(left, right) {
  return TARGET_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
