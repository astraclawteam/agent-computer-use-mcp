# npm Platform Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows installer and runtime asset updater with an exact-version core npm package, an immutable Windows x64 platform npm package, a complete offline ZIP, and byte-identical GitHub/Gitee release delivery.

**Architecture:** One canonical Windows x64 platform stage owns every native byte. The stage is verified once, then copied unchanged into `@xiaozhiclaw/agent-computer-use-win32-x64` and the complete offline ZIP; the protected core package resolves and verifies that exact platform package before starting MCP. A tag-only workflow publishes the platform package before the core package, validates a clean public-npm install, publishes GitHub Release, and mirrors the exact release assets to Gitee without rebuilding.

**Tech Stack:** Node.js 20+ ESM, `node:test`, official `@modelcontextprotocol/sdk`, npm package tarballs with provenance, PowerShell deterministic ZIP tooling, CycloneDX JSON SBOM, GitHub Actions, GitHub CLI, and Gitee v5 REST API.

## Global Constraints

- The only public install name is `agent-computer-use-mcp`; users never install a platform package directly.
- The core package declares `@xiaozhiclaw/agent-computer-use-win32-x64` in `optionalDependencies` with the exact same `X.Y.Z` version; ranges and tags are forbidden.
- The first and only published native target is `win32-x64`; macOS and Linux stay unpublished until separately validated.
- The platform package name is `@xiaozhiclaw/agent-computer-use-win32-x64` with `os: ["win32"]` and `cpu: ["x64"]`.
- Native payloads are complete at install time. Runtime download, postinstall download, private updater, installer, administrator privilege, and self-update are forbidden.
- `platform-manifest.json` covers every platform payload file with sorted relative paths, byte sizes, media types, and SHA-256 hashes; links, traversal, duplicate paths, and Windows case-fold collisions fail closed.
- The complete ZIP is `agent-computer-use-mcp-X.Y.Z-windows-x64.zip`, requires Node.js 20+, and runs without npm, network access, or installation.
- The npm platform package and ZIP platform subtree are copied from one canonical stage and must have identical path/size/SHA-256 inventories.
- Public npm and GitHub Release are authoritative. Gitee Release is a byte-identical, idempotent regional mirror and never rebuilds artifacts.
- Release runs only for a verified `v*` tag whose version exactly matches `package.json`.
- Both npm packages publish with provenance. GitHub Release remains draft until both npm publishes and post-publish smoke pass.
- Generated public packages contain no first-party source, source maps, test fixtures, private keys, tokens, installer files, or mutable cache state.
- Runtime writable data remains under `%LOCALAPPDATA%\AgentComputerUse`; deleting it cannot change the installed program version.

---

### Task 1: Freeze the Package and Artifact Contracts

**Files:**
- Create: `src/platform-package-contract.mjs`
- Create: `test/platform-package-contract.test.mjs`
- Modify: `test/protected-npm-build.test.mjs`
- Modify: `test/windows-release-distribution-contract.test.mjs`

**Interfaces:**
- Produces: `WINDOWS_X64_TARGET`, `platformPackageName(target)`, `createCoreOptionalDependencies(version)`, `createPlatformPackageJson({ version })`, and `releaseAssetNames(version)`.
- Produces stable validation codes: `platform.unsupported_target`, `platform.version_invalid`, and `release.asset_name_invalid`.

- [ ] **Step 1: Write failing contract tests**

```js
test("core and Windows platform manifests use one exact release version", () => {
  assert.deepEqual(createCoreOptionalDependencies("1.2.3"), {
    "@xiaozhiclaw/agent-computer-use-win32-x64": "1.2.3",
  });
  assert.deepEqual(createPlatformPackageJson({ version: "1.2.3" }), {
    name: "@xiaozhiclaw/agent-computer-use-win32-x64",
    version: "1.2.3",
    private: false,
    license: "MIT",
    os: ["win32"],
    cpu: ["x64"],
    files: ["cua-driver", "overlay", "ocr-runtime", "models", "platform-manifest.json", "THIRD_PARTY_LICENSES.txt", "SBOM.cdx.json"],
  });
});

test("release assets contain core, platform, complete ZIP, checksums, SBOM, and manifest only", () => {
  assert.deepEqual(releaseAssetNames("1.2.3"), [
    "agent-computer-use-mcp-1.2.3.tgz",
    "agent-computer-use-win32-x64-1.2.3.tgz",
    "agent-computer-use-mcp-1.2.3-windows-x64.zip",
    "checksums.txt",
    "release-manifest.json",
    "SBOM.cdx.json",
  ]);
});
```

