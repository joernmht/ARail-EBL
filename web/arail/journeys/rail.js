/**
 * The trains of the journeys: the timetable of the rail network (stations on and beyond the layout,
 * lines with their headways) and the trains at the platforms of the stations on the layout.
 *
 * Two sources give the same trip records, so that planning and travelling do not care which one runs:
 * - {@link TimetableRail}: the journeys' own timetable, from the `stations` and `lines` of the
 *   journeys entry (the format of the rail operations, see docs/operations.md), or the network made
 *   from the line names of the platforms. It runs the trains at the platforms (their docks are in
 *   mode "plan", as with the rail operations): a train comes in a few minutes before it leaves and
 *   waits for its departure and for the people still getting on; a train that ends here turns round
 *   for its next trip or goes to the sidings after the passengers got off. Disruptions at the
 *   platforms hold trains (they leave or come in late) or cancel them.
 * - {@link OperationsRail}: the trips of the rail operations (ops/) when they run the trains, with
 *   their delays and cancellations (sick drivers, failed units, ...).
 *
 * Times are **world times**: clock minutes since 00:00 of the world's day 0
 * (`clock.day * 1440 + clock.minutes`). A trip record is
 * `{id, key, day, line, name, dir, from, to, stops: [{station, arr, dep}], dep, arr, delay, cancelled}`
 * with the planned times and the delay known so far (minutes).
 * @module arail/journeys/rail
 */
import { normalizeOps } from "../ops/config.js";
import { tripTemplates } from "../ops/timetable.js";
import { DAY, hhmm } from "../ops/util.js";

/** Clock minutes before its departure a train out of the sidings is at the platform (at least)... */
const LEAD_MIN = 4;
/** ...and simulated seconds (at a fast clock four minutes go by quickly). */
const LEAD_S = 20;
/** Clock minutes a train that ends here stands at the platform while the passengers get off. */
const ALIGHT_MIN = 3;
/** Longest wait (clock minutes) of a train at the platform for its next trip; longer, it goes to the sidings. */
const STAY_MAX_MIN = 20;
/** Simulated seconds a train waits after its departure time for people still getting on. */
const BOARDING_WAIT_S = 30;
/** Clock minutes after which a call that was not made (held long) is skipped. */
const STALE_MIN = 60;

/** World time of the world's clock (clock minutes since 00:00 of day 0). */
export function worldNow(world) {
  return world.clock.day * DAY + world.clock.minutes;
}

/** Index of a station in a trip's stops, or -1. */
export function stopIndex(trip, station) {
  return trip ? trip.stops.findIndex((s) => s.station === station) : -1;
}

/** Does a trip call at `from` and later at `to`? */
export function reaches(trip, from, to) {
  const i = stopIndex(trip, from);
  return i >= 0 && trip.stops.slice(i + 1).some((s) => s.station === to);
}

/** Departure of a trip from a station (planned, world time), or null. */
export function depAt(trip, station) {
  return trip.stops[stopIndex(trip, station)]?.dep ?? null;
}

/** Arrival of a trip at a station (planned, world time), or null. */
export function arrAt(trip, station) {
  return trip.stops[stopIndex(trip, station)]?.arr ?? null;
}

/** "S 8", "s8" and "S 8 → Waldau 07:41" name the same line. */
export function sameLine(text, name) {
  const a = String(text ?? "").replace(/\s+/g, "").toLowerCase(), b = String(name ?? "").replace(/\s+/g, "").toLowerCase();
  if (!a || !b || !a.startsWith(b)) return false;
  return a.length === b.length || !/[a-z0-9]/.test(a[b.length]);
}

/** The network part of a journeys entry, for normalizeOps. */
function networkOf(cfg) {
  const out = {};
  for (const k of ["stations", "lines", "start_weekday"]) if (cfg?.[k] != null) out[k] = cfg[k];
  return out;
}

