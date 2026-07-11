# agent-computer-use-mcp

`agent-computer-use-mcp` is a local standard MCP server for Gateway-managed computer use. It combines semantic desktop control through `cua-driver`, local PP-OCRv6 perception, and a user-only native overlay without restricting computer-use capabilities owned by third-party agents.

## Install

Windows x64 is the first published target. Users install one package name:

```powershell
npm install agent-computer-use-mcp@X.Y.Z
npx -y agent-computer-use-mcp@X.Y.Z
```

npm automatically selects the exact matching `@agent-computer-use/win32-x64@X.Y.Z` optional dependency. The protected core package contains the MCP runtime; the platform package contains cua-driver, the native overlay, ONNX Runtime, and PP-OCRv6 small models. Missing, linked, mismatched, incomplete, or corrupt platform packages fail before MCP startup.

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

GitHub Release publishes a complete Windows x64 ZIP with the same protected core and byte-identical platform payload used by npm:

```powershell
node .\agent-computer-use-mcp-X.Y.Z-windows-x64\bin\agent-computer-use-mcp.mjs
```

The ZIP requires Node.js 20 or newer. It requires no npm install, network access, elevation, or setup program. Gitee Release mirrors the published GitHub assets byte-for-byte for regional access; GitHub and public npm remain authoritative.

## Development

```powershell
npm ci
npm test
npm run mcp
```

Release-focused commands:

- `npm run release:npm:build:core`: build the protected core package with no first-party source maps.
- `npm run release:npm:build:win32-x64`: build the immutable platform package from locked native assets.
- `npm run phase:0.14`: verify protected npm package integrity and standard MCP compatibility.
- `npm run phase:0.15`: assemble both npm tarballs and the complete ZIP, compare platform inventories, and run the offline MCP smoke.
- `npm run phase:7.8`: verify exact platform resolution and read-only repair guidance.
- `npm run phase:7.9`: verify npm/ZIP platform identity and network-free startup.
- `npm run release:windows:size-report`: enforce the 310 MiB complete ZIP limit.

The repository root is private to npm publication. Only generated release staging packages are publishable. They contain protected runtime code, exact manifests, licenses, checksums, and SBOM data without first-party source or source maps. Obfuscation is defense in depth, not a secrecy boundary.

## Runtime State

Writable state is limited to user data under `%LOCALAPPDATA%\AgentComputerUse\` (`logs`, `traces`, `artifacts`, `sessions`, and disposable `cache`). It contains no authoritative program version or active native asset selection.

The native overlay and branded cursor are visible only while Gateway-managed computer use is active. They are excluded from screenshots, OCR, observations, traces, and benchmark artifacts.

## Release

A verified `v*` tag triggers this order:

1. Validate tag, main ancestry, changelog, and tests.
2. Build the core package, Windows x64 platform package, complete ZIP, checksums, manifest, and CycloneDX SBOM.
3. Create a draft GitHub Release.
4. Publish the platform npm package, then the core npm package, both with provenance.
5. Install only `agent-computer-use-mcp@X.Y.Z` from public npm and run an official MCP SDK smoke.
6. Publish GitHub Release.
7. Mirror the same files to Gitee and download-verify every hash.

Gitee failure never rebuilds or rolls back npm/GitHub publication. Maintainers retry only the mirror jobs after the regional service recovers.

See [productization docs](docs/productization/README.md) and the [approved distribution design](docs/superpowers/specs/2026-07-11-npm-platform-distribution-design.md).
