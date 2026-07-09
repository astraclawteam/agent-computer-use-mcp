# Protected npm Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a publish-ready npm tarball that runs the standard MCP server while containing no first-party source tree, tests, C# source, Python source, or Source Maps.

**Architecture:** The repository package remains the maintainer workspace and is marked non-publishable. A release builder creates `artifacts/npm-release/package`, bundles first-party runtime modules with esbuild while keeping npm dependencies external, applies a final JavaScript obfuscation pass, generates an integrity manifest and verifying launcher, and packs only that staging directory. A fail-closed inventory validator and official MCP SDK smoke test gate every tarball.

**Tech Stack:** Node.js 20 ESM, `esbuild@0.28.1`, `javascript-obfuscator@5.4.6`, Node test runner, official `@modelcontextprotocol/sdk` client.

## Global Constraints

- The GitHub repository remains open source; obfuscation raises casual analysis and tamper cost but is never described as secrecy or cryptographic protection.
- Root `npm publish` is blocked. Only the generated staging package is publishable.
- The publish-ready package may contain `dist/*.mjs`, `package.json`, `release-integrity.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.
- It must not contain `src/`, `test/`, `scripts/`, C# project/source, Python source, TypeScript source, `.map` files, or `sourceMappingURL` comments.
- First-party relative imports are bundled; bare npm dependencies and Node built-ins remain external.
- Obfuscation runs after bundling/minification. No formatter, banner rewrite, or minifier may mutate protected code afterward.
- Obfuscation must not rename object properties or globals because MCP schemas, JSON fields, environment variables, and native module APIs are public runtime contracts.
- `controlFlowFlattening`, `deadCodeInjection`, `debugProtection`, and `unicodeEscapeSequence` stay disabled to protect startup latency and runtime stability.
- `sourceMap` is explicitly disabled in both esbuild and the obfuscator.
- The release launcher verifies SHA-256 for protected runtime files before importing the MCP server.
- npm registry integrity and future signed release metadata remain the trust anchors; the local launcher hash is defense in depth.
- Published runtime smoke must initialize, list tools, and call `computer.health({fast:true})` through the official MCP SDK.
- Overlay exclusion remains unchanged and every release report sets `includeUserOverlay=false` and `startsDesktopControl=false`.

---

### Task 1: Publish Inventory Policy

**Files:**

- Create: `src/npm-release-policy.mjs`
- Create: `test/npm-release-policy.test.mjs`

**Interfaces:**

- Produces: `validateProtectedNpmEntries(entries)`
- Produces: `validateProtectedRuntime({ files, protection })`
- Required entries: `package.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `release-integrity.json`, `dist/launcher.mjs`, `dist/computer-use-mcp-server.mjs`, `dist/ocr-sidecar.mjs`

- [x] **Step 1: Write failing policy tests**

```js
test("protected npm inventory accepts only approved runtime entries", () => {
  const result = validateProtectedNpmEntries(PROTECTED_ENTRIES);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.violations, []);
});

test("protected npm inventory rejects source and Source Maps", () => {
  const result = validateProtectedNpmEntries([
    ...PROTECTED_ENTRIES,
    "src/computer-use-mcp-server.mjs",
    "test/server-smoke.test.mjs",
    "windows-installer/Program.cs",
    "dist/computer-use-mcp-server.mjs.map",
  ]);
  assert.deepEqual(result.violations.map((item) => item.code), [
    "source-entry-forbidden",
    "source-entry-forbidden",
    "source-entry-forbidden",
    "source-map-forbidden",
  ]);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/npm-release-policy.test.mjs`

Expected: FAIL because `src/npm-release-policy.mjs` does not exist.

- [x] **Step 3: Implement fail-closed inventory and protection validation**

Normalize separators and optional `package/` prefixes. Reject unknown top-level roots, forbidden source extensions, Source Maps, map comments in runtime contents, missing required entries, unminified first-party import paths, and missing protection metadata.

- [x] **Step 4: Run focused and full tests**

Run: `node --test test/npm-release-policy.test.mjs`

