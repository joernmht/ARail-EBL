/**
 * Rail operations in the world (`{"type": "operations", …}` in the layout's `simulations`): the
 * engine (engine.js) runs with the world's fast clock, and what it does is shown on the layout:
 *
 * - its trains at the platforms of the stations on the layout (the docks of those platforms are
 *   in mode "plan": the built-in timetable leaves them alone), with their units, driver and delay
 *   on the label, and cancelled trains on the boards;
 * - the crews that live in the town's houses walk to the crew base (the depot's door) and home
 *   again; those who live beyond the layout come in by train and walk from the platform;
 * - the depot (depot.js) with the units in its workshop and on its stabling tracks;
 * - the world's disruptions at the platforms hold or cancel its trains.
 *
 * Runtime state stays out of the layout: `toJSON()` returns the settings.
 * @module arail/ops/simulation
 */
import { Simulation } from "../core/simulation.js";
import { CD } from "../core/colors.js";
import { polylineAt, polylineLengths } from "../core/math.js";
import { drawPerson } from "../sims/passengers.js";
import { OpsEngine, causeWord, jobWord } from "./engine.js";
import { autoNetwork, normalizeOps, validateOps } from "./config.js";
import { shortName } from "./crew.js";
import { DAY, durationLabel, hhmm } from "./util.js";

/** Colours of crew members walking: a yellow high-visibility vest over dark blue trousers. */
export const CREW_COLOURS = { body: CD.gelb, legs: CD.dunkelblau };
/** Clock minutes before its departure a train that comes out of the depot is at the platform. */
const AT_PLATFORM_MIN = 4;
/** Clock minutes a train that goes to the depot stands at the platform after it arrived. */
const ALIGHT_MIN = 3;
/** Walking speed of crews (m/s). */
const WALK_MPS = 1.4;

export class OperationsSimulation extends Simulation {
  static type = "operations";
  static label = "Rail operations (fleet and crews)";
  static description = "Units with maintenance and failures, the workshop and its contracts (ECM), crews with duties and rosters; trains at the platforms of the layout.";
  static params = [];

  /**
   * Problems of an operations entry (validateLayout prefixes them).
   * @param {object} cfg the entry as written in the file
   * @param {object} layout the normalized layout
   */
  static validate(cfg, layout) {
    return validateOps(cfg, layout);
  }

  constructor(world, config = {}) {
    super(world, config);
    /** @type {OpsEngine | null} */
    this.engine = null;
    /** Trains at platform docks: dock id -> {vehicle, units, trip, leave} */
    this.visits = new Map();
    /** Crew members walking on the layout. */
    this.walkers = [];
    /** Days the engine is ahead of the world's clock (when the clock was set back). */
    this._dayShift = 0;
    this._quiet = false;
    this._called = new Set();
    this._key = null;
    this._platforms = new Set();
    this._offs = [
      world.events.on("clock.set", () => this._clockJump()),
      world.events.on("object.removed", () => (this._dirty = true)),
      world.events.on("object.added", () => (this._dirty = true)),
      world.events.on("object.changed", () => (this._dirty = true)),
    ];
    this._dirty = true;
    world.services.planner = this;
    this._updatePlatforms();
  }

  get name() {
    return this.config.name || "Rail operations";
  }

  dispose() {
    this._offs.forEach((off) => off());
    if (this.world.services.planner === this) {
      this.world.services.planner = null;
      this.world.services.refreshModes();
    }
  }

  /** The layout as it is now (objects edited since it was loaded). */
  _layout() {
    return { ...this.world.layout, objects: this.world.objects.map((o) => o.spec) };
  }

  /** Platforms whose trains this simulation runs. */
  _updatePlatforms() {
    const cfg = this.config;
    const stations = Array.isArray(cfg.stations) ? cfg.stations : autoNetwork(this._layout()).stations;
    this._platforms = new Set(stations.flatMap((s) => (Array.isArray(s.platforms) ? s.platforms : [])));
    this.world.services.refreshModes();
  }

