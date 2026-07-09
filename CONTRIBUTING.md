# Contributing

Thanks for contributing to `agent-computer-use-mcp`. This project is designed for a large mixed human/AI maintenance team, so process discipline matters as much as code.

## Required Workflow

1. Create a branch from `main`.
2. Make focused changes with tests.
3. Run the relevant verification commands.
4. Open a pull request.
5. Wait for CI and reviewer approval.
6. Merge only after required checks and reviews pass.

Direct pushes to `main` are prohibited for non-admin users and should be reserved for emergency maintainer recovery only.

## Branch Names

Use:

- `feat/<short-topic>`
- `fix/<short-topic>`
- `docs/<short-topic>`
- `test/<short-topic>`
- `chore/<short-topic>`

## Commit Messages

Use concise conventional-style commits:

- `feat: add OCR region cache`
- `fix: preserve overlay exclusion in capture`
- `docs: add MCP client setup`
- `test: cover driver health fallback`

## Test Matrix

Always run:

```sh
npm test
```

Run these for MCP protocol, install config, or SDK changes:

```sh
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
```

Run this for real desktop action, overlay, cursor, or `cua-driver mcp` changes:

```sh
npm run phase:1.4
```

## Dependency Policy

- Prefer platform APIs and existing dependencies.
- New runtime dependencies require a PR explanation covering size, license, offline behavior, and platform support.
- Do not commit model packs, binaries, caches, or generated build output.

## Public Contract Policy

The public API is the MCP tool surface and structured result shape. Any change to tool names, arguments, result fields, environment variables, or installation config must be called out as a contract change in the PR.

Compatibility aliases such as `XIAOZHICLAW_*` may remain, but new documentation and examples must use `AGENT_COMPUTER_USE_*`.

