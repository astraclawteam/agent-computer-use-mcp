import { createBridgeBackedDriver } from "./bridge-backed-driver.mjs";

const XIAOZHI_LANES = new Set(["xiaozhi-deepseek-v4-flash", "xiaozhi-claude-sonnet-5"]);

export function createXiaozhiWebDriver(options = {}) {
  if (Object.hasOwn(options, "cdpEndpoint")) throw driverError("agent_e2e.raw_cdp_forbidden");
  if (!XIAOZHI_LANES.has(options.lane)) throw driverError("agent_e2e.xiaozhi_lane_invalid");
  const url = validateUrl(options.url);
  const pageProbe = options.pageProbe ?? (() => defaultPageProbe(url));
  return createBridgeBackedDriver({
    sessionBridge: options.sessionBridge,
    discover: async ({ bridgeStatus }) => {
      const page = await pageProbe();
      if (!page?.reachable) {
        return Object.freeze({ available: false, reachable: false, hostId: "xiaozhi-web", lane: options.lane, blocker: "agent_e2e.xiaozhi_unreachable" });
      }
      if (!bridgeStatus.ready) {
        return Object.freeze({
          available: false,
          reachable: true,
          hostId: "xiaozhi-web",
          lane: options.lane,
          buildId: page.buildId ?? null,
          urlOrigin: url.origin,
          blocker: bridgeStatus.blocker,
        });
      }
      return Object.freeze({
        available: true,
        hostId: "xiaozhi-web",
        hostKind: "host-owned-web-session",
        lane: options.lane,
        buildId: page.buildId ?? null,
        urlOrigin: url.origin,
        sessionBridge: bridgeStatus.protocol,
      });
    },
  });
}

async function defaultPageProbe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return Object.freeze({ reachable: response.ok, buildId: response.headers.get("x-xiaozhiclaw-build") });
  } catch {
    return Object.freeze({ reachable: false, buildId: null });
  }
}

function validateUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw driverError("agent_e2e.xiaozhi_url_invalid"); }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw driverError("agent_e2e.xiaozhi_url_insecure");
  }
  return url;
}

function driverError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