/** The trips of the journeys' own timetable; the journeys run them at the platforms. */
export class TimetableRail {
  /** @param {object} sim the journeys simulation */
  constructor(sim) {
    this.sim = sim;
    this.world = sim.world;
    this.kind = "timetable";
    /** Normalized network (normalizeOps). */
    this.model = null;
    this._key = null;
    /** @type {Map<number, object[]>} world day -> its trips */
    this.days = new Map();
    /** @type {Map<string, object>} trip id -> trip */
    this.byId = new Map();
    /** Trains at the platforms: dock id -> {vehicle, dock, station, arrived, next, leave, due} */
    this.visits = new Map();
    /** Arrivals and departures dealt with: "a|<trip>|<station>", "d|<trip>|<station>". */
    this._done = new Set();
    /** Trips that have a train for their departure: trip id -> dock id. */
    this._assigned = new Map();
    /** World time the trains started running (after loading, a clock jump): earlier arrivals and departures are left out. */
    this._since = null;
  }

  /** It runs the trains at the platforms itself. */
  get runsTrains() {
    return true;
  }

  /** Build the network anew when the journeys entry or the platforms changed. */
  ensure() {
    const cfg = this.sim.config, version = this.world.objectsVersion;
    if (this.model && this._version === version && this._cfg === cfg) return this.model;
    this._version = version;
    this._cfg = cfg;
    const layout = this.sim.layout();
    const platforms = layout.objects.filter((o) => o?.type === "platform").map((o) => [o.id, o.sides ?? "both", o.lines ?? ""]);
    const key = JSON.stringify([networkOf(cfg), platforms]);
    if (this.model && key === this._key) return this.model;
    this._key = key;
    this.model = normalizeOps(networkOf(cfg), layout);
    this.reset();
    return this.model;
  }

  /** Forget all trips; the trains at the platforms leave. */
  reset() {
    for (const visit of this.visits.values()) visit.vehicle.dwellLeft = 0;
    this.visits.clear();
    this.days.clear();
    this.byId.clear();
    this._done.clear();
    this._assigned.clear();
    this._since = null;
  }

  get stations() {
    return this.ensure().stations;
  }

  get lines() {
    return this.ensure().lines;
  }

  station(id) {
    return this.stations.find((s) => s.id === id) ?? null;
  }

  line(id) {
    return this.lines.find((l) => l.id === id) ?? null;
  }

  /** Weekday (0 = Monday) of a world day. */
  weekday(day) {
    return (((this.ensure().start_weekday + day) % 7) + 7) % 7;
  }

  /** The trips of a world day (made when first asked for). */
  trips(day) {
    const model = this.ensure();
    let list = this.days.get(day);
    if (list) return list;
    const base = day * DAY;
    list = tripTemplates(model, this.weekday(day)).map((t) => {
      const trip = {
        id: `${day}:${t.key}`, key: t.key, day, line: t.line, name: this.line(t.line)?.name ?? t.line, dir: t.dir, from: t.from, to: t.to,
        stops: t.stops.map((s) => ({ station: s.station, arr: s.arr == null ? null : base + s.arr, dep: s.dep == null ? null : base + s.dep })),
        dep: base + t.dep, arr: base + t.arr, delay: 0, cancelled: false, departed: null,
      };
      this.byId.set(trip.id, trip);
      return trip;
    });
    this.days.set(day, list);
    // days long gone are forgotten
    const today = Math.floor(worldNow(this.world) / DAY);
    for (const [d, old] of this.days) {
      if (d >= today - 3) continue;
      for (const t of old) this.byId.delete(t.id);
      this.days.delete(d);
    }
    return list;
  }

  /** A trip of a world day by its key ("S 8:out:6"), or null. */
  find(day, key) {
    return this.trips(day).find((t) => t.key === key) ?? null;
  }

  /** A trip by its id, or null. */
  trip(id) {
    if (!id) return null;
    if (!this.byId.has(id)) {
      const day = Number.parseInt(id, 10);
      if (Number.isInteger(day)) this.trips(day);
    }
    return this.byId.get(id) ?? null;
  }

