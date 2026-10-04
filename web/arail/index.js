/**
 * ARail: augmented-reality framework for model railway laboratories.
 *
 * Public API. Typical use (see web/app/app.js for the complete app):
 *
 *   import * as ARail from "../arail/index.js";
 *   const world = ARail.createWorld(layoutJson);
 *   const detector = new ARail.MarkerDetector({ dictionary: "ARUCO" });
 *   const camera = new ARail.Camera(width, height);
 *   const tracker = new ARail.PlaneTracker(world.map);
 *   // per frame:
 *   const state = tracker.update(detector.detect(imageData), timeSeconds, camera);
 *   world.step(dtSeconds);
 *   if (state.H) world.draw(new ARail.View({ ctx, camera, H: state.H, scale: world.scale }));
 *
 * Extend it with plugins: see docs/extending.md.
 * @module arail
 */
import { Registry } from "./core/registry.js";
import { World } from "./core/world.js";
import { BUILTIN_DISRUPTIONS } from "./core/disruptions.js";
import { BUS, TRAIN } from "./core/vehicles.js";
import { Platform } from "./objects/platform.js";
import { BusTerminal } from "./objects/bus-terminal.js";
import { Building } from "./objects/building.js";
import { AltbauBlock, Factory, House, HouseEstate, Office, Plattenbau, School, Supermarket } from "./objects/houses.js";
import { StationBuilding } from "./objects/station.js";
import { Underpass } from "./objects/underpass.js";
import { Forest, Tree } from "./objects/trees.js";
import { Area } from "./objects/landscape.js";
import { Road } from "./objects/road.js";
import { BusStop } from "./objects/bus-stop.js";
import { BusLine } from "./objects/bus-line.js";
import { Track } from "./objects/track.js";
import { Label } from "./objects/label.js";
import { Tabletop } from "./objects/tabletop.js";
import { PassengerSimulation } from "./sims/passengers.js";
import { TownSimulation } from "./sims/town.js";
import { TrafficSimulation } from "./sims/traffic.js";
import { registerTerminal } from "./terminal/index.js";
import { registerOperations } from "./ops/index.js";
import { registerInfrastructure } from "./infra/index.js";

export const VERSION = "0.1.0";

