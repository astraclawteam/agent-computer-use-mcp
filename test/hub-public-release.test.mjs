import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyHubPublicRelease } from "../scripts/verify-hub-public-release.mjs";

test("public Hub release verification queries the exact MCP id and version repeatedly", async () => {
  const requests = [];
  const logs = [];
  await verifyHubPublicRelease({
    id: "agent-computer-use-mcp",
    version: "0.0.35",
    samples: 3,
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      return new Response(JSON.stringify({
        resources: [{
          id: "agent-computer-use-mcp",
          type: "mcp",
          latestVersion: "0.0.35",
          manifest: { kind: "executable" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    log: (line) => logs.push(line),
  });

  assert.equal(requests.length, 3);
  assert.equal(logs.length, 3);
  for (const request of requests) {
    assert.equal(request.searchParams.get("type"), "mcp");
    assert.equal(request.searchParams.get("q"), "agent-computer-use-mcp");
    assert.equal(request.searchParams.get("limit"), "48");
    assert.match(request.searchParams.get("release_verify"), /^0\.0\.35-/u);
  }
});

test("public Hub release verification rejects a stale catalog version", async () => {
  await assert.rejects(
    verifyHubPublicRelease({
      id: "agent-computer-use-mcp",
      version: "0.0.35",
      samples: 1,
      fetchImpl: async () => new Response(JSON.stringify({
        resources: [{
          id: "agent-computer-use-mcp",
          type: "mcp",
          latestVersion: "0.0.34",
          manifest: { kind: "executable" },
        }],
      }), { status: 200 }),
      log: () => {},
    }),
    /hub\.verify\.version_mismatch/u,
  );
});

test("public Hub release verification rejects a non-executable public projection", async () => {
  await assert.rejects(
    verifyHubPublicRelease({
      id: "agent-computer-use-mcp",
      version: "0.0.35",
      samples: 1,
      fetchImpl: async () => new Response(JSON.stringify({
        resources: [{
          id: "agent-computer-use-mcp",
          type: "mcp",
          latestVersion: "0.0.35",
          manifest: { kind: "stdio" },
        }],
      }), { status: 200 }),
      log: () => {},
    }),
    /hub\.verify\.public_shape_invalid/u,
  );
});
