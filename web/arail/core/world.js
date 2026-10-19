/**
 * The world: one loaded layout with its objects, simulations, services and disruptions.
 *
 *   const world = new World({ registry, layout });
 *   world.step(dtRealSeconds);          // advance simulation
 *   world.draw(view);                   // queue and render all virtual content
 *
 * Tracking (camera, markers) is separate (see core/tracker.js); it shares `world.map`.
 * Streets form a road network (`world.network()`, core/network.js); bus and tram lines run on it
 * (`world.transit`, core/transit.js), cars and bikes park in `world.parking` (core/parking.js). A layout's layers (core/layers.js) are merged in when it
 * is loaded (the ones that are on) and split out again by `toJSON()`; `setLayers` switches them.
 * @module arail/core/world
 */
import { createRng } from "./math.js";
import { EventBus } from "./events.js";
import { normalizeLayout, LAYOUT_FORMAT } from "./layout.js";
import { composeLayout, decomposeLayout, withLayers } from "./layers.js";
import { MarkerMap } from "./tracker.js";
import { UnknownObject } from "./object.js";
import { ServiceManager } from "./services.js";
import { DisruptionManager } from "./disruptions.js";
import { ScenarioPlayer } from "./scenarios.js";
import { TrainRegistry } from "./trains.js";
import { Clock } from "./clock.js";
import { RoadNetwork } from "./network.js";
import { Transit } from "./transit.js";
import { ParkingSpaces } from "./parking.js";
import { Elevation } from "./elevation.js";
import { drawFlat } from "./simple.js";
import { cardOf, findPickable, pickAt } from "./pick.js";

/** How far (mm) an object may reach over the edge of the table modules it stands on. */
const MODULE_TOLERANCE_MM = 2;

/**
 * Is an object off the table modules? The problem as a text, or null. What is placed at a point
 * stands on them with its whole footprint (or with what it says it stands on, `standsOn()`: a tree
 * with its trunk); a street, track or area with all its points (a street may span the gap between
 * two modules as a bridge). Only layouts with table modules ask.
 */
export function offModules(world, o) {
  const cls = o.constructor;
  if ((o.anywhere ?? cls.anywhere) || typeof o.groundLevel === "function" || typeof o.footprint !== "function") return null;
  const el = world.elevation.sync();
  if (!el.modules.length) return null;
  const g = o.geometry;
  const pts = typeof o.standsOn === "function" ? o.standsOn() : cls.placement === "point" ? o.footprint() : g?.points || o.footprint();
  if (!pts?.length || el.onModules(pts, MODULE_TOLERANCE_MM)) return null;
  return "Not on a table module: move it onto one, or add a table module under it.";
}

export class World {
  /**
   * @param {object} options
   * @param {import("./registry.js").Registry} options.registry
   * @param {object} [options.layout] layout file contents
   * @param {number} [options.seed] random seed (reproducible simulations)
   */
  constructor({ registry, layout = {}, seed = 12345 }) {
    this.registry = registry;
    this.events = new EventBus();
    this.seed = seed;
    this.rng = createRng(seed);
    /** Simulated seconds since the layout was loaded. */
    this.time = 0;
    /** Time-lapse factor: simulated seconds per real second. */
    this.speed = 2;
    this.paused = false;
    /** Global passenger demand factor (1 = normal). */
    this.demand = 1;
    /** Display settings, used by objects and simulations when drawing. */
    this.settings = {
      labels: true, // signs with counts above stops
      stopBoards: false, // the full board over a stop (name, people, next vehicles); off: a badge with the people waiting
      trails: true, // walking trails of passengers
      showTracks: false, // draw track objects (normally hidden: the real track is there)
      feedVehicles: "outline", // how trains from the control system are drawn: outline | solid | none
      lighting: true, // day/night lighting from the clock
      peopleColour: "auto", // colour of people: "auto" (town people by trip purpose, passengers by mood) | "purpose" | "mood"
      coverMarkers: true, // grey plates with their numbers over the markers and the labels of model wagons (camera view)
      trackSystems: "", // colour the tracks by one of their railway systems ("power", "train_control", …; rail/systems.js), "" = off
    };
    /** Time of day (fast clock), see core/clock.js. */
    this.clock = new Clock();
    this.services = new ServiceManager(this);
    this.disruptions = new DisruptionManager(this);
    this.scenarios = new ScenarioPlayer(this);
    this.trains = new TrainRegistry(this);
    /** Bus and tram lines in operation (core/transit.js). */
    this.transit = new Transit(this);
    /** Parking spaces and who is parked there (core/parking.js). */
    this.parking = new ParkingSpaces(this);
    /** Heights: the levels of the table modules, streets on ramps and bridges (core/elevation.js). */
    this.elevation = new Elevation(this);
    /**
     * The train whose compatibility the tracks show (View → Colour the tracks by, rail/compat.js):
     * `{name, consist}`, or null.
     */
    this.compatibilityTrain = null;
    /** Incremented whenever an object is added, changed or removed (caches of derived data use it). */
    this.objectsVersion = 0;
    this.load(layout);
  }

