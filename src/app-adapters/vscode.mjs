import { join } from "node:path";

import { createInstalledDocumentAdapter } from "./installed-document.mjs";

export function createVscodeAdapter(options) {
  return createInstalledDocumentAdapter({
    ...options,
    workspacePrefix: "agent-vscode-workspace-",
    buildArguments: ({ root, filePath }) => [
      "--new-window",
      "--disable-extensions",
      `--user-data-dir=${join(root, "user-data")}`,
      `--extensions-dir=${join(root, "extensions")}`,
      filePath,
    ],
    windowPredicate: (window) => /fixture\.txt|Visual Studio Code|VS Code/iu.test(window.title ?? ""),
  });
}