export * from "./core/math.js";
export * from "./core/geometry.js";
export { Camera, parseCalibration, CALIBRATION_FORMAT } from "./core/camera.js";
export { MarkerDetector, DICTIONARIES, markerBits, refineCorners } from "./core/detector.js";
export { MarkerMap, PlaneTracker } from "./core/tracker.js";
export { EventBus } from "./core/events.js";
export { Registry } from "./core/registry.js";
export { World } from "./core/world.js";
export { View, LAYER, prismFaces, rectFootprint } from "./core/view.js";
export { FlyCamera, FLYCAM_DEFAULTS, PITCH_MIN, PITCH_MAX, gridLines, snapToGrid } from "./core/flycam.js";
export { LayoutObject, UnknownObject } from "./core/object.js";
export { Simulation } from "./core/simulation.js";
export { StopArea } from "./core/stops.js";
export { ServiceManager, Vehicle } from "./core/services.js";
export { RoadNetwork, dockPose, joinPaths, PLACE_MAX_M } from "./core/network.js";
export { Transit, LineBus, RoadUsers, linesServing, boxFaces, gapAhead, mustYield, ringName, turningNumber, JUNCTION_WAIT_S } from "./core/transit.js";
export { DisruptionManager, BUILTIN_DISRUPTIONS, affectedAreas } from "./core/disruptions.js";
export { ScenarioPlayer } from "./core/scenarios.js";
export { Clock, DEFAULT_CLOCK, PROFILES, SUN, parseTime, formatTime, profileAt, daylightAt, DAY_MINUTES } from "./core/clock.js";
export { TrainRegistry, parseFeedMessage, FEED_PROTOCOL } from "./core/trains.js";
export { composeLayout, decomposeLayout, normalizeLayers, layersOn, withLayers, layoutPlugins, layerProblems } from "./core/layers.js";
export { LAYOUT_FORMAT, DEFAULT_SERVICES, DEFAULT_GRID, normalizeLayout, normalizeGrid, validateLayout, isLayout, orthoOf, markerIds, DEFAULT_ROLLING, normalizeRollingMarkers } from "./core/layout.js";
export { resolvePoint, resolvePoints, resolveSegment, translatePoint, pointRelativeTo, markersUsed } from "./core/anchors.js";
export { moodColor, shade, mix, rgba, parseColor, parseRgba, grey, PALETTE, CD, CD_LIGHT, OVERLAY, FONT } from "./core/colors.js";
export { TRAIN, BUS } from "./core/vehicles.js";
export { LANGUAGES, Person, Population, pickHome, residentialBuildings } from "./core/people.js";
export { Platform, BusTerminal, Building, Tree, Forest, Area, Road, Track, Label, Tabletop, PassengerSimulation, TownSimulation };
export { TABLE_SURFACES, TABLE_THICKNESS_MM, drawTable, defaultTableBounds, hasPhysicalTable } from "./objects/tabletop.js";
export { BusStop, BusLine, TrafficSimulation };
export { ROAD_KINDS, roadKind, offsetPolyline, drawStreetLamp } from "./objects/road.js";
export { drawStopSign, STOP_SIGN } from "./objects/signs.js";
export { CAR_COLOURS } from "./sims/traffic.js";
export { PURPOSE_COLOURS, PURPOSE_LABELS } from "./sims/town.js";
export { Plattenbau, AltbauBlock, House, HouseEstate, Office, School, Supermarket, Factory, PLATTENBAU_SERIES, buildHouse } from "./objects/houses.js";
export { StationBuilding, Underpass };
export {
  BuildingBase, BuildingModel, Frame, TONES, TIER, USE_OPTIONS, OCCUPANCY, LIGHTS_ON, defaultOccupancy, lightsOn, capacityFor,
  gableRoof, hipRoof, parapetRoof, blockPiece, sawtoothRoof, axes, drawModel, lightWindows, facesCamera, hashString, hash01, polygonNormal,
} from "./objects/building-kit.js";
export { drawTree } from "./objects/trees.js";
export { BOARD_MIN_PX, boardStatus, dockStatus, drawPerson, NEUTRAL_PERSON, statusLines } from "./sims/passengers.js";
// container terminal (named exports only: no `export *`, so no name can collide with the core's)
export {
  TERMINAL_EVENTS, TERMINAL_REQUESTS, PHASE_LABELS,
  CONTAINER_SIZES, CONTAINER_WIDTH_M, CONTAINER_HEIGHT_M, HIGH_CUBE_HEIGHT_M, BAY_M, ROW_M, CARRIER_TYPES, yardType, bargeType,
  bicCheckDigit, parseBic, bicProblem, makeBic, Container, Carrier, Inventory,
  yardGrid, ContainerYard, GantryCrane, TruckLane, Quay, ReachStacker,
  trapezoid, PathMover, TerminalSimulation, terminalOf,
  CONTAINER_COLOURS, TERMINAL_COLOURS, colourFor, boxCorners, drawContainers, drawYardStacks, drawWagon, drawLocomotive, drawTruck,
  drawBarge, drawCrane, drawReachStacker, drawYardGround, drawYardLabels, drawCraneRails, drawTruckLane, drawQuay, drawHighlights,
  drawGhost, pickBoxes,
  ROLLING_DEFAULTS, decodeTag, encodeTag, RollingStock, registerTerminal,
} from "./terminal/index.js";
// rail operations: fleet, maintenance (ECM), crews and penalties (named exports only, like the terminal)
export {
  OPS_DEFAULTS, DEFAULT_PROGRAM, DEFAULT_SOFT, DEFAULT_VEHICLE, DEFAULT_PARTIES, DEFAULT_CONTRACTS, PRESET_SETUPS, PRESET_STRESS,
  autoNetwork, normalizeOps, validateOps, applySetup, setupsOf, stressOf, normalizeProgram, platformDocks,
  tripTemplates, planRotations, planPieces, dayKind, lineProfile, emptyRunMin, emptyRunKm, deadheadMin,
  Unit, UNIT_STATES, expectedFailures, wearInterval,
  buildDuties, reserveDuties, makeStaff, contractMix, shiftOf, SHIFT_LABELS, WORK_RULES, commuteOf, shortName, pieceBounds,
  CrewDesk, Ledger, CAUSE_FUNCTION, CAUSE_LABELS, FUNCTION_LABELS, OpsEngine, causeWord, jobWord,
  KPIS, kpis, runOne, runExperiment, summarize, toCSV, weekOvertime, causeKeyLabel,
  normalizeHours, isOpen, nextOpen, addWork, workBetween, hoursLabel, weekdaySet, weekdayIndex, clockMinutes, dayTime, durationLabel,
  WEEKDAYS, WEEKDAY_LABELS, Depot, OperationsSimulation, opsOf, CREW_COLOURS, OPS_DISRUPTIONS, registerOperations,
} from "./ops/index.js";
// infrastructure: assets, maintenance, projects (named exports only; names that the core or the
// operations use too get an "infra" prefix)
export {
  GRADES, gradeValue, gradeOf, healthOf, gradeLabel, gradeColour, DISCIPLINES, DISCIPLINE_IDS, GENERATIONS, GENERATION_IDS, REPORTS,
  ASSET_TYPES, TYPE_IDS, hazardFactor, repairCap, METHODS, MEASURES,
  ROLES, ROLE_IDS, DEFAULT_NETWORK, DEFAULT_PLACEMENT, INFRA_DEFAULTS, PRESET_SCENARIOS, normalizeInfra, applyScenario, scenariosOf, validateInfra,
  Network, utmToLonLat, utmZone, kmLabel, Asset, generateAssets, healthAtAge, healthAfter, wearRate, ifcGuid,
  StaffMember, makePeople, shiftOf as infraShiftOf, onCallPerson, weekdayOf, roleLabel, SHIFTS, Plant, PLANT_STAGES,
  ProjectDesk, PROJECT_STAGES, PROCEDURES, QUALITY, SUPERVISION, annuityFactor, eur,
  InfraEngine, INFRA_ACTIONS, TASK_WORDS, YEAR, durationText, toGeoJSON, assetRecord,
  AssetObject, LinearAssetObject, Signal, Switch, Balise, LevelCrossing, GsmrMast, Lift, PassengerDisplay, Catenary, CableRoute, Interlocking,
  MaintenanceBase, CrossingPlant, ASSET_OBJECTS, INFRA_OBJECTS, drawAssetState, drawLinearState,
  InfrastructureSimulation, infraOf, STAFF_COLOURS, drawVan, drawDrone, INFRA_DISRUPTIONS, registerInfrastructure,
} from "./infra/index.js";
export { WebSocketFeed } from "./feeds/websocket.js";
export { MockFeed } from "./feeds/mock.js";