- [ ] **Step 2: Run the new tests and confirm RED**

Run: `node --test test/platform-package-contract.test.mjs test/protected-npm-build.test.mjs test/windows-release-distribution-contract.test.mjs`

Expected: FAIL because `src/platform-package-contract.mjs` and exact platform optional dependency behavior do not exist, and the old distribution test still expects an installer-based release.

- [ ] **Step 3: Implement the minimal pure contract module**

```js
export const WINDOWS_X64_TARGET = Object.freeze({ platform: "win32", arch: "x64", id: "windows-x64" });

export function createCoreOptionalDependencies(version) {
  assertReleaseVersion(version);
  return { "@xiaozhiclaw/agent-computer-use-win32-x64": version };
}

export function createPlatformPackageJson({ version }) {
  assertReleaseVersion(version);
  return {
    name: "@xiaozhiclaw/agent-computer-use-win32-x64",
    version,
    private: false,
    license: "MIT",
    os: ["win32"],
    cpu: ["x64"],
    files: ["cua-driver", "overlay", "ocr-runtime", "models", "platform-manifest.json", "THIRD_PARTY_LICENSES.txt", "SBOM.cdx.json"],
  };
}
```

Use `/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/` for generated release versions and return the six exact asset names from `releaseAssetNames(version)`.

- [ ] **Step 4: Update existing release contract assertions**

Change `test/protected-npm-build.test.mjs` to require the exact optional dependency and reject native payload entries in the protected core. Change `test/windows-release-distribution-contract.test.mjs` to assert two npm tarballs plus one complete ZIP and to reject `.exe`, `.msi`, `.msix`, `installer`, and `setup` artifact names.

- [ ] **Step 5: Run tests and confirm GREEN**

Run: `node --test test/platform-package-contract.test.mjs test/protected-npm-build.test.mjs test/windows-release-distribution-contract.test.mjs`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit the contract**

```bash
git add src/platform-package-contract.mjs test/platform-package-contract.test.mjs test/protected-npm-build.test.mjs test/windows-release-distribution-contract.test.mjs
git commit -m "test: freeze npm platform distribution contract"
```

### Task 2: Build One Canonical Windows Platform Stage and npm Package

**Files:**
- Create: `src/platform-payload-inventory.mjs`
- Create: `src/windows-platform-package.mjs`
- Create: `scripts/build-windows-platform-package.mjs`
- Create: `test/platform-payload-inventory.test.mjs`
- Create: `test/windows-platform-package.test.mjs`
- Modify: `scripts/build-protected-npm-package.mjs`
- Modify: `src/phase-0-14-protected-npm-release.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createCoreOptionalDependencies(version)` and `createPlatformPackageJson({ version })` from Task 1.
- Produces: `createPlatformInventory(root, options?) -> { target, version, files }`.
- Produces: `verifyPlatformInventory(root, manifest) -> { status: "passed", files }` or throws an error with a stable `platform.*` code.
- Produces: `buildWindowsPlatformPackage({ outputRoot, version, sourceCommit, assetLockPath }) -> { packageRoot, manifest, inventory }`.

- [ ] **Step 1: Write failing inventory tests**

Cover a valid nested fixture and each fail-closed condition with real temporary files:

```js
test("platform inventory is sorted and hashes every immutable payload file", async () => {
  const inventory = await createPlatformInventory(root, { version: "1.2.3", target: "windows-x64" });
  assert.deepEqual(inventory.files.map(({ path }) => path), ["cua-driver/driver.exe", "models/pp-ocr-v6/rec.onnx"]);
  assert.match(inventory.files[0].sha256, /^[a-f0-9]{64}$/);
});

test("platform inventory rejects Windows case-fold collisions", async () => {
  await assert.rejects(
    createPlatformInventory(root, { version: "1.2.3", target: "windows-x64" }),
    /platform\.path_case_collision/,
  );
});
```

