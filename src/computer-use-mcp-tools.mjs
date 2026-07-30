export const MCP_RESULT_SCHEMA_VERSION = "5.4";

const ANY_OBJECT = { type: "object", additionalProperties: true };
const ANY_ARRAY = { type: "array", items: {} };
const BOX_SCHEMA = {
  type: "object",
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
  additionalProperties: false,
};
const MODEL_IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    provider: { type: "string" },
    model: { type: "string" },
    modelPack: { type: "string" },
    modelFormat: { type: "string" },
    runtime: { type: "string" },
    executionProvider: { type: "string" },
  },
  additionalProperties: false,
};
const PERCEPTION_ELEMENT_ARRAY = {
  type: "array",
  items: {
    type: "object",
    properties: {
      elementToken: { type: "string" },
      elementIndex: { type: "number" },
      role: { type: "string" },
      name: { type: "string" },
      value: { type: "string" },
      state: ANY_OBJECT,
      actions: { type: "array", items: { type: "string" } },
      bounds: BOX_SCHEMA,
      sourceRegion: BOX_SCHEMA,
      interactionPoint: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        additionalProperties: false,
      },
      geometryKind: { type: "string" },
      interactionPointSemantics: { type: "string" },
      controlBoundsKnown: { type: "boolean" },
      editableInteriorKnown: { type: "boolean" },
      confidence: { type: "number" },
      source: { type: "string" },
      proposalId: { type: "string" },
      templateId: { type: "string" },
      pixelLimitedAction: { type: "boolean" },
      guessedAction: { type: "boolean" },
      support: {
        type: "array",
        items: {
          type: "object",
          properties: {
            provider: { type: "string" },
            confidence: { type: "number" },
            proposalId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      modelIdentity: MODEL_IDENTITY_SCHEMA,
      rawTextSha256: { type: "string" },
      exact: { type: "boolean" },
      approvedActionLabel: { type: "boolean" },
      passwordRegion: { type: "boolean" },
      paymentRegion: { type: "boolean" },
      privateRegion: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

const COMMON_OUTPUT_PROPERTIES = {
  resultSchemaVersion: { const: MCP_RESULT_SCHEMA_VERSION },
  includeUserOverlay: { const: false },
  status: { type: "string" },
  error: ANY_OBJECT,
};

function outputSchema(properties = {}, required = []) {
  const schema = {
    type: "object",
    required: ["resultSchemaVersion", "includeUserOverlay"],
    properties: {
      ...COMMON_OUTPUT_PROPERTIES,
      ...properties,
    },
    additionalProperties: false,
  };
  if (required.length > 0) {
    schema.allOf = [{
      if: { required: ["error"] },
      then: { required: ["status", "error"] },
      else: { required },
    }];
  }
  return schema;
}

const LEGACY_COMPUTER_USE_MCP_TOOLS = [
  {
    name: "computer.health",
    title: "Computer Use Health",
    description: "Report local Gateway Computer Use module health without taking control of the desktop.",
    annotations: { phase: "0.9", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        fast: {
          type: "boolean",
          description: "When true, skip heavyweight provider initialization and report contract readiness.",
        },
        prewarm: {
          type: "boolean",
          description: "When true with fast=false, prewarm common OCR crop buckets in the daemon.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      module: { type: "string" },
      version: { type: "string" },
      phases: ANY_OBJECT,
      providers: ANY_OBJECT,
      capabilityHandshake: ANY_OBJECT,
      actionPolicy: ANY_OBJECT,
      driver: ANY_OBJECT,
      ocr: ANY_OBJECT,
      prewarm: ANY_OBJECT,
    }, ["status", "module", "version", "phases", "providers", "capabilityHandshake", "actionPolicy"]),
  },
  {
    name: "computer.doctor",
    title: "Computer Use Doctor",
    description: "Return actionable runtime and install/cache diagnostics without starting desktop control.",
    annotations: { phase: "2.0", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        fast: {
          type: "boolean",
          description: "When true, skip heavyweight provider initialization and return cheap runtime diagnostics.",
        },
        includeInstallCache: {
          type: "boolean",
          description: "When true, include driver, overlay, OCR model, WebView2, and permission readiness.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      module: { type: "string" },
      runtime: ANY_OBJECT,
      runtimeSupervisor: { anyOf: [ANY_OBJECT, { type: "null" }] },
      daemonSession: { anyOf: [ANY_OBJECT, { type: "null" }] },
      runtimeCleanup: { anyOf: [ANY_OBJECT, { type: "null" }] },
      installCache: { anyOf: [ANY_OBJECT, { type: "null" }] },
      diagnostics: ANY_OBJECT,
      repairPlan: ANY_OBJECT,
      activeController: { anyOf: [ANY_OBJECT, { type: "null" }] },
      startsDesktopControl: { const: false },
    }, ["status", "module", "runtime", "daemonSession", "runtimeCleanup", "repairPlan", "activeController", "startsDesktopControl"]),
  },
  {
    name: "computer.repair",
    title: "Computer Use Repair",
    description: "Return an approval-gated repair plan for local Computer Use dependencies.",
    annotations: { phase: "2.1", destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["plan", "start", "status", "cancel"],
          description: "Asset repair lifecycle operation. Defaults to plan.",
        },
        operationId: {
          type: "string",
          description: "Stable caller-provided id for start, status, and cancel operations.",
        },
        requestApproval: {
          type: "boolean",
          description: "Create a time-bounded approval request for the selected repair actions.",
        },
        approvalToken: {
          type: "string",
          description: "Approval token returned by an earlier repair request.",
        },
        approvalTtlMs: {
          type: "number",
          description: "Requested approval lifetime in milliseconds.",
        },
        allowNetwork: {
          type: "boolean",
          description: "Allow approved asset acquisition from manifest-declared network sources.",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum duration for an approved asset operation.",
        },
        dryRun: {
          type: "boolean",
          description: "When true, only return the repair plan and never execute actions.",
        },
        approved: {
          type: "boolean",
          description: "Must be true before any future repair execution path can run.",
        },
        denied: {
          type: "boolean",
          description: "When true with a pending approval token, deny the repair request and clear pending approval.",
        },
        actionIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of repair action ids to include in the plan.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      mode: { type: "string" },
      module: { type: "string" },
      approved: { type: "boolean" },
      denied: { type: "boolean" },
      dryRun: { type: "boolean" },
      approval: ANY_OBJECT,
      repairPlan: ANY_OBJECT,
      progressPlan: ANY_OBJECT,
      executesImmediately: { type: "boolean" },
      execution: ANY_OBJECT,
      startsDesktopControl: { const: false },
    }, ["status", "mode", "module", "approved", "denied", "dryRun", "approval", "repairPlan", "progressPlan", "executesImmediately", "execution", "startsDesktopControl"]),
  },
  {
    name: "computer.installation",
    title: "Computer Use Installation",
    description: "Return local MCP module installation manifest and client configuration templates.",
    annotations: { phase: "1.6", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: "string",
          enum: ["codex", "claude-desktop"],
          description: "Client configuration format to render.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      phase: { type: "string" },
      manifest: ANY_OBJECT,
      clientConfig: ANY_OBJECT,
    }, ["phase", "manifest", "clientConfig"]),
  },
  {
    name: "computer.request_access",
    title: "Request Computer Access",
    description: "Acquire a Gateway-managed controller lease for a known window. Prefer target=\"foreground\" when the user refers to the current/frontmost window; use computer.list_state first when the target is unknown. Never guess a title. The legacy exact titlePart value \"*\" is accepted only as an alias for the foreground window.",
    annotations: { phase: "1.3", destructiveHint: false },
    inputSchema: {
      type: "object",
      oneOf: [
        { required: ["titlePart"] },
        { required: ["windowId"] },
        { required: ["target"] },
        { required: ["applicationToken"] },
      ],
      properties: {
        titlePart: {
          type: "string",
          minLength: 1,
          description: "Case-insensitive literal title or app-name substring. Prefer target=\"foreground\" for the current window; the legacy exact value \"*\" is accepted as a foreground alias.",
        },
        windowId: {
          anyOf: [{ type: "string" }, { type: "number" }],
          description: "Exact window id returned by computer.list_state.",
        },
        target: {
          type: "string",
          enum: ["foreground"],
          description: "Select the current OS foreground window without guessing its title.",
        },
        applicationToken: {
          type: "string",
          minLength: 1,
          description: "Opaque application token returned by computer.observe mode=\"state\". Use it to restore or launch an application that currently has no controllable window, then acquire the resulting window.",
        },
        tier: { type: "string", enum: ["observe", "full", "admin"] },
        agentId: { type: "string" },
        reason: { type: "string" },
        leaseTtlMs: {
          type: "number",
          description: "Controller lease TTL in milliseconds. Expired leases are revoked before capture or action.",
        },
        approvalRequired: {
          type: "boolean",
          description: "When true, create a pending approval instead of starting desktop control.",
        },
        approvalTtlMs: {
          type: "number",
          description: "Pending approval TTL in milliseconds before it fails closed.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      approval: { anyOf: [ANY_OBJECT, { type: "null" }] },
      controller: { anyOf: [ANY_OBJECT, { type: "null" }] },
      overlay: { anyOf: [ANY_OBJECT, { type: "null" }] },
      startsDesktopControl: { type: "boolean" },
    }, ["status", "controller"]),
  },
  {
    name: "computer.approve",
    title: "Approve Computer Use",
    description: "Approve or deny a pending Gateway-managed computer control request.",
    annotations: { phase: "1.12", destructiveHint: true },
    inputSchema: {
      type: "object",
      required: ["approvalToken"],
      properties: {
        approvalToken: { type: "string" },
        approved: {
          type: "boolean",
          description: "When true, grant the pending controller request and start the user-only overlay.",
        },
        denied: {
          type: "boolean",
          description: "When true, deny and clear the pending controller request.",
        },
        reason: { type: "string" },
        leaseTtlMs: {
          type: "number",
          description: "Optional controller lease TTL to apply after approval.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      approval: ANY_OBJECT,
      controller: { anyOf: [ANY_OBJECT, { type: "null" }] },
      overlay: { anyOf: [ANY_OBJECT, { type: "null" }] },
      startsDesktopControl: { type: "boolean" },
    }, ["status", "approval", "controller", "startsDesktopControl"]),
  },
  {
    name: "computer.capture",
    title: "Capture Computer Observation",
    description: "Capture the active Gateway-managed target through the provider router.",
    annotations: { phase: "1.3", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["semantic", "ocr-region", "screenshot"] },
        crop: {
          type: "object",
          required: ["x", "y", "width", "height"],
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          additionalProperties: false,
        },
        timeoutMs: { type: "number" },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      observationId: { type: "string" },
      coordinateSpace: { type: "string", enum: ["window-local"] },
      coordinateBounds: { anyOf: [BOX_SCHEMA, { type: "null" }] },
      coordinateTransform: { type: "string", enum: ["identity"] },
      provider: { type: "string" },
      source: { type: "string" },
      mode: { type: "string" },
      elements: PERCEPTION_ELEMENT_ARRAY,
      artifact: ANY_OBJECT,
      capture: ANY_OBJECT,
      window: ANY_OBJECT,
      text: { type: "string" },
      controllerId: { type: "string" },
      expiresAt: { anyOf: [{ type: "string" }, { type: "null" }] },
    }),
  },
  {
    name: "computer.act",
    title: "Act On Computer",
    description: "Run an approved action against the active Gateway-managed target. Use activate_window to bring the acquired window to the OS foreground without guessing coordinates. Prefer a semantic elementToken. Every pixel click must declare interactionIntent. OCR geometry is accepted only for activate-recognized-text; focus-editable, activate-control, and select-item require screenshot-grounded control geometry. For text entry on a custom-drawn surface, derive the full editable rectangle from a fresh screenshot and send one type_text action to a safe point near its visual center, using the exact latest screenshot observationId and an explicit textMode. Never infer an editable point from the position of a nearby action button or toolbar icon: composers and editors may place their editable body above a bottom toolbar or button row. If a dialog, sheet, or overlay covers the target, resolve or dismiss it and re-observe before typing. Use replace-all when the field must equal the supplied value or may already contain text; use insert only when appending at the current caret is intended. Coordinate-grounded text defaults to incremental native Unicode input so live search, filtering, validation, and autocomplete controls receive each edit event. Use inputBehavior commit only when the control should receive the final value as one paste-style transaction; the Host restores the prior clipboard. OCR bounds and OCR interactionPoint values describe recognized glyphs only; they are never proof of a control's editable interior and are rejected for type_text or coordinate-grounded press_key. Exclude icons, labels, borders, and affordances when grounding an editable point. Window-local image coordinates start at (0,0): never add window.bounds.x/y to them. Do not click first. Pixel-grounded actions default to foreground delivery so native focus and IME events reach the application. Targetless type_text and press_key require the unexpired focusReceiptId returned by an explicitly focus-verified action. Never infer focus from a successful RPC or an OCR label click. A semantic accessibility click may return outcome=delivered when invocation succeeded but no stable state change is immediately visible; never replay that click, continue with the next distinct planned action, and verify at the next observable boundary. If a pixel action or text mutation is indeterminate, possibly_applied, or unverified, call computer.observe before any further action and follow the structured recovery contract from the fresh state. Task completion still requires observing the intended UI state transition.",
    annotations: { phase: "1.3", destructiveHint: true },
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "object",
          required: ["kind"],
          allOf: [{
            if: {
              anyOf: [
                { required: ["x"] },
                { required: ["y"] },
              ],
            },
            then: {
              required: ["observationId", "x", "y", "coordinateSpace"],
            },
          }, {
            if: {
              allOf: [
                {
                  properties: { kind: { const: "click" } },
                  required: ["kind"],
                },
                {
                  anyOf: [
                    { required: ["x"] },
                    { required: ["y"] },
                  ],
                },
              ],
            },
            then: {
              required: ["interactionIntent"],
            },
          }, {
            if: {
              properties: { kind: { const: "type_text" } },
              required: ["kind"],
            },
            then: {
              required: ["textMode", "inputBehavior"],
            },
          }],
          properties: {
            kind: {
              type: "string",
              enum: ["activate_window", "set_value", "type_text", "click", "press_key"],
              description: "Use activate_window to foreground the already-acquired controller window. Choose type_text, not click, when the immediate goal is to enter text. Coordinate-grounded type_text atomically focuses the editable interior and applies the declared textMode in one action.",
            },
            observationId: {
              type: "string",
              description: "Required with x/y so the action is bound to the exact latest observation. Text entry requires a screenshot observation visually grounded to the editable interior; OCR text observations are rejected for keyboard actions.",
            },
            elementToken: { type: "string" },
            elementIndex: { type: "number" },
            focusReceiptId: {
              type: "string",
              description: "Required for targetless type_text or press_key. Use only an unexpired receipt returned by computer.act for this controller.",
            },
            interactionIntent: {
              type: "string",
              enum: ["activate-recognized-text", "focus-editable", "activate-control", "select-item"],
              description: "Required for pixel clicks. State the intended UI effect instead of relying on raw geometry. Use focus-editable only with screenshot-grounded editable-interior geometry. OCR geometry is accepted only for activate-recognized-text and never for focusing an input.",
            },
            coordinateSpace: {
              type: "string",
              enum: ["window-local", "screen"],
              description: "Required with x/y. Copy the fresh observation's coordinateSpace. For text entry, derive the full editable rectangle from the screenshot and choose a safe interior point near its visual center. Do not use the horizontal or vertical position of an adjacent action button as a proxy; an editor body may be above its bottom toolbar or button row. Exclude icons, labels, borders, affordances, and occluding dialogs or sheets. OCR interactionPoint values identify glyph centers and cannot ground keyboard actions. For window-local, never add window.bounds.x/y. Use screen only when coordinates are already absolute desktop coordinates; Host subtracts the observed window origin.",
            },
            x: {
              type: "number",
              description: "X in the explicitly declared coordinateSpace. Bind it to the latest observationId. For text entry, it must be a screenshot-grounded editable-interior point, not an OCR glyph center or a rectangle edge.",
            },
            y: {
              type: "number",
              description: "Y in the explicitly declared coordinateSpace. Bind it to the latest observationId. For text entry, it must be a screenshot-grounded editable-interior point, not an OCR glyph center or a rectangle edge.",
            },
            value: {
              type: "string",
              description: "Text for set_value or type_text. On custom-drawn fields, use type_text with x/y so focus and entry happen atomically; never precede it with a focus click.",
            },
            textMode: {
              type: "string",
              enum: ["insert", "replace-all"],
              description: "Required for type_text. Use replace-all with screenshot-grounded x/y when the editable field must equal value or may already contain content. Use insert only when intentional insertion/appending at the current caret is desired. For semantic replacement, use set_value.",
            },
            inputBehavior: {
              type: "string",
              enum: ["incremental", "commit"],
              description: "Required generic edit-event semantics for every type_text. Use incremental only when the control must react to each edit, such as live search, filtering, validation, or autocomplete. Use commit for message composers, document fields, forms, and other controls where the exact final value matters; it applies the value in one clipboard-backed transaction and restores the prior clipboard. Select from the control's interaction semantics, never from an application name or keyword.",
            },
            key: {
              type: "string",
              description: "Key name for press_key, for example return, tab, escape, or delete.",
            },
            modifiers: {
              type: "array",
              items: { type: "string" },
            },
            deliveryMode: { type: "string", enum: ["background", "foreground"] },
            captureAfter: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      provider: { type: "string" },
      action: { type: "string" },
      result: ANY_OBJECT,
      pixelLimitedAction: { type: "boolean" },
      outcome: { type: "string" },
      effectiveDeliveryMode: { type: "string" },
      execution: ANY_OBJECT,
      focusReceipt: ANY_OBJECT,
      capture: ANY_OBJECT,
    }, ["status", "provider", "action", "result", "pixelLimitedAction", "execution"]),
  },
  {
    name: "computer.cancel",
    title: "Cancel Computer Use",
    description: "Cancel the active Gateway-managed controller lease.",
    annotations: { phase: "1.3", destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      previousController: { anyOf: [ANY_OBJECT, { type: "null" }] },
      previousApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
    }, ["status", "previousController"]),
  },
  {
    name: "computer.revoke",
    title: "Revoke Computer Use",
    description: "Revoke the active Gateway-managed controller lease and clear module state.",
    annotations: { phase: "1.3", destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      previousController: { anyOf: [ANY_OBJECT, { type: "null" }] },
      previousApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
    }, ["status", "previousController"]),
  },
  {
    name: "computer.list_state",
    title: "List Computer Use State",
    description: "Read Computer Use state and discover visible desktop windows. Use foregroundWindow to answer which window is currently frontmost, or use its windowId with computer.request_access. This tool never acquires control.",
    annotations: { phase: "1.3", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      activeController: { anyOf: [ANY_OBJECT, { type: "null" }] },
      pendingAccessApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
      lastCapture: { anyOf: [ANY_OBJECT, { type: "null" }] },
      pendingRepairApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
      foregroundWindow: { anyOf: [ANY_OBJECT, { type: "null" }] },
      windows: ANY_ARRAY,
      windowDiscovery: ANY_OBJECT,
      auditEvents: ANY_ARRAY,
      startsDesktopControl: { const: false },
    }, [
      "status",
      "activeController",
      "pendingAccessApproval",
      "lastCapture",
      "pendingRepairApproval",
      "foregroundWindow",
      "windows",
      "windowDiscovery",
      "auditEvents",
      "startsDesktopControl",
    ]),
  },
  {
    name: "computer.capture_window",
    title: "Capture Window",
    description: "Capture a real OS window to a PNG artifact using a window-level capture path. Use the exact titlePart value \"*\" to capture the current foreground window.",
    annotations: { phase: "1.0", readOnlyHint: true },
    inputSchema: {
      type: "object",
      required: ["titlePart"],
      properties: {
        titlePart: {
          type: "string",
          description: "Case-insensitive literal title substring, or the exact value \"*\" for the current foreground window.",
        },
        outputPath: { type: "string" },
        timeoutMs: { type: "number" },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      provider: { type: "string" },
      source: { type: "string" },
      capture: ANY_OBJECT,
      artifact: ANY_OBJECT,
    }, ["status", "provider", "source", "capture", "artifact"]),
  },
  {
    name: "computer.ocr_region",
    title: "OCR Region",
    description: "Run the local OCR sidecar against an image path and optional crop region.",
    annotations: { phase: "1.1", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        imagePath: { type: "string" },
        titlePart: { type: "string" },
        crop: {
          type: "object",
          required: ["x", "y", "width", "height"],
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          additionalProperties: false,
        },
        languages: {
          type: "array",
          items: { type: "string" },
        },
        timeoutMs: { type: "number" },
        noCache: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      provider: { type: "string" },
      mode: { type: "string" },
      imagePath: { type: "string" },
      capture: { anyOf: [ANY_OBJECT, { type: "null" }] },
      observation: ANY_OBJECT,
    }, ["status", "provider", "mode", "imagePath", "observation"]),
  },
  {
    name: "computer.observe_diff",
    title: "Observe Diff",
    description: "Compare two real-window captures and OCR only the dirty region.",
    annotations: { phase: "1.1", readOnlyHint: true },
    inputSchema: {
      type: "object",
      required: ["baselinePath", "changedPath"],
      properties: {
        baselinePath: { type: "string" },
        changedPath: { type: "string" },
        threshold: { type: "number" },
        padding: { type: "number" },
        languages: {
          type: "array",
          items: { type: "string" },
        },
        timeoutMs: { type: "number" },
      },
      additionalProperties: false,
    },
    outputSchema: outputSchema({
      status: { type: "string" },
      provider: { type: "string" },
      mode: { type: "string" },
      baselinePath: { type: "string" },
      changedPath: { type: "string" },
      dirtyRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
      ocrRegion: ANY_OBJECT,
      observation: { anyOf: [ANY_OBJECT, { type: "null" }] },
    }, ["status", "provider", "mode", "dirtyRegion", "observation"]),
  },
];

