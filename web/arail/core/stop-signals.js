/**
 * Traffic lights at tram stops in the middle of the street (Haltestellen-Lichtsignalanlage), run by
 * core/transit.js.
 *
 * Where people cross a strip with cars or bikes between the sidewalk and a standing tram (a stop on
 * the road or at a raised road: Fahrbahnhaltestelle, Zeitinsel), the vehicles in that strip are held
 * at a stop line before the stop while a tram comes and stands there and while people cross: StVO
 * § 20 says they must not be put in danger, the lights make sure. At an island stop in a street the
 * cars beside the island are held at its end while people cross to and from it. A light is green for
 * the vehicles, then amber (3 s, RiLSA at 50 km/h), red while it is needed, red-amber (1 s) and green
 * again. People step onto the strip only while it is red and no vehicle is left on it (the vehicles
 * that passed the stop line at amber have cleared it): while a tram stands there, else for 8 s (their
 * green); a tram opens its doors only then. Trams pass the lights. A stop says where its lights are
 * with `stopSignals()` (objects/tram.js).
 * @module arail/core/stop-signals
 */
import { dist2, dot2, pointInPolygon, sub2 } from "./math.js";

/**
 * Seconds: amber, red-amber, red kept after the last person has left the strip, green at least (RiLSA:
 * 5 s) and green at least before people ask for red again (not a tram), the people's green when no
 * tram stands there; a tram asks for red within `approach_m` (m) when it moves faster than
 * `moving_ms` (m/s); at amber those stop who can with `brake` (m/s²).
 */
export const STOP_SIGNAL = { amber_s: 3, redAmber_s: 1, clear_s: 2, minGreen_s: 5, minGreenPeople_s: 12, walk_s: 8, approach_m: 50, moving_ms: 0.5, brake: 3.5 };

/** Who stops at a light: everybody but trams; at amber only those who still can (m/s² of `brake`). */
function obeysLight(sig, state) {
  return (self, front) => {
    if (self.kind === "tram") return false;
    if (state === "red" || state === "red-amber") return true;
    const along = dot2(sub2(sig.line[0], front), sig.dir) * (sig.metrePerMM || 0);
    return along >= ((self.v || 0) * (self.v || 0)) / (2 * STOP_SIGNAL.brake);
  };
}

