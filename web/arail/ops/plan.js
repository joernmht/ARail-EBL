/**
 * Normal operations at a station, planned by both sides (`{"type": "ops-plan", …}` in the layout's
 * `simulations`): the trains of an hour, each with the people it is expected to carry. The railway
 * undertaking puts a unit and a driver on each train, the infrastructure manager puts it on a track.
 * The checks say at once what does not work: too few places, a unit or a driver still out with
 * another train, a train outside its driver's shift; a track still taken by another train, a train
 * longer than the platform. Run plays the plan on the layout: the trains come at their times to their
 * tracks with their units and drivers, and what does not work shows: a train waits for its track,
 * unit or driver (a delay), one without them is cancelled, one with too few places comes in full and
 * leaves people behind.
 *
 * A train is away from the station with its unit and driver from its arrival until it is back (its
 * line's `away_min` after its departure); it holds its track from its arrival until `margin_min`
 * after its departure. Runtime state (the plan as changed, a run) stays out of the layout's config;
 * `toJSON()` writes the plan as it is now.
 * @module arail/ops/plan
 */
import { formatTime, parseTime } from "../core/clock.js";
import { Simulation } from "../core/simulation.js";
import { Consist } from "../rail/vehicles.js";
import { fleetEntry, vehicleTypes } from "../rail/trains.js";

/** What the plan says of a train: the unit, the driver, the track. */
export const PLAN_KEYS = ["unit", "driver", "track"];
/** Which side of the strip decides what: the railway undertaking the unit and driver, the infrastructure the track. */
export const PLAN_SIDES = { unit: "evu", driver: "evu", track: "infra" };
/** Share of its expected passengers a train has on board when it comes in (the others get on here). */
const ON_BOARD_SHARE = 0.85;
/** Clock minutes before its departure a cancelled train is announced on the board. */
const ANNOUNCE_MIN = 10;

const time = (v) => parseTime(v) ?? NaN;

export class OpsPlan extends Simulation {
  static type = "ops-plan";
  static label = "Operations plan (trains, units, drivers, tracks)";
  static description = "The trains of an hour at a station: the railway undertaking puts a unit and a driver on each, the infrastructure manager a track; Run plays the plan.";
  static params = [];

  /**
   * Problems of an ops-plan entry (validateLayout prefixes them).
   * @param {object} cfg the entry as written in the file
   */
  static validate(cfg) {
    const out = [], units = new Set((cfg.units || []).map((u) => u.id)), drivers = new Set((cfg.drivers || []).map((d) => d.id));
    if (!Array.isArray(cfg.trains) || !cfg.trains.length) out.push("no trains");
    for (const t of cfg.trains || []) {
      const name = `train ${t.id ?? t.line}`;
      if (!Number.isFinite(time(t.arr)) || !Number.isFinite(time(t.dep))) out.push(`${name}: arr and dep as "HH:MM"`);
      if (t.unit && !units.has(t.unit)) out.push(`${name}: no unit ${t.unit}`);
      if (t.driver && !drivers.has(t.driver)) out.push(`${name}: no driver ${t.driver}`);
    }
    for (const u of cfg.units || []) if (!u.id || (!u.type && !u.vehicles?.length)) out.push(`unit ${u.id ?? "?"}: id and type (or vehicles)`);
    for (const d of cfg.drivers || []) if (!d.id || !Number.isFinite(time(d.from)) || !Number.isFinite(time(d.to))) out.push(`driver ${d.id ?? "?"}: id, from and to`);
    return out;
  }