  /** ServiceManager planner: the rail docks of the stations on the layout are run by this simulation. */
  claims(dock) {
    return this.enabled && this._platforms.has(dock.area.owner?.id);
  }

  /* ---------------------------------------------------------------- the engine */

  /** Build the engine anew when what it depends on changed (stations, lines, homes of the crews). */
  _ensure() {
    if (!this._dirty && this.engine) return;
    this._dirty = false;
    const layout = this._layout();
    const model = normalizeOps(this.config, layout);
    const key = JSON.stringify([model.stations, model.lines.map((l) => [l.id, l.route, l.docks, l.first, l.last, l.takt_min]), this.config]);
    if (this.engine && key === this._key) return;
    this._key = key;
    this._updatePlatforms();
    this._build(layout);
  }

  _build(layout) {
    this._clearVisits();
    this.walkers = [];
    const base = this._baseDoor();
    const homes = base ? this._homes(base) : [];
    this.engine = new OpsEngine(this.config, {
      layout, seed: this.world.seed, live: false, homes,
      hooks: { stationEffects: (s) => this._stationFx(s), event: (name, payload) => this._event(name, payload) },
    });
    this._dayShift = 0;
    // the days before the clock's time run without walkers; from now on crews walk to work on the layout
    this._quiet = true;
    this.engine.runTo(this._engineTime());
    this._quiet = false;
    this.engine.live = true;
    this.engine.measureFrom = this.engine.dayOffset;
    this.version = (this.version || 0) + 1;
  }

  /** Engine time of the world's clock. */
  _engineTime() {
    const c = this.world.clock;
    return (this.engine.dayOffset + c.day + this._dayShift) * DAY + c.minutes;
  }

  /** The world's clock was set: the engine runs on to that time (to tomorrow's if it was set back). */
  _clockJump() {
    if (!this.engine) return;
    let t = this._engineTime();
    while (t < this.engine.now - 1) {
      this._dayShift++;
      t = this._engineTime();
    }
    this._quiet = true;
    this.engine.runTo(t);
    this._quiet = false;
    this._clearVisits();
    this.walkers = [];
  }

  step(dt) {
    if (!this.enabled) return;
    this._ensure();
    const e = this.engine;
    if (!e) return;
    let t = this._engineTime();
    if (t < e.now - 1) return this._clockJump();
    // a long step (the clock was fast-forwarded): what happened in between is not shown
    if (t - e.now > 30) return this._clockJump();
    e.runTo(t);
    this._stepVisits();
    this._stepWalkers(dt);
  }

  /** Forward the engine's events to the world (`ops.*`) and show them on the layout. */
  _event(name, payload) {
    if (this._quiet) return;
    this.world.events.emit(`ops.${name}`, { simulation: this, ...payload });
    if (name === "trip.departed") this._departed(payload.trip);
    else if (name === "trip.arrived") this._arrived(payload.trip);
    else if (name === "trip.cancelled") this._cancelled(payload.trip);
    else if (name === "crew.signoff") this._walkHome(payload.person);
    else if (name === "crew.alighted") this._walkFromTrain(payload.person, payload.trip);
  }

  /** Effects of the world's disruptions at a station's platforms on its trains. */
  _stationFx(stationId) {
    const st = this.engine?.stations.get(stationId);
    if (!st?.on_layout) return null;
    const fx = { hold: false, cancel: false, closed: false };
    for (const area of this.world.stopAreas()) {
      if (!st.platforms.includes(area.owner?.id)) continue;
      const e = this.world.disruptions.effectsFor(area);
      fx.hold ||= e.hold;
      fx.cancel ||= e.cancel;
      fx.closed ||= e.closed;
    }
    return fx;
  }

  /* ---------------------------------------------------------------- trains at the platforms */

  /** The on-layout station of a station id, or null. */
  _onLayout(stationId) {
    const s = this.engine?.stations.get(stationId);
    return s?.on_layout ? s : null;
  }

