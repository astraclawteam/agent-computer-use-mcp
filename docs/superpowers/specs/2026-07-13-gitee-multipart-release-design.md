# Gitee Multipart Release Design

## Goal

Mirror every published GitHub Release to Gitee despite Gitee's 100 MB
per-attachment quota, while preserving the exact GitHub bytes as the sole
artifact identity.

## Trust Boundary

GitHub Release and public npm remain authoritative. The Gitee job downloads the
published GitHub assets and never rebuilds, modifies, signs, or versions them.
An asset at or below 94,371,840 bytes is uploaded unchanged. A larger asset is
represented by ordered 94,371,840-byte parts plus a deterministic manifest.

The manifest uses schema version 1 and binds:

- the immutable `vX.Y.Z` tag and its 40-character source commit;
- every GitHub original name, byte size, and SHA-256;
- representation kind `exact` or `chunked`;
- every ordered attachment name, byte size, and SHA-256.

Part names are `<original-name>.partNNN`, starting at `part001`. The manifest,
parts, and `restore-gitee-release.ps1` contain no credential, authenticated URL,
runner path, or mutable download location.

## Mirror Flow

1. Fast-forward Gitee `main` to the verified GitHub main commit and create the
   release tag from the verified source commit. The push never uses force and
   fails if Gitee diverged or the tag already has another identity.
2. Verify the Gitee tag resolves to the same source commit as GitHub.
3. Materialize the deterministic Gitee transport inventory from downloaded
   GitHub assets.
4. Create or update the release notes for the existing tag.
5. Retain identical managed attachments, replace mismatches, and upload missing
   attachments. Preserve unrelated operator attachments.
6. Download managed attachments sequentially, using streaming SHA-256 to bound
   memory.
7. Verify each attachment and prove each multipart representation reconstructs
   to the GitHub original size and SHA-256.

The original oversized file is never uploaded to Gitee. Verification is not
allowed to trust API-reported hashes without downloading the bytes.

## Recovery

`restore-gitee-release.ps1` reads only `gitee-mirror-manifest.json` and local
attachments in its input directory. It verifies all part hashes before joining,
writes through a temporary file, verifies the final size and SHA-256, then
atomically promotes the restored file. Exact assets are verified in place.

The tag-triggered release workflow performs this flow automatically. A separate
manual `gitee-release-repair.yml` workflow accepts an existing published `v*`
tag, verifies it is reachable from `main`, downloads that GitHub Release, and
runs the same mirror and verification code. It cannot build release assets,
publish npm packages, edit GitHub Release state, or move tags.

## Failure Policy

- Missing or mismatched tag identity fails before Gitee release mutation.
- A non-fast-forward Gitee branch or conflicting tag fails without force.
- Any local, remote part, manifest, or reconstructed hash mismatch fails closed.
- Gitee failure never rolls back public npm or GitHub Release.
- Reruns are idempotent and converge on one release and one deterministic
  managed attachment inventory.
- A malformed token is rejected without logging its value.

## Acceptance

- No Gitee attachment exceeds 94,371,840 bytes.
- The 107.6 MB platform tarball and 158.0 MB offline ZIP are multipart.
- The core tarball, checksums, release manifest, and SBOM remain exact files.
- The recovery script reconstructs byte-identical originals on Windows.
- CI verifies remote attachment hashes and reconstructed GitHub identities.
- `v0.0.1` is repaired without moving its published tag or rebuilding artifacts.
