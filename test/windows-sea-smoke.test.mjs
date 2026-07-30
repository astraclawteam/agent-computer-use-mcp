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
  assert.match(source, /click\.status !== "ok"/u);
  assert.match(source, /click\.result\?\.verified !== true/u);
  assert.match(source, /savedText !== "windows-sea-layer-a"/u);
  assert.doesNotMatch(source, /connection\.call\("computer\.(?:request_access|capture|cancel|list_state)"/u);
  assert.doesNotMatch(source, /command:\s*process\.execPath/u);
});
