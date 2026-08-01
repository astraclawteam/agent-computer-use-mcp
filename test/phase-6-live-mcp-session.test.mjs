import assert from "node:assert/strict";
import test from "node:test";
import { createPhase6LiveSession } from "../src/phase-6-live-mcp-session.mjs";

test("the live Phase 6 session uses the official client and releases an acquired lease on close", async () => {
  const calls = [];
  let closes = 0;
  const session = createPhase6LiveSession({
    client: {
      async callTool(request) {
        calls.push(structuredClone(request));
        if (request.name === "computer.acquire") {
          return { structuredContent: { status: "granted" } };
        }
        if (request.name === "computer.release") {
          return { structuredContent: { status: "cancelled" } };
        }
        return { structuredContent: { status: "ok" } };
      },
      async close() { closes += 1; },
    },
  });

  await session.callTool("computer.acquire", { applicationName: "fixture" });
  await session.callTool("computer.observe", { mode: "semantic" });
  await session.close();
  await session.close();

  assert.deepEqual(calls.map((call) => call.name), [
    "computer.acquire",
    "computer.observe",
    "computer.release",
  ]);
  assert.equal(closes, 1);
});

test("an explicit release prevents a duplicate cleanup release", async () => {
  const calls = [];
  const session = createPhase6LiveSession({
    client: {
      async callTool(request) {
        calls.push(request.name);
        return {
          structuredContent: {
            status: request.name === "computer.acquire" ? "granted" : "released",
          },
        };
      },
      async close() {},
    },
  });

  await session.callTool("computer.acquire", { applicationName: "fixture" });
  await session.callTool("computer.release", { reason: "completed" });
  await session.close();

  assert.deepEqual(calls, ["computer.acquire", "computer.release"]);
});

test("the live session can retain raw MCP media for visual acceptance diagnostics", async () => {
  const calls = [];
  const rawResult = {
    structuredContent: { status: "ok" },
    content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
  };
  const session = createPhase6LiveSession({
    client: {
      async callTool(request) {
        calls.push(request.name);
        return rawResult;
      },
      async close() {},
    },
  });

  assert.equal(await session.callToolRaw("computer.observe", { mode: "screenshot" }), rawResult);
  assert.deepEqual(calls, ["computer.observe"]);
  await session.close();
});