  /** A free dock of a line at a station (in mode "plan"), the line's own first. */
  _freeDock(trip, stationId) {
    const e = this.engine, services = this.world.services;
    const line = e.lines.get(trip.line);
    const own = line?.docks[stationId] || [], all = e.stations.get(stationId)?.docks || [];
    for (const id of [...own, ...all]) {
      const st = services.docks.get(id);
      if (st && st.mode === "plan" && !st.vehicle && !this.visits.has(id)) return id;
    }
    return null;
  }

  /**
   * Label of a train at a platform: the line and where it goes next (or where it came from), its
   * units and driver, its delay.
   * @param {object} trip the trip it leaves for, or the one it came with (`arrived`)
   */
  _texts(trip, units, { arrived = false } = {}) {
    const e = this.engine;
    const name = (id) => e.stations.get(id)?.name ?? id;
    const driver = trip.driver ? e.desk.people.get(trip.driver) : trip.pieces?.driver?.person ? e.desk.people.get(trip.pieces.driver.person) : null;
    const delay = Math.round(arrived ? Math.max(0, (trip.arrE ?? e.now) - trip.arr) : Math.max(0, (trip.depA ?? e.now) - trip.dep));
    return {
      line: arrived ? `${trip.lineName} from ${name(trip.from)}` : `${trip.lineName} → ${name(trip.to)} ${hhmm(trip.dep)}`,
      info: [units.join(" + ") + (driver ? ` · ${shortName(driver.name)}` : ""), ...(delay >= 1 ? [`+${delay} min`] : [])],
    };
  }

  /** Label a visit for the trip it waits for. */
  _label(visit, trip, opts) {
    const t = this._texts(trip, visit.units, opts);
    visit.vehicle.line = t.line;
    visit.vehicle.info = t.info;
  }

  /** Call a train to a dock (arriving now) for a trip it arrives with (`arrived`) or leaves for. */
  _call(dockId, trip, units, opts = {}) {
    const v = this.world.services.call(dockId, { source: "plan", line: trip.lineName });
    if (!v) return null;
    v.dwellLeft = Infinity;
    v.ops = { trip: trip.id, units };
    const visit = { vehicle: v, units, trip: trip.id, leave: null, dock: dockId };
    this._label(visit, trip, opts);
    this.visits.set(dockId, visit);
    return visit;
  }

  /** Let a train at a dock leave (with the trip it leaves for, if any). */
  _leave(visit, trip = null) {
    if (trip) {
      visit.units = trip.unitIds;
      this._label(visit, trip);
    } else {
      visit.vehicle.line = "Not in service";
      visit.vehicle.info = [visit.units.join(" + ")];
    }
    visit.vehicle.dwellLeft = 0;
    this.visits.delete(visit.dock);
  }

  _clearVisits() {
    for (const visit of this.visits.values()) visit.vehicle.dwellLeft = 0;
    this.visits.clear();
    this._called.clear();
  }

  /** The visit of a train waiting for a trip, or with one of these units. */
  _visitOf(units, tripId = null) {
    if (tripId) for (const visit of this.visits.values()) if (visit.next === tripId || visit.trip === tripId) return visit;
    for (const visit of this.visits.values()) if (visit.units.some((u) => units.includes(u))) return visit;
    return null;
  }

