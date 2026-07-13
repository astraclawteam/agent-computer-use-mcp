import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createInstalledDocumentAdapter } from "./installed-document.mjs";

const COMPONENTS = new Set(["writer", "calc", "impress", "draw"]);

export function createLibreOfficeAdapter(options) {
  if (!COMPONENTS.has(options.component)) throw new Error("app.libreoffice_component_invalid");
  return createInstalledDocumentAdapter({
    ...options,
    workspacePrefix: `agent-libreoffice-${options.component}-`,
    buildArguments: ({ root, filePath }) => [
      `-env:UserInstallation=${pathToFileURL(join(root, "profile")).href}`,
      "--norestore",
      "--nofirststartwizard",
      "--nodefault",
      `--${options.component}`,
      filePath,
    ],
    windowPredicate: (window) => /fixture\.txt|LibreOffice/iu.test(window.title ?? ""),
  });
}
