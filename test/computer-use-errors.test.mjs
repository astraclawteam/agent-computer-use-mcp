import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeToolErrorText,
  serializeToolError,
} from "../src/computer-use-errors.mjs";

test("PowerShell CLIXML is reduced to its actionable error text", () => {
  const raw = [
    "#< CLIXML",
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">',
    '<S S="Error">window.not_found: Missing App_x000D__x000A_At line:1 char:1_x000D__x000A_+ throw</S>',
    "</Objs>",
  ].join("\r\n");

  assert.equal(
    normalizeToolErrorText(raw),
    "window.not_found: Missing App\nAt line:1 char:1\n+ throw",
  );
  assert.deepEqual(serializeToolError(new Error(raw)), {
    code: "window.not_found",
    message: "window.not_found: Missing App\nAt line:1 char:1\n+ throw",
  });
});

test("nested CLIXML escapes are decoded before the error is exposed", () => {
  assert.equal(
    normalizeToolErrorText(
      '#< CLIXML\r\n<S S="Error">window.not_found: *_x005F_x000D__x005F_x000A_</S>',
    ),
    "window.not_found: *",
  );
});

test("structured error codes and retry detail survive text normalization", () => {
  const error = new Error("#< CLIXML\r\n<S S=\"Error\">No matching window_x000D__x000A_</S>");
  error.code = "window.not_found";
  error.detail = {
    retryable: true,
    nextTool: "computer.list_state",
  };

  assert.deepEqual(serializeToolError(error), {
    code: "window.not_found",
    message: "No matching window",
    detail: {
      retryable: true,
      nextTool: "computer.list_state",
    },
  });
});
