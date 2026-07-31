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
    description: "Acquire a Gateway-managed controller lease from trusted discovery evidence. When the user refers to an application, call computer.observe mode=\"state\" first and pass its applicationToken even if auxiliary windows are already listed; the Host will restore and select the primary application window. Use target=\"foreground\" only when the user explicitly means the current OS foreground window. Use windowId only for the exact window returned by the immediately preceding state observation. Never infer, guess, or synthesize a window title.",
    annotations: { phase: "1.3", destructiveHint: false },
    inputSchema: {
      type: "object",
      oneOf: [
        { required: ["windowId"] },
        { required: ["target"] },
        { required: ["applicationToken"] },
      ],
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
    description: "Execute exactly one action using the latest single-use surfaceReceipt, then verify the resulting UI state. CRITICAL TEXT RULE: when the next goal is to enter text, call type_text directly; coordinate-grounded type_text atomically focuses the editable surface and writes the value. Never click an editable field first. Pixel click is only for a control whose activation or selection is itself the intended outcome. Prefer a semantic elementToken. Otherwise use a fresh screenshot observationId with window-local screenshot coordinates and full targetBounds; OCR glyph geometry is observation-only and cannot ground clicks, text focus, or key input. For type_text, use replace-all when the field must equal value and insert only for intentional insertion. Use incremental when each edit event must drive live filtering/autocomplete; use commit when only the exact final value matters. The Host restores the clipboard. Exclude icons, labels, borders, adjacent buttons, and occluding overlays from editable bounds. Never add window.bounds offsets to window-local coordinates. Use activate_window to foreground the acquired window. Consume automatic post-action evidence before another observation; invoke visual only for a remaining layout, icon, or complex-scene ambiguity. A successful RPC is not completion evidence: finish only after observing the requested UI transition.",
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
                      enum: ["activate-control", "select-item"],
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
              description: "Use activate_window to foreground the acquired window. CRITICAL: if the immediate goal is text entry, choose type_text directly and never click the editable first. Click is only for a control whose activation or selection is the goal.",
            },
            observationId: {
              type: "string",
              description: "Required with x/y so the action is bound to the exact latest observation. Text entry requires a screenshot observation visually grounded to the editable interior; OCR text observations are rejected for keyboard actions.",
            },
            surfaceReceiptId: {
              type: "string",
              description: "Optional explicit binding to the latest observation's single-use surfaceReceipt.id. If supplied, it must match exactly. Every observation authorizes at most one action even when omitted.",
            },
            elementToken: { type: "string" },
            elementIndex: { type: "number" },
            focusReceiptId: {
              type: "string",
              description: "Required for targetless type_text or press_key. Use only an unexpired receipt returned by computer.act or by the mandatory post-write computer.observe when that observation exactly confirmed the entered value near the same grounded target.",
            },
            interactionIntent: {
              type: "string",
              enum: ["activate-control", "select-item"],
              description: "Required for pixel clicks. State the intended UI effect instead of relying on raw geometry. Both intents require screenshot-derived targetBounds. OCR text geometry is observation-only. To enter text, do not click first; use atomic coordinate-grounded type_text with screenshot-derived targetBounds.",
            },
            targetRole: {
              type: "string",
              enum: ["button", "list-item", "menu-item", "toggle", "editable", "other"],
              description: "Required for pixel clicks. Classify the visible target by interaction semantics, not by its label. Any search box, composer, editor, or text-entry surface is editable even when OCR calls it a button. Pixel click on editable is safely not applied so the same fresh observation can authorize one atomic type_text action.",
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
              description: "Required for coordinate-grounded type_text and for screenshot-grounded activate-control or select-item clicks. It is the full interactive surface rectangle from the same screenshot observation, in coordinateSpace. The Host validates that x/y is safely inside its central region and executes at the rectangle center, avoiding glyph-only bounds, borders, and adjacent icons.",
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
  description: "Read desktop state or capture semantic, screenshot, OCR, changed-region, and explicitly escalated visual observations through one bounded interface. A locked or secure Windows input desktop is a terminal blocker: ask the user to unlock and do not acquire, perceive, or act through it. Start with semantic. Use screenshot for the normal pixel path: the Host evaluates frame change and returns changed-region or window OCR without invoking the image-understanding model. Consume that structured evidence before escalating, and if the visible evidence already proves the requested outcome, finish without an extra confirmation click. Use visual only after a prior semantic or screenshot observation leaves one concrete layout, icon, or complex-scene ambiguity that OCR cannot answer; visual requires visualQuestion and runs the configured image-understanding model inside the same transaction. Repeating the same visual request on an unchanged screenshot is suppressed. Model-facing OCR elements are explicitly observationOnly: their bounds describe recognized glyph geometry rather than a parent control. Never click, focus, select a containing row, type text, or ground a coordinate press_key from an OCR element or its bounds. For a custom-drawn editable surface, first inspect screenshot OCR; escalate once with visual only when the editable rectangle remains ambiguous. Screenshot, visual, capture-window, and OCR observations return an observationId, a single-use surfaceReceipt, coordinateSpace, and zero-based coordinateBounds. Copy projected visual image coordinates unchanged into computer.act; the Host applies the declared screenshot-to-native transform. Every observation authorizes at most one action, so observe immediately after each action. Artifact paths are connector-private and must not be passed to unrelated file or media tools.",
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
      visualQuestion: {
        type: "string",
        maxLength: 1200,
        description: "Required only when mode is visual. Ask the one concrete layout, icon, or complex-scene question that remained unresolved after a prior screenshot/OCR result. It is ignored by the lower-latency screenshot mode.",
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
      enum: ["screenshot", "visual"],
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
    desktopState: ANY_OBJECT,
    blocker: ANY_OBJECT,
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
