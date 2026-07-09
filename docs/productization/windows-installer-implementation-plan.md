# Windows Installer Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real, offline-capable Windows install, upgrade, status, and rollback transaction for a versioned `agent-computer-use-mcp` release bundle.

**Architecture:** Release jobs use a Node builder to turn already-built package and helper artifacts into a deterministic local bundle with a file-level SHA-256 manifest. A small .NET 10 installer verifies the local bundle, stages an immutable release, atomically switches `install-state.json`, retains the previous version for rollback, and initializes stable program/data/cache roots. Network acquisition, Authenticode signing, and end-user wizard UI remain separate layers and cannot bypass this transaction engine.

**Tech Stack:** Node.js 20 ESM, Node test runner, .NET 10 console application, `System.Text.Json`, `System.Security.Cryptography`, GitHub Actions Windows runners.

## Global Constraints

- The installer is per-user and defaults to `%LOCALAPPDATA%\Programs\AgentComputerUse` and `%LOCALAPPDATA%\AgentComputerUse`.
- Tests and host products can override both roots explicitly; tests must never write to real user install roots.
- The transaction consumes a local directory bundle. It never downloads assets, starts desktop control, or starts the user overlay.
- Every payload file must have a normalized relative path, byte length, and SHA-256 hash in `release-manifest.json`.
- Release directories are immutable after activation. Activation changes only `state/install-state.json`.
- `install-state.json` records `currentVersion`, `previousVersion`, monotonically increasing `revision`, and activation time.
- Failed verification or staging leaves the active version unchanged and removes transaction staging files.
- Rollback is allowed only when the previous release exists and passes manifest verification.
- No generated installers, bundles, model packs, or helper binaries are committed to Git.
- Overlay exclusion remains unchanged: `includeUserOverlay=false` and no installer operation captures a screen.

---

### Task 1: Deterministic Release Bundle Builder

**Files:**

- Create: `src/release-bundle.mjs`
- Create: `test/release-bundle.test.mjs`

**Interfaces:**

- Produces: `buildReleaseManifest({ packageName, version, sourceRoot, files, generatedAt })`
- Produces: `materializeReleaseBundle({ packageName, version, sourceRoot, outputRoot, files, generatedAt })`
- Produces: `verifyReleaseBundle({ bundleRoot })`
- Manifest shape: `{ schemaVersion: 1, packageName, version, generatedAt, files: [{ path, bytes, sha256 }] }`

- [ ] **Step 1: Write failing tests for deterministic manifests and path safety**

```js
test("release bundle materializes hashed payload files", async () => {
  const result = await materializeReleaseBundle({
    packageName: "agent-computer-use-mcp",
    version: "0.0.1",
    sourceRoot,
    outputRoot,
    files: ["package/package.json", "helpers/overlay.exe"],
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  assert.equal(result.status, "ready");
  assert.equal((await verifyReleaseBundle({ bundleRoot: outputRoot })).status, "ready");
});

test("release bundle rejects traversal and mismatched hashes", async () => {
  await assert.rejects(
    () => materializeReleaseBundle({ sourceRoot, outputRoot, files: ["../secret.txt"] }),
    /bundle\.path_invalid/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/release-bundle.test.mjs`

Expected: FAIL because `src/release-bundle.mjs` does not exist.

- [ ] **Step 3: Implement deterministic copy, hashing, and verification**

```js
export async function materializeReleaseBundle(options) {
  const manifest = await buildReleaseManifest(options);
  await mkdir(join(options.outputRoot, "payload"), { recursive: true });
  for (const file of manifest.files) {
    await copyFile(
      resolveSafe(options.sourceRoot, file.path),
      resolveSafe(join(options.outputRoot, "payload"), file.path),
    );
  }
  await writeFile(
    join(options.outputRoot, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return verifyReleaseBundle({ bundleRoot: options.outputRoot });
}
```

