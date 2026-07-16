# agent-computer-use-mcp

`agent-computer-use-mcp` is a local standard MCP server for Gateway-managed computer use. It combines semantic desktop control through `cua-driver`, local PP-OCRv6 perception, and a user-only native overlay without restricting computer-use capabilities owned by third-party agents.

## Install

Windows x64 is the first published target. Users install one package name:

```powershell
npm install agent-computer-use-mcp@X.Y.Z
npx -y agent-computer-use-mcp@X.Y.Z
```

npm automatically selects the exact matching `@xiaozhiclaw/agent-computer-use-win32-x64@X.Y.Z` optional dependency. The protected core package contains the MCP runtime; the platform package contains cua-driver, the native overlay, ONNX Runtime, and PP-OCRv6 small models. Missing, linked, mismatched, incomplete, or corrupt platform packages fail before MCP startup.

Example host configuration:

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

Upgrade and rollback are normal npm version operations. The MCP server never downloads native assets, runs npm, or updates itself. `computer.repair` may report this exact command but remains read-only:

```powershell
npm install agent-computer-use-mcp@X.Y.Z
```

## Offline ZIP

The release assembly can produce a complete Windows x64 ZIP with the same protected core and byte-identical platform payload used by npm:

```powershell
node .\agent-computer-use-mcp-X.Y.Z-windows-x64\bin\agent-computer-use-mcp.mjs
```

The ZIP requires Node.js 20 or newer. It requires no npm install, network access,
elevation, or setup program. The current tag workflow does not upload or publish
this ZIP; GitHub/Gitee release distribution requires a separate operator flow.

## Development

```powershell
npm ci
npm test
npm run mcp
```

Release-focused commands:

- `npm run release:npm:build:core`: build the protected core package with no first-party source maps.
- `npm run release:npm:build:win32-x64`: build the immutable platform package from locked native assets.
- `npm run release:npm:package -- --package <tarball>`: run the read-only registry preflight for one protected package; add `--publish` only for an intentional maintainer publish.
- `npm run phase:0.14`: verify protected npm package integrity and standard MCP compatibility.
- `npm run phase:0.15`: assemble both npm tarballs and the complete ZIP, compare platform inventories, and run the offline MCP smoke.
- `npm run phase:7.8`: verify exact platform resolution and read-only repair guidance.
- `npm run phase:7.9`: verify npm/ZIP platform identity and network-free startup.
- `npm run release:windows:size-report`: enforce the 310 MiB complete ZIP limit.
- `npm run soak:pr`: run the exact 900,000 ms pull-request soak and seal commercial runtime evidence.
- `npm run evidence:verify -- <evidence-directory>`: recompute evidence identities, inventory, and SHA-256 checksums.
- `npm run perception:quick`: run the released offline OCR plus calibrated SOM/OCR proposal fusion against the deterministic quick corpus.
- `npm run phase:9.0 -- --evidence <sealed-run> ...`: evaluate sealed evidence without running tests, downloading assets, or starting desktop control.

The pull-request soak uses real official-SDK stdio clients, fault/reconnect cycles,
Windows process-tree sampling, and a post-cleanup probe. It enforces at most
128 MiB RSS net growth, 128 handles net growth, a tool-call failure rate below
0.1%, and zero orphan processes, residual ports, overlay leaks, and cursor
leaks. Its sealed directory contains `run-manifest.json`, `events.jsonl`,
`report.json`, and `checksums.txt`. Complete screenshots and user documents are
forbidden from commercial runtime evidence.

## Commercial 1.0 Eligibility

Preview releases remain publishable with `commercialEligible: false`. A stable
`1.x` release fails closed unless Phase 9.0 verifies one candidate identity
across all of the following:

- exact 900,000 ms pull-request, 7,200,000 ms nightly, and 28,800,000 ms release-candidate soak evidence;
- passing Tier A and installed Browser, Electron, Office, Complex Canvas,
  CAD-like, and Timeline evidence with successful cleanup;
- at least 97% OCR character accuracy, 95% critical-label recall, 98% proposal
  precision, 90% proposal recall, and zero guessed actions;
- matching Git commit, core/platform package, driver, overlay, OCR model pack,
  release version, and `v*` tag identities.

Failed evidence remains part of the decision even when a later retry passes.
The deterministic quick corpus currently validates the mechanism; it does not
replace the separately locked full corpus or long-run/app-lab evidence.

The repository root is private to npm publication. Only generated release staging packages are publishable. They contain protected runtime code, exact manifests, licenses, checksums, and SBOM data without first-party source or source maps. Obfuscation is defense in depth, not a secrecy boundary.

## Runtime State

Writable state is limited to user data under `%LOCALAPPDATA%\AgentComputerUse\` (`logs`, `traces`, `artifacts`, `sessions`, and disposable `cache`). It contains no authoritative program version or active native asset selection.

The native overlay and branded cursor are visible only while Gateway-managed computer use is active. They are excluded from screenshots, OCR, observations, traces, and benchmark artifacts.

## Release

A verified `v*` tag validates the source, builds and smokes the protected core and
Windows x64 packages, and uploads the two npm tarballs as a CI artifact. The
workflow has no npm credentials and never writes to the npm registry.

A maintainer downloads the verified tarballs and handles each package explicitly.
Use the clean checkout for the exact tag, run the command without `--publish`
first, then publish the platform package before the core package:

```powershell
npm run release:npm:package -- --package <tarball>
npm run release:npm:package -- --package <tarball> --publish
```

The command accepts only the canonical filename and current source version. It
rebuilds the corresponding protected staging package and requires an exact
SHA-512 match before registry access. It publishes exactly the named tarball and
does not change versions, commit, tag, push, publish a second package, create a
GitHub Release, or mutate Gitee.

See the [current release pipeline policy](docs/productization/real-release-pipeline-spec.md)
and [release gates](docs/productization/release-gates.md). The earlier
[automatic distribution design](docs/superpowers/specs/2026-07-11-npm-platform-distribution-design.md)
is a superseded historical record, not the current release contract.
