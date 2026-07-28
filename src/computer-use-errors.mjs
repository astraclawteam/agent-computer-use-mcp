export class ComputerUseMcpError extends Error {
  constructor(code, message, detail = undefined) {
    super(message ?? code);
    this.name = "ComputerUseMcpError";
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail = undefined) {
  throw new ComputerUseMcpError(code, message, detail);
}

export function serializeToolError(error) {
  if (error instanceof ComputerUseMcpError) {
    return compactError({
      code: error.code,
      message: normalizeToolErrorText(error.message),
      detail: error.detail,
    });
  }

  const message = normalizeToolErrorText(error instanceof Error ? error.message : String(error));
  const explicitCode = typeof error?.code === "string" && error.code.trim()
    ? error.code.trim()
    : null;
  const inferredCode = message.includes(":") ? message.split(":")[0].trim() : null;
  return compactError({
    code: explicitCode ?? inferredCode ?? "tool.failed",
    message: message || "The Computer Use tool failed.",
    detail: error?.detail,
  });
}

export function normalizeToolErrorText(value) {
  let text = String(value ?? "");
  const clixmlErrors = [...text.matchAll(/<S\b[^>]*\bS=(?:"Error"|'Error')[^>]*>([\s\S]*?)<\/S>/giu)]
    .map((match) => decodePowerShellXmlText(match[1]).trim())
    .filter(Boolean);
  if (clixmlErrors.length > 0) {
    text = clixmlErrors.join("\n");
  } else {
    text = decodePowerShellXmlText(text)
      .replace(/^\s*#<\s*CLIXML\s*/iu, "")
      .replace(/<\?xml[\s\S]*?\?>/giu, "")
      .replace(/<\/?Objs\b[^>]*>/giu, "")
      .replace(/<\/?S\b[^>]*>/giu, "");
  }
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function decodePowerShellXmlText(value) {
  let decoded = String(value);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded.replace(/_x([0-9a-f]{4})_/giu, (_match, codePoint) => (
      String.fromCharCode(Number.parseInt(codePoint, 16))
    ));
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded
    .replace(/&#x([0-9a-f]+);/giu, (_match, codePoint) => (
      String.fromCodePoint(Number.parseInt(codePoint, 16))
    ))
    .replace(/&#([0-9]+);/gu, (_match, codePoint) => (
      String.fromCodePoint(Number.parseInt(codePoint, 10))
    ))
    .replace(/&quot;/giu, "\"")
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function compactError({ code, message, detail }) {
  return {
    code,
    message,
    ...(detail === undefined ? {} : { detail }),
  };
}
