export const COMPUTER_USE_EDGES = ["top", "right", "bottom", "left"];

export function shouldShowGatewayComputerUseFrame(controller) {
  return controller?.provider === "gateway-managed";
}
