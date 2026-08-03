# Contributing to Computer Use MCP

Thank you for helping make desktop agents faster, safer, and less surprising.
The best contributions are grounded in a real interface, a reproducible failure,
and evidence that the final state is correct.

## Ways to contribute

- Report a Windows application or control that cannot be observed reliably.
- Add a safe real-application smoke covering focus, scaling, tray restore,
  multilingual text, custom-drawn UI, or cleanup.
- Improve MCP interoperability, Host projection, diagnostics, or release safety.
- Reduce latency without weakening observation provenance or verification.
- Clarify setup, architecture, examples, or failure messages.

For security-sensitive behavior, use
[private vulnerability reporting](https://github.com/astraclawteam/agent-computer-use-mcp/security/advisories/new)
instead of a public issue.

## Before opening code

1. Search existing issues and pull requests.
2. For a bug, capture the smallest safe reproduction: application version,
   observation mode, expected state, actual structured error, and whether the
   final state changed.
3. Avoid screenshots or logs containing private user data. A synthetic fixture
   is strongly preferred.
4. For a larger contract or architecture change, open an issue before investing
   in the implementation.

## Design principles

- **Natural-language capability routing.** Tool selection is driven by semantic
  descriptions and model reasoning, never application-name keywords or regexes.
- **Compact public surface.** Keep Agent tools task-level and bounded.
  Generic desktop goals use `computer.task`, messaging mutations use
  `computer.message`, and lifecycle operations and diagnostics remain
  Host-owned.
- **Host-owned continuation.** Keep generic task continuation on the
  interaction-step execution-control contract. Do not reintroduce shell or
  low-level GUI fallback after `computer.task`, and accept an owner process only
  when process evidence proves one application family.
- **Evidence before mutation.** Semantic elements, focus receipts, or a fresh
  observation must ground actions.
- **No guessed coordinates.** Pixel actions stay bound to observation identity,
  bounds, scale, confidence, and expiry.
- **Fail closed.** Uncertain targeting, policy violations, corrupt artifacts,
  and session mismatches do not degrade into an unsafe fallback.
- **Cleanup is part of correctness.** Success, failure, cancellation, timeout,
  disconnect, and shutdown must all release visible and native resources.
- **No private payloads in evidence.** Screenshots, OCR text, paths, secrets,
  and user documents do not enter committed or uploaded test artifacts.

## Development workflow

1. Branch from an up-to-date `main`.
2. Keep the change focused and add tests at the owning contract boundary.
3. Run the relevant verification commands.
4. Open a pull request using the repository template.
5. Resolve review feedback and wait for required CI.
6. Merge only after checks and approval pass.

Recommended branch names:

- `feat/<short-topic>`
- `fix/<short-topic>`
- `docs/<short-topic>`
- `test/<short-topic>`
- `chore/<short-topic>`
- `release/<version>`

Use concise conventional commits such as `fix: preserve focus metadata` or
`docs: clarify Host media bridge`.

## Verification

Every code change runs:

```powershell
npm ci
npm test
```

MCP protocol, Host projection, installation, or SDK changes also run:

```powershell
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
```

Desktop action, cursor, overlay, focus, input, or driver changes also run:

```powershell
npm run phase:1.4
```

Packaging or release changes also run:

```powershell
npm run artifact:windows:build -- --allow-network
npm run artifact:windows:smoke
```

If a required real application or driver is unavailable, say exactly what was
not verified. Do not replace real evidence with a mock and report it as complete.

## Public contract changes

The public contract includes tool names, descriptions, arguments, structured
results, lifecycle metadata, environment variables, installation templates,
and released artifact shape.

A contract-changing pull request must:

- identify producers and consumers;
- update strict schemas and the public contract review;
- include backward-compatibility or migration notes;
- prove the standard MCP client and server gates;
- keep Agent and Host-only tool visibility explicit.

## Dependencies and generated files

- Prefer platform APIs and existing dependencies.
- Explain runtime size, license, offline behavior, and platform support for every
  new dependency.
- Do not commit model packs, native binaries, caches, credentials, screenshots,
  user data, or generated release directories.
- Project-bound design assets are allowed when intentionally referenced by docs
  and reviewed for licensing and privacy.

## Release contributions

The source checkout is not an npm publication root. A release PR updates the
version, changelog, documentation, and release contract. After it lands, an
annotated `vX.Y.Z` tag triggers the Windows artifact workflow.

The workflow verifies the tag and source, builds the immutable SEA artifact,
generates checksums, and creates a GitHub Release. It has no npm or Gitee
credentials. Never bypass a failed release run by uploading locally rebuilt
bytes to the same tag.

## Review checklist

Reviewers will ask:

- Is the behavior grounded in a real user scenario?
- Does the change preserve the task-level Agent surface and explicit Host-only
  lifecycle boundary?
- Are focus, scale, truncation, execution path, and fallback evidence honest?
- Are policy and cleanup paths tested?
- Are released bytes reproducible from the tagged source?
- Does the documentation describe current behavior rather than aspiration?