Also test symlink/reparse-point rejection, traversal rejection, missing file, extra file, size mismatch, digest mismatch, duplicate path, unsorted manifest, wrong target, and wrong version.

- [ ] **Step 2: Run inventory tests and confirm RED**

Run: `node --test test/platform-payload-inventory.test.mjs`

Expected: FAIL because the inventory module does not exist.

- [ ] **Step 3: Implement inventory creation and verification**

Walk with `lstat`, reject `isSymbolicLink()`, normalize separators to `/`, reject absolute/empty/`.`/`..` segments, track `path.toLocaleLowerCase("en-US")`, stream each file through SHA-256, and sort using ordinal path comparison. Verification must compare the manifest and the complete on-disk inventory in both directions.

- [ ] **Step 4: Run inventory tests and confirm GREEN**

Run: `node --test test/platform-payload-inventory.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing platform package builder tests**

Use dependency injection for existing asset acquisition and overlay/OCR assembly so the test can materialize tiny real fixtures:

```js
test("builder produces the complete immutable Windows package from one stage", async () => {
  const result = await buildWindowsPlatformPackage({
    outputRoot,
    version: "1.2.3",
    sourceCommit: "a".repeat(40),
    materialize: fixtureMaterializer,
  });
  const manifest = JSON.parse(await readFile(join(outputRoot, "platform-manifest.json"), "utf8"));
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(manifest.target, { platform: "win32", arch: "x64", id: "windows-x64" });
  assert.deepEqual(JSON.parse(await readFile(join(outputRoot, "package.json"), "utf8")).os, ["win32"]);
  assert.equal(result.inventory.files.some(({ path }) => path.startsWith("overlay/")), true);
});
```

Assert required groups `cua-driver/`, `overlay/`, `ocr-runtime/`, and `models/pp-ocr-v6/`; `THIRD_PARTY_LICENSES.txt`; CycloneDX `SBOM.cdx.json`; atomic staging/rename; and no installer/cache/source-map entries.

- [ ] **Step 6: Run builder tests and confirm RED**

Run: `node --test test/windows-platform-package.test.mjs`

Expected: FAIL because the builder and command do not exist.

- [ ] **Step 7: Implement the platform builder and command**

`buildWindowsPlatformPackage` must create `<output>.staging-<uuid>`, invoke the materializer once, validate all required groups, write license and SBOM files, generate `platform-manifest.json` last, verify it, and atomically replace `outputRoot`. The command writes to `artifacts/npm-release/platform-win32-x64/package` by default and accepts `--output`, `--version`, and `--source-commit`.

Modify `buildProtectedNpmPackage` so its generated `package.json` receives:

```js
optionalDependencies: createCoreOptionalDependencies(packageJson.version)
```

Add scripts:

```json
{
  "release:npm:build:core": "node scripts/build-protected-npm-package.mjs",
  "release:npm:build:win32-x64": "node scripts/build-windows-platform-package.mjs"
}
```

- [ ] **Step 8: Run focused package tests and Phase 0.14**

Run: `node --test test/platform-payload-inventory.test.mjs test/windows-platform-package.test.mjs test/protected-npm-build.test.mjs test/phase-0-14-protected-npm-release.test.mjs`

Run: `npm run phase:0.14`

Expected: all tests and the phase gate PASS; generated core contains the exact optional dependency and no native bytes; generated platform package passes inventory verification.

- [ ] **Step 9: Commit the canonical stage and package**

```bash
git add src/platform-payload-inventory.mjs src/windows-platform-package.mjs scripts/build-windows-platform-package.mjs scripts/build-protected-npm-package.mjs src/phase-0-14-protected-npm-release.mjs package.json test/platform-payload-inventory.test.mjs test/windows-platform-package.test.mjs test/protected-npm-build.test.mjs test/phase-0-14-protected-npm-release.test.mjs
git commit -m "feat: build immutable Windows platform package"
```

### Task 3: Resolve and Verify the Platform Package Before MCP Startup

**Files:**
- Create: `src/platform-package-resolver.mjs`
- Create: `test/platform-package-resolver.test.mjs`
- Modify: `scripts/npm-release-launcher-template.mjs`
- Modify: `src/computer-use-mcp-server.mjs`
- Modify: `src/computer-use-errors.mjs`
- Modify: `src/computer-use-mcp-tools.mjs`
- Modify: `test/protected-npm-smoke.test.mjs`
- Modify: `test/phase-2-1-repair.test.mjs`

**Interfaces:**
- Consumes: `verifyPlatformInventory(root, manifest)` from Task 2.
- Produces: `resolveVerifiedPlatform({ platform, arch, coreVersion, resolvePackageJson, realpath }) -> { packageName, packageRoot, manifest, paths }`.
- Produces paths `{ cuaDriverRoot, overlayRoot, ocrRuntimeRoot, ocrModelRoot }` only after complete verification.
- Produces stable diagnostics `platform.unsupported`, `platform.package_missing`, `platform.version_mismatch`, `platform.linked_root`, `platform.manifest_invalid`, and `platform.integrity_failed` plus `npm install agent-computer-use-mcp@X.Y.Z` remediation.

- [ ] **Step 1: Write failing resolver tests**

```js
test("resolver returns native paths only after exact-version verification", async () => {
  const resolved = await resolveVerifiedPlatform({
    platform: "win32",
    arch: "x64",
    coreVersion: "1.2.3",
    resolvePackageJson: () => join(platformRoot, "package.json"),
    realpath,
  });
  assert.equal(resolved.packageName, "@xiaozhiclaw/agent-computer-use-win32-x64");
  assert.equal(resolved.paths.overlayRoot, join(platformRoot, "overlay"));
});

