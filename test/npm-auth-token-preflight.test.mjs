import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = "scripts/validate-npm-auth-token.mjs";

test("npm auth preflight rejects malformed tokens without revealing them", () => {
  const token = "npm_secret-value-with-a-newline\n";
  const result = runPreflight(token);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm auth token preflight failed/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /secret-value/u);
});

test("npm auth preflight accepts a structurally valid token with safe metadata", () => {
  const token = `npm_${"A".repeat(36)}`;
  const result = runPreflight(token);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm auth token preflight passed/u);
  assert.match(result.stdout, /"length":40/u);
  assert.doesNotMatch(result.stdout, new RegExp(token, "u"));
});

function runPreflight(token) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_AUTH_TOKEN: token,
    },
  });
}