Run: `npm test`

Expected: all tests PASS.

- [x] **Step 5: Commit Task 1**

```sh
git add src/npm-release-policy.mjs test/npm-release-policy.test.mjs
git commit -m "feat: add protected npm inventory policy"
```

### Task 2: Release-Only Build Staging

**Files:**

- Create: `scripts/build-protected-npm-package.mjs`
- Create: `scripts/block-source-publish.mjs`
- Create: `test/protected-npm-build.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/ocr-sidecar.mjs`
- Modify: `src/computer-use-installation.mjs`
- Modify: `test/ocr-sidecar.test.mjs`
- Modify: `test/phase-1-6-installation.test.mjs`

**Interfaces:**

- Script: `npm run release:npm:build`
- Output root: `artifacts/npm-release/package`
- Output metadata: `{ status, packageRoot, runtimeFiles, protection, integrity }`
- Root publish blocker: `npm publish` from the repository exits non-zero with `release.source_publish_blocked`.

- [x] **Step 1: Write failing staging tests**

```js
test("protected npm build emits only protected release staging", async () => {
  const report = await buildProtectedNpmPackage({ outputRoot });
  assert.equal(report.status, "passed");
  assert.equal(report.protection.bundle, "esbuild");
  assert.equal(report.protection.obfuscator, "javascript-obfuscator");
  assert.equal(report.protection.sourceMap, false);
  assert.equal(report.protection.selfDefending, true);
  assert.equal(report.inventory.status, "passed");
});
```

Add tests that package JSON points `bin.agent-computer-use-mcp` at `dist/launcher.mjs`, contains runtime dependencies but no dev dependencies or maintainer scripts, and the original identifiers/import paths are absent from protected server output.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/protected-npm-build.test.mjs test/ocr-sidecar.test.mjs test/phase-1-6-installation.test.mjs`

Expected: FAIL because the release builder and protected path resolution do not exist.

- [x] **Step 3: Pin build-only dependencies and block root publication**

```json
{
  "private": true,
  "scripts": {
    "prepublishOnly": "node scripts/block-source-publish.mjs",
    "release:npm:build": "node scripts/build-protected-npm-package.mjs"
  },
  "devDependencies": {
    "esbuild": "0.28.1",
    "javascript-obfuscator": "5.4.6"
  }
}
```

- [x] **Step 4: Add development and protected runtime path selection**

`computer.installation` uses `dist/launcher.mjs` when present and `src/computer-use-mcp-server.mjs` in a source checkout. OCR resolves an explicit environment override first, then co-located `dist/ocr-sidecar.mjs`, then the development sidecar path.

- [x] **Step 5: Implement bundle, minify, obfuscate, and staging metadata**

Use esbuild with `bundle:true`, `platform:"node"`, `format:"esm"`, `packages:"external"`, `minify:true`, `sourcemap:false`, and `legalComments:"none"`. Apply JavaScript Obfuscator last with `target:"node"`, `sourceMap:false`, `selfDefending:true`, `identifierNamesGenerator:"hexadecimal"`, `stringArray:true`, `stringArrayEncoding:["base64"]`, `stringArrayThreshold:0.75`, and all high-risk transforms disabled.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node --test test/protected-npm-build.test.mjs test/ocr-sidecar.test.mjs test/phase-1-6-installation.test.mjs`

Run: `npm run release:npm:build`

Expected: protected staging validates with no source/map violations.

- [x] **Step 7: Commit Task 2**

```sh
git add package.json package-lock.json scripts src test
git commit -m "feat: build protected npm release staging"
```

### Task 3: Integrity Launcher And Standard MCP Smoke

**Files:**

- Create: `scripts/npm-release-launcher-template.mjs`
- Create: `scripts/protected-npm-smoke.mjs`
- Create: `test/protected-npm-smoke.test.mjs`
- Modify: `scripts/build-protected-npm-package.mjs`
- Modify: `package.json`

**Interfaces:**