test("resolver fails closed on core/platform version mismatch", async () => {
  await assert.rejects(resolveVerifiedPlatform(options), /platform\.version_mismatch/);
});
```

Add tests for unsupported targets, missing optional dependency, linked package root, corrupt file, extra file, missing required component, and stable reinstall guidance that never invokes npm or fetch.

- [ ] **Step 2: Run resolver tests and confirm RED**

Run: `node --test test/platform-package-resolver.test.mjs`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement resolver and startup integration**

Use `createRequire(import.meta.url).resolve("@xiaozhiclaw/agent-computer-use-win32-x64/package.json")`, compare the package root with `realpath`, parse both package and platform manifests, require exact versions, call complete inventory verification, and then derive paths. The protected launcher passes the verified result to the server through an explicit `platformRuntime` option; no environment variable or cache path may override verified package paths.

Change `computer.repair` output for platform failures to a diagnosis plus exact reinstall command. Remove any branch that invokes npm, downloads assets, activates a cache generation, or mutates package files.

- [ ] **Step 4: Run resolver and MCP focused tests**

Run: `node --test test/platform-package-resolver.test.mjs test/protected-npm-smoke.test.mjs test/phase-2-1-repair.test.mjs test/computer-use-mcp.test.mjs`

Expected: PASS. A corrupt platform fixture must prevent MCP startup before `listTools` is available.

- [ ] **Step 5: Commit runtime resolution**

```bash
git add src/platform-package-resolver.mjs src/computer-use-mcp-server.mjs src/computer-use-errors.mjs src/computer-use-mcp-tools.mjs scripts/npm-release-launcher-template.mjs test/platform-package-resolver.test.mjs test/protected-npm-smoke.test.mjs test/phase-2-1-repair.test.mjs
git commit -m "feat: verify platform package before MCP startup"
```

### Task 4: Assemble and Smoke the Complete Offline ZIP

**Files:**
- Create: `src/platform-release-assembly.mjs`
- Create: `scripts/build-platform-release.mjs`
- Create: `scripts/offline-platform-smoke.mjs`
- Create: `test/platform-release-assembly.test.mjs`
- Create: `test/offline-platform-smoke.test.mjs`
- Modify: `scripts/pack-protected-npm-package.mjs`
- Modify: `scripts/create-deterministic-zip.ps1`
- Modify: `src/phase-0-15-real-release-assembly.mjs`
- Modify: `scripts/windows-release-size-report.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes both generated package roots and `createPlatformInventory`.
- Produces: `assemblePlatformRelease({ version, sourceCommit, outputRoot, corePackageRoot, platformPackageRoot, installProductionDependencies }) -> { assets, releaseManifest, inventoryComparison }`.
- Produces: `smokeOfflineBundle({ zipPath, spawn, networkGuard }) -> { toolsListed, doctorPassed, platformVerified, desktopControlStarted: false }`.

