export const MCP_RESULT_SCHEMA_VERSION = "5.5";

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
      observationOnly: { type: "boolean" },
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
    description: "Acquire a Gateway-managed controller lease from trusted discovery evidence and return an initial semantic observation when available. When the user refers to an application, call computer.observe mode=\"state\" first and pass its applicationToken even if auxiliary windows are already listed; the Host will restore and select the primary application window. Use target=\"foreground\" only when the user explicitly means the current OS foreground window. Use windowId only for the exact window returned by the immediately preceding state observation. Never infer, guess, or synthesize a window title.",
    annotations: { phase: "1.3", destructiveHint: false },
    inputSchema: {
      type: "object",
      not: {
        anyOf: [
          { required: ["windowId", "target"] },
          { required: ["windowId", "applicationToken"] },
          { required: ["target", "applicationToken"] },
        ],
      },
      properties: {
        windowId: {
          anyOf: [{ type: "string" }, { type: "number" }],
          description: "Exact window id returned by the immediately preceding computer.observe mode=\"state\" when the user explicitly targets that specific window rather than an application.",
        },
        target: {
          type: "string",
          enum: ["foreground"],
          description: "Select the current OS foreground window without guessing its title.",
        },
        applicationToken: {
          type: "string",
          minLength: 1,
          description: "Opaque application token returned by computer.observe mode=\"state\". Prefer this for every application-level request. It restores a minimized or tray application and selects its primary window without substituting an already-open auxiliary surface.",
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
      initialObservation: ANY_OBJECT,
      foregroundWindow: { anyOf: [ANY_OBJECT, { type: "null" }] },
      windows: ANY_ARRAY,
      applications: ANY_ARRAY,
      applicationCount: { type: "number" },
      nextAction: { type: "string" },
      reused: { type: "boolean" },
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
      coordinateTransform: { type: "string", enum: ["identity", "scale-offset"] },
      coordinateScale: ANY_OBJECT,
      surfaceReceipt: ANY_OBJECT,
      surfaceProvenance: ANY_OBJECT,
      focusReceipt: ANY_OBJECT,
      mutationVerification: ANY_OBJECT,
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
    description: "Act once from the latest single-use surfaceReceipt. Prefer semantic elementToken. Pixels require fresh screenshot targetBounds; OCR glyphs never ground actions. For text use one type_text (replace-all exact; insert intentional). Custom editable: screenshot-grounded focus-editable click, then verified focusReceipt. Text is incremental. Consume an embedded fresh post-action capture instead of observing again; use its verified focusReceipt for one commit or navigation key without re-click or retype. Exclude borders, icons, adjacent controls, and occlusions. Copy window-local coordinates unchanged; finish only after the requested transition is observed.",
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
              required: ["interactionIntent", "targetRole"],
            },
          }, {
            if: {
              properties: { kind: { const: "type_text" } },
              required: ["kind"],
            },
            then: {
              required: ["textMode", "inputBehavior"],
            },
          }, {
            if: {
              allOf: [
                {
                  properties: { kind: { const: "type_text" } },
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
              required: ["targetBounds"],
            },
          }, {
            if: {
              allOf: [
                {
                  properties: {
                    kind: { const: "click" },
                    interactionIntent: {
                      enum: ["focus-editable", "activate-control", "select-item"],
                    },
                  },
                  required: ["kind", "interactionIntent"],
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
              required: ["targetBounds"],
            },
          }],
          properties: {
            kind: {
              type: "string",
              enum: ["activate_window", "set_value", "type_text", "click", "press_key"],
              description: "Use activate_window to foreground. For text entry use type_text directly; click only when activation or selection is the goal.",
            },
            observationId: {
              type: "string",
              description: "Required with x/y and must identify the latest screenshot observation. OCR-only observations cannot ground keyboard actions.",
            },
            surfaceReceiptId: {
              type: "string",
              description: "Optional exact binding to the latest single-use surfaceReceipt.id.",
            },
            elementToken: { type: "string" },
            elementIndex: { type: "number" },
            focusReceiptId: {
              type: "string",
              description: "Required for targetless type_text or press_key; use only a current receipt for the same verified target.",
            },
            interactionIntent: {
              type: "string",
              enum: ["focus-editable", "activate-control", "select-item"],
              description: "Pixel-click intent. focus-editable requires screenshot editable bounds and verified focus before targetless typing.",
            },
            targetRole: {
              type: "string",
              enum: ["button", "list-item", "menu-item", "toggle", "editable", "other"],
              description: "Required for pixel clicks. Classify interaction semantics; every text-entry surface is editable regardless of its label.",
            },
            coordinateSpace: {
              type: "string",
              enum: ["window-local", "screen"],
              description: "Required with x/y. Copy the observation's space; never add window offsets to window-local coordinates. Text points must be inside screenshot-derived editable bounds.",
            },
            x: {
              type: "number",
              description: "Optional X. For type_text with targetBounds, omit x/y; Host uses the center.",
            },
            y: {
              type: "number",
              description: "Optional Y. For type_text with targetBounds, omit x/y; Host uses the center.",
            },
            targetBounds: {
              type: "object",
              required: ["x", "y", "width", "height"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number", exclusiveMinimum: 0 },
                height: { type: "number", exclusiveMinimum: 0 },
              },
              additionalProperties: false,
              description: "Full interactive rectangle from the same screenshot, excluding glyph-only bounds, borders, adjacent controls, and occlusions. Alone it grounds type_text at its center.",
            },
            value: {
              type: "string",
              description: "Text for set_value or atomic type_text.",
            },
            textMode: {
              type: "string",
              enum: ["insert", "replace-all"],
              description: "Required for type_text. Use replace-all for an exact value; insert only for intentional insertion.",
            },
            inputBehavior: {
              type: "string",
              enum: ["incremental"],
              description: "Required for type_text. Emits native per-edit events so custom controls react without a paste-only shortcut.",
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
      postActionObservation: ANY_OBJECT,
      consumedSurfaceReceipt: ANY_OBJECT,
      postActionObservationRequired: { type: "boolean" },
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
    description: "Read Computer Use state and discover desktop windows plus opaque application tokens. For an application-level request, pass the matching applicationToken to computer.acquire so the Host restores and selects the primary window even when only auxiliary windows are visible. Use foregroundWindow only to answer which window is currently frontmost. This tool never acquires control.",
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
      desktopState: ANY_OBJECT,
      blocker: ANY_OBJECT,
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
  description: "Acquire a bounded lease and return an initial semantic observation. With no selector, the Host returns fresh discovery; retry with applicationToken or windowId. If initialObservation resolves the decision, act or release without another observe. For application tasks use applicationToken to restore a tray-minimized primary window instead of an auxiliary window. Use target=\"foreground\" only when intended. An equivalent lease is reused.",
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
    description: "Discover desktop state or inspect the leased window using semantic, screenshot/OCR, changed-region, or visual evidence. State lists active, visible, and recoverable applications; include installed applications only to launch a stopped target. A locked input desktop is terminal. Reacquire from fresh state each new turn. Start semantic and stop observing when it already resolves the next decision. Use screenshot/OCR only for missing text or geometry. Use visual once only for a remaining layout, icon, or complex-scene ambiguity; ask all facts in one visualQuestion. Unchanged pixels do not prove failure, and proven state needs no reconfirmation. OCR elements are observationOnly glyph geometry, never action targets. Each observation returns a single-use surfaceReceipt; observe after every action. Copy image coordinates unchanged to computer.act. Artifact paths are private.",
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
      mode: { type: "string", enum: ["state", "semantic", "screenshot", "visual", "capture-window", "ocr-region", "diff"] },
      includeInstalled: {
        type: "boolean",
        description: "State only. Include stopped installed applications when the target is otherwise absent.",
      },
      visualQuestion: {
        type: "string",
        maxLength: 1200,
        description: "Visual only. Ask one unresolved layout/icon/scene question; combine every needed fact and editable targetBounds in this single request.",
      },
      titlePart: { type: "string" },
      outputPath: { type: "string" },
      imagePath: { type: "string" },
      baselinePath: { type: "string" },
      changedPath: { type: "string" },
      crop: {
        ...BOX_SCHEMA,
        description: "Optional fresh window-local crop for a fully local OCR or visual question.",
      },
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
    outcome: { type: "string" },
    requestedMode: {
      type: "string",
      enum: ["screenshot", "visual"],
      description: "The caller-requested perception mode when the Host safely satisfies it through a lower-latency equivalent observation.",
    },
    executionControl: {
      type: "object",
      required: ["status", "scope", "retryable", "allowedNextTools", "reason", "nextAction"],
      properties: {
        status: { type: "string", enum: ["blocked"] },
        scope: { type: "string", enum: ["turn", "interaction-step"] },
        retryable: { type: "boolean", enum: [false] },
        allowedNextTools: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          uniqueItems: true,
        },
        reason: { type: "string" },
        observationCount: { type: "number", minimum: 0 },
        observationLimit: { type: "number", minimum: 1 },
        nextAction: { type: "string" },
      },
      additionalProperties: false,
    },
    perceptionRouting: {
      type: "object",
      required: ["selectedMode", "avoidedVision"],
      properties: {
        selectedMode: {
          type: "string",
          enum: ["semantic", "semantic-fallback-existing-screenshot", "window-ocr", "window-ocr-baseline-retry", "changed-region-ocr", "unchanged-frame"],
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
        visualSceneChanged: { type: "boolean" },
        dirtyRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
        ocrRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
        secondaryOcrRegion: { anyOf: [ANY_OBJECT, { type: "null" }] },
        visualRegion: { anyOf: [BOX_SCHEMA, { type: "null" }] },
        suggestedVisualRegion: { anyOf: [BOX_SCHEMA, { type: "null" }] },
        cropAdjustment: { anyOf: [ANY_OBJECT, { type: "null" }] },
        stableFrameObservations: { type: "number", minimum: 0 },
        localElementCount: { type: "number", minimum: 0 },
        visualUnderstandingEligible: { type: "boolean" },
        baselineOcrRequired: { type: "boolean" },
        baselineOcrRetry: { type: "boolean" },
        baselineOcrAttempts: { type: "number", minimum: 0 },
        reason: { type: "string" },
        unchangedInterpretation: ANY_OBJECT,
        noProgress: ANY_OBJECT,
        ocrError: ANY_OBJECT,
      },
      additionalProperties: false,
    },
    localObservation: ANY_OBJECT,
    semanticProbe: ANY_OBJECT,
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
    desktopState: ANY_OBJECT,
    blocker: ANY_OBJECT,
    auditEvents: ANY_ARRAY,
    observationId: { type: "string" },
    interactionStep: {
      type: "number",
      minimum: 0,
      description: "Monotonic action-step identity for bounding Host vision retries within this controller lease.",
    },
    coordinateSpace: {
      type: "string",
      enum: ["window-local"],
      description: "Coordinate space for pixels read from this observation image. Copy this value and image/OCR x/y unchanged into computer.act.",
    },
    coordinateBounds: { anyOf: [BOX_SCHEMA, { type: "null" }] },
    coordinateTransform: {
      type: "string",
      enum: ["identity", "scale-offset"],
      description: "Copy image/OCR x/y unchanged. The Host applies any scale-offset transform before native input; do not add window.bounds.",
    },
    coordinateScale: ANY_OBJECT,
    surfaceReceipt: ANY_OBJECT,
    surfaceProvenance: ANY_OBJECT,
    focusReceipt: ANY_OBJECT,
    mutationVerification: ANY_OBJECT,
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