export class StopSignals {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** @type {Map<string, {state: string, since: number, clear: number, need: boolean, occupied: boolean}>} */
    this.states = new Map();
    /** What the stops' people say: area id → {crossing (people on the strip), waiting (at its edge, to cross)}. */
    this.reports = new Map();
    this._key = null;
    this._list = [];
  }

  /** The lights of the stops (see `stopSignals()` of objects/tram.js), kept while nothing changes. */
  list() {
    const w = this.world, key = `${w.objectsVersion}:${w.map.version}:${w.scale}`;
    if (key !== this._key) {
      this._key = key;
      this._list = [];
      for (const o of w.objects) {
        if (typeof o.stopSignals !== "function" || !o.geometry) continue;
        for (const sig of o.stopSignals() || []) {
          const xs = sig.zone.map((p) => p[0]), ys = sig.zone.map((p) => p[1]);
          const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          this._list.push({ ...sig, owner: o, metrePerMM: w.scale / 1000, box });
        }
      }
      const ids = new Set(this._list.map((s) => s.id));
      for (const id of [...this.states.keys()]) if (!ids.has(id)) this.states.delete(id);
    }
    return this._list;
  }

  /** The light of a signal now: "green", "amber", "red" or "red-amber" ("green" when there is none). */
  state(id) {
    return this.states.get(id)?.state ?? "green";
  }

  /** The light for a stop area: may people step onto the strip now? True where it has no light. */
  walk(areaId) {
    const sig = this.forArea(areaId);
    return !sig || this._walk(sig.id);
  }

  /** May people step onto the strip (see `step`)? */
  _walk(id) {
    return !!this.states.get(id)?.walk;
  }

  /** The light at a stop area, or null: {id, kind ("board" | "island"), reach (m: how far people walk across the strip), s (m: where along the area an island's crossing is)}. */
  forArea(areaId) {
    return this.list().find((s) => s.areaId === areaId) || null;
  }

  /** The light for the people getting on and off at a dock (a stop on the road or at a raised road), or null. */
  forDock(dockId) {
    return (dockId && this.list().find((s) => s.dockId === dockId && s.kind === "board")) || null;
  }

  /** Does a tram at this dock keep its doors shut, because the people cannot cross to it yet? */
  holdsDoors(dockId) {
    const sig = this.forDock(dockId);
    return !!sig && !this._walk(sig.id);
  }

  /** People on the strip and waiting to cross it, from the simulation of the passengers (sims/passengers.js). */
  report(areaId, crossing, waiting = 0) {
    this.reports.set(areaId, { crossing, waiting });
  }

  /**
   * One step: each light changes when it must. Green until a tram comes (after 5 s of green at least)
   * or people want to cross (after 12 s), amber, red: people may cross once no vehicle is left on the
   * strip, while a tram stands there and else for 8 s; it stays red while a tram comes or stands
   * there and while people are on the strip (or still step onto it), and 2 s more; red-amber, green.
   * @param {number} dt simulated seconds
   * @param {{buses: object[], meters: (mm: number) => number, ahead: (bus: object) => {dockId: string, d: number} | null}} transit the trams and how far they are from their next stop
   * @param {object[]} users the road users (core/transit.js RoadUsers entries)
   */
  step(dt, transit, users) {
    const now = this.world.time;
    for (const sig of this.list()) {
      let st = this.states.get(sig.id);
      if (!st) this.states.set(sig.id, (st = { state: "green", since: -Infinity, clear: 0, need: false, occupied: false, walk: false, walkFrom: null }));
      const rep = this.reports.get(sig.areaId) || { crossing: 0, waiting: 0 };
      const tram = this._tram(sig, transit);
      st.need = rep.crossing > 0 || rep.waiting > 0 || !!tram;
      st.occupied = st.state !== "green" && this._occupied(sig, users);
      const held = now - st.since;
      if (st.state === "green") {
        if (st.need && held >= (tram ? STOP_SIGNAL.minGreen_s : STOP_SIGNAL.minGreenPeople_s)) this._set(st, "amber", now);
      } else if (st.state === "amber") {
        if (held >= STOP_SIGNAL.amber_s) this._set(st, "red", now);
      } else if (st.state === "red") {
        if (!st.occupied && st.walkFrom === null) st.walkFrom = now;
        st.walk = !st.occupied && st.walkFrom !== null && (tram === "dwelling" || now - st.walkFrom < STOP_SIGNAL.walk_s);
        const keep = !!tram || rep.crossing > 0 || (st.walk && rep.waiting > 0);
        st.clear = keep ? 0 : st.clear + dt;
        if (st.clear >= STOP_SIGNAL.clear_s) this._set(st, "red-amber", now);
      } else if (held >= STOP_SIGNAL.redAmber_s) this._set(st, "green", now);
      if (st.state !== "red") st.walk = false;
    }
  }

  _set(st, state, now) {
    st.state = state;
    st.since = now;
    st.clear = 0;
    st.walkFrom = null;
  }

  /**
   * Does a tram stand at the light's dock ("dwelling"), or come to it ("coming": its next stop, close,
   * and moving; a tram that waits further back, perhaps behind the very vehicles the light holds,
   * does not keep it red)? Null if not. One that lays over at its first stop does not count either:
   * the people who want to get on ask for red.
   */
  _tram(sig, transit) {
    if (sig.kind !== "board" || !transit) return null;
    let coming = false;
    for (const bus of transit.buses || []) {
      if (bus.kind !== "tram" || bus.phase === "gone") continue;
      if (bus.phase === "dwelling" && bus.dock?.id === sig.dockId) {
        if (!bus.waiting) return "dwelling";
        continue;
      }
      if (coming || bus.v < STOP_SIGNAL.moving_ms) continue;
      const next = transit.ahead?.(bus);
      if (next && next.dockId === sig.dockId && transit.meters(next.d) <= STOP_SIGNAL.approach_m) coming = true;
    }
    return coming ? "coming" : null;
  }

  /**
   * Is a vehicle (not a tram) on the strip, between the stop line and the end of the stop or of the
   * crossing? Anywhere from its rear to its front: a bus is longer than the crossing to an island.
   */
  _occupied(sig, users) {
    const [x0, y0, x1, y1] = sig.box, step = 1 / sig.metrePerMM;
    for (const u of users || []) {
      const v = u.vehicle;
      if (!v || v.kind === "tram" || v.phase === "block" || v.phase === "signal") continue;
      if (dot2(u.dir, sig.dir) < 0.3) continue;
      const n = Math.max(1, Math.ceil(dist2(u.front, u.rear) / step));
      for (let k = 0; k <= n; k++) {
        const p = [u.rear[0] + ((u.front[0] - u.rear[0]) * k) / n, u.rear[1] + ((u.front[1] - u.rear[1]) * k) / n];
        if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && pointInPolygon(p, sig.zone)) return true;
      }
    }
    return false;
  }

  /**
   * Road users that hold the vehicles at the lights: points along the stop line, across the street
   * (only the traffic in the light's direction heeds them), while a light is red, red-amber or amber
   * (at amber only for those who can still stop).
   */
  blockers() {
    const out = [];
    for (const sig of this.list()) {
      const state = this.state(sig.id);
      if (state === "green") continue;
      const obeys = obeysLight(sig, state);
      sig.line.forEach((p, k) => {
        const front = [p[0] + sig.dir[0] * sig.depth, p[1] + sig.dir[1] * sig.depth];
        out.push({ vehicle: { id: `signal:${sig.id}:${k}`, phase: "signal", v: 0, owner: null, obeys }, front, rear: p, dir: sig.dir, speed: 0, approach: null });
      });
    }
    return out;
  }
}
