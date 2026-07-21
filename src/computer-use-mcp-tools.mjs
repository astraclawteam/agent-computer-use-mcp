export const MCP_RESULT_SCHEMA_VERSION = "5.3";

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

export const COMPUTER_USE_MCP_TOOLS = [
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
      actionPolicy: ANY_OBJECT,
      driver: ANY_OBJECT,
      ocr: ANY_OBJECT,
      prewarm: ANY_OBJECT,
    }, ["status", "module", "version", "phases", "providers", "actionPolicy"]),
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
    description: "Acquire a Gateway-managed controller lease for a target window.",
    annotations: { phase: "1.3", destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["titlePart"],
      properties: {
        titlePart: { type: "string" },
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
    description: "Run an approved action against the active Gateway-managed target.",
    annotations: { phase: "1.3", destructiveHint: true },
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "object",
          required: ["kind"],
          properties: {
            kind: { type: "string", enum: ["set_value", "type_text", "click"] },
            elementToken: { type: "string" },
            elementIndex: { type: "number" },
            value: { type: "string" },
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
      capture: ANY_OBJECT,
    }, ["status", "provider", "action", "result", "pixelLimitedAction"]),
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
    description: "Return active controller, last capture, and recent audit events.",
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
      auditEvents: ANY_ARRAY,
    }, ["status", "activeController", "pendingAccessApproval", "lastCapture", "pendingRepairApproval", "auditEvents"]),
  },
  {
    name: "computer.capture_window",
    title: "Capture Window",
    description: "Capture a real OS window to a PNG artifact using a window-level capture path.",
    annotations: { phase: "1.0", readOnlyHint: true },
    inputSchema: {
      type: "object",
      required: ["titlePart"],
      properties: {
        titlePart: { type: "string" },
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