- [ ] **Step 1: Write failing release assembly tests**

```js
test("release assembly emits two npm tarballs and a complete offline ZIP", async () => {
  const result = await assemblePlatformRelease(fixtureOptions);
  assert.deepEqual(result.assets.map(({ name }) => name).sort(), releaseAssetNames("1.2.3").sort());
  assert.equal(result.inventoryComparison.status, "identical");
});

test("ZIP platform subtree is byte-identical to the npm platform tarball", async () => {
  const npmInventory = await inventoryExtractedPlatformTgz(result.platformTgz);
  const zipInventory = await inventoryExtractedZipPlatform(result.offlineZip);
  assert.deepEqual(zipInventory, npmInventory);
});
```

Assert the ZIP contains `bin/agent-computer-use-mcp.mjs`, protected core, full `node_modules`, verified platform subtree, checksums, licenses, SBOM, and no installer/updater/cache/source-map files.

- [ ] **Step 2: Run assembly tests and confirm RED**

Run: `node --test test/platform-release-assembly.test.mjs test/offline-platform-smoke.test.mjs`

Expected: FAIL because platform release assembly and offline smoke do not exist.

- [ ] **Step 3: Implement one-run release assembly**

Pack each package with `npm pack --json`, normalize output names to the contract, create the offline root from the already-built package directories, install only production JavaScript dependencies into the offline root with a lockfile-controlled `npm ci --omit=dev --ignore-scripts`, and copy the canonical platform stage without transforming any files. Generate sorted SHA-256 `checksums.txt`, a CycloneDX release SBOM, and `release-manifest.json` containing tag version, source commit, target, artifact hashes, and canonical platform inventory.

Use the deterministic ZIP script with fixed source commit time and then reopen/extract both npm platform tarball and ZIP to compare inventories before returning success.

- [ ] **Step 4: Implement an official MCP SDK offline smoke**

Extract to a new temporary directory, spawn the ZIP launcher with a child environment containing `AGENT_COMPUTER_USE_NETWORK_DISABLED=1`, connect using `StdioClientTransport`, call `listTools`, `computer.health`, and `computer.doctor`, require verified native paths, assert desktop control never starts, then close the client and require a clean child exit.

- [ ] **Step 5: Run focused tests and Phase 0.15**

Run: `node --test test/platform-release-assembly.test.mjs test/offline-platform-smoke.test.mjs test/windows-release-size-report.test.mjs test/phase-0-15-real-release-assembly.test.mjs`

Run: `npm run phase:0.15`

Run: `npm run release:windows:size-report`

Expected: PASS; output contains exactly the six contracted release assets and the compressed complete ZIP remains below the existing 310 MiB Windows x64 limit.

- [ ] **Step 6: Commit complete offline delivery**

```bash
git add src/platform-release-assembly.mjs scripts/build-platform-release.mjs scripts/offline-platform-smoke.mjs scripts/pack-protected-npm-package.mjs scripts/create-deterministic-zip.ps1 src/phase-0-15-real-release-assembly.mjs scripts/windows-release-size-report.mjs package.json test/platform-release-assembly.test.mjs test/offline-platform-smoke.test.mjs test/windows-release-size-report.test.mjs test/phase-0-15-real-release-assembly.test.mjs
git commit -m "feat: assemble complete Windows offline release"
```

### Task 5: Remove the Installer and Runtime Asset Lifecycle

