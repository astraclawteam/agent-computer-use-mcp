import { spawnSync } from "node:child_process";

const repository = process.env.GITHUB_REPOSITORY ?? "astraclawteam/agent-computer-use-mcp";
const branch = process.env.BRANCH ?? "main";
const adminTeamSlugs = splitCsv(process.env.ADMIN_TEAM_SLUGS ?? "agent-computer-use-admins");
const requiredStatusChecks = splitCsv(process.env.REQUIRED_STATUS_CHECKS ?? "test");

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
}

const body = {
  required_status_checks: {
    strict: true,
    contexts: requiredStatusChecks,
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    dismissal_restrictions: {},
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    required_approving_review_count: 1,
    require_last_push_approval: true,
  },
  restrictions: {
    users: [],
    teams: adminTeamSlugs,
    apps: [],
  },
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: true,
};

ghApi([
  "repos/{owner}/{repo}/branches/{branch}/protection",
  "-X",
  "PUT",
  "-f",
  `owner=${owner}`,
  "-f",
  `repo=${repo}`,
  "-f",
  `branch=${branch}`,
  "--input",
  "-",
], JSON.stringify(body));

console.log(JSON.stringify({
  status: "configured",
  repository,
  branch,
  requiredStatusChecks,
  adminTeamSlugs,
}, null, 2));

function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function ghApi(args, input) {
  const result = spawnSync("gh", ["api", ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error([
      "GitHub API call failed.",
      `Command: gh api ${args.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
}

