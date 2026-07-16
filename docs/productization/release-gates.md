# Release Gates

## Package Contract

- Core package is `agent-computer-use-mcp@X.Y.Z`.
- Windows package is `@xiaozhiclaw/agent-computer-use-win32-x64@X.Y.Z` with exact version, `os: ["win32"]`, and `cpu: ["x64"]`.
- Core contains no native payload; platform contains no first-party source or source maps.
- npm dry-run inventories, licenses, CycloneDX SBOM, and SHA-256 manifests pass.

## Runtime Contract

- Platform package resolves through Node package resolution or the fixed offline sibling layout.
- Core/platform versions, target, complete inventory, links, traversal, duplicate paths, and Windows case-fold uniqueness are verified before MCP startup.
- Runtime performs no download, npm invocation, self-update, or package mutation.
- `computer.repair` returns diagnosis and an exact pinned reinstall command only.

## Offline Contract

- `agent-computer-use-mcp-X.Y.Z-windows-x64.zip` contains protected core, platform payload, production JavaScript dependencies, licenses, checksums, manifest, and SBOM.
- The extracted ZIP starts with Node.js 20+ and no npm, network, elevation, or setup software.
- Official MCP SDK smoke lists tools and calls health/doctor without desktop control.
- ZIP platform inventory is byte-identical to the npm platform package and compressed size is at most 310 MiB.

## Release Contract

- Only a verified `v*` tag on main can produce release artifacts.
- Tag CI has read-only repository permissions, no registry credentials, uploads
  only the two npm tarballs, and performs no npm, Git, GitHub Release, or Gitee
  mutation.
- A maintainer uses the exact clean source checkout and runs the one-package
  command without `--publish` before explicitly adding that flag.
- The command accepts only the canonical filename and current package version,
  rebuilds through the protected staging/inventory path, and requires an exact
  SHA-512 match.
- Verified bytes are copied once into an exclusive private snapshot. Registry
  lookup and the single `npm publish` use only that snapshot; it is rechecked
  before publication and removed in `finally`.
- Platform npm publishes before core npm. The command never bumps, commits,
  tags, pushes, publishes a second package, creates a GitHub Release, or mutates
  Gitee.
- GitHub/Gitee release publication is outside the current release workflow and
  requires a separately authorized operator design and validation.

## Product Safety

- Overlay/cursor appear for Gateway-managed control and stop on cancel, revoke, timeout, disconnect, or shutdown.
- Overlay is absent from agent observations, OCR, screenshots, traces, and artifacts.
- Password, payment, credential, private, and denied-window policies fail closed.
- Concurrency, daemon cleanup, runtime soak, OCR latency, and real app evidence gates pass.

## Commercial Runtime Evidence

- Pull-request CI runs `npm run soak:pr` for exactly 900,000 ms after all MCP
  sessions and the baseline process probe are ready.
- RSS net growth is at most 128 MiB, handle net growth is at most 128 handles,
  and the tool-call failure rate is below 0.1%.
- Cleanup requires zero orphan processes, residual ports, overlay leaks, and
  cursor leaks. Safety-policy errors must fail closed.
- The evidence directory contains `run-manifest.json`, append-only
  `events.jsonl`, `report.json`, and `checksums.txt` bound to the exact Git,
  package, driver, overlay, OCR, and model identities.
- `npm run evidence:verify -- <evidence-directory>` recomputes every inventory
  entry and rejects tampering, unreferenced files, dirty-worktree identity, and
  candidate mismatch.
- Complete screenshots and user documents are forbidden. Tokens, user-profile
  paths, host names, command lines, and executable paths are rejected before
  evidence sealing.
- The two-hour nightly gate runs for exactly 7,200,000 ms on Windows with its
  immutable workload and retains sealed evidence for 30 days.
- The eight-hour release-candidate gate runs for exactly 28,800,000 ms, writes
  at least 48 periodic checkpoints, and is imported only after source and copy
  identities both verify.
- Failed long runs and passing retries use distinct run IDs. Evidence files are
  immutable and are never edited, deleted, or overwritten to obtain a pass.

## Commercial Promotion Gate

- Phase 9.0 is a read-only sealed-evidence aggregator. It cannot execute tests,
  download assets, start desktop control, or infer missing results.
- Preview `0.x` releases report `commercialEligible: false` but keep their
  existing publication behavior.
- Stable `1.x` release metadata requires both `eligible: true` and
  `agentE2eEligible: true` from Phase 9.0, plus a passing Phase 10.4 check of
  the underlying seven-file Agent E2E attempt directories. It also requires a
  matching `vX.Y.Z` tag, package version, Git commit, platform package, driver,
  overlay, OCR runtime/model identity, and zero promotion violations.
- One candidate identity must contain passing pull-request, nightly, release-
  candidate, real-app, and perception evidence. Evidence split across different
  candidate identities cannot be combined.
- Any verified failed run remains disqualifying. A newer passing retry never
  hides or replaces its run ID.
- Contract tests, fake host bridges, Phase 6 harness evidence, and host
  discovery reports always have `qualificationClaim: false` and cannot satisfy
  the stable gate.

## Perception Evidence

- Pull requests use the deterministic generated quick corpus; the scheduled
  app-lab workflow uses the separately stored, hash-locked full corpus.
- The full corpus must contain at least 400 OCR regions and 200 complex-visual
  scenes and pass the repository lock plus local privacy scanner before any
  provider starts.
- Benchmarks invoke the released offline PP-OCRv6 ONNX, SOM, template, and
  proposal providers. Caller-supplied latency or accuracy arrays are forbidden.
- Action proposals require calibrated support from at least two independent
  local providers at fused confidence 0.98, or an exact approved template at
  0.995. SOM-only and OCR-only boxes remain observation-only.
- Commercial targets are 97% OCR character accuracy, 95% critical-label
  recall, 98% proposal precision, 90% proposal recall, and zero guessed actions.
- Warm small-crop P95 is at most 200 ms, ordinary-region P95 is at most 300 ms,
  and the first synthetic full-window diagnostic is at most 1,000 ms with an
  actual cache hit.
- Nightly artifacts contain only `run-manifest.json`, `events.jsonl`,
  `report.json`, and `checksums.txt`. Corpus images, complete windows, user
  documents, raw OCR strings, and local paths are never uploaded.
- The committed quick regression corpus contains only generated/public crops
  that pass privacy scanning. The external full-corpus lock remains fail-closed
  until its real manifest identity and evidence are supplied.
