# Real Release Pipeline Specification

## Channels

Public npm is the primary channel. GitHub Release publishes the complete Windows x64 ZIP and release metadata. Gitee Release is a byte-identical regional mirror of GitHub and never builds artifacts.

## Trigger

`.github/workflows/release.yml` runs only for `v*` tags. The tag version must equal `package.json`, the commit must be reachable from `main`, and `CHANGELOG.md` must contain the version heading.

## Build

A Windows runner builds one canonical platform stage from locked assets, then creates:

```text
agent-computer-use-mcp-X.Y.Z.tgz
agent-computer-use-win32-x64-X.Y.Z.tgz
agent-computer-use-mcp-X.Y.Z-windows-x64.zip
checksums.txt
release-manifest.json
SBOM.cdx.json
```

The npm platform tarball and ZIP platform subtree must have identical path, size, and SHA-256 inventories. The complete ZIP must remain at or below 310 MiB.

## Publication Order

1. Create draft GitHub Release with all six assets.
2. Publish `@xiaozhiclaw/agent-computer-use-win32-x64@X.Y.Z` with npm provenance.
3. Publish `agent-computer-use-mcp@X.Y.Z` with npm provenance.
4. On a clean Windows runner install only the core package name from public npm and run official MCP SDK list/health/doctor smoke.
5. Publish GitHub Release.
6. Download GitHub assets and mirror them to Gitee using the protected `release` environment.
7. Download every Gitee attachment and compare exact size and SHA-256.

GitHub/npm publication is not rolled back when Gitee is unavailable. Mirror jobs are idempotent: identical attachments remain, same-name mismatches are replaced, missing files are uploaded, and obsolete files are removed.

## Secrets

npm uses trusted publishing with OIDC provenance. Gitee uses the `GITEE_TOKEN` secret and `GITEE_OWNER`/`GITEE_REPO` environment variables. The token is sent only in the Authorization header and never appears in URLs, logs, reports, or release metadata.

## Recovery

- Build or npm smoke failure: leave GitHub Release as draft and publish nothing further.
- Core npm failure after platform publication: keep the draft, correct the release, and publish the matching core version before publishing GitHub Release.
- Gitee failure after GitHub publication: rerun only mirror and verification jobs using the already-published GitHub bytes.
- Any checksum mismatch: fail closed and do not mark mirror verification successful.
