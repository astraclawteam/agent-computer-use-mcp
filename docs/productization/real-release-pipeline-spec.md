# GitHub Release Pipeline Specification

## Current boundary

The public release channel is an immutable Windows x64 executable artifact
registered in Hub and attached to a GitHub Release. The workflow defaults to
GitHub `contents: read`; only the final isolated job receives `contents: write`.
The Hub job receives a dedicated SSH release identity and pinned known-hosts
file, while signing and storage credentials remain inside Hub production.

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

After verification, the workflow writes a SHA-256 checksum file and passes the
three-file payload to the pinned Hub publisher source. Hub validates the
archive, signs and stores it, applies the immutable version transaction, and
the workflow then queries the public catalog by exact resource ID and version.
Only after repeated public reads agree does an isolated job run
`gh release create` with `--verify-tag` and `--latest`.

A failed test, build, inventory, checksum, Hub registration, signature,
catalog projection, or public version check creates no GitHub Release. Repeating
the same Hub registration is allowed only when every immutable byte and signed
field is equivalent; a conflict fails the release.

The workflow never:

- publishes npm packages;
- writes to Gitee source;
- changes a branch, tag, or version;
- rebuilds an existing release tag;
- uploads local operator-built bytes.

## Recovery

Fix the source on a new commit and publish a new version. Never delete and reuse
a public tag to replace its bytes. If GitHub Release creation fails after Hub
registration, rerun the unchanged tag workflow only after confirming that no
release exists for that tag. The Hub publisher treats an exactly equivalent
retry as idempotent and rejects any immutable conflict.
