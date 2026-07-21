import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("permission policy denies unsafe windows and disabled admin tier", async () => {
  const {
    createComputerUsePolicy,
    DEFAULT_DENIED_WINDOW_CATEGORIES,
  } = await import("../src/computer-use-policy.mjs");
  const policy = createComputerUsePolicy();

  assert.deepEqual(DEFAULT_DENIED_WINDOW_CATEGORIES, [
    "credential-manager",
    "payment",
    "private-browsing",
    "os-security",
    "private-document",
  ]);

  assert.deepEqual(policy.evaluateAccessRequest({
    tier: "admin",
    window: { title: "Computer Use Lab", processName: "lab.exe" },
  }), {
    allowed: false,
    code: "permission.admin_disabled",
    tier: "admin",
    includeUserOverlay: false,
  });

  assert.deepEqual(policy.evaluateAccessRequest({
    tier: "full",
    window: { title: "1Password - Password Manager", processName: "1Password.exe" },
  }), {
    allowed: false,
    code: "policy.window_denied",
    category: "credential-manager",
    reason: "title-pattern",
    includeUserOverlay: false,
  });

  assert.equal(policy.evaluateAccessRequest({
    tier: "full",
    window: { title: "Computer Use Lab", processName: "lab.exe" },
  }).allowed, true);
});

test("permission policy validates action tiers, allowlist, and secure fields", async () => {
  const { createComputerUsePolicy } = await import("../src/computer-use-policy.mjs");
  const policy = createComputerUsePolicy();
  const observation = {
    elements: [
      { elementToken: "name", role: "Edit", name: "Name", actions: ["set_value"] },
      { elementToken: "password", role: "Edit", name: "Password", isPassword: true, actions: ["set_value"] },
      { elementToken: "save", role: "Button", name: "Save", actions: ["click"] },
    ],
  };

  assert.deepEqual(policy.validateAction({
    tier: "observe",
    action: { kind: "click", elementToken: "save" },
    observation,
  }), {
    allowed: false,
    code: "permission.denied",
    tier: "observe",
    requiredTier: "full",
    includeUserOverlay: false,
  });

  assert.deepEqual(policy.validateAction({
    tier: "full",
    action: { kind: "drag", elementToken: "save" },
    observation,
  }), {
    allowed: false,
    code: "action.kind_unsupported",
    allowedKinds: ["set_value", "type_text", "click"],
    includeUserOverlay: false,
  });

  assert.deepEqual(policy.validateAction({
    tier: "full",
    action: { kind: "set_value", elementToken: "password", value: "secret" },
    observation,
  }), {
    allowed: false,
    code: "policy.secure_field_denied",
    elementToken: "password",
    fieldKind: "password",
    includeUserOverlay: false,
  });

  assert.equal(policy.validateAction({
    tier: "full",
    action: { kind: "click", elementToken: "save" },
    observation,
  }).allowed, true);
});

test("provider router applies policy to request access and password field actions", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const driver = {
    async findWindow(args) {
      calls.push({ method: "findWindow", args });
      if (args.titlePart.includes("1Password")) {
        return { windowId: "secret", title: "1Password - Password Manager", processName: "1Password.exe" };
      }
      return { windowId: "lab", title: "Computer Use Lab", processName: "lab.exe" };
    },
    async capture() {
      calls.push({ method: "capture" });
      return {
        observationId: "obs-policy",
        elements: [
          { elementToken: "password", role: "Edit", name: "Password", isPassword: true, actions: ["set_value"] },
        ],
        includeUserOverlay: false,
      };
    },
    async setValue(args) {
      calls.push({ method: "setValue", args });
      return { status: "ok" };
    },
  };
  const router = new ComputerUseProviderRouter({ driver });

  await assert.rejects(
    () => router.requestAccess({ titlePart: "1Password", tier: "full" }),
    /policy.window_denied/,
  );

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await router.capture({ mode: "semantic" });
  await assert.rejects(
    () => router.act({ action: { kind: "set_value", elementToken: "password", value: "secret" } }),
    /policy.secure_field_denied/,
  );
  assert.equal(calls.some((call) => call.method === "setValue"), false);
});

test("Phase 1.9 has an executable permission policy smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.9"], "node src/phase-1-9-policy-engine.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["1.9"], "permission-policy-engine");
  assert.equal(health.actionPolicy.secureFieldPolicy, "deny-read-write-without-future-high-risk-flow");

  const result = await runNode(["src/phase-1-9-policy-engine.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "1.9");
  assert.equal(report.benchmark, "permission-policy-engine");
  assert.equal(report.observeDeniedAction, true);
  assert.equal(report.unsafeWindowDenied, true);
  assert.equal(report.passwordFieldDenied, true);
  assert.equal(report.adminDisabled, true);
  assert.equal(report.includeUserOverlay, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