**Files:**
- Delete: `windows-installer/`
- Delete: `src/windows-installer-host.mjs`
- Delete: `src/asset-installer-host.mjs`
- Delete: `src/active-asset-state.mjs`
- Delete: `src/asset-operation-manager.mjs`
- Delete: `scripts/install-cache-doctor.mjs`
- Delete: `scripts/verify-authenticode.ps1`
- Delete: installer/cache transaction tests superseded by platform resolver and ZIP tests
- Create: `src/phase-7-8-platform-package-integrity.mjs`
- Create: `src/phase-7-9-offline-package-identity.mjs`
- Create: `test/no-installer-architecture.test.mjs`
- Create: `test/phase-7-8-platform-package-integrity.test.mjs`
- Create: `test/phase-7-9-offline-package-identity.test.mjs`
- Modify: `package.json`
- Modify: current runtime, repair, release, and readiness modules that import deleted lifecycle code

**Interfaces:**
- Phase 7.8 proves package resolution, exact version, immutable inventory, and stable repair diagnostics.
- Phase 7.9 proves npm-platform/ZIP platform byte identity and a network-free offline start.
- `computer.repair` remains read-only diagnosis for native package failures.

- [ ] **Step 1: Write the failing architecture-removal gate**

```js
test("current product contains no installer or private native updater architecture", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith("installer:")), false);
  assert.equal(packageJson.files.some((entry) => /windows-installer/i.test(entry)), false);
  await assert.rejects(stat("windows-installer"), { code: "ENOENT" });
  assert.doesNotMatch(await readFile(".github/workflows/release.yml", "utf8"), /azure\/artifact-signing|authenticode|\.msi|installer/i);
});
```

Limit the documentation scan to current normative documents: `README.md`, `docs/productization/README.md`, `docs/productization/roadmap.md`, `docs/productization/release-gates.md`, and `docs/productization/real-release-pipeline-spec.md`. Historical approved specs and implementation plans remain historical records.

- [ ] **Step 2: Run the removal gate and confirm RED**

Run: `node --test test/no-installer-architecture.test.mjs`

Expected: FAIL on the existing installer directory, scripts, workflow, and normative docs.

- [ ] **Step 3: Delete installer-specific code and rewire shared safety behavior**

Delete only code whose authority is installation, download, activation, rollback, or cache generation. Keep reusable SHA-256, signed release lock, diagnostics, policy, and runtime cleanup primitives when they remain independent of package mutation. Replace cache/installer call sites with `resolveVerifiedPlatform` and read-only diagnostics. Remove installer scripts and `windows-installer` from `files`.

Replace scripts with:

```json
{
  "phase:7.8": "node src/phase-7-8-platform-package-integrity.mjs",
  "phase:7.9": "node src/phase-7-9-offline-package-identity.mjs"
}
```

- [ ] **Step 4: Add and run replacement phase tests**

Run: `node --test test/phase-7-8-platform-package-integrity.test.mjs test/phase-7-9-offline-package-identity.test.mjs test/no-installer-architecture.test.mjs test/phase-2-0-doctor.test.mjs test/phase-2-1-repair.test.mjs`

Run: `npm run phase:7.8`

Run: `npm run phase:7.9`

Expected: PASS; repair output contains only diagnosis and an exact npm reinstall command, while package files remain unchanged.

- [ ] **Step 5: Run the full suite to expose stale lifecycle coupling**

Run: `npm test`

Expected: PASS. Any test that still asserts installer/cache mutation must be rewritten against package integrity or removed when fully superseded; tests for policy, approvals, cancellation, daemon cleanup, overlay, OCR, and MCP schemas must remain.

- [ ] **Step 6: Commit architecture removal**

```bash
git add -A
git commit -m "refactor: remove installer and runtime asset updater"
```

### Task 6: Implement Tag Release, npm Provenance, and Gitee Byte Mirror

**Files:**
- Create: `src/gitee-release-mirror.mjs`
- Create: `scripts/mirror-gitee-release.mjs`
- Create: `scripts/verify-gitee-release.mjs`
- Create: `test/gitee-release-mirror.test.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `test/formal-release-workflow.test.mjs`
- Modify: `scripts/post-publish-smoke.mjs`
- Modify: `src/formal-release-policy.mjs`
- Modify: `test/formal-release-policy.test.mjs`

**Interfaces:**
- Produces: `planGiteeMirror({ githubAssets, giteeAssets }) -> { keep, replace, upload, remove }` using name/size/SHA-256 identity.
- Produces: `mirrorGiteeRelease({ owner, repo, tag, assets, token, fetch }) -> { status, releaseId, assets, hashes }`.
- Produces: `verifyGiteeRelease({ owner, repo, tag, expectedAssets, token, fetch }) -> { status: "passed", assets }`.

- [ ] **Step 1: Write failing Gitee mirror tests**

```js
test("mirror keeps identical assets and replaces same-name mismatches", async () => {
  assert.deepEqual(planGiteeMirror({ githubAssets, giteeAssets }), {
    keep: ["checksums.txt"],
    replace: ["agent-computer-use-mcp-1.2.3-windows-x64.zip"],
    upload: ["SBOM.cdx.json"],
    remove: ["obsolete.exe"],
  });
});

