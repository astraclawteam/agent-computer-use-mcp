# GitHub Release Pipeline Specification

## Current boundary

The public release channel is an immutable Windows x64 executable artifact
attached to a GitHub Release. The workflow has GitHub `contents: write`
permission only. It has no npm credential, Gitee credential, signing secret, or
permission to update source branches.

The released archive is the same SEA artifact shape consumed by the XiaozhiClaw
Hub publisher:

```text
agent-computer-use-mcp-X.Y.Z-win32-x64.tar.gz
hub-publisher-input.json
SHA256SUMS.txt
```

## Trigger and identity

`.github/workflows/release.yml` runs only for a pushed `v*` tag. Before any
release is created, the workflow requires:

- `vX.Y.Z` equals `package.json` version `X.Y.Z`;
- the tagged commit is an ancestor of `origin/main`;
- `CHANGELOG.md` contains an exact `## X.Y.Z` heading;
- the full test suite and MCP SDK phases 1.6, 1.7, and 1.8 pass.

The build records the exact tag commit in the artifact manifest and SBOM.

## Windows artifact

A Windows runner downloads only hash-locked upstream assets, builds the native
overlay, prunes every non-Windows-x64 ONNX target, bundles the protected MCP and
OCR runtimes, and creates a Node SEA executable.

Before archiving, CI verifies the complete payload inventory, entrypoint,
checksums, target, version, and source identity. The resulting archive remains
below the enforced size limit and starts without npm, network access,
elevation, or self-update.

## Publication

After verification, the workflow writes a SHA-256 checksum file and runs
`gh release create` with `--verify-tag` and `--latest`. Publication is atomic at
the release boundary: a failed test, build, inventory check, or checksum step
creates no GitHub Release.

The workflow never:

- publishes npm packages;
- writes to Gitee;
- changes a branch, tag, or version;
- rebuilds an existing release tag;
- uploads local operator-built bytes.

## Recovery

Fix the source on a new commit and publish a new version. Never delete and reuse
a public tag to replace its bytes. If GitHub Release creation fails after the
artifact build, rerun the unchanged tag workflow only after confirming that no
release exists for that tag.
