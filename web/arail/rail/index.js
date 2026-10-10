/**
 * Railway systems and trains: what the track sections are equipped with (traction power, train
 * control, signals, radio, gauge, line category) and where a system changes; the vehicles and the
 * consists of trains with their figures. `registerRail` adds its object types, the train data of
 * the info cards and the check of the consists to a registry.
 * @module arail/rail
 */
import { SystemChange } from "./objects.js";
import { consistProblems, trainCard } from "./trains.js";

export {
  POWER, PANTOGRAPH, TRAIN_CONTROL, ETCS, SIGNALLING, RADIO, GAUGE, AXLE_LOADS_T, METRE_LOADS_T, ROUTE_CLASS, LOADING_GAUGE, COUNTRIES,
  SYSTEMS, SYSTEM_OVERLAYS, SYSTEM_PARAMS, routeClassLimits, sectionSystems, systemValue, systemRows, systemChanges, worldSystemChanges,
  drawSystemBand, drawSystemChange,
} from "./systems.js";
export { CHANGE_KINDS, SystemChange } from "./objects.js";
export { BRAKE_POSITIONS, VEHICLE_KINDS, VEHICLE_TYPES, Consist, consistRows } from "./vehicles.js";
export { vehicleTypes, consistFor, consistOfHit, consistProblems, trainCard } from "./trains.js";
export { COMPATIBILITY, checkSection, checkTracks, compatibilitySection, drawCompatibilityBand } from "./compat.js";

/** Register the object types, the train data of the info cards and the check of the consists. */
export function registerRail(registry) {
  registry.registerObject(SystemChange);
  registry.registerCard("train-data", trainCard);
  registry.registerCheck("consists", consistProblems);
}
