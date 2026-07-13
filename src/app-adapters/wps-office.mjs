import { createInstalledDocumentAdapter } from "./installed-document.mjs";

export function createWpsOfficeAdapter(options) {
  return createInstalledDocumentAdapter({
    ...options,
    workspacePrefix: "agent-wps-document-",
    buildArguments: ({ filePath }) => ["/new", filePath],
    windowPredicate: (window) => /fixture\.txt|WPS/iu.test(window.title ?? ""),
  });
}
