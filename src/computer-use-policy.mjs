export const DEFAULT_ALLOWED_ACTION_KINDS = ["set_value", "click"];
export const DEFAULT_DELIVERY_MODES = ["background"];
export const DEFAULT_PERMISSION_TIERS = ["observe", "full", "admin"];
export const DEFAULT_DENIED_WINDOW_CATEGORIES = [
  "credential-manager",
  "payment",
  "private-browsing",
  "os-security",
  "private-document",
];

const DEFAULT_DENIED_WINDOWS = [
  {
    category: "credential-manager",
    reason: "title-pattern",
    title: /\b(1password|bitwarden|keepass|lastpass|password manager|credential manager)\b/i,
  },
  {
    category: "payment",
    reason: "title-pattern",
    title: /\b(payment|checkout|paypal|stripe|bank transfer|wire transfer)\b/i,
  },
  {
    category: "private-browsing",
    reason: "title-pattern",
    title: /\b(incognito|inprivate|private browsing)\b/i,
  },
  {
    category: "os-security",
    reason: "title-pattern",
    title: /\b(windows security|user account control|credential prompt|security prompt)\b/i,
  },
  {
    category: "private-document",
    reason: "title-pattern",
    title: /\b(private document|confidential|tax return|medical record)\b/i,
  },
];

export function createComputerUsePolicy(options = {}) {
  const allowedKinds = options.allowedKinds ?? DEFAULT_ALLOWED_ACTION_KINDS;
  const deliveryModes = options.deliveryModes ?? DEFAULT_DELIVERY_MODES;
  const permissionTiers = options.permissionTiers ?? DEFAULT_PERMISSION_TIERS;
  const allowAdmin = options.allowAdmin === true;
  const deniedWindows = options.deniedWindows ?? DEFAULT_DENIED_WINDOWS;

  return {
    describe() {
      return {
        permissionTiers,
        allowedKinds,
        deliveryModes,
        deniedWindowCategories: DEFAULT_DENIED_WINDOW_CATEGORIES,
        adminEnabled: allowAdmin,
        observeTierBlocksAction: true,
        secureFieldPolicy: "deny-read-write-without-future-high-risk-flow",
      };
    },

    evaluateAccessRequest({ tier = "full", window } = {}) {
      if (!permissionTiers.includes(tier)) {
        return deny("access.tier_unsupported", { tier, allowedTiers: permissionTiers });
      }
      if (tier === "admin" && !allowAdmin) {
        return deny("permission.admin_disabled", { tier });
      }

      const deniedWindow = matchDeniedWindow(window, deniedWindows);
      if (deniedWindow) {
        return deny("policy.window_denied", deniedWindow);
      }

      return {
        allowed: true,
        tier,
        includeUserOverlay: false,
      };
    },

    validateAction({ tier = "full", action, observation } = {}) {
      if (!permissionTiers.includes(tier)) {
        return deny("access.tier_unsupported", { tier, allowedTiers: permissionTiers });
      }
      if (tier === "admin" && !allowAdmin) {
        return deny("permission.admin_disabled", { tier });
      }
      if (!action?.kind) {
        return deny("action.kind_required");
      }
      if (!allowedKinds.includes(action.kind)) {
        return deny("action.kind_unsupported", { allowedKinds });
      }
      if (tier === "observe") {
        return deny("permission.denied", { tier, requiredTier: "full" });
      }

      const hasElementRef = action.elementToken !== undefined || action.elementIndex !== undefined;
      if (!hasElementRef) {
        return deny("action.element_required");
      }
      if (action.kind === "set_value" && typeof action.value !== "string") {
        return deny("action.value_required");
      }

      const deliveryMode = action.deliveryMode ?? "background";
      if (!deliveryModes.includes(deliveryMode)) {
        return deny("delivery_mode.unsupported", { allowedDeliveryModes: deliveryModes });
      }

      const element = findObservationElement(observation, action);
      if (element && isSecureField(element)) {
        const detail = {
          fieldKind: "password",
        };
        if (element.elementToken !== undefined) detail.elementToken = element.elementToken;
        if (element.elementIndex !== undefined) detail.elementIndex = element.elementIndex;
        return deny("policy.secure_field_denied", {
          ...detail,
        });
      }

      return {
        allowed: true,
        tier,
        actionKind: action.kind,
        includeUserOverlay: false,
      };
    },
  };
}

function matchDeniedWindow(window, deniedWindows) {
  const title = window?.title ?? "";
  const processName = window?.processName ?? window?.process ?? "";
  for (const rule of deniedWindows) {
    if (rule.title?.test(title) || rule.processName?.test(processName)) {
      return {
        category: rule.category,
        reason: rule.reason,
      };
    }
  }
  return null;
}

function findObservationElement(observation, action) {
  const elements = observation?.elements ?? [];
  if (action.elementToken !== undefined) {
    return elements.find((element) => element.elementToken === action.elementToken);
  }
  if (action.elementIndex !== undefined) {
    return elements[action.elementIndex];
  }
  return undefined;
}

function isSecureField(element) {
  if (element.isPassword || element.password || element.secureTextEntry) return true;
  const text = `${element.role ?? ""} ${element.name ?? ""} ${element.label ?? ""}`.toLowerCase();
  return text.includes("password") || text.includes("secure text");
}

function deny(code, detail = {}) {
  return {
    allowed: false,
    code,
    ...detail,
    includeUserOverlay: false,
  };
}
