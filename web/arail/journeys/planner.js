/**
 * The journey planner: travel plans with transfers from a start to an aim, for a departure time.
 *
 * Places are the buildings on the layout (by their entrances) and the stations beyond the layout
 * (from the timetable, see rail.js). A plan is a list of legs:
 * - `walk`: over the road network (streets, footpaths, the underpass), at 1.3 m/s;
 * - `bus`: a bus line from one stop to another (`world.transit`). Buses run at a headway, not to a
 *   timetable: the planner expects half the headway of waiting and the line's average speed, so its
 *   bus times are estimates ("about 07:52");
 * - `train`: a trip of the timetable from one station to another, with its planned times.
 *
 * The walks and the buses run on the layout, at the speed of the simulation, while the clock is
 * faster (`clock.factor`): their minutes are clock minutes too, so a walk of 100 m takes about 15
 * clock minutes at 1:12. Between a vehicle and a train the traveller keeps a transfer time (the
 * minimum the attendee asks for). Plans are ranked by arrival, then by transfers and walking; for
 * each way (the same modes and lines) at most two departures are offered.
 * @module arail/journeys/planner
 */
import { dist2, polylineLengths } from "../core/math.js";
import { PROFILES, profileAt } from "../core/clock.js";
import { towards } from "../core/transit.js";
import { DAY } from "../ops/util.js";
import { arrAt, depAt, reaches, stopIndex } from "./rail.js";

/** Walking speed of the travellers (prototype m/s). */
export const WALK_MPS = 1.3;
/** Longest walk to or from a bus stop (prototype m). */
const ACCESS_M = 450;
/** Minutes after the departure time the planner looks for trains. */
const HORIZON_MIN = 6 * 60;
/** Departures per line and way that are offered. */
const PER_LINE = 2;
/** Plans offered at most. */
const MAX_PLANS = 6;
/** Shortest dwell of a bus at a stop (simulated s, as in the transit). */
const MIN_DWELL_S = 8;
/** Seconds a bus loses per stop besides its dwell: doors, pulling out, braking and accelerating (measured on the lab example). */
const STOP_LOSS_S = 12;
/** Average speed of a bus between stops, as a share of its line's speed (measured on the lab example). */
const BUS_PACE = 0.55;

/**
 * A walking path between two places on the layout ({pos, key}), over the road network when it
 * connects them: {points, lengths, length (mm), route, routeStart}.
 * @param {object} world
 * @param {{pos: number[], key?: string | null}} from
 * @param {{pos: number[], key?: string | null}} to
 */
export function walkPath(world, from, to) {
  let net = null;
  try {
    net = world.network?.() || null;
  } catch {
    net = null;
  }
  let route = null;
  if (net) {
    const a = net.place?.(from.key) ?? net.nearestNode?.(from.pos, { mode: "walk" });
    const b = net.place?.(to.key) ?? net.nearestNode?.(to.pos, { mode: "walk" });
    if (a != null && b != null) route = net.route?.(a, b, { mode: "walk" }) || null;
  }
  const raw = route ? [from.pos, ...route.points, to.pos] : [from.pos, to.pos];
  const points = [raw[0]];
  for (const p of raw.slice(1)) if (dist2(p, points[points.length - 1]) > 0.01) points.push(p);
  if (points.length < 2) points.push(to.pos.slice());
  const lengths = polylineLengths(points);
  return { points, lengths, length: lengths[lengths.length - 1], route, routeStart: route?.points.length ? dist2(from.pos, route.points[0]) : 0 };
}

/** Where a place reference ({kind: "building", id, entrance} or {kind: "area", id, access}) is on the layout now: {pos, key}, or null. */
export function placePoint(world, ref) {
  if (!ref) return null;
  if (ref.kind === "building") {
    const o = world.getObject(ref.id);
    const list = o?.geometry && typeof o.entrances === "function" ? o.entrances() : [];
    const i = Math.min(Math.max(0, ref.entrance ?? 0), list.length - 1);
    return list[i] ? { pos: list[i].pos, key: `building:${o.id}:${i}` } : null;
  }
  if (ref.kind === "area") {
    const area = world.getStopArea(ref.id);
    const e = area?.access[Math.min(Math.max(0, ref.access ?? 0), area.access.length - 1)];
    return e ? { pos: area.toLayout(e.s, e.t), key: `area:${area.id}:${area.access.indexOf(e)}` } : null;
  }
  return null;
}