Implementation must sort normalized paths, reject absolute/traversal/duplicate paths, create parent directories, and re-read copied payload files during verification.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/release-bundle.test.mjs`

Expected: PASS with traversal and corruption cases covered.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 1**

```sh
git add src/release-bundle.mjs test/release-bundle.test.mjs
git commit -m "feat: add deterministic release bundle builder"
```

### Task 2: Native Installer Transaction Engine

**Files:**

- Create: `windows-installer/AgentComputerUse.Installer.csproj`
- Create: `windows-installer/InstallerModels.cs`
- Create: `windows-installer/InstallerJsonContext.cs`
- Create: `windows-installer/InstallerLayout.cs`
- Create: `windows-installer/ReleaseVerifier.cs`
- Create: `windows-installer/InstallerEngine.cs`
- Create: `windows-installer/Program.cs`
- Create: `test/windows-installer-transaction.test.mjs`

**Interfaces:**

- CLI: `install --bundle <path> --program-root <path> --data-root <path>`
- CLI: `upgrade --bundle <path> --program-root <path> --data-root <path>`
- CLI: `rollback --program-root <path> --data-root <path>`
- CLI: `status --program-root <path> --data-root <path>`
- Exit `0`: structured JSON `{ status, operation, currentVersion, previousVersion, revision, activePayloadRoot }`
- Non-zero: structured JSON on stdout `{ status: "failed", operation, error: { code, message } }`

- [ ] **Step 1: Write the failing black-box transaction test**

```js
test("Windows installer performs install upgrade and rollback on real files", async () => {
  const v1 = await fixtureBundle("0.0.1", { "package/version.txt": "v1" });
  const v2 = await fixtureBundle("0.0.2", { "package/version.txt": "v2" });

  assert.equal((await runInstaller("install", v1)).currentVersion, "0.0.1");
  assert.equal((await runInstaller("upgrade", v2)).currentVersion, "0.0.2");

  const rolledBack = await runInstaller("rollback");
  assert.equal(rolledBack.currentVersion, "0.0.1");
  assert.equal(rolledBack.previousVersion, "0.0.2");
  assert.equal(await readFile(join(rolledBack.activePayloadRoot, "package/version.txt"), "utf8"), "v1");
});
```

Add cases proving a corrupted bundle does not change the active version, rollback fails closed when no previous version exists, and all cache/data directories are initialized.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/windows-installer-transaction.test.mjs`

Expected: FAIL because the .NET installer project does not exist.

- [ ] **Step 3: Implement the .NET installer project and JSON contracts**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PublishAot>true</PublishAot>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
```

Use source-generated `System.Text.Json` metadata for `ReleaseManifest`, `InstallState`, `InstallerResult`, and `InstallerError` so later NativeAOT release publishing does not depend on runtime reflection.

- [ ] **Step 4: Implement safe manifest verification and immutable staging**

```csharp
public VerifiedRelease Verify(string releaseRoot)
{
    var manifest = ReadManifest(releaseRoot);
    foreach (var file in manifest.Files)
    {
        var fullPath = ResolvePayloadPath(releaseRoot, file.Path);
        Require(File.Exists(fullPath), "installer.payload_missing");
        Require(new FileInfo(fullPath).Length == file.Bytes, "installer.size_mismatch");
        Require(Hash(fullPath) == file.Sha256, "installer.hash_mismatch");
    }
    return new VerifiedRelease(manifest, Path.Combine(releaseRoot, "payload"));
}
```

Reject rooted paths, `.`/`..`, duplicate case-insensitive paths, invalid versions, unsupported schema versions, and empty manifests before touching the active state.

- [ ] **Step 5: Implement install, upgrade, status, and rollback state transitions**

```csharp
var stageRoot = layout.CreateTransactionStage();
try
{
    CopyBundle(bundleRoot, stageRoot);
    verifier.Verify(stageRoot);
    Directory.Move(stageRoot, finalReleaseRoot);
    WriteStateAtomically(nextState);
}
finally
{
    if (Directory.Exists(stageRoot)) Directory.Delete(stageRoot, recursive: true);
}
```

Installation of an already-active verified version is idempotent. Upgrade retains the old current version as previous. Rollback swaps current and previous only after verifying the target release. State revisions increase on every successful activation.

- [ ] **Step 6: Run focused tests, build, and NativeAOT publish**

Run: `node --test test/windows-installer-transaction.test.mjs`

Expected: PASS for install, upgrade, rollback, corruption cleanup, and root initialization.

Run: `dotnet build windows-installer/AgentComputerUse.Installer.csproj --configuration Release`

Expected: build succeeds with zero errors.

Run: `dotnet publish windows-installer/AgentComputerUse.Installer.csproj --configuration Release --runtime win-x64 --self-contained true --output artifacts/windows-installer/win-x64`

Expected: a self-contained `AgentComputerUse.Installer.exe` is produced under the ignored `artifacts/` root.

- [ ] **Step 7: Commit Task 2**

```sh
git add windows-installer test/windows-installer-transaction.test.mjs
git commit -m "feat: add transactional Windows installer"
```

### Task 3: Executable Phase 7.8 Installer Proof

**Files:**

- Create: `src/phase-7-8-windows-installer-transaction.mjs`
- Create: `test/phase-7-8-windows-installer-transaction.test.mjs`
- Modify: `package.json`
- Modify: `src/computer-use-provider-router.mjs`

**Interfaces:**

- Script: `npm run phase:7.8`
- Report: `{ status: "passed", phase: "7.8", install, upgrade, rollback, corruptedBundleRejected, startsDesktopControl: false, includeUserOverlay: false }`
- Script: `npm run installer:publish:win-x64`

- [ ] **Step 1: Write the failing phase contract test**

```js
test("Phase 7.8 proves real installer transactions", async () => {
  assert.equal(packageJson.scripts["phase:7.8"], "node src/phase-7-8-windows-installer-transaction.mjs");
  const report = JSON.parse((await runNode(["src/phase-7-8-windows-installer-transaction.mjs"])).stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.install.currentVersion, "0.0.1");
  assert.equal(report.upgrade.currentVersion, "0.0.2");
  assert.equal(report.rollback.currentVersion, "0.0.1");
  assert.equal(report.corruptedBundleRejected, true);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});