test("mirror report never contains the Gitee token", async () => {
  const report = await mirrorGiteeRelease({ ...fixture, token: "secret-token", fetch: fakeFetch });
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});
```

Test create-or-update release, paginated asset listing, idempotent rerun, delete-and-reupload mismatch, checksum verification, URL encoding, 429/5xx bounded retry, GitHub/npm success preservation when Gitee fails, and sanitized errors.

- [ ] **Step 2: Run mirror tests and confirm RED**

Run: `node --test test/gitee-release-mirror.test.mjs`

Expected: FAIL because the mirror module does not exist.

- [ ] **Step 3: Implement the Gitee v5 mirror client**

Use injected `fetch`, `Authorization: token <value>`, bounded exponential retry for 429/5xx, and multipart uploads to the configured owner/repo/tag release. Never place the token in query strings, logs, thrown messages, persisted reports, or artifact metadata. Compute each local asset SHA-256 before upload, and verify remote name/size plus the mirrored `checksums.txt` inventory after upload. Reruns retain identical assets and replace mismatches.

- [ ] **Step 4: Run mirror tests and confirm GREEN**

Run: `node --test test/gitee-release-mirror.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write the failing workflow contract**

The test must parse YAML and assert this exact dependency order:

```text
validate -> build-release -> draft-github-release -> publish-platform-npm
-> publish-core-npm -> post-publish-npm-smoke -> publish-github-release
-> mirror-gitee-release -> verify-gitee-release
```

Also assert: trigger is `v*`; both npm publishes use `--access public --provenance`; platform publishes first; draft is created before npm; clean smoke installs only `agent-computer-use-mcp@X.Y.Z` from public npm; GitHub draft publishes only after smoke; Gitee jobs use `environment: release`, `vars.GITEE_OWNER`, `vars.GITEE_REPO`, and `secrets.GITEE_TOKEN`; no Azure, Authenticode, installer, test certificate, or private asset-signing secret appears.

- [ ] **Step 6: Run workflow tests and confirm RED**

Run: `node --test test/formal-release-workflow.test.mjs test/formal-release-policy.test.mjs`

Expected: FAIL because the current workflow signs and publishes installer artifacts and publishes only one npm package.

- [ ] **Step 7: Rewrite the release workflow**

Build release assets once on `windows-2025`; upload them as one Actions artifact; create a GitHub draft with all six assets; publish the platform tarball first and core tarball second with npm trusted publishing/provenance; on a clean Windows runner run `npm install agent-computer-use-mcp@X.Y.Z`, start the installed standard MCP server with the official SDK, verify package integrity/health/doctor, and exit; publish GitHub Release; mirror the downloaded GitHub assets to Gitee; verify the mirror. Make Gitee failure visible and retryable without deleting or rolling back npm/GitHub publication.

- [ ] **Step 8: Run workflow and mirror tests**