  /** The trip a train at a platform leaves with (null: it ends here or is not one of these trains). */
  tripOf(vehicle) {
    return vehicle?.journeys?.next ?? null;
  }

  /** The trip a train at a platform came with (null: it came out of the sidings). */
  arrivedTripOf(vehicle) {
    return vehicle?.journeys?.arrived ?? null;
  }

  /** Expected time (world) of a trip at a station: the planned time plus the delay so far. */
  expected(trip, station, kind = "arr") {
    const s = trip.stops[stopIndex(trip, station)];
    const t = s ? (kind === "dep" ? s.dep ?? s.arr : s.arr ?? s.dep) : null;
    return t == null ? null : t + (trip.delay || 0);
  }

  /** Has the trip left a station (or is it past it)? */
  departedFrom(trip, station, now) {
    if (trip.cancelled) return false;
    const st = this.station(station);
    if (st?.on_layout) return trip.departed != null && trip.departedAt === station;
    return now >= (this.expected(trip, station, "dep") ?? Infinity);
  }

  /* ---------------------------------------------------------------- the trains at the platforms */

  /** The rail docks this timetable runs (with the journeys as the services' planner). */
  claims(dock) {
    const owner = dock.area.owner?.id;
    return this.stations.some((s) => s.on_layout && s.platforms.includes(owner));
  }

  /** Clock minutes of the arrival animation. */
  _approachMin() {
    return (this.world.layout.services.approach_s * this.world.clock.factor) / 60;
  }

  /** Clock minutes before its departure a train out of the sidings comes in. */
  _leadMin() {
    return Math.max(LEAD_MIN, (LEAD_S * this.world.clock.factor) / 60);
  }

  /** Merged effects of the world's disruptions at a station's platforms. */
  _fx(station) {
    const fx = { hold: false, cancel: false, closed: false };
    for (const area of this.world.stopAreas()) {
      if (!station.platforms.includes(area.owner?.id)) continue;
      const e = this.world.disruptions.effectsFor(area);
      fx.hold ||= e.hold;
      fx.cancel ||= e.cancel;
      fx.closed ||= e.closed;
    }
    return fx;
  }

  /** Run the trains at the platforms (once per simulation step). */
  step() {
    const model = this.ensure();
    const here = model.stations.filter((s) => s.on_layout && s.docks.length);
    if (!here.length) return;
    const now = worldNow(this.world), today = Math.floor(now / DAY);
    // what was due before the trains started running is not made up for
    this._since ??= now;
    const since = this._since;
    const trips = [...this.trips(today - 1), ...this.trips(today), ...this.trips(today + 1)];
    const fx = new Map(here.map((s) => [s.id, this._fx(s)]));
    const approach = this._approachMin(), lead = this._leadMin();
    // trains coming in (from beyond the layout, or through), in the order they arrive
    const due = [];
    for (const trip of trips) {
      if (trip.cancelled) continue;
      for (const stop of trip.stops) {
        if (stop.arr == null || !fx.has(stop.station)) continue;
        const key = `a|${trip.id}|${stop.station}`;
        if (this._done.has(key) || now < stop.arr + trip.delay - approach) continue;
        if (now > stop.arr + trip.delay + STALE_MIN || stop.arr + trip.delay < since) this._done.add(key);
        else due.push({ trip, stop, key });
      }
    }
    due.sort((a, b) => a.stop.arr + a.trip.delay - (b.stop.arr + b.trip.delay));
    for (const { trip, stop, key } of due) {
      if (trip.cancelled) continue;
      const f = fx.get(stop.station);
      if (f.cancel || f.closed) {
        this._done.add(key);
        this._cancel(trip, stop.station, now);
        continue;
      }
      const dock = f.hold ? null : this._freeDock(trip, stop.station);
      if (!dock) {
        // held before the station (or no free track): it comes in late
        trip.delay = Math.max(trip.delay, now + approach - stop.arr);
        continue;
      }
      this._done.add(key);
      this._call(dock, stop.station, trip, stop.dep != null ? trip : this._turnaround(trip, stop, now), now);
    }
    // trains out of the sidings for the trips that start here
    for (const trip of trips) {
      const stop = trip.stops[0];
      if (trip.cancelled || this._assigned.has(trip.id) || !fx.has(stop.station)) continue;
      const key = `d|${trip.id}|${stop.station}`;
      if (this._done.has(key) || now < stop.dep - lead) continue;
      if (now > stop.dep + STALE_MIN || stop.dep < since) {
        this._done.add(key);
        continue;
      }
      const f = fx.get(stop.station);
      if (f.cancel || f.closed) {
        this._done.add(key);
        this._cancel(trip, stop.station, now);
        continue;
      }
      if (f.hold) continue; // it comes in when the hold ends, and leaves late
      const dock = this._freeDock(trip, stop.station);
      if (!dock) continue;
      this._done.add(key);
      this._call(dock, stop.station, null, trip, now);
    }
    for (const visit of [...this.visits.values()]) this._stepVisit(visit, now, fx.get(visit.station));
    if (this._done.size > 5000) this._done.clear();
  }

