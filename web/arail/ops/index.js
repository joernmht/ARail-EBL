/**
 * Rail operations: rolling stock with maintenance (the entity in charge of maintenance, ECM, and its
 * four functions), crews with contracts and duties, and the penalties between the parties.
 *
 *   import { registerOperations } from "./ops/index.js";
 *   registerOperations(registry);   // the depot object, the "operations" simulation, its disruptions
 *
 * `arail/index.js` registers it with the built-ins. The engine also runs without a world (Node.js,
 * comparisons): `new OpsEngine(config, {layout})`, `runExperiment(...)`.
 * @module arail/ops
 */
export {
  OPS_DEFAULTS, DEFAULT_PROGRAM, DEFAULT_SOFT, DEFAULT_VEHICLE, DEFAULT_PARTIES, DEFAULT_CONTRACTS, PRESET_SETUPS, PRESET_STRESS,
  autoNetwork, normalizeOps, validateOps, applySetup, setupsOf, stressOf, normalizeProgram, platformDocks,
} from "./config.js";
export { tripTemplates, planRotations, planPieces, dayKind, lineProfile, emptyRunMin, emptyRunKm, deadheadMin } from "./timetable.js";
export { Unit, UNIT_STATES, expectedFailures, wearInterval } from "./fleet.js";
export { buildDuties, reserveDuties, makeStaff, contractMix, shiftOf, SHIFT_LABELS, WORK_RULES, commuteOf, shortName, pieceBounds } from "./crew.js";
export { CrewDesk } from "./crewdesk.js";
export { Ledger, CAUSE_FUNCTION, CAUSE_LABELS, FUNCTION_LABELS } from "./contracts.js";
export { OpsEngine, causeWord, jobWord } from "./engine.js";
export { KPIS, kpis, runOne, runExperiment, summarize, toCSV, weekOvertime, causeKeyLabel } from "./experiment.js";
export {
  normalizeHours, isOpen, nextOpen, addWork, workBetween, hoursLabel, weekdaySet, weekdayIndex, clockMinutes, dayTime, durationLabel,
  WEEKDAYS, WEEKDAY_LABELS,
} from "./util.js";
export { Depot } from "./depot.js";
export { OperationsSimulation, opsOf, CREW_COLOURS } from "./simulation.js";
export { OPS_DISRUPTIONS } from "./disruptions.js";

import { Depot } from "./depot.js";
import { OperationsSimulation } from "./simulation.js";
import { OPS_DISRUPTIONS } from "./disruptions.js";

/**
 * Register the depot object (palette group Transport), the "operations" simulation and its
 * disruption types.
 * @param {import("../core/registry.js").Registry} registry
 * @returns {import("../core/registry.js").Registry}
 */
export function registerOperations(registry) {
  registry.registerObject(Depot);
  registry.registerSimulation(OperationsSimulation);
  for (const def of OPS_DISRUPTIONS) registry.registerDisruption(def);
  return registry;
}