  /**
   * Each step: trains coming in are called to a platform a little before they arrive (the arrival
   * takes `approach_s`); trains that come out of the depot are at the platform shortly before they
   * leave; trains that go to the depot leave the platform after a short stop.
   */
  _stepVisits() {
    const e = this.engine, now = e.now;
    const approach = (this.world.layout.services.approach_s * this.world.clock.factor) / 60;
    for (const trip of e.running) {
      if (!this._onLayout(trip.to) || this._called.has(`a:${trip.id}`) || trip.arrE - approach > now) continue;
      this._called.add(`a:${trip.id}`);
      if (this._visitOf(trip.unitIds)) continue;
      const dock = this._freeDock(trip, trip.to);
      if (dock) this._call(dock, trip, trip.unitIds, { arrived: true });
    }
    for (const d of [e.today, e.today - 1]) {
      for (const trip of e.days.get(d)?.trips || []) {
        if ((trip.state !== "planned" && trip.state !== "waiting") || !this._onLayout(trip.from)) continue;
        if (trip.dep - AT_PLATFORM_MIN > now || this._called.has(`d:${trip.id}`)) continue;
        const units = trip.rots.map((r) => r.unit?.id).filter(Boolean);
        if (!units.length) continue;
        this._called.add(`d:${trip.id}`);
        const visit = this._visitOf(units);
        if (visit) {
          visit.leave = null;
          visit.next = trip.id;
          this._label(visit, trip);
          continue;
        }
        // the units come out of the depot
        if (trip.rots.some((r) => r.unit && (r.unit.trip || r.unit.at !== trip.from))) continue;
        const dock = this._freeDock(trip, trip.from);
        if (dock) Object.assign(this._call(dock, trip, units) || {}, { next: trip.id });
      }
    }
    for (const visit of [...this.visits.values()]) {
      const st = this.world.services.docks.get(visit.dock);
      if (!st || st.vehicle !== visit.vehicle) {
        this.visits.delete(visit.dock);
        continue;
      }
      visit.since ??= now;
      // a train waiting for a trip that is gone (it left with other units, or was cancelled) leaves too
      const next = visit.next ? e.trips.get(visit.next) : null;
      if (visit.leave == null && (!next || next.state === "done" || next.state === "cancelled" || next.state === "terminated") && now - visit.since > 20) visit.leave = now;
      if (visit.leave != null && now >= visit.leave) this._leave(visit);
    }
    if (this._called.size > 3000) this._called.clear();
  }

  _departed(trip) {
    if (!this._onLayout(trip.from)) return;
    const visit = this._visitOf(trip.unitIds, trip.id);
    if (visit) this._leave(visit, trip);
  }

  _arrived(trip) {
    if (!this._onLayout(trip.to)) return;
    const e = this.engine;
    let visit = this._visitOf(trip.unitIds);
    if (!visit) {
      const dock = this._freeDock(trip, trip.to);
      visit = dock ? this._call(dock, trip, trip.unitIds, { arrived: true }) : null;
    }
    if (!visit) return;
    // a unit that stays at the platform for its next trip keeps the train there; else it goes to the depot after a short stop
    const stays = (trip.unitObjs || []).filter((u) => !u.inDepot && u.at === trip.to && !u.trip);
    visit.leave = stays.length ? null : e.now + ALIGHT_MIN;
    const next = stays.map((u) => u.rotation?.trips.find((t) => t.state === "planned" && t.from === trip.to && t.dep >= trip.arr)).find(Boolean);
    if (next) {
      visit.next = next.id;
      this._label(visit, next);
    } else this._label(visit, trip, { arrived: true });
  }

  _cancelled(trip) {
    const station = this._onLayout(trip.from);
    if (!station) return;
    // the passengers waiting at the line's platform hear of it
    const dockId = this.engine.lines.get(trip.line)?.docks[station.id]?.[0];
    const st = dockId ? this.world.services.docks.get(dockId) : null;
    if (st && trip.dep - this.engine.now < 30) {
      this.world.events.emit("vehicle.cancelled", { vehicle: { id: `ops:${trip.id}`, line: trip.lineName, kind: "train", dock: st.dock, source: "plan" }, dock: st.dock, area: st.dock.area });
    }
    for (const visit of this.visits.values()) if (visit.next === trip.id) visit.leave = this.engine.now + 2;
  }

