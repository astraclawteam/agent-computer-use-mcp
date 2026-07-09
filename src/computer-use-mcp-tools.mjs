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
  },
  {
    name: "computer.repair",
    title: "Computer Use Repair",
    description: "Return an approval-gated repair plan for local Computer Use dependencies.",
    annotations: { phase: "2.1", destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "When true, only return the repair plan and never execute actions.",
        },
        approved: {
          type: "boolean",
          description: "Must be true before any future repair execution path can run.",
        },
        actionIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of repair action ids to include in the plan.",
        },
      },
      additionalProperties: false,
    },
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
      },
      additionalProperties: false,
    },
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
            kind: { type: "string", enum: ["set_value", "click"] },
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
  },
];
