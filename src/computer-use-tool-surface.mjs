import { ComputerUseMcpError } from "./computer-use-errors.mjs";
import {
  COMPUTER_USE_AGENT_TOOLS,
  COMPUTER_USE_MCP_TOOLS,
} from "./computer-use-mcp-tools.mjs";

/**
 * Protocol-layer tool surfaces.
 *
 * Host-only tools used to be marked with the private `xiaozhiclaw/visibility`
 * `_meta` key. No third-party MCP Host understands that key, so a standard Host
 * projected all ten tools into the model's inventory and the workflow-internal
 * lifecycle and management tools were reachable by the Agent. The surface is now
 * expressed through the advertised `tools/list` inventory, which every MCP Host
 * enforces without vendor knowledge, and through a matching `tools/call` gate so
 * an off-surface name cannot be invoked from memory.
 *
 * The surface is selected once per process from launch arguments or environment.
 * Both are owned by whoever spawns the server, never by the model, so the Agent
 * cannot widen its own inventory over the wire.
 */
export const AGENT_TOOL_SURFACE = "agent";
export const HOST_TOOL_SURFACE = "host";
export const DEFAULT_TOOL_SURFACE = AGENT_TOOL_SURFACE;
export const TOOL_SURFACES = Object.freeze([AGENT_TOOL_SURFACE, HOST_TOOL_SURFACE]);

export const TOOL_SURFACE_FLAG = "--tool-surface";
export const TOOL_SURFACE_ENV = "AGENT_COMPUTER_USE_TOOL_SURFACE";
// Repository policy keeps this environment alias as an explicitly supported
// launcher contract; the retired --host-control argument had no such owner.
const COMPATIBILITY_TOOL_SURFACE_ENV = "XIAOZHICLAW_TOOL_SURFACE";

const SURFACE_TOOLS = Object.freeze({
  [AGENT_TOOL_SURFACE]: COMPUTER_USE_AGENT_TOOLS,
  [HOST_TOOL_SURFACE]: COMPUTER_USE_MCP_TOOLS,
});

const SURFACE_TOOL_NAMES = Object.freeze(Object.fromEntries(
  TOOL_SURFACES.map((surface) => [surface, new Set(SURFACE_TOOLS[surface].map((tool) => tool.name))]),
));

/** Names a standard MCP Host projects to the model when it launches the default surface. */
export const COMPUTER_USE_AGENT_TOOL_NAMES = Object.freeze(
  SURFACE_TOOLS[AGENT_TOOL_SURFACE].map((tool) => tool.name),
);

/**
 * Resolve the tool surface for this process.
 *
 * Precedence is launch arguments, then environment, then the fail-closed Agent
 * default. An explicit but unrecognized value fails loudly instead of silently
 * degrading, so a Host typo cannot look like a working host-mode launch.
 */
export function resolveToolSurface(options = {}) {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;

  const fromArgv = readSurfaceFromArgv(argv);
  if (fromArgv) return { surface: normalizeSurface(fromArgv.value, fromArgv.origin), source: fromArgv.origin };

  const fromEnv = readSurfaceFromEnv(env);
  if (fromEnv) return { surface: normalizeSurface(fromEnv.value, fromEnv.origin), source: fromEnv.origin };

  return { surface: DEFAULT_TOOL_SURFACE, source: "default" };
}

/** Tools advertised by `tools/list` on this surface. */
export function listToolsForSurface(surface) {
  return SURFACE_TOOLS[assertKnownSurface(surface)];
}

export function isToolOnSurface(surface, name) {
  return SURFACE_TOOL_NAMES[assertKnownSurface(surface)].has(name);
}

/**
 * Reject any name the surface does not advertise.
 *
 * An off-surface tool must be indistinguishable from a tool that does not exist,
 * otherwise the error itself tells the Agent which hidden names are real.
 */
export function assertToolOnSurface(surface, name) {
  if (isToolOnSurface(surface, name)) return;
  throw new ComputerUseMcpError("tool_not_found", `tool_not_found: ${name}`);
}

/** Launch arguments a Host appends to obtain the full host surface. */
export function hostToolSurfaceArgs() {
  return [`${TOOL_SURFACE_FLAG}=${HOST_TOOL_SURFACE}`];
}

/** Environment a Host may set instead when it cannot control launch arguments. */
export function hostToolSurfaceEnv() {
  return { [TOOL_SURFACE_ENV]: HOST_TOOL_SURFACE };
}

function readSurfaceFromArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") continue;
    if (arg.startsWith(`${TOOL_SURFACE_FLAG}=`)) {
      return { value: arg.slice(TOOL_SURFACE_FLAG.length + 1), origin: "argv" };
    }
    if (arg === TOOL_SURFACE_FLAG) {
      return { value: args[index + 1] ?? "", origin: "argv" };
    }
  }
  return null;
}

function readSurfaceFromEnv(env) {
  const source = env ?? {};
  const value = source[TOOL_SURFACE_ENV] ?? source[COMPATIBILITY_TOOL_SURFACE_ENV];
  if (typeof value !== "string" || value.trim() === "") return null;
  return { value, origin: "environment" };
}

function normalizeSurface(value, origin) {
  const surface = String(value).trim().toLowerCase();
  if (!TOOL_SURFACES.includes(surface)) {
    throw new ComputerUseMcpError(
      "tool_surface.invalid",
      `tool_surface.invalid: ${origin} requested an unknown Computer Use tool surface`,
      { requested: String(value), supported: [...TOOL_SURFACES], source: origin },
    );
  }
  return surface;
}

function assertKnownSurface(surface) {
  if (TOOL_SURFACES.includes(surface)) return surface;
  throw new ComputerUseMcpError(
    "tool_surface.invalid",
    `tool_surface.invalid: unknown Computer Use tool surface`,
    { requested: String(surface), supported: [...TOOL_SURFACES] },
  );
}