  /** The next trip of a train that ends at a station: the line's next departure from there, soon enough. */
  _turnaround(trip, stop, now) {
    const turn = this.line(trip.line)?.turn_min ?? 6;
    let best = null;
    for (const d of [trip.day, trip.day + 1]) {
      for (const t of this.trips(d)) {
        const first = t.stops[0];
        if (t.line !== trip.line || t.cancelled || this._assigned.has(t.id) || first.station !== stop.station) continue;
        if (first.dep < stop.arr + turn || first.dep > stop.arr + STAY_MAX_MIN || now > first.dep + 10) continue;
        if (!best || first.dep < best.stops[0].dep) best = t;
      }
    }
    return best;
  }

  /** A free track of the line at a station (in mode "plan"), the line's own first. */
  _freeDock(trip, station) {
    const services = this.world.services;
    const own = this.line(trip.line)?.docks[station] || [], all = this.station(station)?.docks || [];
    for (const id of [...own, ...all]) {
      const st = services.docks.get(id);
      if (st && st.mode === "plan" && !st.vehicle && !this.visits.has(id)) return id;
    }
    return null;
  }

  /** Call a train to a dock: it came with `arrived` (or out of the sidings) and leaves with `next` (or not in service). */
  _call(dockId, station, arrived, next, now) {
    const v = this.world.services.call(dockId, { source: "plan", line: (next || arrived).name });
    if (!v) return null;
    v.dwellLeft = Infinity;
    const visit = { vehicle: v, dock: dockId, station, arrived, next, leave: null, due: null };
    if (next) this._assigned.set(next.id, dockId);
    else visit.leave = now + this._approachMin() + ALIGHT_MIN;
    v.journeys = visit;
    this.visits.set(dockId, visit);
    this._label(visit);
    return visit;
  }

  /** The text on a train: where it goes and when (or where it came from), and its delay. */
  _label(visit) {
    const v = visit.vehicle, name = (id) => this.station(id)?.name ?? id;
    const t = visit.next || visit.arrived;
    if (visit.next) v.line = `${t.name} → ${name(t.to)} ${hhmm(depAt(t, visit.station))}`;
    else if (visit.arrived) v.line = `${t.name} from ${name(t.from)}`;
    const d = Math.round(t?.delay || 0);
    v.info = d >= 1 ? [`+${d} min`] : [];
  }