  constructor(world, config = {}) {
    super(world, config);
    const lines = this.config.lines || {};
    /** The trains, by departure: {id, line, to, arr, dep, back, passengers} (clock minutes). */
    this.trains = (this.config.trains || []).map((t, i) => {
      const line = lines[t.line] || {}, arr = time(t.arr), dep = time(t.dep);
      return { id: String(t.id ?? i), line: String(t.line ?? ""), to: t.to ?? line.to ?? "", arr, dep, back: dep + Number(t.away_min ?? line.away_min ?? 30), passengers: Math.max(0, Number(t.passengers) || 0) };
    }).filter((t) => Number.isFinite(t.arr) && Number.isFinite(t.dep)).sort((a, b) => a.dep - b.dep || a.arr - b.arr);
    /** The units: {id, name, spec, consist, places, length_m}. */
    this.units = (this.config.units || []).map((u) => this._unit(u));
    /** The drivers: {id, name, from, to} (clock minutes). */
    this.drivers = (this.config.drivers || []).map((d) => ({ id: String(d.id), name: d.name || String(d.id), from: time(d.from), to: time(d.to) }));
    /** The plan: train id → {unit, driver, track} (ids, or null). */
    this.plan = new Map();
    this.reset();
    /** The run while it plays: {schedule, called, visits, vehicles}; null otherwise. */
    this.running = null;
    /** The outcome of the last run of the plan as it is: {trains: [{id, delay, cancelled, leftBehind}], onTime, late, cancelled, leftBehind}. */
    this.result = null;
    // the clock set by hand ends a run (not the run's own start)
    this._setting = false;
    this._offs = [world.events.on("clock.set", () => !this._setting && this.stop())];
  }

  get name() {
    return this.config.name || "Operations plan";
  }

  /** Clock minutes a track stays taken after a train left it (`margin_min`, 2). */
  get margin() {
    return Math.max(0, Number(this.config.margin_min ?? 2) || 0);
  }

  /** The plan as the layout has it (undoing every change); not while it runs. */
  reset() {
    if (this.running) return this;
    this.result = null;
    this.plan.clear();
    (this.config.trains || []).forEach((t, i) => this.plan.set(String(t.id ?? i), { unit: t.unit ?? null, driver: t.driver ?? null, track: t.track ?? null }));
    return this;
  }

  /** The plan of a train: {unit, driver, track}. */
  get(trainId) {
    return this.plan.get(trainId) ?? { unit: null, driver: null, track: null };
  }

  /**
   * Put a unit, a driver or a track on a train (null takes it off); not while the plan runs.
   * @param {string} trainId
   * @param {"unit" | "driver" | "track"} key
   * @param {string | null} value
   */
  set(trainId, key, value) {
    if (this.running || !PLAN_KEYS.includes(key) || !this.plan.has(trainId)) return this;
    this.plan.set(trainId, { ...this.get(trainId), [key]: value || null });
    // the last run was another plan
    this.result = null;
    return this;
  }

  train(id) {
    return this.trains.find((t) => t.id === id) ?? null;
  }

  unit(id) {
    return this.units.find((u) => u.id === id) ?? null;
  }

  driver(id) {
    return this.drivers.find((d) => d.id === id) ?? null;
  }

