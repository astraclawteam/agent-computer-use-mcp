import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows SEA smoke uses the released executable directly and fails closed on tampering", async () => {
  const source = await readFile(new URL("../src/windows-sea-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /new StdioClientTransport\(\{\s*command: executablePath/u);
  assert.match(source, /verifyWindowsSeaArtifactTree\(artifactRoot, inventory\)/u);
  assert.match(source, /tamperRejected/u);
  assert.match(source, /sourceCwdRequired: false/u);
  assert.match(source, /connection\.call\("computer\.acquire"/u);
  assert.match(source, /connection\.call\("computer\.observe", \{ mode: "semantic" \}\)/u);
  assert.match(source, /connection\.call\("computer\.release"/u);
  assert.match(source, /allowToolError: true/u);
  assert.match(source, /clickOutcomeVerified/u);
  assert.match(source, /capture\.scene\?\.elements/u);
  assert.match(source, /elementId: name\.id/u);
  assert.match(source, /click\.outcome === "committed"/u);
  assert.match(source, /click\.outcome === "indeterminate"/u);
  assert.match(source, /postcondition: "saved-file"/u);
  assert.match(source, /replayed: false/u);
  assert.match(source, /savedText !== "windows-sea-layer-a"/u);
  assert.doesNotMatch(source, /elementToken|elementIndex/u);
  assert.doesNotMatch(source, /connection\.call\("computer\.(?:request_access|capture|cancel|list_state)"/u);
  assert.doesNotMatch(source, /command:\s*process\.execPath/u);
});

test("Windows SEA smoke defaults to the current package version and releases control on close", async () => {
  const script = await readFile(new URL("../scripts/smoke-windows-sea-artifact.mjs", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/windows-sea-smoke.mjs", import.meta.url), "utf8");
  assert.match(script, /JSON\.parse\(await readFile\("package\.json", "utf8"\)\)/u);
  assert.match(script, /const version = readOption\("--version"\) \?\? packageJson\.version/u);
  assert.match(script, /artifacts\/mcp-executable\/\$\{version\}/u);
  assert.doesNotMatch(script, /artifacts\/mcp-executable\/0\.0\.\d+/u);
  assert.match(source, /name: "computer\.release"/u);
  assert.doesNotMatch(source, /name: "computer\.revoke"/u);
});

test("Windows SEA smoke proves the released executable defaults to the Agent surface", async () => {
  const source = await readFile(new URL("../src/windows-sea-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /const HOST_SURFACE_ARGS = \["--tool-surface=host"\]/u);
  assert.match(
    source,
    /const EXPECTED_AGENT_SURFACE_TOOLS = \["computer\.task", "computer\.message"\]/u,
  );
  assert.match(source, /await assertReleasedAgentSurface\(executablePath, launchRoot, options\.environment\)/u);
  assert.match(source, /sea_smoke\.agent_surface_invalid/u);
  assert.match(source, /sea_smoke\.agent_surface_callable/u);
  // The retained evidence must record what the gate proved, not only that it did not throw.
  assert.match(source, /hostOnlyToolRejectedAs: hidden\.error\.code/u);
  assert.match(source, /^\s+agentSurface,$/mu);
  // The lifecycle checks below it must run on an explicitly opted-in surface.
  assert.match(source, /createMcpConnection\(executablePath, launchRoot, options\.environment, HOST_SURFACE_ARGS\)/u);
});
