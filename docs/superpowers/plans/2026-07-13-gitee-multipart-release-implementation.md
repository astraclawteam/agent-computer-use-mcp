# Gitee Multipart Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a quota-safe, reversible Gitee release mirror and repair the published `v0.0.1` mirror without changing GitHub or npm artifacts.

**Architecture:** A focused transport materializer turns authoritative GitHub assets into exact attachments or 90 MiB parts plus a schema-versioned manifest. The existing Gitee API client mirrors that deterministic inventory and verifies downloaded remote bytes sequentially. A PowerShell recovery tool reconstructs originals, while tag and manual repair workflows call the same implementation.

**Tech Stack:** Node.js 24 ESM, `node:test`, Web `fetch`, streaming SHA-256, PowerShell 7/Windows PowerShell, GitHub Actions, Gitee v5 REST API.

## Global Constraints

- GitHub Release and public npm remain authoritative and unchanged.
- Gitee part size is exactly 94,371,840 bytes.
- No token, authenticated URL, or local path enters manifests, reports, or logs.
- Verification downloads remote bytes and fails closed on every mismatch.
- The repair workflow never builds, publishes npm, edits GitHub Release state, or moves tags.

---

### Task 1: Multipart Materializer

**Files:**
- Create: `src/gitee-release-parts.mjs`
- Test: `test/gitee-release-parts.test.mjs`

**Interfaces:**
- Produces: `prepareGiteeReleaseAssets({ assets, outputRoot, tag, sourceCommit, chunkSize? })` returning `{ assets, manifest, originals }`.

- [ ] Write tests for exact assets, boundary sizes, deterministic part names,
  ordered hashes, reruns, and secret/path-free manifests.
- [ ] Run `node --test test/gitee-release-parts.test.mjs` and confirm RED.
- [ ] Implement deterministic streaming split and manifest serialization.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Recovery Tool

**Files:**
- Create: `scripts/restore-gitee-release.ps1`
- Test: `test/gitee-release-restore.test.mjs`

**Interfaces:**
- Consumes: schema version 1 `gitee-mirror-manifest.json` and local attachments.
- Produces: verified original files without network access.

- [ ] Write tests that invoke PowerShell to restore exact and chunked fixtures
  and reject corrupt, missing, traversal, and pre-existing output cases.
- [ ] Run the focused test and confirm RED.
- [ ] Implement temporary-file reconstruction, SHA-256 checks, and atomic promote.
- [ ] Run the focused test and confirm GREEN.

### Task 3: Mirror and Remote Verification

**Files:**
- Modify: `src/gitee-release-mirror.mjs`
- Modify: `scripts/mirror-gitee-release.mjs`
- Modify: `scripts/verify-gitee-release.mjs`
- Modify: `test/gitee-release-mirror.test.mjs`

**Interfaces:**
- Mirror and verify consume the prepared transport `assets` while reports retain
  the original GitHub identity map.

- [ ] Add failing tests for sequential remote streaming, multipart inventory,
  token normalization rejection, and reconstructed identity evidence.
- [ ] Implement streaming response hashing and prepared-inventory integration.
- [ ] Run mirror, parts, and restore tests and confirm GREEN.

### Task 4: Release and Repair Workflows

**Files:**
- Modify: `.github/workflows/release.yml`
- Create: `.github/workflows/gitee-release-repair.yml`
- Modify: `test/formal-release-workflow.test.mjs`
- Create: `test/gitee-release-repair-workflow.test.mjs`

**Interfaces:**
- Tag workflow mirrors after GitHub publication.
- Manual workflow accepts `tag`, resolves its immutable source commit, then calls
  the same mirror and verification scripts.

- [ ] Add failing workflow contract tests for triggers, permissions, immutable
  tag validation, environment protection, and forbidden build/publish commands.
- [ ] Implement both workflow paths with shared scripts.
- [ ] Run focused workflow tests and confirm GREEN.

### Task 5: Verification and Release Repair

**Files:**
- Verify all changed files and documentation.

- [ ] Run focused tests and `npm test`.
- [ ] Run `git diff --check` and protected package dry-run gates.
- [ ] Commit, push, open a PR, request independent review, and merge through the
  protected branch workflow.
- [ ] Dispatch `gitee-release-repair.yml` for `v0.0.1`.
- [ ] Verify Gitee tag identity, every managed attachment hash, reconstructed
  original hashes, GitHub Release state, and both public npm packages.
- [ ] Delete merged local and remote feature branches.
