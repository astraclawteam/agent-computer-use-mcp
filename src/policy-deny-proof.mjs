import { createComputerUsePolicy } from "./computer-use-policy.mjs";

const SENSITIVE_SURFACES = [
  {
    id: "credential-manager-window",
    kind: "window",
    window: { title: "1Password - Password Manager", processName: "1Password.exe" },
    expectedCode: "policy.window_denied",
  },
  {
    id: "payment-window",
    kind: "window",
    window: { title: "Stripe Checkout - Payment", processName: "chrome.exe" },
    expectedCode: "policy.window_denied",
  },
  {
    id: "private-browsing-window",
    kind: "window",
    window: { title: "InPrivate Browsing - Account", processName: "msedge.exe" },
    expectedCode: "policy.window_denied",
  },
  {
    id: "private-document-window",
    kind: "window",
    window: { title: "Confidential Tax Return", processName: "winword.exe" },
    expectedCode: "policy.window_denied",
  },
  {
    id: "password-field-action",
    kind: "action",
    action: { kind: "set_value", elementToken: "password", value: "secret" },
    observation: {
      elements: [
        { elementToken: "password", role: "Edit", name: "Password", isPassword: true, actions: ["set_value"] },
      ],
    },
    expectedCode: "policy.secure_field_denied",
  },
];

export function createPolicyDenyProof(options = {}) {
  const policy = options.policy ?? createComputerUsePolicy();
  const denials = SENSITIVE_SURFACES.map((surface) => evaluateSurface(policy, surface));
  const violations = denials
    .filter((denial) => denial.allowed !== false || denial.code !== denial.expectedCode)
    .map((denial) => ({
      id: denial.id,
      expectedCode: denial.expectedCode,
      actualCode: denial.code ?? null,
      allowed: denial.allowed,
    }));
  const actionDenial = denials.find((denial) => denial.id === "password-field-action");
  const actionExecutionBlocked = actionDenial?.allowed === false && actionDenial.code === "policy.secure_field_denied";

  return {
    phase: "1.11",
    status: violations.length === 0 ? "passed" : "failed",
    mode: "policy-deny-proof",
    deniedSurfaceIds: SENSITIVE_SURFACES.map((surface) => surface.id),
    denials,
    violations,
    actionExecutionBlocked,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function evaluateSurface(policy, surface) {
  const result = surface.kind === "window"
    ? policy.evaluateAccessRequest({ tier: "full", window: surface.window })
    : policy.validateAction({ tier: "full", action: surface.action, observation: surface.observation });

  return {
    id: surface.id,
    kind: surface.kind,
    expectedCode: surface.expectedCode,
    allowed: result.allowed,
    code: result.code ?? null,
    category: result.category ?? null,
    includeUserOverlay: result.includeUserOverlay === true,
  };
}