Run: `node --test test/formal-release-workflow.test.mjs test/formal-release-policy.test.mjs test/gitee-release-mirror.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit the dual-channel release workflow**

```bash
git add .github/workflows/release.yml src/gitee-release-mirror.mjs scripts/mirror-gitee-release.mjs scripts/verify-gitee-release.mjs scripts/post-publish-smoke.mjs src/formal-release-policy.mjs test/gitee-release-mirror.test.mjs test/formal-release-workflow.test.mjs test/formal-release-policy.test.mjs
git commit -m "ci: publish npm platform packages and mirror releases"
```

### Task 7: Publish the Normative Docs and Run Every Release Gate

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/productization/README.md`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/real-release-pipeline-spec.md`
- Modify: `docs/superpowers/specs/2026-07-11-npm-platform-distribution-design.md` only to mark implementation status and link this plan

**Interfaces:**
- Documents the one-name npm install, exact platform selection, complete offline ZIP, Node.js 20 floor, no runtime download/installer, rollback via npm version pin, Gitee mirror trust model, and maintainer release recovery procedure.

- [ ] **Step 1: Update current documentation**

Document these exact user commands:

```powershell
npm install agent-computer-use-mcp@X.Y.Z
npx -y agent-computer-use-mcp@X.Y.Z
node .\agent-computer-use-mcp-X.Y.Z-windows-x64\bin\agent-computer-use-mcp.mjs
```

State that npm automatically installs `@xiaozhiclaw/agent-computer-use-win32-x64@X.Y.Z`, the offline ZIP is complete, Gitee mirrors GitHub bytes, and `computer.repair` never downloads or mutates installation files. Add maintainer steps for retrying only the Gitee mirror after an outage and for verifying `checksums.txt` before publication.

- [ ] **Step 2: Run documentation and architecture tests**

Run: `node --test test/no-installer-architecture.test.mjs test/windows-release-distribution-contract.test.mjs test/formal-release-workflow.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run package dry runs and inspect public inventories**

Run: `npm run release:npm:build:core`

Run: `npm run release:npm:build:win32-x64`

Run: `npm pack --dry-run --json artifacts/npm-release/package`

Run: `npm pack --dry-run --json artifacts/npm-release/platform-win32-x64/package`

Expected: core contains protected runtime/docs/license/integrity only; platform contains native payload/manifest/licenses/SBOM only; neither inventory includes first-party source maps, tests, secrets, installer files, or mutable cache state.

- [ ] **Step 4: Run all local release phases**

Run: `npm run phase:0.14`

Run: `npm run phase:0.15`

Run: `npm run phase:7.8`

Run: `npm run phase:7.9`

Run: `npm run release:windows:size-report`

Expected: every phase reports `passed`, platform inventories are identical, offline MCP smoke succeeds, and the complete ZIP is under 310 MiB.

- [ ] **Step 5: Run the full regression suite**

Run: `npm test`

Expected: all tests pass with zero failures, including existing MCP protocol, policy, approval, cancellation, daemon, OCR, overlay, concurrency, and real-app gates.

- [ ] **Step 6: Verify repository hygiene**

Run: `git diff --check`

Run: `git status --short`

Run: `rg -n "azure/artifact-signing|Authenticode|windows-installer|installer:build|installer:publish|AGENT_COMPUTER_USE_ASSET_PRIVATE_KEY" package.json .github README.md docs/productization src scripts test`

Expected: no whitespace errors; only intended source changes remain; the search returns no current architecture references except explicitly named historical-removal assertions.

- [ ] **Step 7: Commit documentation and final gates**

```bash
git add README.md CHANGELOG.md docs/productization docs/superpowers/specs/2026-07-11-npm-platform-distribution-design.md
git commit -m "docs: publish npm platform distribution operations"
```

- [ ] **Step 8: Perform final verification before PR**

Run: `git log --oneline --decorate -8`

Run: `git status --short`

Expected: the feature branch contains reviewable commits for contract, package build, resolver, offline ZIP, architecture removal, release workflow, and docs; the worktree is clean.

## Completion Criteria

- Installing only `agent-computer-use-mcp@X.Y.Z` on Windows x64 installs and verifies the exact matching platform package.
- Starting with a missing, mismatched, linked, corrupt, or incomplete platform package fails before MCP desktop control starts and emits a stable reinstall command.
- The npm platform tarball and complete ZIP carry byte-identical platform payload inventories.
- The ZIP starts through an official MCP SDK client without npm, network, installer, elevation, or desktop control during smoke.
- No current product code or release workflow contains a Windows installer, private updater, runtime asset downloader, or production Authenticode dependency.
- A `v*` tag creates a draft, publishes platform then core npm packages with provenance, passes a clean public install smoke, publishes GitHub Release, and mirrors exact bytes to Gitee.
- All focused tests, phase gates, package dry runs, size checks, and the complete test suite pass.
