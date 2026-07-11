import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const API_ROOT = "https://gitee.com/api/v5";

export function planGiteeMirror({ githubAssets = [], giteeAssets = [] } = {}) {
  const expected = new Map(githubAssets.map((asset) => [asset.name, asset]));
  const actual = new Map(giteeAssets.map((asset) => [asset.name, asset]));
  const plan = { keep: [], replace: [], upload: [], remove: [] };
  for (const asset of githubAssets) {
    const remote = actual.get(asset.name);
    if (!remote) plan.upload.push(asset.name);
    else if (remote.sizeBytes === asset.sizeBytes && remote.sha256 === asset.sha256) plan.keep.push(asset.name);
    else plan.replace.push(asset.name);
  }
  for (const asset of giteeAssets) {
    if (!expected.has(asset.name)) plan.remove.push(asset.name);
  }
  return plan;
}

export async function mirrorGiteeRelease(options = {}) {
  const context = releaseContext(options);
  const release = await getOrCreateRelease(context);
  const listed = await listReleaseAssets(context, release.id);
  const remoteAssets = await hydrateRemoteHashes(context, listed);
  const plan = planGiteeMirror({ githubAssets: context.assets, giteeAssets: remoteAssets });
  const byName = new Map(listed.map((asset) => [asset.name, asset]));
  for (const name of [...plan.replace, ...plan.remove]) {
    await apiRequest(context, `/repos/${segment(context.owner)}/${segment(context.repo)}/releases/${release.id}/attach_files/${byName.get(name).id}`, {
      method: "DELETE",
    });
  }
  const localByName = new Map(context.assets.map((asset) => [asset.name, asset]));
  for (const name of [...plan.replace, ...plan.upload]) {
    await uploadAsset(context, release.id, localByName.get(name));
  }
  return {
    status: "mirrored",
    releaseId: release.id,
    tag: context.tag,
    plan,
    assets: context.assets.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })),
  };
}

export async function verifyGiteeRelease(options = {}) {
  const context = releaseContext({ ...options, assets: options.expectedAssets });
  const release = await getReleaseByTag(context);
  if (!release) throw mirrorError("gitee.release_missing", context.tag);
  const listed = await listReleaseAssets(context, release.id);
  const remote = await hydrateRemoteHashes(context, listed);
  const plan = planGiteeMirror({ githubAssets: context.assets, giteeAssets: remote });
  if (plan.replace.length > 0 || plan.upload.length > 0 || plan.remove.length > 0) {
    throw mirrorError("gitee.asset_identity_mismatch", JSON.stringify(plan));
  }
  return {
    status: "passed",
    releaseId: release.id,
    tag: context.tag,
    assets: remote.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })),
  };
}

async function getOrCreateRelease(context) {
  const existing = await getReleaseByTag(context);
  if (existing) return existing;
  return apiRequest(context, `/repos/${segment(context.owner)}/${segment(context.repo)}/releases`, {
    method: "POST",
    json: {
      tag_name: context.tag,
      name: context.tag,
      body: `Byte-identical mirror of GitHub Release ${context.tag}.`,
      prerelease: false,
    },
  });
}

async function getReleaseByTag(context) {
  return apiRequest(context, `/repos/${segment(context.owner)}/${segment(context.repo)}/releases/tags/${segment(context.tag)}`, {
    allow404: true,
  });
}

async function listReleaseAssets(context, releaseId) {
  const assets = [];
  for (let page = 1; ; page += 1) {
    const result = await apiRequest(context, `/repos/${segment(context.owner)}/${segment(context.repo)}/releases/${releaseId}/attach_files?page=${page}&per_page=100`);
    if (!Array.isArray(result)) throw mirrorError("gitee.response_invalid", "attach_files");
    assets.push(...result.map((asset) => ({
      id: asset.id,
      name: asset.name,
      sizeBytes: asset.sizeBytes ?? asset.size,
      sha256: asset.sha256,
      downloadUrl: asset.browser_download_url ?? asset.download_url,
    })));
    if (result.length < 100) return assets;
  }
}

async function hydrateRemoteHashes(context, assets) {
  return Promise.all(assets.map(async (asset) => {
    if (/^[a-f0-9]{64}$/u.test(asset.sha256 ?? "")) return asset;
    if (typeof asset.downloadUrl !== "string") return { ...asset, sha256: null };
    const response = await retryFetch(context, asset.downloadUrl, { method: "GET" }, false);
    if (!response.ok) throw mirrorError("gitee.asset_download_failed", asset.name);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      ...asset,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
}

async function uploadAsset(context, releaseId, asset) {
  if (!asset) throw mirrorError("gitee.local_asset_missing", "unknown");
  const bytes = await readFile(asset.path);
  if (bytes.length !== asset.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw mirrorError("gitee.local_asset_identity_mismatch", asset.name);
  }
  const form = new FormData();
  form.append("file", new Blob([bytes]), asset.name);
  return apiRequest(context, `/repos/${segment(context.owner)}/${segment(context.repo)}/releases/${releaseId}/attach_files`, {
    method: "POST",
    body: form,
  });
}

async function apiRequest(context, path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("authorization", `token ${context.token}`);
  headers.set("accept", "application/json");
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await retryFetch(context, `${API_ROOT}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  }, true);
  if (options.allow404 && response.status === 404) return null;
  if (!response.ok) throw mirrorError("gitee.api_failed", `${response.status} ${path.split("?")[0]}`);
  if (response.status === 204) return null;
  return response.json();
}

async function retryFetch(context, url, options, apiRequest) {
  let lastResponse;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const request = apiRequest ? options : { ...options, headers: undefined };
    try {
      lastResponse = await context.fetch(url, request);
    } catch (cause) {
      if (attempt === 2) throw mirrorError("gitee.transport_failed", sanitize(cause));
      await context.delay(100 * (2 ** attempt));
      continue;
    }
    if (lastResponse.status !== 429 && lastResponse.status < 500) return lastResponse;
    if (attempt < 2) await context.delay(100 * (2 ** attempt));
  }
  return lastResponse;
}

function releaseContext(options) {
  for (const name of ["owner", "repo", "tag", "token"]) {
    if (typeof options[name] !== "string" || options[name].trim() === "") throw mirrorError("gitee.config_missing", name);
  }
  if (!Array.isArray(options.assets)) throw mirrorError("gitee.assets_invalid", "assets");
  return {
    owner: options.owner,
    repo: options.repo,
    tag: options.tag,
    token: options.token,
    assets: options.assets,
    fetch: options.fetch ?? globalThis.fetch,
    delay: options.delay ?? ((ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))),
  };
}

function segment(value) {
  return encodeURIComponent(value);
}

function sanitize(value) {
  return value instanceof Error ? value.name : typeof value;
}

function mirrorError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}
