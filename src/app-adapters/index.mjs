import {
  APP_ADAPTER_METHODS,
  assertAppAdapter,
  runAppAdapter,
  sanitizeExecutableIdentity,
} from "./adapter-contract.mjs";
import { createBrowserFixtureAdapter } from "./browser-fixture.mjs";
import { createNativeFixtureAdapter } from "./native-fixture.mjs";
import { createNotepadAdapter } from "./notepad.mjs";
import { createVisualFixtureAdapter } from "./visual-fixture.mjs";
import { createLibreOfficeAdapter } from "./libreoffice.mjs";
import { createVscodeAdapter } from "./vscode.mjs";
import { createWpsOfficeAdapter } from "./wps-office.mjs";

export {
  APP_ADAPTER_METHODS,
  assertAppAdapter,
  runAppAdapter,
  sanitizeExecutableIdentity,
};

export const TIER_A_ADAPTER_FACTORIES = Object.freeze({
  "notepad-file": createNotepadAdapter,
  "native-form": createNativeFixtureAdapter,
  "browser-local": createBrowserFixtureAdapter,
  "visual-fixture": createVisualFixtureAdapter,
});

export const INSTALLED_APP_ADAPTER_FACTORIES = Object.freeze({
  "vscode-workspace": createVscodeAdapter,
  "libreoffice-writer": (options) => createLibreOfficeAdapter({ ...options, component: "writer" }),
  "libreoffice-calc": (options) => createLibreOfficeAdapter({ ...options, component: "calc" }),
  "libreoffice-impress": (options) => createLibreOfficeAdapter({ ...options, component: "impress" }),
  "libreoffice-draw": (options) => createLibreOfficeAdapter({ ...options, component: "draw" }),
  "wps-document": createWpsOfficeAdapter,
});

export function createAppAdapterRegistry(adapters = {}) {
  if (adapters === null || typeof adapters !== "object" || Array.isArray(adapters)) {
    throw registryError("app.adapter_registry_invalid");
  }
  const entries = Object.entries(adapters).map(([name, adapter]) => {
    if (name.trim() === "") throw registryError("app.adapter_name_required");
    return [name, assertAppAdapter(adapter)];
  });
  const registry = new Map(entries);

  return Object.freeze({
    get(name) {
      const adapter = registry.get(name);
      if (!adapter) throw registryError("app.adapter_not_registered", name);
      return adapter;
    },
    has(name) {
      return registry.has(name);
    },
    list() {
      return Object.freeze([...registry.keys()].sort());
    },
  });
}

function registryError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