  /** A train at a platform leaves at its time, when nobody is getting on any more (not while held). */
  _stepVisit(visit, now, fx) {
    const st = this.world.services.docks.get(visit.dock), v = visit.vehicle;
    if (!st || st.vehicle !== v) {
      this.visits.delete(visit.dock);
      if (visit.next) this._assigned.delete(visit.next.id);
      return;
    }
    if (v.phase !== "dwelling") return;
    const next = visit.next;
    if (next?.cancelled) {
      visit.next = null;
      this._assigned.delete(next.id);
      visit.leave = now + 2;
      this._label(visit);
    }
    if (visit.next) {
      const dep = depAt(next, visit.station);
      if (now < dep) return;
      if (fx?.cancel || fx?.closed) return this._cancel(next, visit.station, now);
      if (fx?.hold) {
        next.delay = Math.max(next.delay, now - dep);
        this._label(visit);
        return;
      }
      // the doors close when nobody is getting on any more (a few seconds at most)
      visit.due ??= this.world.time;
      if (this._boarding(v) && this.world.time - visit.due < BOARDING_WAIT_S) return;
      next.delay = Math.max(next.delay, now - dep);
      next.departed = now;
      next.departedAt = visit.station;
      this._label(visit);
      v.dwellLeft = 0;
      this.visits.delete(visit.dock);
      return;
    }
    if (visit.leave != null && now >= visit.leave) {
      v.line = "Not in service";
      v.info = [];
      v.dwellLeft = 0;
      this.visits.delete(visit.dock);
    }
  }

  /** Is anybody getting on this train? */
  _boarding(v) {
    const crowd = this.sim.passengers?.crowds?.get(v.dock.area.id);
    return !!crowd?.people.some((p) => p.state === "boarding" && p.vehicle === v);
  }

  /** A trip is cancelled (at a station on the layout); the people waiting hear of it. */
  _cancel(trip, station, now) {
    if (trip.cancelled) return;
    trip.cancelled = true;
    trip.cancelledAt = now;
    for (const visit of this.visits.values()) {
      if (visit.next !== trip) continue;
      visit.next = null;
      visit.leave = now + 2;
      this._label(visit);
    }
    this._assigned.delete(trip.id);
    const dockId = this.line(trip.line)?.docks[station]?.[0];
    const st = dockId ? this.world.services.docks.get(dockId) : null;
    if (st) this.world.events.emit("vehicle.cancelled", { vehicle: { id: `journeys:${trip.id}`, line: trip.name, kind: "train", dock: st.dock, source: "plan" }, dock: st.dock, area: st.dock.area });
  }

  /**
   * Board lines of a stop area of a station on the layout: the next departures from it
   * ("S 8 → Waldau 07:41 +2", "RE 1 07:15 cancelled").
   */
  statusLines(area) {
    const station = this.stations.find((s) => s.on_layout && s.platforms.includes(area.owner?.id));
    if (!station) return [];
    const now = worldNow(this.world), today = Math.floor(now / DAY);
    const docks = new Set(area.docks.map((d) => d.id));
    const list = [];
    for (const d of [today - 1, today, today + 1]) {
      for (const trip of this.trips(d)) {
        const dep = depAt(trip, station.id);
        if (dep == null || trip.departed != null || dep + trip.delay < now - 1 || dep > now + 120) continue;
        if (!this.line(trip.line)?.docks[station.id]?.some((x) => docks.has(x))) continue;
        if (trip.cancelled && now - trip.cancelledAt > 30) continue;
        list.push(trip);
      }
    }
    list.sort((a, b) => depAt(a, station.id) - depAt(b, station.id));
    return list.slice(0, 2).map((trip) => {
      const dep = depAt(trip, station.id);
      if (trip.cancelled) return `${trip.name} ${hhmm(dep)} cancelled`;
      const late = Math.round(trip.delay);
      return `${trip.name} → ${this.station(trip.to)?.name ?? trip.to} ${hhmm(dep)}${late >= 1 ? ` +${late}` : ""}`;
    });
  }
}

/**
 * The trips of the rail operations (`opsOf(world)`), as trip records in world time. The rail
 * operations run the trains at the platforms; this only reads their trips.
 */
export class OperationsRail {
  /**
   * @param {object} sim the journeys simulation
   * @param {object} ops the operations simulation
   */
  constructor(sim, ops) {
    this.sim = sim;
    this.world = sim.world;
    this.ops = ops;
    this.kind = "operations";
    /** @type {WeakMap<object, object>} engine trip -> its record */
    this._views = new WeakMap();
  }

