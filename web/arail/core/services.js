/**
 * Vehicle services at docks: trains at platform tracks, buses at bus bays.
 *
 * Every dock has a state machine. Without a control-system feed it runs a simple
 * timetable (a vehicle every `headway` seconds, randomised); vehicles can also be called
 * manually or by scenarios. Disruptions change the behaviour through their effects
 * (hold, cancel, closed, frequency). A connected control system takes over rail docks,
 * see `core/trains.js`. Docks with `managed` set (bus stops of bus lines) are left to their
 * manager (`core/transit.js`): no timetable vehicles, and `call()` does not send any.
 *
 * Vehicle life cycle and events: `vehicle.arriving` -> `vehicle.arrived` (doors open) ->
 * `vehicle.departing` (doors close) -> `vehicle.departed`; or `vehicle.cancelled`.
 * @module arail/core/services
 */
import { smoothstep } from "./math.js";

let nextVehicleId = 1;

export class Vehicle {
  constructor({ kind, dock, line = "", source = "timetable", delayMin = 0, trainId = null, approach = 6 }) {
    this.id = `v${nextVehicleId++}`;
    this.kind = kind;
    /** @type {import("./stops.js").Dock} */
    this.dock = dock;
    this.line = line;
    this.source = source;
    this.delayMin = delayMin;
    this.trainId = trainId;
    this.approach = approach;
    /** @type {"arriving" | "dwelling" | "departing"} */
    this.phase = "arriving";
    this.progress = 0;
    this.dwellLeft = dock.dwell;
    // trains on the left edge travel towards s = 0, on the right edge towards s = L; buses always forward
    this.direction = kind === "bus" ? 1 : -dock.side;
  }

  get doorsOpen() {
    return this.phase === "dwelling";
  }
}

