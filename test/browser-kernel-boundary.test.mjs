import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const forbidden = [
  "connectOverCDP",
  "CDPBrowserProxy",
  "WebContentsView",
  "playwright-core",
  "electron.debugger",
];

test("the public OS MCP package does not embed a preview browser kernel", async () => {
  const source = await readTree(path.resolve("src"));
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `forbidden preview browser kernel token: ${token}`);
  }
});

async function readTree(root) {
  const chunks = [];
  for (const name of (await readdir(root)).sort()) {
    const file = path.join(root, name);
    const info = await stat(file);
    if (info.isDirectory()) chunks.push(await readTree(file));
    else if (/\.(?:mjs|cjs|js)$/.test(name)) chunks.push(await readFile(file, "utf8"));
  }
  return chunks.join("\n");
}

