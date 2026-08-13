#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const DEFAULT_HUB_CATALOG_URL = "https://xiaozhi.qlogicagent.com/api/v15/registry/catalog";

export async function verifyHubPublicRelease({
  id,
  version,
  catalogUrl = DEFAULT_HUB_CATALOG_URL,
  samples = 6,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u.test(id ?? "")) {
    throw new Error("hub.verify.id_invalid");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version ?? "")) {
    throw new Error("hub.verify.version_invalid");
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > 20) {
    throw new Error("hub.verify.samples_invalid");
  }
  if (typeof fetchImpl !== "function") throw new Error("hub.verify.fetch_unavailable");

  for (let sample = 1; sample <= samples; sample += 1) {
    const url = new URL(catalogUrl);
    url.searchParams.set("type", "mcp");
    url.searchParams.set("q", id);
    url.searchParams.set("limit", "48");
    url.searchParams.set("release_verify", `${version}-${sample}-${Date.now()}`);
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`hub.verify.catalog_http_error: ${response.status}`);
    }
    const body = await response.json();
    if (!Array.isArray(body?.resources)) {
      throw new Error("hub.verify.catalog_payload_invalid");
    }
    const resource = body.resources.find((candidate) => candidate?.id === id);
    if (!resource) {
      throw new Error(`hub.verify.resource_missing: ${id}`);
    }
    if (resource.latestVersion !== version) {
      throw new Error(`hub.verify.version_mismatch: ${resource.latestVersion ?? "missing"} != ${version}`);
    }
    if (resource.type !== "mcp" || resource.manifest?.kind !== "executable") {
      throw new Error("hub.verify.public_shape_invalid");
    }
    log(`[hub-release] public ${id}@${version} sample ${sample}/${samples}`);
  }
}

function parseArgs(args) {
  const values = new Map();
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    if (!match || values.has(match[1])) throw new Error("Usage: --id=<resource-id> --version=<X.Y.Z> [--catalog-url=<url>] [--samples=<n>]");
    values.set(match[1], match[2]);
  }
  const unknown = [...values.keys()].filter((key) => !["id", "version", "catalog-url", "samples"].includes(key));
  if (unknown.length > 0 || !values.has("id") || !values.has("version")) {
    throw new Error("Usage: --id=<resource-id> --version=<X.Y.Z> [--catalog-url=<url>] [--samples=<n>]");
  }
  return {
    id: values.get("id"),
    version: values.get("version"),
    ...(values.has("catalog-url") ? { catalogUrl: values.get("catalog-url") } : {}),
    ...(values.has("samples") ? { samples: Number(values.get("samples")) } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHubPublicRelease(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
