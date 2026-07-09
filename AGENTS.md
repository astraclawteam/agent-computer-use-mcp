# Agent Worker Rules

This repository is maintained by a large team and many contributors are AI agents. These rules are mandatory for every automated or human-assisted coding session.

## Read Order

Before changing files, read:

1. `AGENTS.md`
2. `README.md`
3. `CONTRIBUTING.md`
4. The tests covering the files you plan to edit

If a host product provides a stricter instruction, follow the stricter rule.

## Repository Purpose

`agent-computer-use-mcp` is a local MCP module for Gateway-managed computer use. The public contract is the `computer.*` MCP tool surface. The implementation may use `cua-driver mcp`, OCR, native desktop helper apps, and overlays internally, but clients should depend on the MCP contract rather than private internals.

## Project Structure

- `src/`: MCP server, tool definitions, provider router, driver/OCR/overlay integration, phase smoke scripts.
- `test/`: Node test runner tests. Every behavior change needs a focused test here.
- `public/`: browser demo and overlay visual prototype assets.
- `gateway-overlay/`: Windows user-only overlay helper.
- `native-lab/`: Windows native target app used for real desktop control validation.
- `ocr-sidecar/`: OCR sidecar experiments and ONNX Runtime integration.
- `docs/`: long-form governance or architecture docs.
- `scripts/`: maintainer automation scripts.
- `.github/`: PR template, CODEOWNERS, CI, and GitHub metadata.

## Branch And PR Rules

- Non-admin contributors and AI workers must not push directly to `main`.
- Repository administrators may push directly to `main` for repository bootstrap, governance repair, or emergency recovery.
- Work on short-lived branches named `type/short-topic`, for example `feat/ocr-region-cache` or `fix/mcp-health-error`.
- Every change must go through a pull request.
- Every non-admin PR must have at least one maintainer approval before merge.
- CODEOWNERS review is required for protected areas.
- All required checks must pass before merge.
- Do not require approval from a different person than the latest pusher; this repository intentionally disables GitHub's "require approval of the most recent reviewable push" condition.
- Use squash merge unless maintainers explicitly choose otherwise.

## Coding Constraints

- Use the official `@modelcontextprotocol/sdk` for all MCP server/client protocol paths.
- Do not add hand-rolled MCP JSON-RPC framing, request id maps, or stdout line parsers for MCP paths.
- Keep OCR sidecar JSONL private to the sidecar; do not expose it as MCP unless a spec explicitly changes that boundary.
- The user overlay is user-only. It must never enter screenshots, OCR input, observations, benchmarks, or persisted capture artifacts.
- Prefer text-first and semantic observations before pixel/coordinate actions.
- Coordinate/pixel actions must be marked as `pixelLimitedAction=true`.
- Keep `AGENT_COMPUTER_USE_*` environment variables as the public names. `XIAOZHICLAW_*` aliases are compatibility-only.
- Do not commit generated artifacts: `node_modules/`, `.NET bin/obj`, OCR model packs, captures, logs, or temp files.
- Keep files focused. If a file becomes hard to review, split by responsibility with tests.

## Required Verification

Run the smallest relevant test first, then the full suite before claiming completion.

Minimum for ordinary code/doc changes:

```sh
npm test
```

For MCP protocol or installation changes, also run:

```sh
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
```

For desktop action or `cua-driver mcp` changes, run when the platform has `cua-driver` configured:

```sh
npm run phase:1.4
```

If a required verification cannot run, the PR must state why and what substitute evidence was collected.

## PR Quality Bar

Every PR must explain:

- what changed
- why it changed
- what tests were run
- whether user-only overlay exclusion still holds
- whether MCP public contracts changed
- whether new dependencies, binaries, model packs, or platform assumptions were introduced

Do not hide risk. If a path is Windows-only, GPU-dependent, offline-dependent, or `cua-driver`-dependent, say so in the PR.

## AI Agent Behavior

- Inspect before editing; do not rewrite broad files opportunistically.
- Make small, reviewable changes.
- Preserve public contracts unless the PR explicitly proposes a contract change.
- Do not “fix” unrelated files.
- Do not silence failing tests without a clear explanation and replacement coverage.
- Do not claim a test passes unless the command was run in the current working tree.
- Do not commit secrets, tokens, screenshots containing sensitive data, or local machine paths beyond controlled test fixtures.
