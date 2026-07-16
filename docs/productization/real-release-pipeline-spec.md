# Real Release Pipeline Specification

## Current Boundary

Public npm is the primary package channel. The tag workflow is artifact-only:
it has no npm, GitHub Release, or Gitee write credentials and performs no
publication or repository push. GitHub/Gitee release distribution is outside
the current workflow.

## Trigger

`.github/workflows/release.yml` runs only for `v*` tags. The tag version must
equal `package.json`, the commit must be reachable from `main`, and
`CHANGELOG.md` must contain the version heading.

## CI Output

A Windows runner builds the protected core and immutable Windows x64 staging
packages, runs the existing release smoke and inventory checks, and uploads
only these two tarballs:

```text
agent-computer-use-mcp-X.Y.Z.tgz
agent-computer-use-win32-x64-X.Y.Z.tgz
```

The workflow may assemble additional local verification material while running
the existing production build, but it does not upload or publish that material.

## Manual npm Publication

Publication is one package at a time and always starts with the read-only form:

```powershell
npm run release:npm:package -- --package <tarball>
npm run release:npm:package -- --package <tarball> --publish
```

The maintainer must use the clean source checkout for the exact package
version. The command requires the canonical tarball filename, rebuilds the
corresponding protected package through the existing staging/inventory path,
and requires an exact SHA-512 match before registry lookup or publication.
Publish the Windows platform package before the core package.

The command does not bump, commit, tag, push, publish a second package, create a
GitHub Release, or mutate Gitee. A renamed, stale, or content-drifted tarball
fails closed before `npm publish` is reachable.

## Credentials and Recovery

Tag CI has read-only repository permissions and no registry credential. npm
authentication belongs only to the maintainer environment that runs the
explicit `--publish` command.

- Build, smoke, inventory, or artifact upload failure publishes nothing.
- A package preflight failure publishes nothing; correct the source or selected
  tarball and rerun the read-only command.
- If the platform package succeeds and the core package fails, inspect the
  registry and retry only the exact verified core tarball.
- GitHub/Gitee release publication and repair are not claims of this workflow.
