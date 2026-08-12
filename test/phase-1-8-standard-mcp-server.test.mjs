import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 1.8 server uses the official MCP SDK transport instead of a hand-rolled protocol loop", () => {
  const source = readFileSync("src/computer-use-mcp-server.mjs", "utf8");

  assert.match(source, /@modelcontextprotocol\/sdk\/server\/index\.js/);
  assert.match(source, /@modelcontextprotocol\/sdk\/server\/stdio\.js/);
  assert.doesNotMatch(source, /for await \(const chunk of process\.stdin\)/);
  assert.doesNotMatch(source, /async function handleLine/);
  assert.doesNotMatch(source, /async function dispatch/);
  assert.doesNotMatch(source, /function write\(message\)/);
  assert.match(source, /COMPUTER_USE_MCP_VERSION/);
  assert.doesNotMatch(source, /version:\s*"0\.0\.\d+"/);
});

test("release version has one package-owned source of truth", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const { COMPUTER_USE_MCP_VERSION } = await import("../src/computer-use-version.mjs");

  assert.equal(COMPUTER_USE_MCP_VERSION, packageJson.version);
});

test("Phase 1.8 cua-driver MCP bridge also uses the official MCP SDK client", () => {
  const source = readFileSync("src/cua-driver-mcp-driver.mjs", "utf8");

  assert.match(source, /@modelcontextprotocol\/sdk\/client\/index\.js/);
  assert.match(source, /@modelcontextprotocol\/sdk\/client\/stdio\.js/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{ jsonrpc/);
  assert.doesNotMatch(source, /handleStdout/);
  assert.doesNotMatch(source, /pending = new Map/);
});

test("Phase 1.8 has an executable standard MCP SDK server smoke script", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.8"], "node src/phase-1-8-standard-mcp-server.mjs");
});