const byLegacyName = (name) => {
  const tool = LEGACY_COMPUTER_USE_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing Computer Use schema: ${name}`);
  return tool;
};

const HOST_MANAGEMENT_META = Object.freeze({
  "xiaozhiclaw/visibility": "host",
  "xiaozhiclaw/management": true,
});

const TURN_CONTROL_RESOURCE = "desktop-control";
const acquireLifecycleMeta = Object.freeze({
  "xiaozhiclaw/resourceLifecycle": Object.freeze({
    schemaVersion: 1,
    operation: "acquire",
    resourceType: TURN_CONTROL_RESOURCE,
    scope: "turn",
    cleanupTool: "computer.release",
  }),
});
const releaseLifecycleMeta = Object.freeze({
  "xiaozhiclaw/resourceLifecycle": Object.freeze({
    schemaVersion: 1,
    operation: "release",
    resourceType: TURN_CONTROL_RESOURCE,
    scope: "turn",
  }),
});

export const COMPUTER_USE_HOST_TOOLS = Object.freeze(
  ["computer.health", "computer.doctor", "computer.installation", "computer.repair"].map((name) =>
    Object.freeze({ ...byLegacyName(name), _meta: HOST_MANAGEMENT_META })),
);

const semanticCapabilityMeta = ({
  summary,
  scenarios = [],
  prerequisites = [],
  effects = [],
  modalities = [],
  constraints = [],
}) => Object.freeze({
  "xiaozhiclaw/acceptsRequestContext": Object.freeze({ schemaVersion: 1 }),
  "xiaozhiclaw/semanticCapability": Object.freeze({
    schemaVersion: 1,
    summary,
    scenarios: Object.freeze(scenarios),
    prerequisites: Object.freeze(prerequisites),
    effects: Object.freeze(effects),
    modalities: Object.freeze(modalities),
    constraints: Object.freeze(constraints),
  }),
});

const acquireTool = {
  ...byLegacyName("computer.request_access"),
  name: "computer.acquire",
  title: "Acquire Computer Access",
  description: "Acquire a Gateway-managed controller lease for one explicit or foreground window. Repeating the call from the same Agent reuses an equivalent active lease or safely retargets it when the foreground window changes. If the requested app is minimized to its tray or has no window, call computer.observe mode=\"state\" and acquire its opaque applicationToken to restore or launch it without shell commands.",
  _meta: Object.freeze({
    ...semanticCapabilityMeta({
    summary: "Establish bounded control of a local graphical application window so it can be observed or operated for the user's requested outcome.",
    scenarios: [
      "A task requires seeing or interacting with a native desktop application's visible interface.",
      "The target is the current foreground window or a specifically identified application window.",
    ],
    prerequisites: ["The user and Host policy permit local desktop control."],
    effects: ["Creates a time-bounded controller lease and user-visible control overlay."],
    modalities: ["local desktop GUI", "native application window"],
    constraints: ["Identify the target from observed state; never guess a window title."],
    }),
    ...acquireLifecycleMeta,
  }),
};

const observeTool = {
  name: "computer.observe",
  title: "Observe Computer",
  description: "Read desktop state or capture semantic, screenshot, OCR, and changed-region observations through one bounded interface. Start with semantic; when pixels are needed the Host automatically evaluates screenshot change, runs changed-region or window OCR within a short local budget, and only permits the image-understanding model for an explicit unresolved layout, icon, or complex visual question. Repeating the same visual request on an unchanged screenshot is suppressed. OCR can ground only an explicit activate-recognized-text click; its bounds and interactionPoint describe glyph geometry rather than parent-control geometry. Never use an OCR point to focus an editable field, select a containing row, type text, or ground a coordinate press_key. For a custom-drawn editable surface, capture a fresh screenshot and set visualQuestion to the concrete layout, focus, control, or state question that remains unresolved after structured observation. The Host securely runs the configured image-understanding model inside the same observation transaction and returns pixel-grounded visual evidence; do not call a second media tool for that screenshot. Screenshot, capture-window, and OCR observations return an observationId plus coordinateSpace and zero-based coordinateBounds for bounded x/y actions. Copy coordinateSpace and projected screenshot coordinates unchanged into computer.act; never add window.bounds to window-local coordinates. Artifact paths are connector-private and must not be passed to unrelated file or media tools.",
  _meta: semanticCapabilityMeta({
    summary: "Inspect visible state in local graphical applications using window discovery, semantic elements, screenshots, OCR, or visual differences.",
    scenarios: [
      "Understand what is currently displayed before deciding where or how to interact.",
      "Verify the visible result after an interface action.",
    ],
    prerequisites: ["State discovery is available; detailed window capture requires an active controller lease."],
    effects: ["Reads visible desktop and accessibility state without intentionally changing the target application."],
    modalities: ["local desktop GUI", "visual observation", "OCR", "accessibility state"],
    constraints: ["Treat each observation as time-bounded and observe again after the interface changes."],
  }),
  annotations: { phase: "5.8", readOnlyHint: true },
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["state", "semantic", "screenshot", "capture-window", "ocr-region", "diff"] },
      visualQuestion: {
        type: "string",
        maxLength: 1200,
        description: "Optional natural-language question for screenshot or capture-window. The Host answers it with the configured image-understanding model in the same observation result and projects grounding into this observation's pixel coordinate space.",
      },
      titlePart: { type: "string" },
      outputPath: { type: "string" },
      imagePath: { type: "string" },
      baselinePath: { type: "string" },
      changedPath: { type: "string" },
      crop: BOX_SCHEMA,
      languages: { type: "array", items: { type: "string" } },
      threshold: { type: "number" },
      padding: { type: "number" },
      timeoutMs: { type: "number" },
      noCache: { type: "boolean" },
    },
    additionalProperties: false,
  },
  outputSchema: outputSchema({
    status: { type: "string" },
    mode: { type: "string" },
    requestedMode: {
      type: "string",
      enum: ["screenshot"],
      description: "The caller-requested perception mode when the Host safely satisfies it through a lower-latency equivalent observation.",
    },
    perceptionRouting: {
      type: "object",
      required: ["selectedMode", "avoidedVision"],
      properties: {
        selectedMode: {
          type: "string",
          enum: ["semantic", "window-ocr", "window-ocr-baseline-retry", "changed-region-ocr", "unchanged-frame"],
        },
        avoidedVision: { type: "boolean" },
        sufficient: { type: "boolean" },
        actionableElementCount: { type: "number", minimum: 0 },
        namedActionableRatio: { type: "number", minimum: 0, maximum: 1 },
        changedRegionFirst: { type: "boolean" },
        localCropFirst: { type: "boolean" },
        ocrFirst: { type: "boolean" },
        screenshotDigest: { type: "string" },
        frameStatus: { type: "string", enum: ["new-frame", "changed-region", "unchanged"] },
        dirtyRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
        ocrRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
        localElementCount: { type: "number", minimum: 0 },
        visualUnderstandingEligible: { type: "boolean" },
        baselineOcrRequired: { type: "boolean" },
        baselineOcrRetry: { type: "boolean" },
        baselineOcrAttempts: { type: "number", minimum: 0 },
        reason: { type: "string" },
        ocrError: ANY_OBJECT,
      },
      additionalProperties: false,
    },
    localObservation: ANY_OBJECT,
    activeController: { anyOf: [ANY_OBJECT, { type: "null" }] },
    pendingAccessApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
    pendingRepairApproval: { anyOf: [ANY_OBJECT, { type: "null" }] },
    lastCapture: { anyOf: [ANY_OBJECT, { type: "null" }] },
    foregroundWindow: { anyOf: [ANY_OBJECT, { type: "null" }] },
    windows: ANY_ARRAY,
    windowDiscovery: ANY_OBJECT,
    applications: ANY_ARRAY,
    applicationCount: { type: "number", minimum: 0 },
    applicationDiscovery: ANY_OBJECT,
    auditEvents: ANY_ARRAY,
    observationId: { type: "string" },
    coordinateSpace: {
      type: "string",
      enum: ["window-local"],
      description: "Coordinate space for pixels read from this observation image. Copy this value and image/OCR x/y unchanged into computer.act.",
    },
    coordinateBounds: { anyOf: [BOX_SCHEMA, { type: "null" }] },
    coordinateTransform: {
      type: "string",
      enum: ["identity"],
      description: "Identity means image/OCR x/y must be passed unchanged; do not add window.bounds.",
    },
    coordinateScale: ANY_OBJECT,
    focusedElement: { anyOf: [ANY_OBJECT, { type: "null" }] },
    truncation: ANY_OBJECT,
    interactionContract: ANY_OBJECT,
    provider: { type: "string" },
    source: { type: "string" },
    modelPack: { type: "string" },
    modelFormat: { type: "string" },
    sessionMode: { type: "string" },
    runtime: { type: "string" },
    executionProvider: { type: "string" },
    cacheHit: { type: "boolean" },
    crop: { anyOf: [BOX_SCHEMA, { type: "null" }] },
    timings: ANY_OBJECT,
    elements: PERCEPTION_ELEMENT_ARRAY,
    elementCount: { type: "number" },
    artifact: ANY_OBJECT,
    capture: ANY_OBJECT,
    window: ANY_OBJECT,
    text: { type: "string" },
    observation: { anyOf: [ANY_OBJECT, { type: "null" }] },
    dirtyRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
    ocrRegion: ANY_OBJECT,
    imagePath: { type: "string" },
    baselinePath: { type: "string" },
    changedPath: { type: "string" },
    controllerId: { type: "string" },
    expiresAt: { anyOf: [{ type: "number" }, { type: "null" }] },
    startsDesktopControl: { type: "boolean" },
  }),
};

const releaseTool = {
  ...byLegacyName("computer.cancel"),
  name: "computer.release",
  title: "Release Computer Access",
  description: "Release the active Gateway-managed controller lease and any pending access request.",
  _meta: Object.freeze({
    ...semanticCapabilityMeta({
      summary: "End local desktop control and clear any pending access request after the requested interaction is finished or cannot continue safely.",
      scenarios: ["Clean up after observing or operating a native desktop application."],
      prerequisites: ["A controller lease or pending access request may exist."],
      effects: ["Revokes desktop control and removes the user-visible control overlay."],
      modalities: ["local desktop GUI", "controller lifecycle"],
      constraints: ["Release control when the task finishes or is abandoned."],
    }),
    ...releaseLifecycleMeta,
  }),
};

const actTool = {
  ...byLegacyName("computer.act"),
  _meta: semanticCapabilityMeta({
    summary: "Operate the visible interface of a local graphical application by clicking, entering text, or setting a supported control value.",
    scenarios: [
      "Complete a user-requested workflow in a native desktop application.",
      "Enter content into a visible field and activate the application's own controls.",
    ],
    prerequisites: [
      "An approved controller lease is active.",
      "The target and intended control were identified from a recent observation.",
    ],
    effects: ["Changes application state and may cause the application to submit or send content when its visible controls are activated."],
    modalities: ["local desktop GUI", "pointer interaction", "keyboard text entry"],
    constraints: ["Ground coordinates or element targets in observation evidence and verify consequential results afterward."],
  }),
};

export const COMPUTER_USE_AGENT_TOOLS = Object.freeze([
  Object.freeze(acquireTool),
  Object.freeze(observeTool),
  Object.freeze(actTool),
  Object.freeze(releaseTool),
]);

/** Raw MCP inventory: four Agent tools plus four Host-only management tools. */
export const COMPUTER_USE_MCP_TOOLS = Object.freeze([
  ...COMPUTER_USE_AGENT_TOOLS,
  ...COMPUTER_USE_HOST_TOOLS,
]);