/** Register all built-in object types, simulations, disruptions and vehicles. */
export function registerBuiltins(registry) {
  for (const cls of [
    Platform, BusTerminal, Road, Underpass, BusStop, BusLine,
    Building, StationBuilding, Plattenbau, AltbauBlock, House, HouseEstate, Office, School, Supermarket, Factory, Tree, Forest, Area, Track, Label, Tabletop,
  ]) {
    registry.registerObject(cls);
  }
  registry.registerSimulation(PassengerSimulation);
  registry.registerSimulation(TownSimulation);
  registry.registerSimulation(TrafficSimulation);
  for (const def of BUILTIN_DISRUPTIONS) registry.registerDisruption(def);
  registry.registerVehicle(TRAIN);
  registry.registerVehicle(BUS);
  registerTerminal(registry);
  registerOperations(registry);
  registerInfrastructure(registry);
  return registry;
}

/** The default registry with all built-ins; plugins register into it. */
export const registry = registerBuiltins(new Registry());

/**
 * Create a world for a layout with the default registry.
 * @param {object} [layout] layout file contents
 * @param {{seed?: number, registry?: Registry}} [options]
 */
export function createWorld(layout = {}, { seed, registry: reg = registry } = {}) {
  return new World({ registry: reg, layout, seed });
}

/**
 * Load plugin modules. A plugin is an ES module whose default export is a function that
 * receives this API: `export default function (arail) { arail.registry.registerObject(...) }`.
 * Only same-origin URLs are loaded unless `allowCrossOrigin` is set.
 * @param {string[]} urls module URLs, relative to `base`
 * @param {string} base base URL (e.g. the layout file URL)
 * @param {{allowCrossOrigin?: boolean, registry?: Registry}} [options] registry: where the
 *   plugins register (default: the default registry)
 * @returns {Promise<string[]>} errors (empty if all plugins loaded)
 */
export async function loadPlugins(urls, base, { allowCrossOrigin = false, registry: reg } = {}) {
  const errors = [];
  const module = await import("./index.js");
  const api = reg && reg !== registry ? { ...module, registry: reg } : module;
  for (const u of urls || []) {
    try {
      const url = new URL(u, base);
      if (!allowCrossOrigin && globalThis.location && url.origin !== globalThis.location.origin) {
        throw new Error("cross-origin plugins are disabled");
      }
      const mod = await import(url.href);
      if (typeof mod.default !== "function") throw new Error("a plugin needs a default export function");
      await mod.default(api);
    } catch (err) {
      errors.push(`${u}: ${err.message}`);
    }
  }
  return errors;
}
