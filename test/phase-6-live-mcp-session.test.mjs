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

test("the live Phase 6 session forwards cancellation and exposes the SDK transport pid", async () => {
  const calls = [];
  const controller = new AbortController();
  const session = createPhase6LiveSession({
    client: {
      async callTool(request, schema, options) {
        calls.push({ request, schema, options });
        return { structuredContent: { status: "ok" } };
      },
      async close() {},
    },
    transport: { pid: 4242 },
  });

  await session.callTool(
    "computer.observe",
    { mode: "state" },
    { signal: controller.signal },
  );
  await session.close();

  assert.equal(session.processId, 4242);
  assert.deepEqual(calls[0].request, {
    name: "computer.observe",
    arguments: { mode: "state" },
  });
  assert.equal(calls[0].schema, undefined);
  assert.equal(calls[0].options.signal, controller.signal);
});
