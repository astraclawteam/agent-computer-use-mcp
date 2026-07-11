# npm Platform Distribution Design

**Status:** Approved for planning

**Date:** 2026-07-11

## Decision

`agent-computer-use-mcp` has exactly two official distribution channels:

1. Public npm is the primary channel.
2. GitHub Release provides a complete platform ZIP for offline and manual use.

The project does not ship or require a Windows installer. Users install only
`agent-computer-use-mcp`; npm automatically selects the compatible platform
package. The first supported target is Windows x64. Other platform packages
remain unpublished until they pass native validation.

## Goals

- Preserve a standard MCP entry point that works in VS Code, Codex, Claude, and
  other standards-compliant MCP hosts.
- Require only one user-facing npm install or `npx` package name.
- Deliver every required native byte during npm installation, with no first-use
  download.
- Make the GitHub Windows x64 ZIP complete and runnable without `npm install`.
- Keep runtime operation local and offline after package acquisition.
- Make npm versioning the installation, upgrade, downgrade, and rollback model.
- Keep npm provenance, exact hashes, SBOM, licenses, and reproducible package
  inventories as release gates.

## Non-goals

- A Windows MSI, MSIX, EXE installer, setup wizard, Start Menu entry, service,
  scheduled task, or machine-wide installation.
- A private updater or a second package manager inside the MCP server.
- Runtime downloading, activation, or rollback of cua-driver, OCR models, or the
  overlay.
- Publishing macOS or Linux packages before real native validation.
- Guaranteeing that GitHub is directly reachable from every network.

## Considered Approaches

### Selected: core package plus platform optional dependency

The public core package declares exact-version platform packages in
`optionalDependencies`. Each platform package declares npm `os` and `cpu`
constraints. npm skips incompatible packages and installs the matching package.

This gives users one install command, avoids downloading unrelated platforms,
and allows the platform payload to carry all native bytes.

### Rejected: Playwright-style post-install asset download

Keeping native assets outside npm would make the core package smaller, but it
would introduce first-use latency, network failure modes, cache repair logic,
and a separate asset lifecycle. It conflicts with offline-first operation.

### Rejected: one fat cross-platform npm package

Bundling all operating systems into the core package would make installation
simple but force every user to download unrelated native assets. The cost grows
with every supported platform.

## Package Architecture

### Public core package

Package name:

```text
agent-computer-use-mcp
```

The protected public package contains:

- the standard MCP server and launcher;
- JavaScript production dependencies;
- strict tool and output schemas;
- platform resolver and manifest verifier;
- public documentation and license metadata;
- no first-party source maps;
- no Windows installer or installer source;
- no native platform payload.

For release `X.Y.Z`, the core manifest declares:

```json
{
  "optionalDependencies": {
    "@agent-computer-use/win32-x64": "X.Y.Z"
  }
}
```

Versions are exact. Ranges and tags such as `latest` are forbidden in the
generated release manifest.

### Windows x64 platform package

Package name:

```text
@agent-computer-use/win32-x64
```

Its release manifest includes:

```json
{
  "version": "X.Y.Z",
  "os": ["win32"],
  "cpu": ["x64"]
}
```

The package contains:

```text
@agent-computer-use/win32-x64/
├── package.json
├── platform-manifest.json
├── cua-driver/
├── overlay/
├── ocr-runtime/
├── models/pp-ocr-v6/
├── THIRD_PARTY_LICENSES.txt
└── SBOM.cdx.json
```

`platform-manifest.json` records the release version, target identity, relative
path, media type, byte size, and SHA-256 of every shipped file. Paths must be
sorted, unique under Windows case folding, relative, and free of links.

The platform package is immutable. The MCP runtime never modifies its contents.

## Runtime Resolution

At startup, the core MCP runtime:

