import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("static server serves the Computer Use demo page", async () => {
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit").then(() => true);

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  try {
    await waitFor(() => output.match(/http:\/\/127\.0\.0\.1:(\d+)/), 3000);
    const port = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /data-computer-use-frame/);
  } finally {
    if (!child.killed) child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))]);
  }
});

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for server");
}