  /**
   * Status lines for the board of a stop area of the stations on the layout: the next departures
   * ("RE 1 → Altstadt 07:15 +4", "S 2 07:20 cancelled").
   */
  statusLines(area) {
    const e = this.engine;
    if (!e) return [];
    const station = [...e.stations.values()].find((s) => s.on_layout && s.platforms.includes(area.owner?.id));
    if (!station) return [];
    const docks = new Set(area.docks.map((d) => d.id));
    const list = [];
    for (const d of [e.today, e.today + 1]) {
      for (const trip of e.days.get(d)?.trips || []) {
        if (trip.from !== station.id || trip.dep < e.now - 5 || trip.dep > e.now + 120) continue;
        const line = e.lines.get(trip.line);
        if (!line?.docks[station.id]?.some((x) => docks.has(x))) continue;
        if (trip.state === "running" || trip.state === "done") continue;
        list.push(trip);
      }
    }
    list.sort((a, b) => a.dep - b.dep);
    return list.slice(0, 2).map((trip) => {
      const dest = e.stations.get(trip.to)?.name ?? trip.to;
      if (trip.state === "cancelled") return `${trip.lineName} ${hhmm(trip.dep)} cancelled`;
      const late = trip.state === "waiting" ? Math.round(e.now - trip.dep) : 0;
      return `${trip.lineName} → ${dest} ${hhmm(trip.dep)}${late >= 1 ? ` +${late}` : ""}`;
    });
  }

  /* ---------------------------------------------------------------- crews on foot */

  /** The crew base's door: the depot's entrance, else the first platform's access. */
  _baseDoor() {
    const net = this._net();
    const depot = this.world.objects.find((o) => o.type === "depot" && o.geometry && o.entrances?.().length);
    if (depot) return { pos: depot.entrances()[0].pos, key: `building:${depot.id}:0`, net };
    const area = this.world.stopAreas().find((a) => this._platforms.has(a.owner?.id));
    if (area) return { pos: area.toLayout(area.access[0].s, area.access[0].t), key: `area:${area.id}:0`, net };
    return null;
  }

  _net() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /** Residential buildings with the walk to the crew base (m). */
  _homes(base) {
    const out = [];
    for (const o of this.world.objects) {
      if (!o.geometry || typeof o.capacity !== "function" || typeof o.entrances !== "function") continue;
      const use = typeof o.use === "function" ? o.use() : o.constructor.use;
      const residents = o.capacity()?.residents || 0;
      if (use !== "residential" || !(residents > 0) || !o.entrances().length) continue;
      const path = this._path(o.entrances()[0].pos, `building:${o.id}:0`, base.pos, base.key);
      out.push({ id: o.id, name: o.name, walkM: (path.length * this.world.scale) / 1000, weight: residents });
    }
    return out;
  }

  /** A walking path between two layout points, over the road network when possible. */
  _path(from, fromKey, to, toKey) {
    const net = this._net();
    let points = [from, to];
    if (net) {
      const a = net.place?.(fromKey) ?? net.nearestNode?.(from, { mode: "walk" });
      const b = net.place?.(toKey) ?? net.nearestNode?.(to, { mode: "walk" });
      const route = a != null && b != null ? net.route?.(a, b, { mode: "walk" }) : null;
      if (route?.points?.length) points = [from, ...route.points, to];
    }
    const clean = [points[0]];
    for (const p of points.slice(1)) if (Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 0.1) clean.push(p);
    if (clean.length < 2) clean.push(to.slice());
    const lengths = polylineLengths(clean);
    return { points: clean, lengths, length: lengths[lengths.length - 1] };
  }

  /** Clock minutes a walk of `mm` takes on the layout (people walk at their real speed; the clock is faster). */
  _walkMinutes(mm) {
    return (((mm * this.world.scale) / 1000 / WALK_MPS) * this.world.clock.factor) / 60;
  }