  get runsTrains() {
    return true;
  }

  get engine() {
    return this.ops.engine;
  }

  /** Has the engine started (it is built in the first step of the rail operations)? */
  get ready() {
    return !!this.ops.engine;
  }

  ensure() {
    return this.engine?.model ?? null;
  }

  get stations() {
    return this.engine?.model.stations ?? [];
  }

  get lines() {
    return this.engine?.model.lines ?? [];
  }

  station(id) {
    return this.engine?.stations.get(id) ?? null;
  }

  line(id) {
    return this.engine?.lines.get(id) ?? null;
  }

  /** Minutes the engine's clock is ahead of the world's. */
  _offset() {
    return this.ops.engineOffset?.() ?? 0;
  }

  /** A trip record (world time) of an engine trip (`real`: one the engine runs, not a planned one). */
  _view(t, day = null, real = true) {
    const off = this._offset();
    let v = real ? this._views.get(t) : null;
    if (!v || v.offset !== off) {
      v = {
        id: t.id, key: t.key, day: day ?? Math.floor((t.dep - off) / DAY), line: t.line, name: t.lineName ?? this.line(t.line)?.name ?? t.line,
        dir: t.dir, from: t.from, to: t.to, dep: t.dep - off, arr: t.arr - off,
        stops: t.stops.map((s) => ({ station: s.station, arr: s.arr == null ? null : s.arr - off, dep: s.dep == null ? null : s.dep - off })),
        offset: off,
      };
      if (real) this._views.set(t, v);
    }
    const e = this.engine, now = e ? e.now : 0;
    v.cancelled = t.state === "cancelled" || t.state === "terminated";
    v.departed = t.depA != null ? t.depA - off : null;
    const end = t.arrA ?? t.arrE;
    v.delay = Math.max(0, end != null ? end - t.arr : t.depA != null ? t.depA - t.dep : t.state === "waiting" ? now - t.dep : 0);
    return v;
  }

  /** The trips of a world day. */
  trips(day) {
    const e = this.engine;
    if (!e) return [];
    const ed = day + this._offset() / DAY;
    const real = e.days.get(ed)?.trips;
    if (real) return real.map((t) => this._view(t, day));
    // a day the engine has not made yet: its planned trips
    const base = ed * DAY;
    return e.templates(ed).trips.map((t) => this._view({
      ...t, id: `${ed}:${t.key}`, lineName: e.lines.get(t.line)?.name ?? t.line, dep: base + t.dep, arr: base + t.arr, state: "planned",
      stops: t.stops.map((s) => ({ station: s.station, arr: s.arr == null ? null : base + s.arr, dep: s.dep == null ? null : base + s.dep })),
    }, day, false));
  }

  find(day, key) {
    const e = this.engine;
    const real = e?.trips.get(`${day + this._offset() / DAY}:${key}`);
    if (real) return this._view(real, day);
    return this.trips(day).find((t) => t.key === key) ?? null;
  }

  trip(id) {
    const real = id ? this.engine?.trips.get(id) : null;
    return real ? this._view(real) : null;
  }

  tripOf(vehicle) {
    const t = this.ops.tripsAt?.(vehicle?.dock?.id)?.next;
    return t ? this._view(t) : null;
  }

  arrivedTripOf(vehicle) {
    const t = this.ops.tripsAt?.(vehicle?.dock?.id)?.arrived;
    return t ? this._view(t) : null;
  }

  expected(trip, station, kind = "arr") {
    const s = trip.stops[stopIndex(trip, station)];
    const t = s ? (kind === "dep" ? s.dep ?? s.arr : s.arr ?? s.dep) : null;
    return t == null ? null : t + (trip.delay || 0);
  }

  departedFrom(trip, station, now) {
    if (trip.cancelled) return false;
    if (trip.from === station) return trip.departed != null;
    return now >= (this.expected(trip, station, "dep") ?? Infinity);
  }

  claims() {
    return false;
  }

  step() {}

  statusLines() {
    return [];
  }
}