1. Maps `process.platform` and `process.arch` to a supported package name.
2. Resolves that package with Node package resolution from the core launcher.
3. Requires the core and platform package versions to match exactly.
4. Validates the platform identity and complete file inventory.
5. Resolves cua-driver, overlay, OCR runtime, and model paths only from the
   verified platform package root.
6. Starts the standard MCP server only after verification succeeds.

Missing, mismatched, linked, corrupt, or incomplete packages fail closed with a
stable diagnostic code and a reinstall command. Computer Use never starts in a
degraded native state.

Runtime-writable state is limited to user data:

```text
%LOCALAPPDATA%\AgentComputerUse\
├── logs\
├── traces\
├── artifacts\
├── sessions\
└── cache\
```

This directory contains no authoritative program version or active native asset
selection. It can be removed without uninstalling the package.

## Installation, Upgrade, and Rollback

npm owns package lifecycle:

```text
npm install agent-computer-use-mcp@X.Y.Z
```

- Upgrade installs a newer core and exact matching platform version.
- Downgrade or rollback installs an older matching version.
- The MCP server does not self-update.
- `computer.repair` may diagnose a missing or corrupt platform package and emit
  an exact reinstall command, but it must not run npm or access the network.
- Global, host-managed, workspace-local, and `npx` installations use the same
  resolver contract.