```

- [ ] **Step 2: Run the phase test and verify RED**

Run: `node --test test/phase-7-8-windows-installer-transaction.test.mjs`

Expected: FAIL because `phase:7.8` is not registered.

- [ ] **Step 3: Implement the phase runner and package scripts**

The runner creates two local fixture bundles under an OS temp directory, executes the built installer for install/upgrade/rollback, corrupts a third bundle, verifies the active version remains unchanged, prints one JSON report, and removes all fixtures in `finally`.

Register:

```json
{
  "phase:7.8": "node src/phase-7-8-windows-installer-transaction.mjs",
  "installer:build": "dotnet build windows-installer/AgentComputerUse.Installer.csproj --configuration Release",
  "installer:publish:win-x64": "dotnet publish windows-installer/AgentComputerUse.Installer.csproj --configuration Release --runtime win-x64 --self-contained true --output artifacts/windows-installer/win-x64"
}
```

- [ ] **Step 4: Run focused and full verification**

Run: `node --test test/phase-7-8-windows-installer-transaction.test.mjs`

Expected: PASS.

Run: `npm run phase:7.8`

Expected: JSON report with `status=passed`.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```sh
git add package.json src/computer-use-provider-router.mjs src/phase-7-8-windows-installer-transaction.mjs test/phase-7-8-windows-installer-transaction.test.mjs
git commit -m "test: add real Windows installer transaction gate"
```

### Task 4: Release Gate, CI, and Operator Documentation

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Test: `test/package-foundation.test.mjs`
- Test: `test/phase-0-11-release-readiness.test.mjs`

**Interfaces:**

- CI installs .NET 10 and runs `npm run phase:7.8`.
- The npm package includes `windows-installer/*.csproj` and `windows-installer/*.cs` source, not generated binaries.
- Roadmap explicitly distinguishes completed proof gates from real transaction execution.

- [ ] **Step 1: Write failing package/release-gate assertions**

```js
assert.ok(files.includes("windows-installer/AgentComputerUse.Installer.csproj"));
assert.ok(files.includes("windows-installer/Program.cs"));
assert.equal(releaseGate.requiredCommands.includes("npm run phase:7.8"), true);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/package-foundation.test.mjs test/phase-0-11-release-readiness.test.mjs`

Expected: FAIL because installer source and Phase 7.8 are absent from package/release contracts.

- [ ] **Step 3: Update CI, package policy, roadmap, release gates, and operator docs**

CI additions:

```yaml
- name: Setup .NET
  uses: actions/setup-dotnet@v4
  with:
    dotnet-version: "10.0.x"

- name: Verify real Windows installer transaction
  run: npm run phase:7.8
```

Document that the installer is a headless per-user transaction engine, consumes only verified local bundles, and is the sole writer of release activation state. Keep asset acquisition and signing as explicit follow-up gates.

- [ ] **Step 4: Run final verification**

Run: `npm run installer:build`

Run: `npm run installer:publish:win-x64`

Run: `npm run phase:7.8`

Run: `npm run phase:1.6`

Run: `npm run phase:1.7`

Run: `npm run phase:1.8`

Run: `npm run package:dry-run`

Run: `npm pack --dry-run --json`

Run: `npm test`

Run: `git diff --check`

Expected: every command exits `0`; generated artifacts remain ignored; installer operations report `startsDesktopControl=false` and `includeUserOverlay=false`.

- [ ] **Step 5: Commit Task 4**

```sh
git add .github/workflows/ci.yml docs/productization README.md CHANGELOG.md package.json test/package-foundation.test.mjs test/phase-0-11-release-readiness.test.mjs
git commit -m "docs: gate transactional Windows installation"
```

## Follow-On PR Sequence

1. `feat/asset-cache-materializer`: signed asset manifest schema, resumable download, local/offline source adapters, SHA-256/AuthentiCode verification, content-addressed cache, and approved repair execution.
2. `test/real-app-smoke-runner`: executable result store plus Notepad, browser, Electron, WPF, and WinForms smoke adapters; unavailable third-party apps report `skipped_environment`, never fabricated success.
3. `feat/ocr-pack-delivery`: PP-OCRv6 small pack acquisition, file verification, compute-provider probing, warm process lifetime, crop/diff benchmark corpus, and latency history artifacts.
4. `test/runtime-soak-harness`: daemon soak, abnormal MCP disconnect, multi-client pressure, child crash loops, stale process/port cleanup, and restart recovery evidence.
5. `ci/release-pipeline`: tag validation, npm tarball and offline bundle build, installer NativeAOT publish, Authenticode hook, checksums, GitHub Release draft, and explicit npm/private distribution channel selection.
6. `docs/open-source-governance`: concise public README, contribution and AI coding rules, security response policy, architecture decision records, and release operator runbook.

Each follow-on PR gets its own implementation plan and must pass review before the next layer is allowed to depend on it.