  /* ---------------------------------------------------------------- layout */

  /** Load a layout (replaces all objects, simulations and scenarios), with the layers that are on. */
  load(json) {
    const composed = composeLayout(json);
    this._composed = composed;
    /** The layer new objects are added to (null: the base); one of the layers that are on. */
    if (!composed.layers.some((l) => l.enabled && l.id === this.activeLayer)) this.activeLayer = null;
    const layout = normalizeLayout(composed.layout);
    this.layout = layout;
    this.scale = layout.scale;
    const m = layout.markers;
    const markers = { size: m.size_mm, sizes: m.sizes_mm, poses: m.poses, origin: m.origin, locked: m.locked, moving: m.moving };
    // the map object stays the same, so trackers built on `world.map` keep working
    if (this.map) this.map.configure(markers);
    else this.map = new MarkerMap(markers);
    this.objects = [];
    this.compatibilityTrain = null;
    this.time = 0;
    this.demand = 1;
    this.clock.configure(layout.clock);
    this.rng = createRng(this.seed);
    this.services.reset();
    this.disruptions.reset();
    this.trains.reset();
    this.transit.reset();
    this.parking?.reset();
    this._areas = null;
    this._syncedAreas = null;
    this._network = null;
    for (const spec of layout.objects) this._create(spec);
    this.objectsVersion++;
    for (const s of this.simulations || []) s.dispose?.();
    this.simulations = [];
    // settings of simulations whose plugin is missing are kept and saved unchanged
    this._simulationEntries = layout.simulations.map((cfg) => {
      const Sim = this.registry.simulations.get(cfg.type);
      if (!Sim) {
        console.warn(`Unknown simulation type "${cfg.type}" (missing plugin?)`);
        return { cfg };
      }
      const sim = new Sim(this, cfg);
      this.simulations.push(sim);
      return { sim };
    });
    this.scenarios.load(layout.scenarios);
    this._syncStops();
    this.events.emit("layout.loaded", { layout });
  }

  /** Current layout (including edits and the surveyed marker map) as a layout file, with its layers. */
  toJSON() {
    const flat = this._flatJSON();
    if (!this._composed?.layers.length) return flat;
    return decomposeLayout(flat, this._composed, {
      newObjects: this.activeLayer,
      simulationOrigin: this._simulationEntries.map((e, i) => this._composed.origin.simulations[i] ?? null),
    });
  }

  /**
   * The layers of the layout: [{id, name, description, enabled, exclusive, layout, simulations: types of
   * the simulations it adds}] (`layout`: the path of a layout of its own, relative to the layout file).
   */
  layers() {
    return (this._composed?.layers || []).map(({ id, name, description, enabled, exclusive, layout, simulations }) => ({
      id, name, description, enabled, exclusive, layout, simulations: simulations.filter((x) => x.patch !== true).map((x) => x.type),
    }));
  }

  /** The layer an object comes from (null: the base). */
  layerOf(id) {
    return this._composed?.origin.objects.get(id)?.layer ?? null;
  }

  /**
   * Switch layers: exactly these are on afterwards. The layout is loaded again with them (edits
   * are kept; the simulations start again).
   * @param {Iterable<string>} ids
   */
  setLayers(ids) {
    this.load(withLayers(this.toJSON(), ids));
  }

  _flatJSON() {
    const L = this.layout;
    // locked and moving as the map has them now; written only when set, to keep files tidy
    const { locked, moving, poses, ...markers } = L.markers;
    if (this.map.locked) markers.locked = true;
    if (this.map.moving.size) markers.moving = [...this.map.moving].sort((a, b) => a - b);
    markers.poses = this.map.toJSON();
    return {
      format: LAYOUT_FORMAT,
      name: L.name,
      description: L.description,
      scale: this.scale,
      markers,
      services: L.services,
      clock: this.clock.toJSON(),
      grid: L.grid,
      simulations: this._simulationEntries.map((e) => (e.sim ? e.sim.toJSON() : e.cfg)),
      objects: this.objects.map((o) => o.toJSON()),
      scenarios: L.scenarios,
      plugins: L.plugins,
      ...(L.consists?.length ? { consists: L.consists } : {}),
      ...(L.vehicle_types && Object.keys(L.vehicle_types).length ? { vehicle_types: L.vehicle_types } : {}),
      ...(L.view ? { view: L.view } : {}),
    };
  }