  /**
   * Crews who walk to work set off so that they arrive when the engine expects them (late if
   * they are late today), and tell the engine when they are there.
   */
  _startWalks() {
    const e = this.engine;
    const base = this._baseDoor();
    for (const d of [e.today, e.today + 1]) {
      for (const duty of e.days.get(d)?.duties || []) {
        const c = duty.commute;
        if (!c || c.walking || c.trip || !duty.person || duty.state === "done") continue;
        const p = e.desk.people.get(duty.person);
        if (!p || p.home.kind !== "layout" || p.commute.mode !== "walk" || (p.present && p.today === duty)) continue;
        const home = this.world.getObject(p.home.building);
        const door = home?.entrances?.()[0]?.pos;
        if (!door || !base) {
          if (e.now >= c.arriveAt) e.crewArrived(p.id);
          continue;
        }
        const path = (c.path ||= this._path(door, `building:${home.id}:0`, base.pos, base.key));
        const minutes = this._walkMinutes(path.length);
        const leave = c.arriveAt - minutes;
        if (e.now < leave) continue;
        c.walking = true;
        const done = Math.min(1, minutes > 0 ? (e.now - leave) / minutes : 1);
        this.walkers.push({ person: p.id, path, s: done * path.length, arrive: true, phase: 0, speed: WALK_MPS * (0.9 + (hashOf(p.id) % 20) / 100) });
      }
    }
  }

  _walkHome(p) {
    if (!p || p.home.kind === "away") return;
    const base = this._baseDoor();
    if (!base) return;
    let to = null, key = null;
    if (p.home.kind === "layout") {
      const home = this.world.getObject(p.home.building);
      to = home?.entrances?.()[0]?.pos;
      key = home ? `building:${home.id}:0` : null;
      if (p.commute.mode !== "walk") return;
    } else {
      // to the platform, for a train home
      const area = this.world.stopAreas().find((a) => this._platforms.has(a.owner?.id));
      to = area ? area.toLayout(area.access[0].s, area.access[0].t) : null;
      key = area ? `area:${area.id}:0` : null;
    }
    if (!to) return;
    this.walkers.push({ person: p.id, path: this._path(base.pos, base.key, to, key), s: 0, arrive: false, phase: 0, speed: WALK_MPS });
  }

  _walkFromTrain(p, trip) {
    const base = this._baseDoor();
    const visit = this._visitOf(trip.unitIds);
    const area = visit ? this.world.services.docks.get(visit.dock)?.dock.area : this.world.stopAreas().find((a) => this._platforms.has(a.owner?.id));
    if (!base || !area) return this.engine.crewArrived(p.id);
    const from = area.toLayout(area.access[0].s, area.access[0].t);
    this.walkers.push({ person: p.id, path: this._path(from, `area:${area.id}:0`, base.pos, base.key), s: 0, arrive: true, phase: 0, speed: WALK_MPS });
  }

