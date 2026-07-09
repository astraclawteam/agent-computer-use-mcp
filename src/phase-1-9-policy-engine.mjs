import { createComputerUsePolicy } from "./computer-use-policy.mjs";

const policy = createComputerUsePolicy();
const observation = {
  elements: [
    { elementToken: "password", role: "Edit", name: "Password", isPassword: true },
    { elementToken: "save", role: "Button", name: "Save" },
  ],
};

const observeAction = policy.validateAction({
  tier: "observe",
  action: { kind: "click", elementToken: "save" },
  observation,
});
const unsafeWindow = policy.evaluateAccessRequest({
  tier: "full",
  window: { title: "1Password - Password Manager", processName: "1Password.exe" },
});
const passwordField = policy.validateAction({
  tier: "full",
  action: { kind: "set_value", elementToken: "password", value: "secret" },
  observation,
});
const adminTier = policy.evaluateAccessRequest({
  tier: "admin",
  window: { title: "Computer Use Lab", processName: "lab.exe" },
});
const ordinaryWindow = policy.evaluateAccessRequest({
  tier: "full",
  window: { title: "Computer Use Lab", processName: "lab.exe" },
});

const passed = observeAction.code === "permission.denied"
  && unsafeWindow.code === "policy.window_denied"
  && passwordField.code === "policy.secure_field_denied"
  && adminTier.code === "permission.admin_disabled"
  && ordinaryWindow.allowed === true;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "1.9",
  benchmark: "permission-policy-engine",
  observeDeniedAction: observeAction.allowed === false,
  unsafeWindowDenied: unsafeWindow.allowed === false,
  passwordFieldDenied: passwordField.allowed === false,
  adminDisabled: adminTier.allowed === false,
  ordinaryWindowAllowed: ordinaryWindow.allowed === true,
  includeUserOverlay: false,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;
