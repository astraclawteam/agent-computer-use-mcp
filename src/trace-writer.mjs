import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildDiagnosticsPolicy, redactDiagnosticValue } from "./diagnostics-policy.mjs";

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "screenshot",
  "screenshotBase64",
  "image",
  "imageBase64",
  "overlay",
  "overlayPixels",
  "overlayImage",
]);

export function createTraceWriter(options = {}) {
  const policy = options.policy ?? buildDiagnosticsPolicy(options);
  const traceRoot = options.traceRoot ?? policy.roots.traceRoot;
  const clock = options.clock ?? {
    iso: () => new Date().toISOString(),
  };

  return {
    async writeEvent(type, payload = {}) {
      assertTracePayloadAllowed(payload);
      const ts = clock.iso();
      const path = join(traceRoot, `trace-${ts.slice(0, 10)}.jsonl`);
      const event = {
        ts,
        type,
        payload: redactDiagnosticValue(payload),
        includeUserOverlay: false,
      };
      await mkdir(traceRoot, { recursive: true });
      await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
      return {
        status: "written",
        path,
        includeUserOverlay: false,
      };
    },
  };
}

export function assertTracePayloadAllowed(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTracePayloadAllowed(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key) || (key === "includeUserOverlay" && child === true)) {
      throw new Error(`payload_forbidden: ${[...path, key].join(".")}`);
    }
    assertTracePayloadAllowed(child, [...path, key]);
  }
}
