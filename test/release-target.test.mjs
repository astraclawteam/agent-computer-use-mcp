import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WINDOWS_X64_RELEASE_TARGET,
  assertReleaseTarget,
  resolveReleaseTarget,
  sameReleaseTarget,
} from "../src/release-target.mjs";

test("windows-x64 resolves to the canonical release target", () => {
  assert.deepEqual(resolveReleaseTarget("windows-x64"), {
    id: "windows-x64",
    os: "win32",
    arch: "x64",
    libc: null,
    accelerator: "directml-cpu",
  });
  assert.equal(Object.isFrozen(WINDOWS_X64_RELEASE_TARGET), true);
});

test("unsupported or inconsistent release targets fail closed", () => {
  assert.throws(
    () => resolveReleaseTarget("macos-arm64"),
    (error) => error?.code === "release.target_unsupported",
  );
  assert.throws(
    () => assertReleaseTarget({ ...WINDOWS_X64_RELEASE_TARGET, arch: "arm64" }),
    (error) => error?.code === "release.target_invalid",
  );
  assert.equal(
    sameReleaseTarget(WINDOWS_X64_RELEASE_TARGET, structuredClone(WINDOWS_X64_RELEASE_TARGET)),
    true,
  );
  assert.equal(sameReleaseTarget(WINDOWS_X64_RELEASE_TARGET, null), false);
});
