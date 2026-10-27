/**
 * Railway systems and trains: what the track sections are equipped with (traction power, train
 * control, signals, radio, gauge, line category) and where a system changes; the vehicles and the
 * consists of trains with their figures; the trains at the platforms drawn solid from their
 * vehicles; the running dynamics of trains (forces, runs, braking, adhesion, couplings, energy), the
 * train protection on the track ahead and what both show on the info card and the table.
 * `registerRail` adds its object types, the trains at the platforms, the train data and running
 * dynamics of the info cards and the check of the consists to a registry.
 * @module arail/rail
 */
import { SystemChange } from "./objects.js";
import { RAIL_TRAIN } from "./stock.js";
import { consistProblems, trainCard } from "./trains.js";
import { runningCard } from "./running.js";
import { LOW_ADHESION } from "./disruptions.js";

export {
  POWER, PANTOGRAPH, TRAIN_CONTROL, ETCS, SIGNALLING, RADIO, GAUGE, AXLE_LOADS_T, METRE_LOADS_T, ROUTE_CLASS, LOADING_GAUGE, COUNTRIES,
  SYSTEMS, SYSTEM_OVERLAYS, SYSTEM_PARAMS, routeClassLimits, sectionSystems, systemValue, systemRows, systemChanges, worldSystemChanges,
  drawSystemBand, drawSystemChange,
} from "./systems.js";
export { CHANGE_KINDS, SystemChange } from "./objects.js";
export { BRAKE_POSITIONS, VEHICLE_KINDS, VEHICLE_TYPES, Consist, consistRows } from "./vehicles.js";
export { DEFAULT_FLEET, PEAK_DEMAND, fleetEntry, vehicleTypes, lineConsist, consistFor, consistOfHit, consistProblems, trainCard, trainConsist } from "./trains.js";
export { LIVERIES, carsLength, drawTrain, turnCars } from "./draw.js";
export { LOOKS, RAIL_TRAIN, STOP_MARGIN_M, carsOf, dockLine, trainDoors, trainOutline, trainPose } from "./stock.js";
export { COMPATIBILITY, checkSection, checkTracks, compatibilitySection, drawCompatibilityBand } from "./compat.js";
export {
  G, MASS_FACTORS, STRAHL, RAIL_CONDITIONS, SANDING, SERVICE_BRAKE, MINDEN, BRAKE_FILL_S, BRAKE_SIGNAL_MPS, COUPLER_KN, START_RESISTANCE, ENERGY, SUPPLEMENT,
  trainModel, adhesion, tractiveEffort, slips, runningResistance, curveResistance, lineResistance, regenForce, brakingDistance, brakingSpeed,
  requiredBrakePercentage, fullBraking, serviceDeceleration, sectionAt, runProfile, receptivity, coastingRun, couplerForces, startingForces, runInForce, loadLimit,
  approachFactor, lineRunningTime, drivingStyles, runEnergyPerKm,
} from "./dynamics.js";
export { LOW_ADHESION, SLOW } from "./disruptions.js";
export { PZB, PZB_RULES, ETCS_CURVES, REACTION_S, pzbType, pzb1000, pzb500, supervision, pzbApproach, etcsCurves } from "./protection.js";
export {
  LINE_PARAMS, NEXT_STOP_M, OPEN_LINE_KMH, trackLength, lineBrakingDistance, railCondition, pathAhead, pathPoint, lineAlong, signalsAhead, magnetsAhead,
  trainOnTrack, trackAheadOf, speedAt, drawTrackAhead, formatDistance,
} from "./ahead.js";
export { REFERENCE_GRADIENT, minutesSeconds, runningCard } from "./running.js";

/**
 * Register the object types, the trains at the platforms (in place of core's), the train data and
 * the running dynamics of the info cards, slippery rails as a disruption and the check of the consists.
 */
export function registerRail(registry) {
  registry.registerObject(SystemChange);
  registry.registerVehicle(RAIL_TRAIN);
  registry.registerCard("train-data", trainCard);
  registry.registerCard("train-running", runningCard);
  registry.registerDisruption(LOW_ADHESION);
  registry.registerCheck("consists", consistProblems);
}
