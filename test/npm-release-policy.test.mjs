import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REQUIRED_PROTECTED_NPM_ENTRIES,
  validateProtectedNpmEntries,
  validateProtectedRuntime,
} from "../src/npm-release-policy.mjs";

test("protected npm inventory accepts only approved runtime entries", () => {
  const result = validateProtectedNpmEntries(REQUIRED_PROTECTED_NPM_ENTRIES);

  assert.equal(result.status, "passed");
  assert.equal(result.entryCount, REQUIRED_PROTECTED_NPM_ENTRIES.length);
  assert.deepEqual(result.violations, []);
});

test("protected npm inventory rejects source Source Maps and unknown entries", () => {
  const result = validateProtectedNpmEntries([
    ...REQUIRED_PROTECTED_NPM_ENTRIES,
    "src/computer-use-mcp-server.mjs",
    "test/server-smoke.test.mjs",
    "windows-installer/Program.cs",
    "ocr-sidecar/xiaozhiclaw_ocr_sidecar.py",
    "dist/computer-use-mcp-server.mjs.map",
    "docs/private-release-notes.md",
  ]);

  assert.equal(result.status, "failed");
  assert.deepEqual(result.violations.map((item) => [item.code, item.path]), [
    ["source-entry-forbidden", "src/computer-use-mcp-server.mjs"],
    ["source-entry-forbidden", "test/server-smoke.test.mjs"],
    ["source-entry-forbidden", "windows-installer/Program.cs"],
    ["source-entry-forbidden", "ocr-sidecar/xiaozhiclaw_ocr_sidecar.py"],
    ["source-map-forbidden", "dist/computer-use-mcp-server.mjs.map"],
    ["entry-not-allowlisted", "docs/private-release-notes.md"],
  ]);
});

test("protected npm inventory fails closed when a required runtime file is missing", () => {
  const entries = REQUIRED_PROTECTED_NPM_ENTRIES.filter((entry) => entry !== "dist/ocr-sidecar.mjs");
  const result = validateProtectedNpmEntries(entries);

  assert.equal(result.status, "failed");
  assert.deepEqual(result.violations, [{
    code: "required-entry-missing",
    path: "dist/ocr-sidecar.mjs",
  }]);
});

test("protected runtime requires stable no-map obfuscation metadata", () => {
  const result = validateProtectedRuntime({
    files: [
      { path: "dist/launcher.mjs", contents: "var _0x1a2b=()=>import('./computer-use-mcp-server.mjs');" },
      { path: "dist/computer-use-mcp-server.mjs", contents: "var _0x3c4d='computer.health';" },
      { path: "dist/ocr-sidecar.mjs", contents: "var _0x5e6f='recognize';" },
    ],
    protection: readyProtection(),
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.violations, []);
});

test("protected runtime rejects Source Map comments relative source imports and unsafe options", () => {
  const result = validateProtectedRuntime({
    files: [
      {
        path: "dist/computer-use-mcp-server.mjs",
        contents: "import './computer-use-policy.mjs';\n//# sourceMappingURL=server.mjs.map",
      },
    ],
    protection: {
      ...readyProtection(),
      sourceMap: true,
      renameProperties: true,
      controlFlowFlattening: true,
    },
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.violations.map((item) => item.code), [
    "source-map-enabled",
    "rename-properties-enabled",
    "control-flow-flattening-enabled",
    "source-map-reference",
    "first-party-import-unbundled",
  ]);
});

function readyProtection() {
  return {
    bundle: "esbuild@0.28.1",
    obfuscator: "javascript-obfuscator@5.4.6",
    minify: true,
    sourceMap: false,
    selfDefending: true,
    renameGlobals: false,
    renameProperties: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
  };
}
