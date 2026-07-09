import { getInstallLayout } from "./package-foundation.mjs";

const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|password|secret|token)/i;
const WINDOWS_USER_PATH_PATTERN = /C:\\Users\\[^\\]+/g;

export function buildDiagnosticsPolicy(options = {}) {
  const layout = getInstallLayout({
    platform: options.platform,
    env: options.env,
  });

  return {
    status: "ready",
    roots: {
      artifactRoot: layout.artifactRoot,
      logRoot: layout.logRoot,
      traceRoot: layout.traceRoot,
    },
    streams: {
      trace: {
        format: "jsonl",
        root: layout.traceRoot,
        redaction: "required",
      },
      log: {
        format: "jsonl",
        root: layout.logRoot,
        redaction: "required",
      },
      artifact: {
        root: layout.artifactRoot,
        includeUserOverlay: false,
        redaction: "metadata-required",
      },
    },
    retention: {
      traceDays: 14,
      logDays: 30,
      artifactDays: 7,
    },
    redactionPolicy: {
      secretKeys: ["authorization", "apiKey", "password", "secret", "token"],
      localUserPaths: true,
      replacement: "[REDACTED]",
    },
    includeUserOverlay: false,
  };
}

export function redactDiagnosticValue(value) {
  return redactValue(value, null);
}

function redactValue(value, key) {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, null));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === "string") {
    return value.replace(WINDOWS_USER_PATH_PATTERN, "C:\\Users\\[USER]");
  }
  return value;
}