  setScale(scale) {
    if (!(scale > 0)) return;
    this.scale = scale;
    this.objectChanged(null);
  }

  /* ---------------------------------------------------------------- objects */

  _create(spec) {
    const Cls = this.registry.objects.get(spec.type);
    const obj = Cls ? new Cls(this, spec) : new UnknownObject(this, spec);
    if (!Cls) console.warn(`Unknown object type "${spec.type}" (missing plugin?)`);
    this.objects.push(obj);
    return obj;
  }

  getObject(id) {
    return this.objects.find((o) => o.id === id) || null;
  }

  /** Ids of objects of the layers that are off (a new object must not take them). */
  _offLayerIds() {
    const c = this._composed;
    if (!c?.layers.length) return new Set();
    return new Set(c.layers.filter((l) => !l.enabled).flatMap((l) => l.objects.map((o) => o.id)).filter((id) => !c.origin.objects.has(id)));
  }

  /** A new object ID like "building-3" (not used by any layer, also not by those that are off). */
  newId(type) {
    const taken = this._offLayerIds();
    let i = 1;
    while (this.getObject(`${type}-${i}`) || taken.has(`${type}-${i}`)) i++;
    return `${type}-${i}`;
  }

  /** Add an object from a spec ({type, ...}); returns the object. */
  addObject(spec) {
    if (!this.registry.objects.has(spec.type)) throw new Error(`Unknown object type: ${spec.type}`);
    const free = spec.id && !this.getObject(spec.id) && !this._offLayerIds().has(spec.id);
    const s = { ...spec, id: free ? spec.id : this.newId(spec.type) };
    // a new object belongs to the active layer; one that was removed and comes back (undo) to its own
    const origins = this._composed?.origin.objects;
    if (origins && !origins.has(s.id)) origins.set(s.id, { layer: this.activeLayer ?? null, base: null, patches: [] });
    const obj = this._create(s);
    this.objectChanged(obj);
    this.events.emit("object.added", { object: obj });
    return obj;
  }

  removeObject(id) {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return false;
    const [obj] = this.objects.splice(i, 1);
    this.objectChanged(null);
    this.events.emit("object.removed", { object: obj });
    return true;
  }

  /** Called when an object's spec changed (by `LayoutObject.set`). */
  objectChanged(obj) {
    this.objectsVersion++;
    this._areas = null;
    this._areasKey = null;
    this._syncStops();
    if (obj) this.events.emit("object.changed", { object: obj });
  }

  /** All stop areas of all objects (cached until objects or the marker map change). */
  stopAreas() {
    const key = `${this.map.version}:${this.scale}`;
    if (!this._areas || this._areasKey !== key) {
      this._areasKey = key;
      this._areas = this.objects.flatMap((o) => (o.geometry ? o.stopAreas() : []));
    }
    return this._areas;
  }

  /** Keep the service docks in line with the stop areas (they change when markers get surveyed). */
  _syncStops() {
    const areas = this.stopAreas();
    if (this._syncedAreas === areas) return;
    this._syncedAreas = areas;
    this.services.sync();
  }

  getStopArea(id) {
    return this.stopAreas().find((a) => a.id === id) || null;
  }

  /**
   * The road network of the streets, footpaths, building entrances, stops and bus lanes
   * (core/network.js), cached until objects, the marker map or the scale change.
   * @returns {RoadNetwork | null} null only while it is being built (for objects asked during the build)
   */
  network() {
    const key = `${this.objectsVersion}:${this.map.version}:${this.scale}`;
    if (this._network && this._networkKey === key) return this._network;
    if (this._buildingNetwork) return null; // asked for while it is being built
    this._buildingNetwork = true;
    try {
      this._network = new RoadNetwork(this);
      this._networkKey = key;
    } finally {
      this._buildingNetwork = false;
    }
    return this._network;
  }

  /* ---------------------------------------------------------------- simulation */