export class ServiceManager {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** @type {Map<string, {dock: object, vehicle: Vehicle | null, timer: number, heldFor: number, mode: string, manual: object | null}>} */
    this.docks = new Map();
  }

  reset() {
    this.docks.clear();
  }

  get rng() {
    return this.world.rng;
  }

  _headway(dock) {
    return dock.headway * this.rng.uniform(0.7, 1.3);
  }

  /** Vehicle kind for a dock: a registered vehicle of the dock's kind (e.g. "tram"), else train or bus. */
  _vehicleKind(dock) {
    if (this.world.registry.vehicles.has(dock.kind)) return dock.kind;
    return dock.kind === "bus" ? "bus" : "train";
  }

  /** Update the dock list from the stop areas of all objects (keeps running vehicles). */
  sync() {
    const seen = new Set();
    for (const area of this.world.stopAreas()) {
      for (const dock of area.docks) {
        if (dock.managed) continue; // served by bus lines (core/transit.js)
        seen.add(dock.id);
        const st = this.docks.get(dock.id);
        if (st) {
          st.dock = dock;
          if (st.vehicle) st.vehicle.dock = dock;
        } else {
          this.docks.set(dock.id, { dock, vehicle: null, timer: this.rng.uniform(0.15, 0.6) * dock.headway, heldFor: 0, mode: "timetable", manual: null });
        }
      }
    }
    for (const [id, st] of this.docks) {
      if (!seen.has(id)) {
        if (st.vehicle) this._emit("vehicle.departed", st.vehicle);
        this.docks.delete(id);
      }
    }
  }

  _emit(name, vehicle) {
    this.world.events.emit(name, { vehicle, dock: vehicle.dock, area: vehicle.dock.area });
  }

  /** All vehicles currently at or near docks. */
  vehicles() {
    const out = [];
    for (const st of this.docks.values()) if (st.vehicle) out.push(st.vehicle);
    return out;
  }

  /** Dock states of a stop area, for departure boards. */
  forArea(areaId) {
    return [...this.docks.values()].filter((st) => st.dock.area.id === areaId);
  }

  _lineFor(dock) {
    const owner = dock.area.owner;
    const lines = String(owner?.spec?.lines || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (lines.length) return this.rng.pick(lines);
    return dock.kind === "bus" ? `Bus ${this.rng.pick([62, 64, 85, 87])}` : this.rng.pick(["RE 1", "RB 33", "S 2", "S 8"]);
  }

  /**
   * Send a vehicle to a dock now.
   * @param {string} target dock ID, stop area ID or object ID (a free dock is chosen)
   * @param {{line?: string, source?: string, side?: number}} [options]
   * @returns {Vehicle | null}
   */
  call(target, options = {}) {
    let candidates = [...this.docks.values()].filter(
      (st) => st.dock.id === target || st.dock.area.id === target || st.dock.area.owner?.id === target,
    );
    if (options.side) candidates = candidates.filter((st) => st.dock.side === options.side);
    const free = candidates.filter((st) => !st.vehicle && st.mode !== "feed");
    if (!free.length) return null;
    const st = this.rng.pick(free);
    return this._dispatch(st, { source: options.source || "manual", line: options.line });
  }

  _dispatch(st, { source = "timetable", line, trainId = null } = {}) {
    const dock = st.dock;
    const v = new Vehicle({
      kind: this._vehicleKind(dock),
      dock,
      line: line || this._lineFor(dock),
      source,
      delayMin: st.heldFor / 60,
      trainId,
      approach: this.world.layout.services.approach_s,
    });
    st.vehicle = v;
    st.heldFor = 0;
    this._emit("vehicle.arriving", v);
    return v;
  }

  /** Feed control (see core/trains.js): a real train stopped at / left a dock. */
  feedArrived(dockId, { trainId, line }) {
    const st = this.docks.get(dockId);
    if (!st || st.vehicle) return st?.vehicle || null;
    const v = this._dispatch(st, { source: "feed", line, trainId });
    v.phase = "dwelling";
    v.progress = 1;
    v.dwellLeft = Infinity;
    this._emit("vehicle.arrived", v);
    return v;
  }

  feedDeparted(dockId) {
    const st = this.docks.get(dockId);
    if (!st?.vehicle || st.vehicle.source !== "feed" || st.vehicle.phase === "departing") return;
    const v = st.vehicle;
    v.phase = "departing";
    v.progress = 0;
    this._emit("vehicle.departing", v);
  }

  /** Switch rail docks between timetable and feed control. */
  setMode(dockId, mode) {
    const st = this.docks.get(dockId);
    if (st) st.mode = mode;
  }

  step(dt) {
    const effects = this.world.disruptions;
    for (const st of this.docks.values()) {
      const fx = effects.effectsFor(st.dock.area);
      if (st.vehicle) this._advance(st, st.vehicle, dt, fx);
      if (st.mode !== "timetable") continue;
      // The timetable runs on while a vehicle is at the dock: the headway is the time between
      // arrivals. A due vehicle waits while the dock is occupied, closed or held; the waiting
      // time is its delay, and it arrives as soon as it may.
      if (st.timer > 0) {
        // fewer vehicles at night and more in the rush hours (see core/clock.js)
        const tod = this.world.clock.demand(st.dock.kind === "bus" ? "bus" : "rail");
        st.timer -= dt * Math.max(0, fx.frequency ?? 1) * tod;
        if (st.timer > 0) continue;
      }
      if (fx.cancel) {
        const cancelled = new Vehicle({ kind: this._vehicleKind(st.dock), dock: st.dock, line: this._lineFor(st.dock), source: "timetable" });
        this._emit("vehicle.cancelled", cancelled);
        st.timer = this._headway(st.dock);
        st.heldFor = 0;
        continue;
      }
      if (st.vehicle || fx.closed || fx.hold) {
        st.heldFor += dt;
        continue;
      }
      st.timer = this._headway(st.dock);
      this._dispatch(st);
    }
  }

  _advance(st, v, dt, fx) {
    const approach = Math.max(0.5, v.approach);
    if (v.phase === "arriving") {
      v.progress += dt / approach;
      if (v.progress >= 1) {
        v.phase = "dwelling";
        v.progress = 1;
        this._emit("vehicle.arrived", v);
      }
    } else if (v.phase === "dwelling") {
      v.dwellLeft -= dt;
      if (v.dwellLeft <= 0 || (fx.closed && v.source !== "feed")) {
        v.phase = "departing";
        v.progress = 0;
        this._emit("vehicle.departing", v);
      }
    } else {
      v.progress += dt / (v.source === "feed" ? 1 : approach);
      if (v.progress >= 1) {
        st.vehicle = null;
        this._emit("vehicle.departed", v);
      }
    }
  }

  /**
   * Where a vehicle is drawn: its extent along the area and across it, in metres.
   * @returns {{s0: number, s1: number, t0: number, t1: number, def: object} | null}
   */
  placement(v) {
    const def = this.world.registry.vehicles.get(v.kind);
    if (!def) return null;
    const dock = v.dock, area = dock.area;
    const [a, b] = def.extent(dock);
    const travel = b - a + 5;
    let shift = 0;
    if (v.phase === "arriving") shift = -v.direction * (1 - smoothstep(v.progress)) * travel;
    else if (v.phase === "departing" && v.source !== "feed") shift = v.direction * smoothstep(v.progress) * travel;
    const s0 = Math.max(a + shift, dock.s0 - (def.overhang_m ?? 0), 0);
    const s1 = Math.min(b + shift, dock.s1 + (def.overhang_m ?? 0), area.L);
    if (s1 - s0 < 0.3) return null;
    const t0 = dock.side * (area.W / 2 + def.gap_m), t1 = dock.side * (area.W / 2 + def.gap_m + def.width_m);
    return { s0, s1, t0, t1, def };
  }

  /** Door positions (s, m) of a vehicle standing at its dock. */
  doors(v) {
    const def = this.world.registry.vehicles.get(v.kind);
    return def ? def.doors(v.dock) : [];
  }

  draw(view) {
    // Trains from a control system are real: by default the train registry outlines them
    // where they are; only with feedVehicles = "solid" (or for a virtual camera, which shows no
    // real trains) is a virtual train drawn at the dock.
    const style = view.virtual ? "solid" : this.world.settings.feedVehicles;
    for (const v of this.vehicles()) {
      if (v.source === "feed" && style !== "solid") continue;
      const p = this.placement(v);
      if (p) p.def.draw(view, v, p);
    }
  }
}