/** The name of a stop area for people: "Altmarkt (Stop A)", "Platform 2". */
export function areaName(area) {
  if (!area) return "";
  const owner = area.owner;
  const sides = owner?.world?.stopAreas?.().filter((a) => a.owner === owner).length ?? 1;
  return sides > 1 && area.docks[0]?.label ? `${owner.name} (${area.docks[0].label})` : owner?.name ?? area.id;
}

export class Planner {
  /** @param {object} sim the journeys simulation */
  constructor(sim) {
    this.sim = sim;
    this.world = sim.world;
    this._walks = new Map();
    this._walksKey = null;
  }

  get rail() {
    return this.sim.rail();
  }

  /** Clock minutes of simulated seconds. */
  clockMin(seconds) {
    return (seconds * this.world.clock.factor) / 60;
  }

  /** Clock minutes to get off a vehicle at a stop area and walk to its exit (a quarter of its length, on average). */
  alightMin(area) {
    return area ? this.clockMin(area.L / 4 / WALK_MPS + 4) : 0;
  }

  /* ---------------------------------------------------------------- places */

  /**
   * The places a journey can start or end at: the buildings of the layout (with a use and an
   * entrance) and the stations beyond the layout.
   * @returns {Array<{kind: "building" | "station", id: string, name: string, use?: string}>}
   */
  places() {
    const out = [];
    for (const o of this.world.objects) {
      if (!o.geometry || typeof o.entrances !== "function" || typeof o.capacity !== "function" || !o.entrances().length) continue;
      const use = typeof o.use === "function" ? o.use() : o.constructor.use;
      out.push({ kind: "building", id: o.id, name: o.name, use: use || "other" });
    }
    for (const s of this.rail?.stations || []) if (!s.on_layout) out.push({ kind: "station", id: s.id, name: s.name });
    return out;
  }

  /** A place now: a building with its entrances ({pos, key, ref}), or a station beyond the layout; null if it is not there. */
  place(ref) {
    if (ref?.kind === "building") {
      const o = this.world.getObject(ref.id);
      const list = o?.geometry && typeof o.entrances === "function" ? o.entrances() : [];
      if (!list.length) return null;
      return {
        kind: "building", id: o.id, name: o.name,
        points: list.map((e, i) => ({ pos: e.pos, key: `building:${o.id}:${i}`, ref: { kind: "building", id: o.id, entrance: i }, name: o.name })),
      };
    }
    if (ref?.kind === "station") {
      const s = this.rail?.station(ref.id);
      return s && !s.on_layout ? { kind: "station", id: s.id, name: s.name } : null;
    }
    return null;
  }

  /** The access points of a stop area as walking places. */
  _areaPoints(area) {
    return area.access.map((e, i) => ({ pos: area.toLayout(e.s, e.t), key: `area:${area.id}:${i}`, ref: { kind: "area", id: area.id, access: i }, name: areaName(area) }));
  }

  /* ---------------------------------------------------------------- walking */

  /** The shortest walk between two sets of places: {from, to, m, min} (clock minutes), or null. */
  walk(fromPoints, toPoints) {
    const key = `${this.world.objectsVersion}:${this.world.map.version}:${this.world.scale}`;
    if (key !== this._walksKey) {
      this._walksKey = key;
      this._walks.clear();
    }
    let best = null;
    for (const a of fromPoints) {
      for (const b of toPoints) {
        const k = `${a.key}|${b.key}`;
        let mm = this._walks.get(k);
        if (mm == null) {
          mm = walkPath(this.world, a, b).length;
          this._walks.set(k, mm);
        }
        if (!best || mm < best.mm) best = { from: a, to: b, mm };
      }
    }
    if (!best) return null;
    const m = (best.mm * this.world.scale) / 1000;
    return { from: best.from, to: best.to, m, min: this.clockMin(m / WALK_MPS) };
  }

  _walkLeg(w, dep) {
    return { type: "walk", from: w.from.ref, to: w.to.ref, fromName: w.from.name, toName: w.to.name, m: Math.round(w.m), min: w.min, dep, arr: dep + w.min };
  }

  /* ---------------------------------------------------------------- buses */

  /** Stop areas served by bus lines. */
  _busAreas() {
    return this.world.stopAreas().filter((a) => a.kind === "bus" && a.docks.some((d) => d.managed));
  }

  /** Clock minutes between two buses of a line at a time (world), or null at night (no buses). */
  _headwayMin(line, t) {
    const c = this.world.clock;
    const demand = c.profiles ? profileAt(PROFILES.bus, ((t % DAY) + DAY) % DAY) : 1;
    return demand >= 0.05 ? this.clockMin(line.headway / demand) : null;
  }

