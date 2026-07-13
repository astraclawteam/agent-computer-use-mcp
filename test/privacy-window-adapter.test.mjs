import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runAppAdapter } from "../src/app-adapters/adapter-contract.mjs";
import { createPrivacyWindowAdapter } from "../src/app-adapters/privacy-window.mjs";

const EXECUTABLE = {
  path: "C:/Program Files (x86)/WXWork/WXWork.exe",
  fileName: "WXWork.exe",
  version: "5.0.0",
  sizeBytes: 20,
  sha256: "a".repeat(64),
};

test("privacy adapter may list application windows and evaluate policy only", async () => {
  const tools = [];
  const policyCalls = [];
  const mcp = {
    async start() {},
    async close() {},
    async callTool(name) {
      tools.push(name);
      return { structuredContent: { windows: [{
        pid: 606,
        window_id: "private-window",
        process_name: "WXWork.exe",
        title: "企业微信 - private conversation title",
      }] } };
    },
  };
  const result = await runAppAdapter(createPrivacyWindowAdapter({
    mcp,
    executable: EXECUTABLE,
    applicationId: "wecom",
    fixedTitlePrefixes: ["企业微信", "WeCom"],
    policyEvaluator(request) {
      policyCalls.push(request);
      return { allowed: false, code: "policy.private_content_capture_denied" };
    },
  }), { controlLease: { id: "privacy-policy", status: "active" } });

  assert.equal(result.status, "policy-blocked");
  assert.deepEqual(tools, ["list_windows"]);
  assert.deepEqual(policyCalls.map((call) => call.operation), ["capture", "action"]);
  assert.equal(result.finalState.kind, "policy-event");
  assert.equal(result.finalState.applicationId, "wecom");
  assert.equal(JSON.stringify(result).includes("private conversation title"), false);
  assert.equal(result.executable.path, undefined);
});

test("privacy adapter fails closed if either capture or action policy is allowed", async () => {
  for (const allowedOperation of ["capture", "action"]) {
    const result = await runAppAdapter(createPrivacyWindowAdapter({
      mcp: windowOnlyMcp(),
      executable: EXECUTABLE,
      applicationId: "wecom",
      fixedTitlePrefixes: ["企业微信"],
      policyEvaluator: ({ operation }) => operation === allowedOperation
        ? { allowed: true }
        : { allowed: false, code: "policy.private_content_capture_denied" },
    }), { controlLease: { id: "privacy-policy", status: "active" } });
    assert.equal(result.status, "product-failure", allowedOperation);
    assert.equal(result.reason, "policy.private_window_not_denied", allowedOperation);
  }
});

test("privacy adapter source contains no content observation, action, OCR, screenshot, hotkey, or artifact APIs", async () => {
  const source = await readFile("src/app-adapters/privacy-window.mjs", "utf8");
  for (const forbidden of ["get_window_state", "screenshot", "ocr", "set_value", "hotkey", "writeFile", "artifact"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "iu"), forbidden);
  }
});

function windowOnlyMcp() {
  return {
    async start() {},
    async close() {},
    async callTool(name) {
      assert.equal(name, "list_windows");
      return { structuredContent: { windows: [{ pid: 606, process_name: "WXWork.exe", title: "企业微信" }] } };
    },
  };
}
