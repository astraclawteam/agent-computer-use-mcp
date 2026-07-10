# Productization Docs

Read these files in order:

1. `roadmap.md`
2. `release-gates.md`
3. `app-smoke-matrix.md`
4. `windows-installer-implementation-plan.md`
5. `npm-release-hardening-implementation-plan.md`
6. `asset-cache-materializer-spec.md`
7. `asset-cache-materializer-implementation-plan.md`
8. `real-release-pipeline-spec.md`
9. `real-release-assembly-implementation-plan.md`

The roadmap defines phases P0-P7. The release gates define alpha, beta, and commercial readiness. The app smoke matrix tracks real local software coverage. The implementation plans record the real Windows transaction engine, protected npm distribution, trusted asset acquisition/cache pipeline, and ordered follow-on PRs. The real release pipeline specification defines the tag-driven GitHub Release and public npm distribution contract.

PR4 candidate assembly uses `npm run release:windows:assemble` and writes `blocked_unsigned` output to `artifacts/windows-release/<version>/`. `npm run phase:0.15` independently verifies that inventory, installs it without network or preinstalled Node.js, activates all required assets, and smokes the installed standard MCP server. These candidate files are CI evidence only until PR5 applies and verifies production signing.

AI workers should convert roadmap items into focused issues or PRs instead of broad catch-all changes.
