# Productization Docs

Current normative documents:

1. `roadmap.md`
2. `release-gates.md`
3. `real-release-pipeline-spec.md`
4. `app-smoke-matrix.md`
5. `real-app-smoke-catalog.json`
6. `../superpowers/specs/2026-07-11-npm-platform-distribution-design.md`

The distribution contract is public npm plus a complete GitHub platform ZIP. Gitee Release is a reversible regional transport mirror: small attachments remain identical and oversized attachments use verified 90 MiB parts that reconstruct to the GitHub SHA-256. Windows x64 is the only enabled native target.

Files named `windows-installer-*`, `asset-cache-materializer-*`, and older release assembly plans are historical records superseded by the approved npm platform distribution design. They are not current implementation guidance.

AI workers must derive changes from the current normative files and preserve exact package versions, fail-closed platform verification, offline runtime behavior, standard MCP protocol compatibility, and user-only overlay exclusion.
