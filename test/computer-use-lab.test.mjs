import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Computer Use Lab page exposes stable accessible controls", async () => {
  const html = await readFile(new URL("../public/lab.html", import.meta.url), "utf8");

  assert.match(html, /<title>Computer Use Lab<\/title>/);
  assert.match(html, /data-computer-use-lab/);
  assert.match(html, /aria-label="Name"/);
  assert.match(html, /data-lab-control="name"/);
  assert.match(html, /data-lab-control="save"/);
  assert.match(html, /data-lab-status/);
  assert.match(html, /data-lab-counter/);
  assert.match(html, /data-lab-list/);
});

test("Computer Use Lab script saves name into structured status text", async () => {
  const html = await readFile(new URL("../public/lab.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/lab.mjs", import.meta.url), "utf8");

  assert.match(html, /type="module" src="\.\/lab\.mjs"/);
  assert.match(script, /Saved: \$\{name\}/);
  assert.match(script, /data-lab-action-log/);
});
