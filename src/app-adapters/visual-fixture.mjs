import { spawn } from "node:child_process";

import {
  codedError,
  publishOverlayTargetRect,
  startDriverSession,
  stopDriverSession,
  structured,
  waitForWindow,
} from "./shared.mjs";

export function createVisualFixtureAdapter(options) {
  const mcp = options.mcp;
  const session = options.session ?? `agent-app-visual-${process.pid}`;
  const spawnApp = options.spawnApp ?? ((path, args) => spawn(path, args, { stdio: "ignore", windowsHide: false }));
  let child;
  let sessionStarted = false;
  let verifiedProposal;

  return {
    async discover() { return { executable: options.executable }; },
    async prepare() { return { fixture: { args: options.arguments ?? [] } }; },
    async launch(context, fixture) {
      await startDriverSession(mcp, session);
      sessionStarted = true;
      child = spawnApp(options.executable.path, fixture.args);
      const window = await waitForWindow(mcp, (item) => item.pid === child.pid || item.title?.includes(options.titlePart ?? "Visual Fixture"), { sleep: options.sleep });
      await publishOverlayTargetRect(options.overlayTargetRectFile, window);
      return { app: { window } };
    },
    async observe(context, app) {
      const state = structured(await mcp.callTool("get_window_state", {
        pid: app.window.pid, window_id: app.window.window_id, include_screenshot: false, max_elements: 1200, max_depth: 40, session,
      }));
      const proposal = await options.proposalProvider({ window: app.window, state, includeUserOverlay: false });
      if (!proposal) return { status: "insufficient-perception", reason: "observation.insufficient" };
      if (!Number.isInteger(proposal.elementIndex) || proposal.usedGuessedCoordinates === true) {
        return { status: "insufficient-perception", reason: "observation.insufficient" };
      }
      return { observation: { window: app.window, proposal } };
    },
    async act(context, observation) {
      if (Object.hasOwn(observation.proposal, "x") || Object.hasOwn(observation.proposal, "y")) {
        throw codedError("observation.guessed_coordinates_forbidden");
      }
      await mcp.callTool("click", {
        pid: observation.window.pid, window_id: observation.window.window_id,
        element_index: observation.proposal.elementIndex, delivery_mode: "background", session,
      });
      verifiedProposal = observation.proposal;
      return { action: { kind: "element-action", token: observation.proposal.elementToken ?? null } };
    },
    async verify() {
      const verified = await options.verifyProposal?.(verifiedProposal);
      if (verified !== true) throw codedError("app.final_state_mismatch");
      return { finalState: { kind: "window-state", proposalId: verifiedProposal.id } };
    },
    async cleanup() {
      child?.kill();
      if (sessionStarted) await stopDriverSession(mcp, session);
      else await mcp.close();
    },
  };
}
