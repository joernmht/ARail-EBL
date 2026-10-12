/**
 * Container terminal: public names and registration.
 *
 *   import { registerTerminal } from "./terminal/index.js";
 *   registerTerminal(registry);   // the five object types and the "terminal" simulation
 *
 * `arail/index.js` registers it with the built-ins.
 * @module arail/terminal
 */
import { ContainerYard, GantryCrane, TruckLane, Quay, ReachStacker } from "./objects.js";
import { TerminalSimulation } from "./operations.js";

export { TERMINAL_EVENTS, TERMINAL_REQUESTS, PHASE_LABELS } from "./types.js";
export {
  CONTAINER_SIZES, CONTAINER_WIDTH_M, CONTAINER_HEIGHT_M, HIGH_CUBE_HEIGHT_M, BAY_M, ROW_M, CARRIER_TYPES, yardType, bargeType,
  bicCheckDigit, parseBic, bicProblem, makeBic, Container, Carrier, Inventory,
} from "./model.js";
export { yardGrid, ContainerYard, GantryCrane, TruckLane, Quay, ReachStacker } from "./objects.js";
export { trapezoid, PathMover } from "./movers.js";
export { TerminalSimulation, terminalOf } from "./operations.js";
export {
  CONTAINER_COLOURS, TERMINAL_COLOURS, colourFor, boxCorners, drawContainers, drawYardStacks, drawWagon, drawLocomotive, drawTruck,
  drawBarge, drawCrane, drawReachStacker, drawYardGround, drawYardLabels, drawCraneRails, drawTruckLane, drawQuay, drawHighlights,
  drawGhost, pickBoxes,
} from "./draw.js";
export { ROLLING_DEFAULTS, decodeTag, encodeTag, RollingStock } from "./rolling.js";

/**
 * Register the terminal's object types (palette group "Terminal") and its simulation.
 * @param {import("../core/registry.js").Registry} registry
 * @returns {import("../core/registry.js").Registry}
 */
export function registerTerminal(registry) {
  for (const cls of [ContainerYard, GantryCrane, TruckLane, Quay, ReachStacker]) registry.registerObject(cls);
  registry.registerSimulation(TerminalSimulation);
  return registry;
}