  /**
   * Advance the simulation.
   * @param {number} dtReal real seconds since the last call
   */
  step(dtReal) {
    this._syncStops();
    this.trains.step(Math.min(dtReal, 1));
    if (this.paused) return;
    let dt = Math.min(dtReal, 0.1) * this.speed;
    // sub-steps keep the crowd model stable at high time-lapse factors
    const n = Math.max(1, Math.ceil(dt / 0.25));
    dt /= n;
    for (let i = 0; i < n; i++) {
      this.time += dt;
      if (this.clock.advance(dt)) this.events.emit("clock.day", { day: this.clock.day });
      this.scenarios.step();
      this.disruptions.step();
      this.services.step(dt);
      this.transit.step(dt);
      for (const o of this.objects) o.update(dt);
      for (const s of this.simulations) s.step(dt);
    }
  }

  /* ---------------------------------------------------------------- pointing at things */

  /**
   * What is at an image pixel of a view (core/pick.js): a person, vehicle or other thing that moves
   * (the nearest), else a layout object, else null.
   * @param {import("./view.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] image px
   * @param {{tolerance?: number, ground?: number[] | null}} [options] tolerance in CSS px
   * @returns {import("./pick.js").Pickable | null}
   */
  pick(view, pixel, options = {}) {
    return pickAt(this, view, pixel, options);
  }

  /**
   * The info card of a pickable: its owner's description, for a layout object what the simulations
   * know about it, and what the card providers of the registry add (the train data of a train).
   * @param {import("./pick.js").Pickable} hit
   * @returns {import("./pick.js").Card}
   */
  card(hit) {
    const card = cardOf(hit);
    if (hit.kind === "object") for (const s of this.simulations) if (s.enabled !== false) s.describeObject?.(hit.ref, card);
    for (const add of this.registry.cards?.values() || []) add(this, hit, card);
    return card;
  }

  /** The pickable with this key now (things move on), or null when it is gone. */
  findPickable(view, key) {
    return findPickable(this, view, key);
  }

  /** Set the time of day ("HH:MM" or minutes); simulations re-place their people (`clock.set`). */
  setTime(value) {
    const minutes = this.clock.set(value);
    this.events.emit("clock.set", { minutes });
    return minutes;
  }

  /** Darkness 0 (day) .. 1 (night) for drawing, 0 while the lighting is switched off. */
  night() {
    return this.settings.lighting === false ? 0 : this.clock.night();
  }

  /**
   * Queue everything on the view and render it. Things are lifted to their heights (core/elevation.js,
   * `View#lift`) by what they say they stand on (`elevation`, of the class or the instance): "street"
   * (the default: the street level, on bridges and ramps too), "ground" (the railway: the table
   * module, so that trains pass under a bridge) or "none" (they draw their heights themselves, like
   * the table modules). The simple view stays flat. Afterwards the view keeps the street level (for
   * pointing at things and the editor's marks).
   */
  draw(view, { selected = null } = {}) {
    if (view.night == null) view.night = this.night();
    this._syncStops();
    const el = this.elevation.sync();
    const lifts = view.simple ? {} : { street: el.streetLift, ground: el.groundLift };
    const lift = (x) => lifts[x?.elevation ?? x?.constructor?.elevation ?? "street"] ?? null;
    if (view.simple) {
      // the simple view (core/simple.js): objects flat, what moves as plain blocks
      view.flat = true;
      for (const o of this.objects) {
        if (!o.geometry) continue;
        if (typeof o.drawSimple === "function") o.drawSimple(view);
        else drawFlat(view, o);
      }
      view.flat = false;
    } else {
      for (const o of this.objects) {
        if (!o.geometry) continue;
        view.lift = lift(o);
        o.draw(view);
      }
    }
    for (const part of [this.services, this.transit, this.parking, this.trains, ...this.simulations, this.disruptions]) {
      view.lift = lift(part);
      part.draw(view);
    }
    if (view.simple) view.flat = true;
    view.lift = lift(selected);
    if (selected && selected.geometry) selected.drawSelection(view);
    view.lift = lifts.street ?? null;
    view.render();
  }

  /**
   * What is wrong with an object (shown in the editors): what it says of itself (`problems()`) and,
   * when the layout has table modules, whether it stands on them: houses, streets and the rest are
   * built on table modules (objects/tabletop.js). Table modules, floating labels, what has no
   * footprint and what says so (`anywhere`, of the class or the object) may be anywhere.
   * @param {import("./object.js").LayoutObject} o
   * @returns {string[]}
   */
  problemsOf(o) {
    let list = [];
    try {
      list = typeof o.problems === "function" ? o.problems() || [] : [];
    } catch {
      list = [];
    }
    const at = o.geometry ? offModules(this, o) : null;
    return at ? [...list, at] : list;
  }
}
