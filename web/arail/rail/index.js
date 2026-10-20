/**
 * Railway systems and trains: what the track sections are equipped with (traction power, train
 * control, signals, radio, gauge, line category) and where a system changes; the vehicles and the
 * consists of trains with their figures; the trains at the platforms drawn solid from their
 * vehicles. `registerRail` adds its object types, the trains at the platforms, the train data of
 * the info cards and the check of the consists to a registry.
 * @module arail/rail
 */
import { SystemChange } from "./objects.js";
import { RAIL_TRAIN } from "./stock.js";
import { consistProblems, trainCard } from "./trains.js";

export {
  POWER, PANTOGRAPH, TRAIN_CONTROL, ETCS, SIGNALLING, RADIO, GAUGE, AXLE_LOADS_T, METRE_LOADS_T, ROUTE_CLASS, LOADING_GAUGE, COUNTRIES,
  SYSTEMS, SYSTEM_OVERLAYS, SYSTEM_PARAMS, routeClassLimits, sectionSystems, systemValue, systemRows, systemChanges, worldSystemChanges,
  drawSystemBand, drawSystemChange,
} from "./systems.js";
export { CHANGE_KINDS, SystemChange } from "./objects.js";
export { BRAKE_POSITIONS, VEHICLE_KINDS, VEHICLE_TYPES, Consist, consistRows } from "./vehicles.js";
export { DEFAULT_FLEET, PEAK_DEMAND, fleetEntry, vehicleTypes, consistFor, consistOfHit, consistProblems, trainCard, trainConsist } from "./trains.js";
export { LIVERIES, carsLength, drawTrain, turnCars } from "./draw.js";
export { LOOKS, RAIL_TRAIN, STOP_MARGIN_M, carsOf, dockLine, trainDoors, trainOutline, trainPose } from "./stock.js";
export { COMPATIBILITY, checkSection, checkTracks, compatibilitySection, drawCompatibilityBand } from "./compat.js";

/** Register the object types, the trains at the platforms (in place of core's), the train data of the info cards and the check of the consists. */
export function registerRail(registry) {
  registry.registerObject(SystemChange);
  registry.registerVehicle(RAIL_TRAIN);
  registry.registerCard("train-data", trainCard);
  registry.registerCheck("consists", consistProblems);
}
