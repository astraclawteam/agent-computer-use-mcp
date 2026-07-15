export const UI_TEXT_NORMALIZATION_VERSION = "ui-text-v1";

const LANGUAGE_CLASSES = new Set(["chinese", "english", "numeric", "mixed"]);
const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/gu;

export function normalizeRecognizedUiText(text, options = {}) {
  const languageClass = options.languageClass ?? "mixed";
  if (!LANGUAGE_CLASSES.has(languageClass)) throw normalizationError("perception.metric_language_invalid");
  if (typeof text !== "string") throw normalizationError("perception.metric_text_invalid");
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(/\r\n?|\n/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
