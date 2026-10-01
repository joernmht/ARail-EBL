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
import { Forest, Tree } from "./objects/trees.js";
import { Area, Road } from "./objects/landscape.js";
import { Track } from "./objects/track.js";
import { Label } from "./objects/label.js";
import { PassengerSimulation } from "./sims/passengers.js";

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
export { LayoutObject, UnknownObject } from "./core/object.js";
export { Simulation } from "./core/simulation.js";
export { StopArea } from "./core/stops.js";
export { ServiceManager, Vehicle } from "./core/services.js";
export { DisruptionManager, BUILTIN_DISRUPTIONS, affectedAreas } from "./core/disruptions.js";
export { ScenarioPlayer } from "./core/scenarios.js";
export { Clock, DEFAULT_CLOCK, PROFILES, SUN, parseTime, formatTime, profileAt, daylightAt, DAY_MINUTES } from "./core/clock.js";
export { TrainRegistry, parseFeedMessage, FEED_PROTOCOL } from "./core/trains.js";
export { LAYOUT_FORMAT, DEFAULT_SERVICES, normalizeLayout, validateLayout, isLayout } from "./core/layout.js";
export { resolvePoint, resolvePoints, resolveSegment, translatePoint, pointRelativeTo } from "./core/anchors.js";
export { moodColor, shade, mix, rgba, parseColor, parseRgba, grey, PALETTE, CD } from "./core/colors.js";
export { TRAIN, BUS } from "./core/vehicles.js";
export { Platform, BusTerminal, Building, Tree, Forest, Area, Road, Track, Label, PassengerSimulation };
export { drawTree } from "./objects/trees.js";
export { dockStatus, drawPerson, NEUTRAL_PERSON } from "./sims/passengers.js";
export { WebSocketFeed } from "./feeds/websocket.js";
export { MockFeed } from "./feeds/mock.js";

/** Register all built-in object types, simulations, disruptions and vehicles. */
export function registerBuiltins(registry) {
  for (const cls of [Platform, BusTerminal, Building, Tree, Forest, Area, Road, Track, Label]) registry.registerObject(cls);
  registry.registerSimulation(PassengerSimulation);
  for (const def of BUILTIN_DISRUPTIONS) registry.registerDisruption(def);
  registry.registerVehicle(TRAIN);
  registry.registerVehicle(BUS);
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
