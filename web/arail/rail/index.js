/**
 * Railway systems: what the track sections are equipped with (traction power, train control,
 * signals, radio, gauge, line category) and where a system changes. `registerRail` adds its object
 * types to a registry.
 * @module arail/rail
 */
import { SystemChange } from "./objects.js";

export {
  POWER, PANTOGRAPH, TRAIN_CONTROL, ETCS, SIGNALLING, RADIO, GAUGE, AXLE_LOADS_T, METRE_LOADS_T, ROUTE_CLASS, LOADING_GAUGE, COUNTRIES,
  SYSTEMS, SYSTEM_OVERLAYS, SYSTEM_PARAMS, routeClassLimits, sectionSystems, systemValue, systemRows, systemChanges, worldSystemChanges,
  drawSystemBand, drawSystemChange,
} from "./systems.js";
export { CHANGE_KINDS, SystemChange } from "./objects.js";

/** Register the object types of the railway systems. */
export function registerRail(registry) {
  registry.registerObject(SystemChange);
}
