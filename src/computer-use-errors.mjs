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
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes(":") ? message.split(":")[0] : "tool.failed";
  return {
    code,
    message,
  };
}