  /** The tracks of the station's platforms (the docks of the layout): {id, dock, length_m, label}, by track id. */
  get tracks() {
    const out = [];
    for (const st of this.world.services.docks.values()) {
      const d = st.dock;
      if (d.kind !== "rail" || !d.track) continue;
      out.push({ id: String(d.track), dock: d.id, length_m: d.s1 - d.s0, label: d.area.owner?.name ?? d.label ?? "" });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  }

  track(id) {
    return this.tracks.find((t) => t.id === id) ?? null;
  }

  _unit(u) {
    const spec = { name: u.name || String(u.id), vehicles: u.vehicles?.length ? u.vehicles : [{ type: u.type }] };
    const consist = new Consist(spec, vehicleTypes(this.world));
    return { id: String(u.id), name: spec.name, spec, consist, places: consist.capacity, length_m: consist.length_m };
  }

  /** The vehicles a train runs with: its unit's, else what its line usually has (the default fleet). */
  consistOf(trainId) {
    const u = this.unit(this.get(trainId).unit);
    if (u) return u.consist;
    const t = this.train(trainId);
    return t ? new Consist({ ...fleetEntry(t.line), peak: undefined }, vehicleTypes(this.world)) : null;
  }

  /** "S 1 → Talsee 07:05" */
  label(t) {
    return `${t.line}${t.to ? ` → ${t.to}` : ""} ${formatTime(t.dep)}`;
  }

  /* ---------------------------------------------------------------- the checks */

  /**
   * What does not work in the plan, train by train: for the railway undertaking (`side` "evu": no
   * unit, too few places, the unit still out, no driver, outside the shift, the driver still out) and
   * the infrastructure ("infra": no track, the track still taken, too long for the platform).
   * @returns {Map<string, Array<{side: string, kind: string, text: string}>>}
   */
  checks() {
    const out = new Map(this.trains.map((t) => [t.id, []]));
    const add = (t, side, kind, text) => out.get(t.id).push({ side, kind, text });
    const margin = this.margin;
    const byArr = [...this.trains].sort((a, b) => a.arr - b.arr || a.dep - b.dep);
    for (const t of byArr) {
      const p = this.get(t.id), unit = this.unit(p.unit), driver = this.driver(p.driver), track = this.track(p.track);
      // the trains before it with the same unit, driver or track that are not yet free when it comes
      const before = byArr.slice(0, byArr.indexOf(t)).map((o) => ({ o, p: this.get(o.id) }));
      if (!unit) add(t, "evu", "unit", "No unit");
      else {
        if (unit.places < t.passengers) add(t, "evu", "places", `Too few places: ${unit.places} for ${t.passengers}`);
        const busy = before.find(({ o, p: q }) => q.unit === unit.id && o.back > t.arr);
        if (busy) add(t, "evu", "unit-out", `${unit.id} is still out until ${formatTime(busy.o.back)}`);
      }
      if (!driver) add(t, "evu", "driver", "No driver");
      else {
        if (t.arr < driver.from || t.back > driver.to) add(t, "evu", "shift", `Outside the shift of ${driver.name} (${formatTime(driver.from)}–${formatTime(driver.to)})`);
        const busy = before.find(({ o, p: q }) => q.driver === driver.id && o.back > t.arr);
        if (busy) add(t, "evu", "driver-out", `${driver.name} is still out until ${formatTime(busy.o.back)}`);
      }
      if (!track) add(t, "infra", "track", "No track");
      else {
        const taken = before.find(({ o, p: q }) => q.track === track.id && o.dep + margin > t.arr);
        if (taken) add(t, "infra", "track-taken", `Track ${track.id} is taken by ${taken.o.line} until ${formatTime(taken.o.dep + margin)}`);
        const length = this.consistOf(t.id)?.length_m ?? 0;
        if (length > track.length_m) add(t, "infra", "length", `Too long: ${Math.round(length)} m for ${Math.round(track.length_m)} m`);
      }
    }
    return out;
  }

  /** The problems of one side ("evu", "infra"), or of both. */
  problems(side = null) {
    return [...this.checks().values()].flat().filter((p) => !side || p.side === side);
  }

  /* ---------------------------------------------------------------- the run */

  /**
   * How the plan runs, train by train (clock minutes): a train comes when its time has come and its
   * track, unit and driver are free, and keeps its time at the platform; without a unit, driver or
   * track, or outside its driver's shift, it is cancelled.
   * @returns {Map<string, {arrive: number, depart: number, delay: number, cancelled: string | null}>}
   */
  schedule() {
    const out = new Map(), margin = this.margin;
    const free = { unit: new Map(), driver: new Map(), track: new Map() };
    for (const t of [...this.trains].sort((a, b) => a.arr - b.arr || a.dep - b.dep)) {
      const p = this.get(t.id), unit = this.unit(p.unit), driver = this.driver(p.driver), track = this.track(p.track);
      let cancelled = !unit ? "no unit" : !driver ? "no driver" : !track ? "no track" : null;
      const arrive = cancelled ? t.arr : Math.max(t.arr, free.unit.get(unit.id) ?? -Infinity, free.driver.get(driver.id) ?? -Infinity, free.track.get(track.id) ?? -Infinity);
      const depart = Math.max(t.dep, arrive + (t.dep - t.arr)), back = depart + (t.back - t.dep);
      if (!cancelled && (arrive < driver.from || back > driver.to)) cancelled = "the driver's shift";
      if (cancelled) {
        out.set(t.id, { arrive: t.arr, depart: t.dep, delay: 0, cancelled });
        continue;
      }
      free.unit.set(unit.id, back);
      free.driver.set(driver.id, back);
      free.track.set(track.id, depart + margin);
      out.set(t.id, { arrive, depart, delay: depart - t.dep, cancelled: null });
    }
    return out;
  }

  /** Whether the plan can run here: its tracks are on the layout, and neither another planner nor the control system runs their trains. */
  get canRun() {
    const services = this.world.services, planner = services.planner, tracks = this.tracks;
    return this.enabled && this.trains.length > 0 && tracks.length > 0 && (!planner || planner === this)
      && tracks.every((t) => services.docks.get(t.dock)?.mode !== "feed");
  }

  /**
   * Play the plan on the layout: the clock goes to its start, its tracks are cleared and run by it
   * (the timetable leaves them alone), and its trains come at their times.
   * @returns {boolean} whether it runs
   */
  run() {
    if (!this.canRun) return false;
    this.stop();
    const services = this.world.services;
    services.planner = this;
    const schedule = this.schedule();
    this.running = { schedule, called: new Set(), visits: new Map(), vehicles: new Map(), docks: new Set(this.tracks.map((t) => t.dock)), end: Math.max(...[...schedule.values()].map((x) => x.depart)) };
    this.result = null;
    services.refreshModes();
    for (const id of this.running.docks) services.free(id);
    this._setting = true;
    this.world.setTime(this.config.start ?? Math.min(...this.trains.map((t) => t.arr)) - 2);
    this._setting = false;
    return true;
  }

  /** Stop a run: its trains leave, the tracks go back to the timetable. */
  stop() {
    const r = this.running;
    if (!r) return;
    for (const visit of r.visits.values()) visit.vehicle.dwellLeft = 0;
    this.running = null;
    const services = this.world.services;
    if (services.planner === this) services.planner = null;
    services.refreshModes();
  }

  /** ServiceManager planner: while it runs, the tracks of the plan are its own. */
  claims(dock) {
    return !!this.running?.docks.has(dock.id);
  }

  step() {
    const r = this.running;
    if (!r || !this.enabled) return;
    const services = this.world.services, now = this.world.clock.minutes;
    const approach = (this.world.layout.services.approach_s * this.world.clock.factor) / 60;
    for (const t of this.trains) {
      if (r.called.has(t.id)) continue;
      const s = r.schedule.get(t.id);
      if (s.cancelled) {
        // the people on the platform hear of it
        if (now < t.dep - ANNOUNCE_MIN) continue;
        r.called.add(t.id);
        const st = services.docks.get(this._docksOf(t)[0]);
        if (st) this.world.events.emit("vehicle.cancelled", { vehicle: { id: `plan:${t.id}`, line: this.label(t), kind: "train", dock: st.dock, source: "plan" }, dock: st.dock, area: st.dock.area });
        continue;
      }
      if (now >= s.arrive - approach && this._call(t, s)) r.called.add(t.id);
    }
    for (const [id, visit] of r.visits) {
      const st = services.docks.get(visit.dock);
      if (!st || st.vehicle !== visit.vehicle) r.visits.delete(id);
      else if (visit.vehicle.dwellLeft === Infinity && now >= visit.depart) visit.vehicle.dwellLeft = 0;
    }
    // the end: every train came or was cancelled, none stands at a platform, and its last departure has passed
    if (r.called.size === this.trains.length && !r.visits.size && now >= r.end) this._finish();
  }

  /** Call a train to its track (it comes in now); false while the track is not yet free. */
  _call(t, s) {
    const r = this.running, p = this.get(t.id), unit = this.unit(p.unit), driver = this.driver(p.driver), dock = this.track(p.track)?.dock;
    const v = dock ? this.world.services.call(dock, { source: "plan", line: this.label(t) }) : null;
    if (!v) return false;
    v.dwellLeft = Infinity;
    v.consistSpec = unit.spec;
    v.plan = { train: t.id, unit: unit.id, driver: driver.name };
    v.delayMin = s.delay;
    v.info = [`${unit.id} · ${driver.name}`, ...(s.delay >= 1 ? [`+${Math.round(s.delay)} min`] : [])];
    // the people on board when it comes in; those of this station fill it up. With too few places
    // for the people expected, it runs full and those who do not fit stay behind, here and on its way
    if (unit.places > 0) {
      v.onboard = Math.min(unit.places, Math.round(ON_BOARD_SHARE * t.passengers));
      v.leftBehind = Math.max(0, t.passengers - unit.places);
    }
    r.visits.set(t.id, { vehicle: v, dock, depart: s.depart });
    r.vehicles.set(t.id, v);
    return true;
  }

  _finish() {
    const r = this.running, trains = this.trains.map((t) => {
      const s = r.schedule.get(t.id);
      return { id: t.id, delay: s.delay, cancelled: s.cancelled, leftBehind: r.vehicles.get(t.id)?.leftBehind ?? 0 };
    });
    this.stop();
    const ran = trains.filter((t) => !t.cancelled);
    this.result = {
      trains,
      onTime: ran.filter((t) => t.delay < 1).length,
      late: ran.filter((t) => t.delay >= 1).length,
      cancelled: trains.length - ran.length,
      leftBehind: trains.reduce((n, t) => n + t.leftBehind, 0),
    };
    this.world.events.emit("plan.finished", { plan: this, result: this.result });
  }

  /**
   * How far a run is, by train id: "coming", "here" (at its platform), "done" (gone), "cancelled"
   * (announced); null when it does not run.
   */
  progress() {
    const r = this.running;
    if (!r) return null;
    const out = new Map();
    for (const t of this.trains) {
      const s = r.schedule.get(t.id);
      out.set(t.id, !r.called.has(t.id) ? "coming" : s.cancelled ? "cancelled" : r.visits.has(t.id) ? "here" : "done");
    }
    return out;
  }

  /** The docks a train is shown at: its track's, else those of the platforms of its line (else all of the plan). */
  _docksOf(t) {
    const dock = this.track(this.get(t.id).track)?.dock;
    if (dock) return [dock];
    const all = this.tracks.map((x) => x.dock), services = this.world.services;
    const own = all.filter((id) => String(services.docks.get(id)?.dock.area.owner?.spec?.lines || "").split(",").map((x) => x.trim()).includes(t.line));
    return own.length ? own : all;
  }

  /** The board of a platform while the plan runs: its next trains ("S 1 → Talsee 07:45 +4", "RB 71 07:52 cancelled"). */
  statusLines(area) {
    const r = this.running;
    if (!r) return [];
    const docks = new Set(area.docks.map((d) => d.id)), now = this.world.clock.minutes, list = [];
    for (const t of this.trains) {
      const s = r.schedule.get(t.id);
      if ((r.called.has(t.id) && !s.cancelled) || s.depart < now - 1 || !this._docksOf(t).some((d) => docks.has(d))) continue;
      list.push({ t, s });
    }
    return list.slice(0, 2).map(({ t, s }) => (s.cancelled ? `${t.line} ${formatTime(t.dep)} cancelled` : `${this.label(t)}${s.delay >= 1 ? ` +${Math.round(s.delay)}` : ""}`));
  }

  /** The card of one of its trains: its unit and driver. */
  describeVehicle(v, card) {
    if (!v.plan) return;
    card.rows.push(["Unit", v.plan.unit], ["Driver", v.plan.driver]);
  }

  dispose() {
    this.stop();
    this._offs.forEach((off) => off());
  }

  /** The settings, with the plan as it is now. */
  toJSON() {
    const trains = (this.config.trains || []).map((t, i) => {
      const p = this.get(String(t.id ?? i)), out = { ...t };
      for (const k of PLAN_KEYS) {
        if (p[k]) out[k] = p[k];
        else delete out[k];
      }
      return out;
    });
    return { ...this.config, trains };
  }
}

/** The layout's operations plan, or null. */
export function planOf(world) {
  return world?.simulations?.find((s) => s.constructor.type === OpsPlan.type) ?? null;
}
