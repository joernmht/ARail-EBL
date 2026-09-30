/**
 * The world: one loaded layout with its objects, simulations, services and disruptions.
 *
 *   const world = new World({ registry, layout });
 *   world.step(dtRealSeconds);          // advance simulation
 *   world.draw(view);                   // queue and render all virtual content
 *
 * Tracking (camera, markers) is separate (see core/tracker.js); it shares `world.map`.
 * @module arail/core/world
 */
import { createRng } from "./math.js";
import { EventBus } from "./events.js";
import { normalizeLayout, LAYOUT_FORMAT } from "./layout.js";
import { MarkerMap } from "./tracker.js";
import { UnknownObject } from "./object.js";
import { ServiceManager } from "./services.js";
import { DisruptionManager } from "./disruptions.js";
import { ScenarioPlayer } from "./scenarios.js";
import { TrainRegistry } from "./trains.js";

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
      trails: true, // walking trails of passengers
      showTracks: false, // draw track objects (normally hidden: the real track is there)
      feedVehicles: "outline", // how trains from the control system are drawn: outline | solid | none
    };
    this.services = new ServiceManager(this);
    this.disruptions = new DisruptionManager(this);
    this.scenarios = new ScenarioPlayer(this);
    this.trains = new TrainRegistry(this);
    this.load(layout);
  }

  /* ---------------------------------------------------------------- layout */

  /** Load a layout (replaces all objects, simulations and scenarios). */
  load(json) {
    const layout = normalizeLayout(json);
    this.layout = layout;
    this.scale = layout.scale;
    const m = layout.markers;
    this.map = new MarkerMap({ size: m.size_mm, sizes: m.sizes_mm, poses: m.poses, origin: m.origin });
    this.objects = [];
    this.time = 0;
    this.rng = createRng(this.seed);
    this.services.reset();
    this.disruptions.reset();
    this.trains.reset();
    this._areas = null;
    for (const spec of layout.objects) this._create(spec);
    for (const s of this.simulations || []) s.dispose?.();
    this.simulations = [];
    for (const cfg of layout.simulations) {
      const Sim = this.registry.simulations.get(cfg.type);
      if (Sim) this.simulations.push(new Sim(this, cfg));
      else console.warn(`Unknown simulation type "${cfg.type}" (missing plugin?)`);
    }
    this.scenarios.load(layout.scenarios);
    this.services.sync();
    this.events.emit("layout.loaded", { layout });
  }

  /** Current layout (including edits and the surveyed marker map) as a layout file. */
  toJSON() {
    const L = this.layout;
    return {
      format: LAYOUT_FORMAT,
      name: L.name,
      description: L.description,
      scale: this.scale,
      markers: { ...L.markers, poses: this.map.toJSON() },
      services: L.services,
      simulations: this.simulations.map((s) => s.toJSON()),
      objects: this.objects.map((o) => o.toJSON()),
      scenarios: L.scenarios,
      plugins: L.plugins,
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

  /** A new object ID like "building-3". */
  newId(type) {
    let i = 1;
    while (this.getObject(`${type}-${i}`)) i++;
    return `${type}-${i}`;
  }

  /** Add an object from a spec ({type, ...}); returns the object. */
  addObject(spec) {
    if (!this.registry.objects.has(spec.type)) throw new Error(`Unknown object type: ${spec.type}`);
    const s = { ...spec, id: spec.id && !this.getObject(spec.id) ? spec.id : this.newId(spec.type) };
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
    this._areas = null;
    this._areasKey = null;
    this.services.sync();
    if (obj) this.events.emit("object.changed", { object: obj });
  }

  /** All stop areas of all objects (cached until objects or the marker map change). */
  stopAreas() {
    const key = `${this.map.version}:${this.scale}`;
    if (!this._areas || this._areasKey !== key) {
      this._areasKey = key;
      this._areas = this.objects.flatMap((o) => (o.geometry ? o.stopAreas() : []));
      // the dock list may change when markers get surveyed
      queueMicrotask(() => this.services.sync());
    }
    return this._areas;
  }

  getStopArea(id) {
    return this.stopAreas().find((a) => a.id === id) || null;
  }

  /* ---------------------------------------------------------------- simulation */

  /**
   * Advance the simulation.
   * @param {number} dtReal real seconds since the last call
   */
  step(dtReal) {
    this.trains.step(Math.min(dtReal, 1));
    if (this.paused) return;
    let dt = Math.min(dtReal, 0.1) * this.speed;
    // sub-steps keep the crowd model stable at high time-lapse factors
    const n = Math.max(1, Math.ceil(dt / 0.25));
    dt /= n;
    for (let i = 0; i < n; i++) {
      this.time += dt;
      this.scenarios.step();
      this.disruptions.step();
      this.services.step(dt);
      for (const o of this.objects) o.update(dt);
      for (const s of this.simulations) s.step(dt);
    }
  }

  /** Queue everything on the view and render it. */
  draw(view, { selected = null } = {}) {
    for (const o of this.objects) if (o.geometry) o.draw(view);
    this.services.draw(view);
    this.trains.draw(view);
    for (const s of this.simulations) s.draw(view);
    this.disruptions.draw(view);
    if (selected && selected.geometry) selected.drawSelection(view);
    view.render();
  }
}
