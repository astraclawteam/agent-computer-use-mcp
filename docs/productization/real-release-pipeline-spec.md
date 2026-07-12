# Real Release Pipeline Specification

## Channels

Public npm is the primary channel. GitHub Release publishes the complete Windows x64 ZIP and release metadata. Gitee Release is a reversible regional transport mirror of GitHub and never builds artifacts. Files that fit Gitee's attachment quota remain byte-identical attachments; oversized files are represented by deterministic 90 MiB parts whose verified reconstruction is byte-identical to the GitHub original.

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
6. Download GitHub assets and prepare the Gitee transport inventory using the protected `release` environment.
7. Keep assets at or below 90 MiB unchanged. Split larger assets into ordered 90 MiB parts and publish `gitee-mirror-manifest.json` plus `restore-gitee-release.ps1`.
8. Download every managed Gitee attachment, verify its exact size and SHA-256, and verify that each chunked representation reconstructs to the GitHub asset size and SHA-256.

The part size is exactly 94,371,840 bytes. Part names append `.partNNN` to the original asset name, starting at `.part001`. The manifest schema records the release tag, source commit, original name/size/SHA-256, representation (`exact` or `chunked`), and ordered part name/size/SHA-256. It contains no token, URL credential, or local path.

GitHub/npm publication is not rolled back when Gitee is unavailable. Mirror jobs are idempotent: identical managed attachments remain, same-name mismatches are replaced, and missing files are uploaded. Unrelated operator attachments are preserved. The mirror never uploads an oversized original alongside its parts.

## Secrets

npm uses trusted publishing with OIDC provenance. Gitee uses the `GITEE_TOKEN` secret and `GITEE_OWNER`/`GITEE_REPO` environment variables. The token is sent only in the Authorization header and never appears in URLs, logs, reports, or release metadata.

## Recovery

- Build or npm smoke failure: leave GitHub Release as draft and publish nothing further.
- Core npm failure after platform publication: keep the draft, correct the release, and publish the matching core version before publishing GitHub Release.
- Gitee failure after GitHub publication: run `.github/workflows/gitee-release-repair.yml` for the immutable published tag. It downloads the existing GitHub bytes and never rebuilds, republishes npm, or moves the tag.
- Any checksum mismatch: fail closed and do not mark mirror verification successful.
- Missing or mismatched Gitee tag/source commit: fail closed before release attachment mutation.
