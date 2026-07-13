import {
  APP_ADAPTER_METHODS,
  assertAppAdapter,
  runAppAdapter,
  sanitizeExecutableIdentity,
} from "./adapter-contract.mjs";

export {
  APP_ADAPTER_METHODS,
  assertAppAdapter,
  runAppAdapter,
  sanitizeExecutableIdentity,
};

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
