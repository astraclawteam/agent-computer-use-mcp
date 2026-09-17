# Productization Docs

Current normative documents:

1. `release-gates.md`
2. `real-release-pipeline-spec.md`
3. `real-app-smoke-catalog.json`

The current release contract is a tag-verified Windows x64 SEA artifact
published through GitHub Releases. CI verifies source identity, runs the full
MCP gates, builds one immutable archive, writes SHA-256 checksums, and marks the
release Latest. It has no npm or Gitee credential and never writes source
branches.

Historical npm/Gitee distribution, installer, cache materializer, commercial
promotion, and retired application-matrix plans are retained in Git history.
They are not current implementation guidance or release evidence.

AI workers must derive changes from the current normative files and preserve
exact release versions, fail-closed platform verification, offline runtime
behavior, standard MCP protocol compatibility, and user-only overlay exclusion.
