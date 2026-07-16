# Productization Docs

Current normative documents:

1. `roadmap.md`
2. `release-gates.md`
3. `real-release-pipeline-spec.md`
4. `runtime-soak-operations.md`
5. `app-smoke-matrix.md`
6. `real-app-smoke-catalog.json`

The current release contract is artifact-only tag CI plus explicit one-package
npm publication. CI uploads only the protected core and Windows x64 npm
tarballs, has read-only repository permissions, and performs no registry,
GitHub Release, Gitee, or Git writes. A maintainer publishes one canonical
tarball only after the command rebuilds it from the exact clean source and
verifies the private snapshot identity.

Files named `windows-installer-*`, `asset-cache-materializer-*`, older release
assembly plans, and the earlier automatic GitHub/Gitee publication designs are
historical records. They are not current implementation guidance.

AI workers must derive changes from the current normative files and preserve exact package versions, fail-closed platform verification, offline runtime behavior, standard MCP protocol compatibility, and user-only overlay exclusion.
