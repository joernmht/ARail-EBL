/**
 * Journeys: travellers made one by one, each with a start, an aim and a chosen travel plan with
 * transfers, for exercises in a railway operations lab (instead of a town full of generated people).
 *
 *   import { registerJourneys } from "./journeys/index.js";
 *   registerJourneys(registry);   // the "journeys" simulation
 *
 * `arail/index.js` registers it with the built-ins. The planner also works without the app:
 * `journeysOf(world).plan({from, to, leave: "07:40"})`.
 * @module arail/journeys
 */
export { TimetableRail, OperationsRail, worldNow, stopIndex, reaches, depAt, arrAt, sameLine } from "./rail.js";
export { Planner, WALK_MPS, walkPath, placePoint, areaName } from "./planner.js";
export { JourneysSimulation, Traveller, TRAVELLER_COLOURS, TRAVELLER_STATES, placeName, validateJourneys } from "./simulation.js";

import { JourneysSimulation } from "./simulation.js";

/** The layout's journeys simulation, or null. */
export function journeysOf(world) {
  return world?.simulations?.find((s) => s.constructor.type === JourneysSimulation.type) ?? null;
}

/**
 * Register the "journeys" simulation.
 * @param {import("../core/registry.js").Registry} registry
 */
export function registerJourneys(registry) {
  registry.registerSimulation(JourneysSimulation);
  return registry;
}
