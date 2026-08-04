# Productization Docs

Current normative documents:

1. `roadmap.md`
2. `release-gates.md`
3. `real-release-pipeline-spec.md`
4. `runtime-soak-operations.md`
5. `real-app-smoke-catalog.json`

The current release contract is a tag-verified Windows x64 SEA artifact
published through GitHub Releases. CI verifies source identity, runs the full
MCP gates, builds one immutable archive, writes SHA-256 checksums, and marks the
release Latest. It has no npm or Gitee credential and never writes source
branches.

`app-smoke-matrix.md`, files named `windows-installer-*`,
`asset-cache-materializer-*`, older release assembly plans, and the earlier
automatic GitHub/Gitee publication designs are historical rebuild records.
They are not current implementation guidance or release evidence.

AI workers must derive changes from the current normative files and preserve
exact release versions, fail-closed platform verification, offline runtime
behavior, standard MCP protocol compatibility, and user-only overlay exclusion.