- Script: `npm run release:npm:smoke`
- Integrity manifest: `{ schemaVersion: 1, packageName, packageVersion, protection, files: [{ path, bytes, sha256 }] }`
- Smoke report: `{ status, toolCount, health, integrityVerified, sourceEntries, sourceMaps, startsDesktopControl:false, includeUserOverlay:false }`

- [x] **Step 1: Write failing launcher and MCP smoke tests**

```js
test("protected package launcher verifies integrity and serves standard MCP", async () => {
  const report = await runProtectedNpmSmoke();
  assert.equal(report.status, "passed");
  assert.ok(report.toolNames.includes("computer.health"));
  assert.equal(report.health.includeUserOverlay, false);
  assert.equal(report.integrityVerified, true);
});
```

Add a tamper test that modifies the protected server after build and expects the launcher to exit before MCP initialization with `release.integrity_mismatch`.

- [x] **Step 2: Run focused smoke tests and verify RED**

Run: `node --test test/protected-npm-smoke.test.mjs`

Expected: FAIL because the integrity launcher and smoke runner do not exist.

- [x] **Step 3: Implement final-pass launcher and integrity manifest**

The builder hashes protected server and sidecar output, writes `release-integrity.json`, bundles/minifies/obfuscates the launcher last, and never modifies any protected file afterward. The launcher validates relative paths and SHA-256 before importing the server.

- [x] **Step 4: Implement official MCP SDK release smoke**

Start staging `dist/launcher.mjs` with `StdioClientTransport`, initialize, list tools, call `computer.health({fast:true})`, close, and report only release-safe metadata.

- [x] **Step 5: Run focused and full verification**

Run: `npm run release:npm:smoke`

Run: `npm test`

Expected: all tests PASS; tampered runtime fails before MCP initialization.

- [x] **Step 6: Commit Task 3**

```sh
git add scripts test package.json
git commit -m "test: verify protected npm runtime over standard mcp"
```

### Task 4: Pack Gate, CI, And Release Documentation

**Files:**

- Create: `src/phase-0-14-protected-npm-release.mjs`
- Create: `test/phase-0-14-protected-npm-release.test.mjs`
- Modify: `scripts/package-dry-run.mjs`
- Modify: `src/package-foundation.mjs`
- Modify: `src/release-readiness-gate.mjs`
- Modify: `test/package-foundation.test.mjs`
- Modify: `test/phase-0-11-release-readiness.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Script: `npm run release:npm:pack`
- Script: `npm run phase:0.14`
- `npm run package:dry-run` builds and inspects the staging package, never the source workspace.
- Tarball output: `artifacts/npm-release/*.tgz`

- [x] **Step 1: Write failing tarball and release-gate tests**

Assert the tarball passes `validateProtectedNpmEntries`, has zero source/Source Map entries, includes the obfuscated runtime and integrity manifest, and Phase 0.14 is required by release readiness.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/package-foundation.test.mjs test/phase-0-11-release-readiness.test.mjs test/phase-0-14-protected-npm-release.test.mjs`

Expected: FAIL because protected pack and Phase 0.14 are absent.

- [x] **Step 3: Implement protected pack, phase report, CI, and docs**

Use `npm pack --json <staging-directory>` and move the resulting tarball only inside ignored `artifacts/npm-release/`. Add explicit CI steps for protected build, smoke, pack, and Phase 0.14.

- [x] **Step 4: Run final verification**

Run: `npm run release:npm:build`

Run: `npm run release:npm:smoke`

Run: `npm run release:npm:pack`

Run: `npm run package:dry-run`

Run: `npm run phase:0.14`

Run: `npm run phase:0.11`

Run: `npm run phase:1.6`

Run: `npm run phase:1.7`

Run: `npm run phase:1.8`

Run: `npm test`

Run: `git diff --check`

Expected: every command exits `0`, release tarball has no forbidden entries, runtime smoke passes, and no generated output is tracked.

- [x] **Step 5: Commit Task 4**

```sh
git add .github package.json package-lock.json scripts src test docs README.md CHANGELOG.md
git commit -m "docs: gate protected npm distribution"
```