  /** Clock minutes of a bus ride (a connection of `transit.connections`): driving, and per stop its dwell and the time lost. */
  _rideMin(line, c) {
    const visit = line.visits.find((v) => v.dockId === c.fromDockId);
    const dwell = Math.max(MIN_DWELL_S, visit?.dock.dwell ?? 20);
    return this.clockMin((c.rideMM * this.world.scale) / 1000 / (BUS_PACE * line.speed) + c.stops * (dwell + STOP_LOSS_S));
  }

  /** Index of the way into a stop area nearest to one of its docks (where its vehicles stop). */
  _dockAccess(area, dockId) {
    const dock = area.docks.find((d) => d.id === dockId);
    if (!dock) return 0;
    const s = (dock.s0 + dock.s1) / 2, t = (dock.side * area.W) / 2;
    let best = 0, bd = Infinity;
    area.access.forEach((e, i) => {
      const d = Math.hypot(e.s - s, e.t - t);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** The bus stops within walking distance of places: [{area, walk}] (walk from the places to the stop, or back with `back`). */
  _near(points, back = false) {
    const out = [];
    for (const area of this._busAreas()) {
      const pts = this._areaPoints(area);
      const w = back ? this.walk(pts, points) : this.walk(points, pts);
      if (w && w.m <= ACCESS_M) out.push({ area, walk: w });
    }
    return out;
  }

  /**
   * Bus journeys from places to places, leaving at `t`: the best per line, directly or with one
   * change of buses, as {legs, arr}.
   */
  _bus(fromPoints, toPoints, t) {
    const transit = this.world.transit;
    if (!transit?.connections) return [];
    transit.sync?.();
    const origins = this._near(fromPoints), dests = this._near(toPoints, true);
    if (!origins.length || !dests.length) return [];
    const out = [];
    const ride = (area, to, tAt) => {
      const list = [];
      for (const c of transit.connections(area.id, to.id)) {
        const line = transit.lines.get(c.lineId);
        const every = line && this._headwayMin(line, tAt);
        if (!every) continue;
        const wait = every / 2, min = this._rideMin(line, c);
        const visit = line.visits.find((v) => v.dockId === c.fromDockId);
        list.push({
          type: "bus", line: line.id, name: `Bus ${line.label}`, label: line.label, colour: line.color, towards: towards(visit?.destination, visit?.loop),
          fromArea: area.id, fromDock: c.fromDockId, fromName: areaName(area), toArea: to.id, toDock: c.toDockId, toName: areaName(to),
          every: Math.round(every), stops: c.stops, dep: tAt + wait, arr: tAt + wait + min, wait,
        });
      }
      return list;
    };
    for (const o of origins) {
      for (const d of dests) {
        if (o.area.owner === d.area.owner) continue;
        for (const c of transit.connections(o.area.id, d.area.id)) {
          // to the way in nearest the bay of the line (a terminal is long)
          const w = this.walk(fromPoints, [this._areaPoints(o.area)[this._dockAccess(o.area, c.fromDockId)]]) || o.walk;
          const bus = ride(o.area, d.area, t + w.min).find((b) => b.fromDock === c.fromDockId && b.toDock === c.toDockId);
          if (!bus) continue;
          const last = this._walkLeg(d.walk, bus.arr + this.alightMin(d.area));
          out.push({ legs: [this._walkLeg(w, t), bus, last], arr: last.arr });
        }
      }
    }
    if (out.length) return best(out, (p) => p.legs[1].line);
    // one change of buses: at a stop where another line goes on (also across the street)
    for (const o of origins) {
      const tStop = t + o.walk.min;
      for (const mid of this._busAreas()) {
        if (mid.owner === o.area.owner) continue;
        for (const first of ride(o.area, mid, tStop)) {
          for (const next of this._busAreas().filter((a) => a.owner === mid.owner)) {
            const change = next === mid ? null : this.walk(this._areaPoints(mid), this._areaPoints(next));
            const tNext = first.arr + this.alightMin(mid) + (change?.min ?? 0);
            for (const d of dests) {
              if (d.area.owner === mid.owner) continue;
              for (const second of ride(next, d.area, tNext)) {
                if (second.line === first.line) continue;
                const legs = [this._walkLeg(o.walk, t), first];
                if (change) legs.push(this._walkLeg(change, first.arr + this.alightMin(mid)));
                legs.push(second);
                const last = this._walkLeg(d.walk, second.arr + this.alightMin(d.area));
                legs.push(last);
                out.push({ legs, arr: last.arr });
              }
            }
          }
        }
      }
    }
    return best(out, (p) => p.legs.filter((l) => l.type === "bus").map((l) => l.line).join(">"));
  }

  /* ---------------------------------------------------------------- trains */

  /** The platforms (stop areas) of the stations on the layout: [{station, area}]. */
  _platforms() {
    const out = [];
    for (const s of this.rail?.stations || []) {
      if (!s.on_layout) continue;
      for (const area of this.world.stopAreas()) if (area.kind === "rail" && s.platforms.includes(area.owner?.id)) out.push({ station: s.id, area });
    }
    return out;
  }

  /** The stop area a trip uses at a station on the layout (the area of its line's first track there), or null. */
  _tripArea(trip, station) {
    const dock = this.rail?.line(trip.line)?.docks?.[station]?.[0];
    if (!dock) return null;
    return this.world.stopAreas().find((a) => a.docks.some((d) => d.id === dock)) ?? null;
  }

  /** Trips that leave a station between two times (planned), not cancelled, earliest first. */
  _departures(station, t0, t1) {
    const rail = this.rail, out = [];
    for (let d = Math.floor(t0 / DAY) - 1; d <= Math.floor(t1 / DAY); d++) {
      for (const trip of rail.trips(d)) {
        const dep = depAt(trip, station);
        if (dep != null && dep >= t0 && dep <= t1 && !trip.cancelled) out.push(trip);
      }
    }
    return out.sort((a, b) => depAt(a, station) - depAt(b, station));
  }

  _trainLeg(trip, from, to) {
    const rail = this.rail, name = (id) => rail.station(id)?.name ?? id;
    const leg = {
      type: "train", line: trip.line, name: trip.name, trip: trip.key, day: trip.day, from, to, fromName: name(from), toName: name(to),
      towards: name(trip.to), dep: depAt(trip, from), arr: arrAt(trip, to),
    };
    for (const [k, station] of [["area", from], ["toArea", to]]) {
      const area = rail.station(station)?.on_layout ? this._tripArea(trip, station) : null;
      if (area) {
        leg[k] = area.id;
        leg[k === "area" ? "platform" : "toPlatform"] = area.owner?.name ?? area.id;
      }
    }
    return leg;
  }

  /** Ways from a building to the platforms of the stations on the layout: [{station, area, t, legs}]. */
  _access(place, t) {
    const out = [];
    for (const { station, area } of this._platforms()) {
      const pts = this._areaPoints(area);
      const w = this.walk(place.points, pts);
      if (!w) continue;
      out.push({ station, area: area.id, t: t + w.min, legs: [this._walkLeg(w, t)] });
      for (const p of this._bus(place.points, pts, t)) if (p.arr < t + w.min) out.push({ station, area: area.id, t: p.arr, legs: p.legs });
    }
    return out;
  }

  /** Ways from the platforms of the stations on the layout to a building: [{station, area, build(t) -> {legs, arr}}]. */
  _egress(place) {
    const out = [];
    for (const { station, area } of this._platforms()) {
      const pts = this._areaPoints(area);
      const w = this.walk(pts, place.points);
      if (!w) continue;
      out.push({ station, area: area.id, build: (t0) => {
        const leg = this._walkLeg(w, t0);
        return { legs: [leg], arr: leg.arr };
      } });
      out.push({ station, area: area.id, bus: true, build: (t0) => {
        const p = this._bus(pts, place.points, t0)[0];
        return p && p.arr < t0 + w.min ? p : null;
      } });
    }
    return out;
  }

  /** Train journeys between two places (buildings or stations), with at most one change of trains. */
  _trains(A, B, t, transfer) {
    const rail = this.rail;
    if (!rail?.stations.length) return [];
    const starts = A.kind === "station" ? [{ station: A.id, area: null, t, legs: [] }] : this._access(A, t);
    const ends = B.kind === "station" ? [{ station: B.id, area: null, build: (t0) => ({ legs: [], arr: t0 }) }] : this._egress(B);
    const endStations = new Set(ends.map((e) => e.station));
    const out = [];
    const finish = (head, trip, from, e) => {
      const arr = arrAt(trip, e.station);
      const tail = e.build(arr + (e.area ? this.alightMin(this._tripArea(trip, e.station)) : 0));
      if (tail) out.push({ legs: [...head, this._trainLeg(trip, from, e.station), ...tail.legs], arr: tail.arr });
    };
    const onArea = (trip, station, area) => !area || this._tripArea(trip, station)?.id === area;
    for (const s of starts) {
      const ready = s.legs.length ? s.t + transfer : s.t;
      const count = new Map();
      for (const trip of this._departures(s.station, ready, ready + HORIZON_MIN)) {
        if (!onArea(trip, s.station, s.area)) continue;
        if ((count.get(trip.line) || 0) >= PER_LINE) continue;
        count.set(trip.line, (count.get(trip.line) || 0) + 1);
        // straight there
        for (const e of ends) if (reaches(trip, s.station, e.station) && onArea(trip, e.station, e.area)) finish(s.legs, trip, s.station, e);
        // or with one change of trains
        const i0 = stopIndex(trip, s.station);
        for (let i = i0 + 1; i < trip.stops.length; i++) {
          const h = trip.stops[i].station, arr = trip.stops[i].arr;
          if (arr == null || endStations.has(h)) continue;
          const here = rail.station(h)?.on_layout;
          const a1 = here ? this._tripArea(trip, h) : null;
          const seen = new Set([trip.line]);
          for (const next of this._departures(h, arr, arr + HORIZON_MIN / 2)) {
            if (seen.has(next.line)) continue;
            const e = ends.find((x) => reaches(next, h, x.station) && onArea(next, x.station, x.area));
            if (!e) continue;
            const a2 = here ? this._tripArea(next, h) : null;
            const change = a1 && a2 && a1 !== a2 ? this.walk(this._areaPoints(a1), this._areaPoints(a2)) : null;
            const dep = depAt(next, h), off = this.alightMin(a1);
            if (dep < arr + off + (change?.min ?? 0) + transfer) continue;
            seen.add(next.line);
            const head = [...s.legs, this._trainLeg(trip, s.station, h)];
            if (change) head.push(this._walkLeg(change, arr + off));
            for (const x of ends) if (reaches(next, h, x.station) && onArea(next, x.station, x.area)) finish(head, next, h, x);
          }
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- plans */

  /**
   * Travel plans from a place to another one, leaving at a time.
   * @param {{from: {kind: string, id: string}, to: {kind: string, id: string}, leave: number, transfer?: number}} request
   *   `leave`: world time (clock minutes since 00:00 of day 0); `transfer`: the least clock minutes
   *   between getting to a platform or off a train and the next train
   * @returns {object[]} plans {legs, dep, arr, transfers, walk, wait, pattern, signature}, the best first
   */
  plan({ from, to, leave, transfer = 3 }) {
    const A = this.place(from), B = this.place(to);
    if (!A || !B || (A.kind === B.kind && A.id === B.id)) return [];
    const found = [];
    if (A.kind === "building" && B.kind === "building") {
      const w = this.walk(A.points, B.points);
      if (w) found.push({ legs: [this._walkLeg(w, leave)], arr: leave + w.min });
      found.push(...this._bus(A.points, B.points, leave));
    }
    found.push(...this._trains(A, B, leave, Math.max(0, Number(transfer) || 0)));
    return choose(found.map((p) => finishPlan(p, leave)));
  }
}

/** The best plan per key (earliest arrival). */
function best(plans, keyOf) {
  const out = new Map();
  for (const p of plans) {
    const k = keyOf(p), b = out.get(k);
    if (!b || p.arr < b.arr) out.set(k, p);
  }
  return [...out.values()].sort((a, b) => a.arr - b.arr);
}

/** A plan with its figures: transfers, walking and waiting minutes, the way it goes. */
function finishPlan(p, leave) {
  const rides = p.legs.filter((l) => l.type !== "walk");
  let walk = 0, wait = 0, t = leave;
  for (const l of p.legs) {
    if (l.type === "walk") walk += l.min;
    else wait += Math.max(0, l.dep - t);
    t = l.arr;
  }
  return {
    legs: p.legs, dep: leave, arr: p.arr, transfers: Math.max(0, rides.length - 1), walk, wait,
    pattern: p.legs.map((l) => (l.type === "walk" ? "walk" : `${l.type}:${l.line}`)).join("|"),
    signature: p.legs.map((l) => (l.type === "walk" ? `walk:${l.to?.id}` : l.type === "bus" ? `bus:${l.line}:${l.fromDock}:${l.toDock}` : `train:${l.day}:${l.trip}:${l.from}:${l.to}`)).join("|"),
  };
}

/** The plans to offer: earliest arrival first, each way at most twice (its next departures), no doubles. */
function choose(plans) {
  const seen = new Set(), per = new Map(), out = [];
  plans.sort((a, b) => a.arr - b.arr || a.transfers - b.transfers || a.walk - b.walk);
  for (const p of plans) {
    if (!Number.isFinite(p.arr) || seen.has(p.signature)) continue;
    seen.add(p.signature);
    const n = per.get(p.pattern) || 0;
    if (n >= PER_LINE) continue;
    per.set(p.pattern, n + 1);
    out.push(p);
    if (out.length >= MAX_PLANS) break;
  }
  return out;
}
