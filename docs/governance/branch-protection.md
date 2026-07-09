# Branch Protection

The repository should protect `main` so ordinary contributors and AI workers cannot push directly. All normal work must merge through pull requests with review and passing CI.

## Required GitHub Settings

Protect branch: `main`

Rules:

- Require a pull request before merging.
- Require at least 1 approving review.
- Require review from Code Owners.
- Dismiss stale approvals when new commits are pushed.
- Require approval of the most recent reviewable push.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Required status check: `test`.
- Require conversation resolution before merging.
- Require linear history.
- Block force pushes.
- Block deletions.
- Do not apply the rule to administrators, so repository admins retain emergency recovery access.

Recommended push restrictions:

- Restrict who can push to matching branches.
- Allowed direct-push team: `@astraclawteam/agent-computer-use-admins`.
- No individual users should be added unless they are break-glass administrators.

## Apply With Script

After authenticating GitHub CLI:

```sh
gh auth login
npm run governance:protect-main
```

Optional environment variables:

```sh
GITHUB_REPOSITORY=astraclawteam/agent-computer-use-mcp
BRANCH=main
ADMIN_TEAM_SLUGS=agent-computer-use-admins
REQUIRED_STATUS_CHECKS=test
```

The script uses GitHub branch protection APIs. If your organization uses GitHub Rulesets instead of classic branch protection, keep this document as the policy source and mirror the same requirements in the ruleset UI/API.