The standard host configuration remains one package name:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["-y", "agent-computer-use-mcp@X.Y.Z"]
    }
  }
}
```

Hosts may pin an installed executable instead of using `npx`.

## Complete Offline ZIP

GitHub Release publishes:

```text
agent-computer-use-mcp-X.Y.Z-windows-x64.zip
```

The ZIP contains the same protected core runtime and the same platform payload
bytes published to npm:

```text
agent-computer-use-mcp-X.Y.Z-windows-x64/
├── bin/agent-computer-use-mcp.mjs
├── runtime/core/
├── runtime/platform/
│   ├── cua-driver/
│   ├── overlay/
│   ├── ocr-runtime/
│   └── models/pp-ocr-v6/
├── node_modules/
├── platform-manifest.json
├── THIRD_PARTY_LICENSES.txt
├── SBOM.cdx.json
└── checksums.txt
```

The ZIP requires Node.js 20 or newer but does not require npm, an
installer, administrator privileges, or network access. It starts with:

```powershell
node bin/agent-computer-use-mcp.mjs
```

The release gate extracts the ZIP into a clean temporary directory, disables
network access for the smoke process, initializes an official MCP SDK client,
lists tools, runs health/doctor, verifies native component resolution, and exits
without starting desktop control.

## Byte Identity Across Channels

The npm platform package and GitHub ZIP must be assembled from one canonical
platform staging directory in the same workflow run.

For every platform payload file:

- relative path, size, and SHA-256 are identical across channels;
- generated timestamps do not affect payload identity;
- the release manifest identifies the source commit and target;
- a test extracts both artifacts and compares their canonical inventories.

The ZIP may add the protected core runtime and top-level release metadata, but it
must not rebuild, recompress into a different inner format, or mutate platform
payload files after the npm platform package is packed.

## Release Workflow

A `v*` tag triggers one release workflow:

1. Validate tag, package version, changelog, clean source inventory, and target.
2. Run the complete test suite.
3. Build the protected core package.
4. Build the Windows x64 platform staging directory once.
5. Pack and inspect both public npm packages.
6. Assemble and smoke the complete offline ZIP from the same staging bytes.
7. Generate checksums, CycloneDX SBOM, and third-party license inventory.
8. Create a draft GitHub Release and upload the ZIP, checksums, and SBOM.
9. Publish `@agent-computer-use/win32-x64` to public npm with provenance.
10. Publish `agent-computer-use-mcp` to public npm with provenance.
11. Install the exact public core version from the npm registry in a clean
    Windows directory and run the standard MCP smoke.
12. Publish the GitHub Release only after both npm packages and both smoke paths
    pass.

The platform package is published before the core package so a newly visible
core version never references an unavailable platform version.

There is no Windows installer build, installer signing job, Azure Artifact
Signing dependency, or installer smoke in the release graph.

## Integrity and Supply-chain Policy

Required release controls:

- npm trusted publishing with OIDC and provenance for both packages;
- exact core-to-platform version binding;
- protected JavaScript runtime without first-party source maps;
- SHA-256 complete platform inventory;
- outer GitHub checksums;
- CycloneDX SBOM for core, platform, and ZIP composition;
- pinned upstream identity and license records;
- release-tag and source-commit binding;
- no test-signing artifact accepted as production evidence.

Authenticode signing of first-party native binaries may be added later through
a provider-neutral signing stage, but it is not an installation mechanism and
is not a release prerequisite for this distribution design. Hash and provenance
verification remain mandatory.

## Removal and Migration

The implementation removes the installer architecture rather than hiding its
entry point:

- delete the `windows-installer` project and build scripts;
- remove installer payloads from package, ZIP, checksums, SBOM, signing policy,
  tests, CI, and release workflow;
- remove `%LOCALAPPDATA%\Programs\AgentComputerUse` as an authoritative program
  root;
- replace installer activation and rollback with exact npm package resolution;
- replace asset download/repair execution with diagnosis and reinstall guidance;
- redefine Phase 0.15 as dual-channel package assembly and offline ZIP smoke;
- redefine Phase 7.8 as platform package resolution and integrity proof;
- redefine Phase 7.9 as npm/ZIP byte-identity and offline runtime proof;
- update roadmap, README, release gates, and security documentation.

Historical design documents remain historical evidence and are not rewritten,
but current normative documentation must identify this spec as superseding the
installer-based release model.

## China and Restricted-network Support

After acquisition, all Computer Use behavior is local and requires no Azure,
GitHub, npm, model API, or asset CDN connection.

For public npm installation:

- npm registry selection remains under user or host control;
- the core package uses standard npm dependencies, so a configured compatible
  npm mirror can resolve both the core and scoped platform package;
- installation documentation includes an optional registry override example;
- release correctness never depends on a third-party mirror synchronizing
  immediately;
- the official public npm registry remains the source of record.

For the ZIP:

- it is complete and can be downloaded once, copied through approved internal
  storage, removable media, or an enterprise artifact proxy, and then used
  offline;
- GitHub Release remains the only official ZIP publication channel;
- the project does not promise direct GitHub reachability or throughput from
  every network.

Release testing must cover Chinese Windows locale, Unicode user paths, non-ASCII
window titles, and offline startup. A China-based network smoke is useful
operational evidence but cannot be a deterministic release gate when it depends
on an unofficial mirror.

## Test Contract

The implementation is complete only when automated tests prove:

- one core install automatically installs exactly one compatible platform
  package on Windows x64;
- unsupported platforms fail with a stable unsupported-target diagnostic when
  no validated platform package exists;
- core/platform version mismatch fails before native processes start;
- every platform file is verified and tampering is detected;
- no installer artifact, source, script, workflow job, or normative reference
  remains;
- neither MCP startup nor first Computer Use activation performs a download;
- the complete ZIP runs without npm or network access;
- npm platform payload bytes and ZIP platform payload bytes are identical;
- public npm post-publish installation resolves the platform package;
- standard MCP initialize, tools/list, health, disconnect, and cleanup pass from
  both channels;
- Chinese paths and locale do not alter manifest verification or process launch;
- package tarballs contain no first-party source maps or undeclared files.

## Acceptance Criteria

- A user installs only `agent-computer-use-mcp`.
- npm automatically installs `@agent-computer-use/win32-x64` on Windows x64.
- GitHub Release publishes one complete Windows x64 ZIP built from the same
  platform bytes.
- The ZIP starts with Node.js and no npm installation step.
- No Windows installer is built, published, required, or documented as current
  architecture.
- No first-use asset download occurs.
- Public npm and GitHub Release remain the only official channels.
- Runtime works fully offline after package acquisition.
