/**
 * The built-in simulations of people and road traffic (passengers, the town, cars, bikes) and what
 * the framework exports of them; `web/arail/index.js` re-exports all of it.
 * @module arail/sims
 */
import { PassengerSimulation } from "./passengers.js";
import { TownSimulation } from "./town.js";
import { TrafficSimulation } from "./traffic.js";
import { CyclingSimulation } from "./cycling.js";
import { MarketSimulation } from "./market.js";

export { PassengerSimulation, TownSimulation, TrafficSimulation, CyclingSimulation, MarketSimulation };
export { MARKET_PROFILE, MARKET_COLOUR } from "./market.js";
export {
  BOARD_MIN_PX, boardStatus, boardingAccess, crowdForces, dockStatus, drawPerson, HOLD_S, NEUTRAL_PERSON, personLooks, personRadius, profileRows, STAFF_HOURS,
  STOP_CAPACITY_PER_M2, STOP_LOAD_EASY, statusLines, stopLoad, vehicleSpaces,
} from "./passengers.js";
export { PURPOSE_COLOURS, PURPOSE_LABELS, TRIP_PARTS } from "./town.js";
export { CAR_COLOURS, planDrive, OCCUPANCY_BY_PURPOSE } from "./traffic.js";
export { ABREAST, RIDERS, ridingSurface } from "./cycling.js";

/** The built-in simulations, one per line. */
export const SIMULATION_TYPES = [
  PassengerSimulation,
  TownSimulation,
  TrafficSimulation,
  CyclingSimulation,
  MarketSimulation,
];

/** Register the built-in simulations. */
export function registerSimulations(registry) {
  for (const cls of SIMULATION_TYPES) registry.registerSimulation(cls);
  return registry;
}
