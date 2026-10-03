/**
 * Infrastructure asset management and maintenance: railway assets (track, switches, signals,
 * balises, interlockings, level crossings, cables, GSM-R, overhead lines, substations, platforms,
 * lifts, displays) with their condition, failures and what is known of them; the maintenance staff
 * in shifts with emergency vans and drones; renewals and upgrades through the HOAI phases with
 * funding, approval, procurement and a level crossing plant; roles for students.
 *
 *   import { registerInfrastructure } from "./infra/index.js";
 *   registerInfrastructure(registry);   // the objects, the "infrastructure" simulation, its disruptions
 *
 * `arail/index.js` registers it with the built-ins. The engine also runs without a world (Node.js):
 * `new InfraEngine(config, {seed})`.
 * @module arail/infra
 */
export {
  GRADES, gradeValue, gradeOf, healthOf, gradeLabel, gradeColour, DISCIPLINES, DISCIPLINE_IDS, GENERATIONS, GENERATION_IDS, REPORTS,
  ASSET_TYPES, TYPE_IDS, hazardFactor, repairCap, METHODS, MEASURES,
} from "./catalog.js";
export { ROLES, ROLE_IDS, DEFAULT_NETWORK, DEFAULT_PLACEMENT, INFRA_DEFAULTS, PRESET_SCENARIOS, normalizeInfra, applyScenario, scenariosOf, validateInfra } from "./config.js";
export { Network, utmToLonLat, utmZone, kmLabel } from "./network.js";
export { Asset, generateAssets, healthAtAge, healthAfter, wearRate, ifcGuid } from "./assets.js";
export { StaffMember, makePeople, shiftOf, onCallPerson, weekdayOf, roleLabel, SHIFTS } from "./staff.js";
export { Plant, STAGE_LABELS as PLANT_STAGES } from "./factory.js";
export { ProjectDesk, STAGES as PROJECT_STAGES, PROCEDURES, QUALITY, SUPERVISION, annuityFactor, eur } from "./projects.js";
export { InfraEngine, INFRA_ACTIONS, TASK_WORDS, YEAR, durationText } from "./engine.js";
export { toGeoJSON, assetRecord } from "./export.js";
export {
  AssetObject, LinearAssetObject, Signal, Switch, Balise, LevelCrossing, GsmrMast, Lift, PassengerDisplay, Catenary, CableRoute, Interlocking,
  MaintenanceBase, CrossingPlant, ASSET_OBJECTS, INFRA_OBJECTS, drawAssetState, drawLinearState,
} from "./objects.js";
export { InfrastructureSimulation, infraOf, STAFF_COLOURS, drawVan, drawDrone } from "./simulation.js";
export { INFRA_DISRUPTIONS } from "./disruptions.js";

import { INFRA_OBJECTS } from "./objects.js";
import { InfrastructureSimulation } from "./simulation.js";
import { INFRA_DISRUPTIONS } from "./disruptions.js";

/**
 * Register the infrastructure objects (palette group Infrastructure), the "infrastructure"
 * simulation and its disruption types.
 * @param {import("../core/registry.js").Registry} registry
 */
export function registerInfrastructure(registry) {
  for (const cls of INFRA_OBJECTS) registry.registerObject(cls);
  registry.registerSimulation(InfrastructureSimulation);
  for (const def of INFRA_DISRUPTIONS) registry.registerDisruption(def);
  return registry;
}