  _stepWalkers(dt) {
    this._startWalks();
    const mmPerM = 1000 / this.world.scale;
    for (const w of this.walkers) {
      w.s += w.speed * mmPerM * dt;
      w.phase += w.speed * dt * 5;
      if (w.s >= w.path.length) {
        w.done = true;
        if (w.arrive) this.engine.crewArrived(w.person);
      }
    }
    this.walkers = this.walkers.filter((w) => !w.done);
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.enabled || !this.engine) return;
    for (const w of this.walkers) {
      const at = polylineAt(w.path.points, w.s, w.path.lengths);
      if (!view.inImage(at.point[0], at.point[1], 0)) continue;
      drawPerson(view, at.point, { dir: at.dir, speed: w.speed, phase: w.phase, height: 1.75, colour: CREW_COLOURS.body, legs: CREW_COLOURS.legs });
    }
  }

  /**
   * What a depot object shows: the units in the workshop bays, those on its stabling tracks and the
   * lines of its board.
   * @param {object} depot the depot object
   */
  depotState(depot) {
    const e = this.engine;
    if (!e) return null;
    const p = depot.geometry?.plan;
    if (!p) return null;
    const bays = [];
    for (const bay of e.bays) {
      const job = bay.job;
      if (!job || bay.id > p.bays) continue;
      const u = e.units.get(job.unit);
      bays.push({ bay: bay.id - 1, unit: job.unit, job: true, failed: job.kind === "repair" && u?.status !== "job", text: `${job.unit} · ${jobWord(job)} · ${durationLabel(job.end - e.now)}` });
    }
    const inBays = new Set(bays.map((b) => b.unit));
    const here = [...e.units.values()].filter((u) => u.at === e.depot && u.inDepot && !u.trip && !inBays.has(u.id));
    here.sort((a, b) => (b.status === "failed") - (a.status === "failed") || a.id.localeCompare(b.id));
    const stabled = Array.from({ length: p.stabling }, () => []);
    here.forEach((u, i) => {
      const track = stabled[i % Math.max(1, p.stabling)];
      if (!track || track.length >= 2) return;
      const failed = u.status === "failed";
      const text = failed ? `${u.id} · ${causeWord(u.failCause || "failure")}` : u.job && u.job.state !== "done" ? `${u.id} · ${jobWord(u.job)} at ${hhmm(u.job.plannedStart)}` : u.released ? `${u.id} · ready` : `${u.id} · waiting for release`;
      track.push({ unit: u.id, failed, job: false, text });
    });
    const busy = e.bays.filter((b) => b.job).length;
    const waiting = [...e.jobs.values()].filter((j) => j.state === "waiting" || (j.state === "planned" && j.plannedStart <= e.now)).length;
    const ready = here.filter((u) => u.status === "ready" && u.released).length;
    const crew = [...e.desk.people.values()].filter((x) => x.present).length;
    return {
      bays, stabled,
      lines: [`Workshop ${busy}/${e.bays.length} busy${waiting ? ` · ${waiting} waiting` : ""}`, `${ready} unit${ready === 1 ? "" : "s"} ready · ${crew} crew on duty`],
    };
  }

  /* ---------------------------------------------------------------- actions (panel, disruptions) */

  /** A short-term change now (see OpsEngine.inject); returns what happened. */
  inject(event) {
    this._ensure();
    return this.engine ? this.engine.inject(event) : "no operations";
  }

  /** A person calls in sick for their duty today (or the next one). */
  sickCall(personId) {
    const e = this.engine;
    const p = e?.desk.people.get(personId);
    if (!p) return false;
    const duty = [...p.plan.values()].filter((d) => d.state !== "done" && d.state !== "cancelled" && d.signOff > e.now).sort((a, b) => a.signOn - b.signOn)[0];
    if (!duty) return false;
    p.sickFrom = Math.floor(e.now / DAY);
    p.sickUntil = Math.max(p.sickUntil, p.sickFrom + 2);
    if (p.present && p.today === duty) {
      // sent home during the duty: their pieces need somebody else
      e.log(`${p.name} goes home sick`, "crew");
      p.present = false;
      p.today = null;
      for (const pi of duty.pieces) if (pi.person === p.id && pi.state === "planned") e.desk._give(pi, null);
      duty.absentCause = "sick";
      duty.state = "open";
      this._walkHome(p);
      return true;
    }
    e.desk.sickCall(p.id, duty.id);
    return true;
  }

  /** A unit fails now (on its trip, or where it stands). */
  failUnit(unitId, kind = "hard") {
    const e = this.engine;
    const u = e?.units.get(unitId);
    if (!u) return false;
    if (u.trip) {
      if (kind === "soft") e._softFailure(u, u.trip, 0.5);
      else e._hardFailure(u, u.trip, 0.5);
      return true;
    }
    if (kind === "soft") return false;
    e._fail(u, null, "where it stands");
    return true;
  }

  /** The current settings (runtime state is never saved). */
  toJSON() {
    return { ...this.config };
  }
}

/** The layout's operations simulation, or null. */
export function opsOf(world) {
  return world?.simulations?.find((s) => s.constructor.type === OperationsSimulation.type) ?? null;
}

function hashOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
