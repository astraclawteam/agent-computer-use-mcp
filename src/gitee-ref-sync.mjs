import { spawn } from "node:child_process";

const API_ROOT = "https://gitee.com/api/v5";

export async function syncGiteeReleaseRef(options = {}) {
  const context = validateOptions(options);
  const identity = await resolveIdentity(context);
  const existingTagCommit = await resolveTagCommit(context);
  const authorization = Buffer.from(`${identity.login}:${context.token}`, "utf8").toString("base64");
  const args = [
    "push",
    "--porcelain",
    `https://gitee.com/${context.owner}/${context.repo}.git`,
    `${context.mainCommit}:refs/heads/main`,
  ];
  if (existingTagCommit === null) args.push(`${context.sourceCommit}:refs/tags/${context.tag}`);
  const result = await context.runGit(args, {
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "http.extraHeader",
      GIT_CONFIG_VALUE_1: `Authorization: Basic ${authorization}`,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.exitCode !== 0) throw syncError("gitee.ref_sync_failed", String(result.exitCode));
  return { status: "synced", tag: context.tag, sourceCommit: context.sourceCommit };
}

async function resolveTagCommit(context) {
  let response;
  try {
    response = await context.fetch(
      `${API_ROOT}/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/commits/${encodeURIComponent(context.tag)}`,
      {
        method: "GET",
        headers: {
          authorization: `token ${context.token}`,
          accept: "application/json",
        },
      },
    );
  } catch (cause) {
    throw syncError("gitee.transport_failed", cause instanceof Error ? cause.name : typeof cause);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw syncError("gitee.api_failed", String(response.status));
  const commit = await response.json();
  if (commit?.sha !== context.sourceCommit) {
    throw syncError("gitee.tag_commit_mismatch", `${commit?.sha ?? "missing"} != ${context.sourceCommit}`);
  }
  return commit.sha;
}

async function resolveIdentity(context) {
  let response;
  try {
    response = await context.fetch(`${API_ROOT}/user`, {
      method: "GET",
      headers: {
        authorization: `token ${context.token}`,
        accept: "application/json",
      },
    });
  } catch (cause) {
    throw syncError("gitee.transport_failed", cause instanceof Error ? cause.name : typeof cause);
  }
  if (!response.ok) throw syncError("gitee.api_failed", String(response.status));
  const identity = await response.json();
  if (!/^[0-9A-Za-z_.-]+$/u.test(identity?.login ?? "")) {
    throw syncError("gitee.identity_invalid", "login");
  }
  return identity;
}

function validateOptions(options) {
  for (const name of ["owner", "repo"]) {
    if (!/^[0-9A-Za-z_.-]+$/u.test(options[name] ?? "")) throw syncError("gitee.config_invalid", name);
  }
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.tag ?? "")) {
    throw syncError("gitee.config_invalid", "tag");
  }
  if (!/^[a-f0-9]{40}$/u.test(options.sourceCommit ?? "")) {
    throw syncError("gitee.config_invalid", "sourceCommit");
  }
  const mainCommit = options.mainCommit ?? options.sourceCommit;
  if (!/^[a-f0-9]{40}$/u.test(mainCommit ?? "")) throw syncError("gitee.config_invalid", "mainCommit");
  if (!/^[\x21-\x7e]+$/u.test(options.token ?? "")) throw syncError("gitee.config_invalid", "token");
  return {
    owner: options.owner,
    repo: options.repo,
    tag: options.tag,
    sourceCommit: options.sourceCommit,
    mainCommit,
    token: options.token,
    fetch: options.fetch ?? globalThis.fetch,
    runGit: options.runGit ?? runGit,
  };
}

function runGit(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(syncError("gitee.ref_sync_failed", cause.name)));
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout, stderr }));
  });
}

function syncError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
