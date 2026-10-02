/**
 * The operations engine: a discrete-event simulation of a railway undertaking's daily work with
 * its rolling stock, its maintenance (the four functions of the entity in charge of maintenance,
 * ECM) and its crews. It knows nothing of the layout's geometry and runs in Node.js too: as fast
 * as it can for comparisons (see experiment.js), or step by step with the world's clock (see
 * simulation.js).
 *
 * Time is in clock minutes since 00:00 of day 0. Day 0 … `burn_in_days` − 1 bring the plans and
 * counters into a steady state; day `burn_in_days` is the first day shown or measured (its weekday
 * is `start_weekday`).
 *
 * The day: at noon the duties of the next day are rostered; at `maintenance.planning.at` (on the
 * working days of the planning party) the maintenance planning (ECM function 3) books workshop jobs
 * and assigns units to the rotations of the next day(s); at the rotations' pull-out the operator
 * sends the units out (a spare where the planned unit is missing); at each departure the
 * dispatcher waits for a late unit or crew within limits, runs the train short, or cancels it.
 * Failures happen on trips (see fleet.js); the workshop (ECM function 4) repairs and inspects; its
 * messages pass between the parties with their working hours and delays. Every incident is booked
 * in the ledger (contracts.js) with its cause.
 * @module arail/ops/engine
 */
import { normalizeOps, OPS_DEFAULTS } from "./config.js";
import { dayKind, deadheadMin, emptyRunKm, emptyRunMin, planPieces, planRotations, tripTemplates } from "./timetable.js";
import { Unit, expectedFailures, wearInterval } from "./fleet.js";
import { buildDuties, makeStaff, reserveDuties } from "./crew.js";
import { CrewDesk } from "./crewdesk.js";
import { Ledger } from "./contracts.js";
import { DAY, EventQueue, addWork, dayOf, dayTime, hhmm, isOpen, lognormal, nextOpen, stream } from "./util.js";

/** Event priorities at the same minute (lower first). */
const PRIO = { start: 1, arr: 2, crew: 3, out: 4, work: 5, dep: 6, end: 8, close: 9 };
/** Minutes between samples of the unit states (for the availability). */
const SAMPLE_MIN = 30;
/** Counters of a day (see `stat`). */
const COUNTERS = [
  "trips", "tripsRun", "tripsCancelled", "tripsTerminated", "tripsShort", "kmPlanned", "kmRun", "kmCancelled", "emptyKm", "onTime", "late", "delayMin",
  "hardFailures", "softFailures", "repeatFailures", "inspections", "repairs", "defectJobs", "jobsLate", "lateReleaseH", "workshopMin", "missingUnits",
  "groundedUnits", "extensionRequests", "extensionsGranted", "shortfallRotations", "unitMinAvailable", "unitMinService", "unitMinWorkshop", "unitMinFailed",
  "unitMinTotal", "dutiesPlanned", "dutiesOpen", "dutiesUncovered", "sickCalls", "coveredByReserve", "coveredByCallIn", "coveredAdHoc", "reserveCalls",
  "lateSignOns", "lateSignOnMin", "overtimeMin", "paidMin", "standbyMin", "restConflicts", "longDuties", "noConductor", "comfortUnitDays",
];

const mod = (a, n) => ((a % n) + n) % n;

export class OpsEngine {
  /**
   * @param {object} config the `operations` entry (or a setup of it)
   * @param {object} [options]
   * @param {object} [options.layout] normalized layout (for the network from the platforms)
   * @param {number} [options.seed] random seed (the setting `seed` wins)
   * @param {boolean} [options.live] driven by the world: crews on the layout walk to work and report their arrival
   * @param {Array<{id: string, name?: string, walkM: number, weight?: number}>} [options.homes] buildings where crews can live
   * @param {{stationEffects?: Function, event?: Function}} [options.hooks]
   */
  constructor(config = {}, { layout = null, seed = 12345, live = false, homes = [], hooks = null } = {}) {
    this.config = config;
    this.model = normalizeOps(config, layout);
    const m = this.model;
    this.seed = m.seed ?? seed;
    this.live = live;
    this.hooks = hooks || {};
    /** Engine day of the first day shown or measured. */
    this.dayOffset = m.burn_in_days;
    /** Weekday of day 0 (0 = Monday). */
    this.wd0 = mod(m.start_weekday - this.dayOffset, 7);
    this.queue = new EventQueue();
    this.now = 0;
    this.stations = new Map(m.stations.map((s) => [s.id, s]));
    this.lines = new Map(m.lines.map((l) => [l.id, l]));
    this.types = new Map(m.types.map((t) => [t.id, t]));
    this.softKinds = new Map(m.maintenance.soft.map((s) => [s.id, s]));
    this.depot = m.maintenance.workshop.station ?? m.stations[0]?.id ?? null;
    this.base = m.crew.base ?? this.depot;
    this.relief = new Set(m.stations.filter((s) => s.on_layout).map((s) => s.id));
    if (this.base) this.relief.add(this.base);
    this.parties = new Map(m.parties.map((p) => [p.id, p]));
    this.ledger = new Ledger(m);
    this.ledger.onEntry = (e) => {
      if (dayOf(e.t) >= this.measureFrom) this.emit("penalty", { entry: e });
    };
    /** First day counted in the totals. */
    this.measureFrom = 0;
    /** @type {Map<string, object>} kind of day -> templates */
    this._templates = new Map();
    /** @type {Map<number, object>} day -> {trips, rots, duties} */
    this.days = new Map();
    /** @type {Map<string, object>} trip id -> trip (of the days kept) */
    this.trips = new Map();
    /** Running trips. */
    this.running = new Set();
    /** @type {Map<number, Map<string, string>>} day -> rotation template id -> unit id (the maintenance planning's plan) */
    this.unitPlan = new Map();
    /** @type {Map<number, object>} day -> counters (and by-cause maps) */
    this.daily = new Map();
    this.logs = [];
    /** Infrastructure blocks from stress tests: station -> {until, cancel}. */
    this.blocked = new Map();
    this._jobSeq = 0;
    this._listeners = [];
    this._setupFleet();
    this._setupWorkshop();
    this._setupCrew(homes);
    this._prepareDay(0);
    this._planInitial();
    this.queue.push(0, "day.start", { day: 0 }, PRIO.start);
    this.queue.push(SAMPLE_MIN, "sample", {}, PRIO.close);
  }

  /* ================================================================ basics */

  /** Weekday (0 = Monday) of an engine day. */
  weekday(day) {
    return mod(this.wd0 + day, 7);
  }

  /** "Tue 07:05" */
  timeText(t) {
    return dayTime(t, this.wd0);
  }

  /** Today (engine day of `now`). */
  get today() {
    return dayOf(this.now);
  }

  /** The working hours of a party (always for unknown ones). */
  hoursOf(party) {
    return this.parties.get(party)?.hours ?? { always: true };
  }

  /**
   * When a message sent by one party at time t is dealt with by another: at once within the same
   * party; else at the receiver's next working time plus its handling time (`latency_min`).
   */
  deliver(from, to, t) {
    if (from === to) return t;
    const p = this.parties.get(to);
    if (!p) return t;
    const open = nextOpen(p.hours, t, this.wd0);
    return nextOpen(p.hours, open + p.latency_min, this.wd0);
  }

  /** Subscribe to the engine's events (`trip.departed`, `unit.failed`, …): returns an unsubscribe function. */
  on(fn) {
    this._listeners.push(fn);
    return () => (this._listeners = this._listeners.filter((f) => f !== fn));
  }

  emit(name, payload = {}) {
    this.hooks.event?.(name, payload);
    for (const fn of this._listeners) fn(name, payload);
  }

  /** Add to a counter of today (or of the day of a trip). */
  stat(key, v = 1, sub = null, day = this.today) {
    let d = this.daily.get(day);
    if (!d) {
      d = { day, byCause: { cancel: {}, delay: {}, missing: {} } };
      for (const k of COUNTERS) d[k] = 0;
      this.daily.set(day, d);
    }
    if (sub) d.byCause[key][sub] = (d.byCause[key][sub] || 0) + v;
    else d[key] = (d[key] || 0) + v;
  }

  /** A line in the log of the day (newest last; at most 400 lines). */
  log(text, kind = "ops") {
    this.logs.push({ t: this.now, text, kind });
    if (this.logs.length > 400) this.logs.splice(0, 100);
    this.emit("log", { t: this.now, text, kind });
  }

  /** Book an incident in the ledger (and count it). */
  incident(inc) {
    return this.ledger.book({ t: this.now, ...inc });
  }

  /* ================================================================ set-up */

  /** Trips, rotations, pieces and duties of the kind of a day (cached). */
  templates(day) {
    const wd = this.weekday(day), m = this.model;
    const kind = dayKind(m, wd);
    let tpl = this._templates.get(kind);
    if (tpl) return tpl;
    const trips = tripTemplates(m, wd);
    const rotations = planRotations(m, trips, this.depot);
    const byKey = new Map(trips.map((t) => [t.key, t]));
    const pieces = planPieces(m, rotations, byKey, this.relief, this.base, this.depot);
    const duties = [...buildDuties(m, pieces, { role: "driver", prefix: "D" }), ...reserveDuties(m, "driver")];
    if (m.lines.some((l) => l.conductor)) duties.push(...buildDuties(m, pieces, { role: "conductor", prefix: "C" }));
    tpl = { kind, trips, byKey, rotations, pieces, duties, rotById: new Map(rotations.map((r) => [r.id, r])) };
    this._templates.set(kind, tpl);
    return tpl;
  }

  _setupFleet() {
    const m = this.model, f = m.fleet;
    const need = new Map();
    let kmPerDay = 0, rotCount = 0;
    for (let d = 0; d < 7; d++) {
      const tpl = this.templates(d);
      const counts = new Map();
      for (const r of tpl.rotations) counts.set(r.vehicle, (counts.get(r.vehicle) || 0) + 1);
      for (const [type, n] of counts) need.set(type, Math.max(need.get(type) || 0, n));
      kmPerDay += tpl.rotations.reduce((s, r) => s + r.km, 0);
      rotCount = Math.max(rotCount, tpl.rotations.length);
    }
    let specs = f.units.slice();
    if (!specs.length) {
      for (const type of m.types) {
        const n = need.get(type.id) || 0;
        if (!n && f.count == null) continue;
        const count = f.count != null && m.types.length === 1 ? f.count : Math.ceil(n * (1 + f.reserve_share));
        const [b0, b1] = Array.isArray(type.built) ? type.built : [type.built ?? 2012, type.built ?? 2012];
        for (let i = 0; i < count; i++) {
          const rng = stream(this.seed, "unit", type.id, i);
          const built = Math.round(rng.uniform(b0, b1));
          specs.push({ id: `${type.prefix ?? ""}${(type.first_number ?? 1) + i}`, type: type.id, built, km: Math.round(Math.max(0, m.year - built) * rng.uniform(90000, 140000)) });
        }
      }
    }
    this.units = new Map();
    // an average day of a unit, for the counters at the start
    this.avgKmPerDay = specs.length ? kmPerDay / 7 / specs.length : 400;
    for (const s of specs) {
      const u = new Unit({ ...s, type: this.types.get(s.type) ?? m.types[0] }, this.depot);
      u.inDepot = true;
      const rng = stream(this.seed, "unit-start", u.id);
      const program = u.type.program;
      let maxKm = Infinity, maxDays = Infinity;
      for (const level of [...program].reverse()) {
        const phase = rng.uniform(0.02, 0.9);
        const byKm = level.every_km ? phase * level.every_km : Infinity;
        const byDays = level.every_days ? phase * level.every_days : Infinity;
        let km = Math.min(byKm, byDays * this.avgKmPerDay, maxKm);
        if (!Number.isFinite(km)) km = 0;
        const days = Math.min(byDays, km / Math.max(1, this.avgKmPerDay), maxDays);
        u.counters[level.id] = { km: u.km - km, t: -days * DAY };
        if (level.includes.length) {
          maxKm = Math.min(maxKm, km);
          maxDays = Math.min(maxDays, days);
        }
      }
      const lowest = program[0];
      u.wear = lowest ? u.km - u.counters[lowest.id].km : 0;
      u.odo = [[-Infinity, u.km]];
      this.units.set(u.id, u);
    }
    this.fleetNeed = need;
  }

  _setupWorkshop() {
    const w = this.model.maintenance.workshop;
    this.bays = Array.from({ length: w.bays }, (_, i) => ({ id: i + 1, bookings: [], job: null }));
    /** @type {Map<string, object>} */
    this.jobs = new Map();
  }

  _setupCrew(homes) {
    const m = this.model;
    // the hours of a week, to size the staff
    let paid = 0, duties = 0, cPaid = 0, cDuties = 0;
    for (let d = 0; d < 7; d++) {
      for (const duty of this.templates(d).duties) {
        if (duty.role === "driver") {
          paid += duty.paid;
          duties++;
        } else {
          cPaid += duty.paid;
          cDuties++;
        }
      }
    }
    const k = m.crew.contracts, total = k.reduce((s, c) => s + c.share, 0) || 1;
    const hours = k.reduce((s, c) => s + (c.share / total) * c.hours_week, 0);
    const days = k.reduce((s, c) => s + (c.share / total) * Math.min(5, (c.hours_week / 38) * 5), 0);
    const avail = Math.max(0.3, 1 - m.crew.vacation_rate - m.crew.sick_rate);
    const size = (minutes, n) => Math.ceil(Math.max(minutes / 60 / hours, n / days) / avail * m.crew.staffing);
    let drivers = m.crew.drivers ?? size(paid, duties);
    let conductors = m.crew.conductors ?? (cDuties ? size(cPaid, cDuties) : 0);
    // vacant positions: fewer people for the same work
    drivers = Math.max(1, Math.round(drivers * (1 - m.crew.vacancies)));
    conductors = Math.round(conductors * (1 - m.crew.vacancies));
    const lines = m.lines.map((l) => l.id);
    const outer = [];
    for (const l of m.lines) for (const s of l.route) if (!this.relief.has(s) && !outer.some((o) => o.station === s)) outer.push({ station: s, line: l.id });
    const people = [
      ...makeStaff(m, drivers, { role: "driver", seed: this.seed, lines, homes, outer }),
      ...makeStaff(m, conductors, { role: "conductor", seed: this.seed, lines, homes, outer }),
    ];
    this.desk = new CrewDesk(this, people);
  }

  /* ================================================================ the day */

  /** Trips, rotations and duties of a day, and its roster (made at noon the day before). */
  _prepareDay(d) {
    if (this.days.has(d)) return;
    const tpl = this.templates(d), base = d * DAY;
    const trips = tpl.trips.map((t) => {
      const line = this.lines.get(t.line);
      const trip = {
        ...t, id: `${d}:${t.key}`, day: d, lineName: line?.name ?? t.line, dep: base + t.dep, arr: base + t.arr,
        stops: t.stops.map((s) => ({ station: s.station, arr: s.arr == null ? null : base + s.arr, dep: s.dep == null ? null : base + s.dep })),
        state: "planned", unitIds: [], driver: null, conductor: null, depA: null, arrA: null, arrE: null, delay: 0, cause: null,
        rots: [], pieces: {}, delays: {}, token: 0,
      };
      this.trips.set(trip.id, trip);
      return trip;
    });
    const byKey = new Map(trips.map((t) => [t.key, t]));
    const rots = tpl.rotations.map((r) => ({
      id: `${d}:${r.id}`, tpl: r, day: d, pullOut: base + r.pullOut, pullIn: base + r.pullIn, trips: r.trips.map((k) => byKey.get(k)),
      unit: null, done: false, km: r.km, emptyKm: r.emptyKm,
    }));
    const rotByTpl = new Map(rots.map((r) => [r.tpl.id, r]));
    for (const trip of trips) {
      trip.rots = (tpl.byKey.get(trip.key).rotations || []).map((id) => rotByTpl.get(id)).filter(Boolean);
      const lead = trip.rots[0];
      trip.rotIndex = lead ? lead.tpl.trips.indexOf(trip.key) : -1;
    }
    const duties = tpl.duties.map((dt) => {
      const duty = {
        id: `${d}:${dt.id}`, tpl: dt, day: d, role: dt.role, kind: dt.kind, signOn: base + dt.signOn, signOff: base + dt.signOff,
        paid: dt.paid, breaks: dt.breaks, lines: dt.lines, person: null, state: "planned", pieces: [],
      };
      for (const piece of dt.pieces) {
        const pi = { tpl: piece, duty, trips: piece.trips.map((k) => byKey.get(k)), person: null, state: "planned" };
        duty.pieces.push(pi);
        for (const trip of pi.trips) trip.pieces[dt.role] = pi;
      }
      return duty;
    });
    this.days.set(d, { day: d, trips, rots, duties, kind: tpl.kind });
    this.stat("dutiesPlanned", duties.filter((x) => x.kind === "line").length, null, d);
    this.desk.roster(d, duties);
    this.desk.prepare(d, duties);
    const ahead = this.model.dispatch.pull_out_min + 5;
    for (const trip of trips) {
      this.stat("trips", 1, null, d);
      this.stat("kmPlanned", trip.km, null, d);
      this.queue.push(trip.dep, "trip.dep", { trip: trip.id }, PRIO.dep);
      if (trip.from === this.depot) this.queue.push(trip.dep - ahead, "trip.prep", { trip: trip.id }, PRIO.dep);
    }
    for (const rot of rots) this.queue.push(rot.pullOut, "rot.out", { rot: rot.id }, PRIO.out);
    const first = Math.min(...rots.map((r) => r.pullOut));
    if (Number.isFinite(first)) this.queue.push(Math.max(base, first), "availability", { day: d }, PRIO.out);
    this.queue.push(base + DAY + 240, "day.end", { day: d }, PRIO.close);
  }

  /** Units for the rotations of a day: the maintenance planning's plan, else what the operator has. */
  _dayStart(d) {
    const day = this.days.get(d);
    if (!day) return;
    const plan = this.unitPlan.get(d) || new Map();
    const used = new Set();
    for (const rot of [...day.rots].sort((a, b) => a.pullOut - b.pullOut)) {
      let u = plan.has(rot.tpl.id) ? this.units.get(plan.get(rot.tpl.id)) : null;
      if (u && (used.has(u) || u.type.id !== rot.tpl.vehicle)) u = null;
      if (!u && !plan.has(rot.tpl.id) && this.unitPlan.has(d)) rot.uncovered = this.unitPlan.get(d).shortfallCause?.get(rot.tpl.id) ?? "fleet";
      if (!u && !this.unitPlan.has(d)) u = this._spare(rot.tpl.vehicle, rot.pullOut, used, { planning: true });
      if (u) {
        rot.unit = u;
        used.add(u);
        // a unit still on yesterday's rotation takes this one when that is done
        if (u.rotation && !u.rotation.done && u.rotation.day < d && u.rotation.unit === u) u.queued = rot;
        else u.rotation = rot;
      }
    }
    // tomorrow's preparation and today's planning
    this.queue.push(d * DAY + 720, "day.prepare", { day: d + 1 }, PRIO.work);
    const at = d * DAY + this.model.maintenance.planning.at;
    const planner = this.model.ecm.planning;
    if (isOpen(this.hoursOf(planner), at, this.wd0)) this.queue.push(at, "plan.run", { day: d }, PRIO.work);
    this.queue.push(d * DAY + DAY, "day.start", { day: d + 1 }, PRIO.start);
  }

  _dayEnd(d) {
    // units left away from the depot (their last trips were cancelled) run back
    for (const u of this.units.values()) {
      if (!u.trip && u.at !== this.depot && u.at !== "workshop" && u.status !== "failed" && !(u.rotation && u.rotation.day > d)) this._sendHomeIfIdle(u, u.at);
      if (u.at === this.depot && !u.inDepot && !u.trip && !(u.rotation && !u.rotation.done && u.rotation.day > d)) u.inDepot = true;
    }
    // comfort defects: every unit that ran with one costs a day
    const day = this.days.get(d);
    if (day) {
      const units = new Set();
      for (const trip of day.trips) {
        if (trip.state !== "done" && trip.state !== "terminated") continue;
        for (const id of trip.comfortUnits || []) units.add(id);
      }
      for (const id of units) {
        this.stat("comfortUnitDays", 1, null, d);
        this.incident({ type: "comfort", cause: "defect", units: 1, ref: id });
      }
    }
    // keep three days
    for (const old of [...this.days.keys()]) {
      if (old >= d - 2) continue;
      for (const trip of this.days.get(old).trips) this.trips.delete(trip.id);
      for (const duty of this.days.get(old).duties) this.desk.duties.delete(duty.id);
      this.days.delete(old);
      this.unitPlan.delete(old);
    }
    for (const p of this.desk.people.values()) for (const k of [...p.plan.keys()]) if (k < d - 14) p.plan.delete(k);
    this.emit("day.end", { day: d });
  }

  /* ================================================================ running */

  /** Process all events up to time t (clock minutes). */
  runTo(t) {
    while (this.queue.peekTime() <= t) {
      const e = this.queue.pop();
      this.now = Math.max(this.now, e.t);
      this._handle(e);
    }
    this.now = Math.max(this.now, t);
  }

  /** Run n whole days from now. */
  runDays(n) {
    this.runTo(this.now + n * DAY);
  }

  _handle(e) {
    const x = e.data;
    switch (e.type) {
      case "day.start": return this._dayStart(x.day);
      case "day.prepare": return this._prepareDay(x.day);
      case "day.end": return this._dayEnd(x.day);
      case "plan.run": return this._planRun(x.day);
      case "rot.out": return this._pullOut(x.rot);
      case "availability": return this._availability(x.day);
      case "trip.dep": return this._tryDepart(this.trips.get(x.trip));
      case "trip.prep": return this._prepareDeparture(this.trips.get(x.trip));
      case "trip.arr": return this._arrive(this.trips.get(x.trip), x.token);
      case "unit.fail": return this._hardFailure(this.units.get(x.unit), this.trips.get(x.trip), x.f);
      case "unit.defect": return this._softFailure(this.units.get(x.unit), this.trips.get(x.trip), x.f);
      case "plan.repair": return this._planRepair(this.units.get(x.unit));
      case "job.check": return this._jobCheck(this.jobs.get(x.job));
      case "job.end": return this._jobEnd(this.jobs.get(x.job));
      case "unit.release": return this._release(this.units.get(x.unit), x.job);
      case "dev.decide": return this._decideExtension(this.units.get(x.unit), x.level);
      case "crew.arrive": return this.desk.arrive(x.person, x.duty, this.now);
      case "crew.sick": return this.desk.sickCall(x.person, x.duty);
      case "crew.noshow": return this.desk.noShow(x.person, x.duty);
      case "crew.end": return this.desk.end(x.person, x.duty, this.now);
      case "sample": return this._sample();
      case "stress": return this.inject(x.event);
      case "unblock": return this.blocked.delete(x.station);
      default:
    }
  }

  /* ================================================================ units at the start of the day */

  /** A rotation's pull-out: the planned unit leaves the depot, or a spare in its place. */
  _pullOut(rotId) {
    const rot = this.days.get(Number(rotId.split(":")[0]))?.rots.find((r) => r.id === rotId);
    if (!rot) return;
    const d = this.model.dispatch;
    let u = rot.unit;
    const ok = u && this._serviceable(u, this.now) && u.at === this.depot && !u.trip;
    if (!ok) {
      const spare = this._spare(rot.tpl.vehicle, this.now);
      if (spare) {
        if (u && u.rotation === rot) u.rotation = null;
        if (u && u.queued === rot) u.queued = null;
        if (u) this.log(`${spare.id} replaces ${u.id} (${this._unitCause(u)}) on ${rot.tpl.id}`, "fleet");
        rot.unit = spare;
        spare.rotation = rot;
        u = spare;
      } else if (u) {
        this.log(`${u.id} cannot leave the depot for ${rot.tpl.id}: ${this._unitCauseText(u)}`, "fleet");
        return;
      } else return;
    }
    // out of the depot, with an empty run to the first station
    u.rotation = rot;
    if (u.queued === rot) u.queued = null;
    const first = rot.trips[0];
    u.inDepot = false;
    u.at = first.from;
    const empty = emptyRunMin(this.model, this.depot, first.from);
    if (empty > 0) {
      const km = emptyRunKm(this.model, this.depot, first.from);
      u.run(km, this.now + empty);
      this.stat("emptyKm", km);
    }
    u.readyAt = this.now + d.pull_out_min + empty;
  }

  /** Units missing at the first pull-out of the day, by cause (the availability contract). */
  _availability(d) {
    const day = this.days.get(d);
    if (!day) return;
    const need = day.rots.length;
    const ok = [], not = [];
    for (const u of this.units.values()) (this._serviceable(u, this.now, { known: true }) ? ok : not).push(u);
    const missing = Math.max(0, need - ok.length);
    if (!missing) return;
    const rank = { overrun: 0, repeat: 1, failure: 1, release: 2, extension: 3, overdue: 3, planning: 4, defect: 5, external: 6 };
    not.sort((a, b) => (rank[this._unitCause(a)] ?? 9) - (rank[this._unitCause(b)] ?? 9) || a.id.localeCompare(b.id));
    for (const u of not.slice(0, missing)) {
      const cause = this._unitCause(u);
      this.stat("missingUnits", 1);
      this.stat("missing", 1, cause);
      this.incident({ type: "missing_unit", cause, units: 1, ref: u.id });
    }
    this.log(`${missing} unit${missing === 1 ? "" : "s"} short at the first pull-out (${need} needed)`, "fleet");
  }

  /** May a unit run now (not failed, out, in the workshop, overdue; released)? */
  _serviceable(u, t, { known = false } = {}) {
    if (u.status === "failed" || u.status === "job" || u.status === "transfer" || u.status === "waiting") return false;
    if (u.outUntil != null && t < u.outUntil) return false;
    if (u.job && u.job.state === "running") return false;
    if (!u.released) return false;
    if (u.readyAt > t + (known ? 60 : 0) && u.inDepot) return false;
    return !this._overdue(u, t);
  }

  /** Past a maintenance limit, or a defect past its deadline? */
  _overdue(u, t = this.now) {
    return u.overdue(u.type.program, t) || u.defects.some((x) => x.deadline != null && t > x.deadline);
  }

  /**
   * A spare unit at the depot: not needed for a rotation today, ready, released, not due for a job
   * soon; the one with the most km left first.
   */
  _spare(vehicle, t, used = null, { planning = false } = {}) {
    let best = null;
    for (const u of this.units.values()) {
      if (u.type.id !== vehicle || used?.has(u)) continue;
      if (u.at !== this.depot || !u.inDepot || u.trip || !u.released) continue;
      if (u.status !== "ready") continue;
      if (u.outUntil != null && t < u.outUntil) continue;
      if (!planning && ((u.rotation && u.rotation.day === dayOf(t) && !u.rotation.done && u.rotation.unit === u) || (u.queued && u.queued.unit === u))) continue;
      if (!planning && u.readyAt > t) continue;
      if (this._overdue(u, t)) continue;
      if (u.job && u.job.state !== "done" && u.job.plannedStart < t + 180) continue;
      const left = u.kmLeft(u.type.program, t);
      if (!best || left > best.left) best = { u, left };
    }
    return best?.u ?? null;
  }

  /* ================================================================ trips */

  /** Effects of infrastructure on a station: from stress tests and (live) the world's disruptions. */
  _stationFx(station, t) {
    const out = { hold: false, cancel: false };
    const b = this.blocked.get(station) || this.blocked.get("*");
    if (b && t < b.until) {
      if (b.cancel) out.cancel = true;
      else out.hold = true;
    }
    const fx = this.hooks.stationEffects?.(station, t);
    if (fx) {
      out.hold ||= !!fx.hold;
      out.cancel ||= !!fx.cancel || !!fx.closed;
    }
    return out;
  }

  /** Before a departure from the depot station: a spare leaves the depot in time where a unit will be missing. */
  _prepareDeparture(trip) {
    if (!trip || trip.state !== "planned") return;
    this._unitsFor(trip, { ahead: true });
  }

  /** When each unit of a trip can leave, and why not earlier (a spare from the depot takes the place of a missing one). */
  _unitsFor(trip, { ahead = false } = {}) {
    const now = this.now, d = this.model.dispatch;
    const slots = [];
    const used = new Set();
    for (const rot of trip.rots) {
      let u = rot.unit;
      if (u && used.has(u)) u = null;
      let eta = u ? this._unitEta(u, trip) : Infinity;
      let cause = u ? this._unitCause(u, trip) : rot.uncovered || rot.lastCancelCause || "fleet";
      // a spare from the depot, when it is quicker
      if (eta > Math.max(now, trip.dep) + d.short_wait_min && trip.from === this.depot) {
        const s = this._spare(trip.vehicle, now, used);
        const sEta = s ? Math.max(trip.dep, Math.max(now, s.readyAt) + d.pull_out_min) : Infinity;
        if (s && sEta < eta) {
          // it leaves the depot now
          s.inDepot = false;
          s.at = trip.from;
          s.readyAt = Math.max(now, s.readyAt) + d.pull_out_min;
          if (u && u.rotation === rot) u.rotation = null;
          if (u && u.queued === rot) u.queued = null;
          this.log(`Spare ${s.id} for ${trip.lineName} ${hhmm(trip.dep)}${u ? ` instead of ${u.id} (${this._unitCauseText(u)})` : ""}`, "fleet");
          rot.unit = s;
          s.rotation = rot;
          u = s;
          eta = sEta;
        }
      }
      if (u) used.add(u);
      slots.push({ rot, unit: u, eta, cause });
    }
    return slots;
  }

  /** The earliest time a unit can leave with a trip (Infinity if it will not). */
  _unitEta(u, trip) {
    const d = this.model.dispatch;
    if (u.status === "failed" || u.status === "job" || u.status === "transfer" || u.status === "waiting") return Infinity;
    if (u.outUntil != null && this.now < u.outUntil) return Infinity;
    if (this._overdue(u)) {
      if (!u.overdueReported) {
        u.overdueReported = true;
        this.stat("groundedUnits", 1);
        this.log(`${u.id} may not run: maintenance overdue`, "fleet");
        this._report(u, "overdue");
      }
      return Infinity;
    }
    if (!u.released) return Infinity;
    if (u.trip) {
      if (u.trip.to !== trip.from || !Number.isFinite(u.trip.arrE)) return Infinity;
      return Math.max(trip.dep, u.trip.arrE + (this.lines.get(trip.line)?.turn_min ?? 5));
    }
    if (u.at !== trip.from) return Infinity;
    return Math.max(trip.dep, u.readyAt + (u.inDepot ? d.pull_out_min : 0));
  }

  /** Why a unit is not ready (a cause, see contracts.js). */
  _unitCause(u, trip = null) {
    if (!u) return "fleet";
    if (u.status === "failed") return u.failCause || "failure";
    if (u.outUntil != null && this.now < u.outUntil) return "external";
    if (u.job && u.job.state !== "done" && (u.status === "job" || u.status === "transfer" || u.status === "waiting")) {
      if (u.job.kind === "repair") return u.failCause || "failure";
      return this.now > u.job.plannedEnd ? "overrun" : "planning";
    }
    if (!u.released) return "release";
    if (this._overdue(u)) return u.extensionRefused ? "extension" : u.defects.some((x) => x.deadline != null && this.now > x.deadline) ? "defect" : "overdue";
    if (u.trip) return this._dominant(u.trip) || "primary";
    if (trip && u.at !== trip.from) return u.rotation?.lastCancelCause || "fleet";
    return u.lateCause || "primary";
  }

  _unitCauseText(u) {
    const words = { failure: "failed", repeat: "failed again", external: "out of service", overrun: "workshop late", planning: "in the workshop", release: "release not passed on", overdue: "maintenance overdue", extension: "maintenance overdue", defect: "defect past its deadline", primary: "late", fleet: "elsewhere", capacity: "not ready" };
    return words[this._unitCause(u)] || this._unitCause(u);
  }

  /** The cause with most delay minutes of a trip. */
  _dominant(trip) {
    let best = null;
    for (const [c, v] of Object.entries(trip.delays || {})) if (v > 0 && (!best || v > best[1])) best = [c, v];
    return best?.[0] ?? null;
  }

  /** Try to depart a trip now: wait, run short, cancel or go. */
  _tryDepart(trip) {
    if (!trip || (trip.state !== "planned" && trip.state !== "waiting")) return;
    const now = this.now, d = this.model.dispatch;
    if (now < trip.dep) return;
    const fx = this._stationFx(trip.from, now);
    if (fx.cancel) return this._cancel(trip, "infrastructure");
    if (fx.hold) return this._wait(trip, now + 1, "infrastructure");
    const driver = this.desk.crewFor(trip, "driver");
    if (!driver.person || driver.ready > trip.dep + d.wait_crew_min) return this._cancel(trip, driver.cause || "crew");
    const slots = this._unitsFor(trip);
    const ready = slots.filter((s) => s.eta <= now);
    if (!ready.length) {
      const first = Math.min(...slots.map((s) => s.eta));
      const cause = slots.reduce((c, s) => (s.eta === first ? s.cause : c), slots[0]?.cause || "fleet");
      if (first > trip.dep + d.wait_unit_min) return this._cancel(trip, cause);
      return this._wait(trip, first, cause);
    }
    if (ready.length < slots.length) {
      const next = Math.min(...slots.filter((s) => s.eta > now).map((s) => s.eta));
      if (next <= trip.dep + d.short_wait_min) return this._wait(trip, next, slots.find((s) => s.eta === next).cause);
    }
    if (driver.ready > now) return this._wait(trip, driver.ready, driver.cause || "crew");
    let conductor = null;
    if (trip.conductor) {
      conductor = this.desk.crewFor(trip, "conductor");
      if (conductor.person && conductor.ready > now && conductor.ready <= trip.dep + d.wait_crew_min) return this._wait(trip, conductor.ready, conductor.cause || "crew");
      if (!conductor.person || conductor.ready > now) conductor = null;
    }
    // a unit that will not start
    for (const s of ready) {
      if (this._startFailure(s.unit, trip)) return this._wait(trip, now + 1, s.unit.failCause || "failure");
    }
    this._depart(trip, ready.map((s) => s.unit), driver, conductor, slots.length - ready.length, slots.filter((s) => s.eta > now).map((s) => s.cause));
  }

  _wait(trip, until, cause) {
    trip.state = "waiting";
    trip.waitCause = cause;
    this.queue.push(Math.max(this.now + 0.5, until), "trip.dep", { trip: trip.id }, PRIO.dep);
  }

  /** The random failures of a unit on a trip: drawn once per unit and trip. */
  _failureDraw(u, trip) {
    const key = `${u.id}|${trip.id}`;
    this._draws ||= new Map();
    let draw = this._draws.get(key);
    if (draw) return draw;
    const m = this.model;
    const ctx = { t: this.now, year: m.year, interval: wearInterval(u.type.program), factor: m.fleet.failure_factor };
    const rng = stream(this.seed, "fail", u.id, trip.id);
    const hard = 1 - Math.exp(-expectedFailures(u, trip.km, "hard", ctx));
    const soft = 1 - Math.exp(-expectedFailures(u, trip.km, "soft", { ...ctx, factor: ctx.factor * m.fleet.soft_factor }));
    draw = { hard: rng.next() < hard, fHard: rng.next(), soft: rng.next() < soft, fSoft: rng.next(), kind: rng.next() };
    this._draws.set(key, draw);
    if (this._draws.size > 4000) this._draws.clear();
    return draw;
  }

  /** Does a unit fail as the train is about to leave (it will not start)? */
  _startFailure(u, trip) {
    const f = u.type.failure;
    const draw = this._failureDraw(u, trip);
    if (!draw.hard || draw.fHard >= f.start_share || draw.started) return false;
    draw.started = true;
    draw.hard = false;
    this._fail(u, trip, "at departure");
    // it stands at the platform: back to the depot
    u.at = this.depot;
    u.inDepot = true;
    u.readyAt = this.now + f.tow_min / 2;
    return true;
  }

  _depart(trip, units, driver, conductor, short, shortCauses) {
    const now = this.now, m = this.model, d = m.dispatch;
    trip.state = "running";
    trip.depA = now;
    trip.unitIds = units.map((u) => u.id);
    trip.unitObjs = units;
    this.running.add(trip);
    const late = now - trip.dep;
    if (late > 0) trip.delays[trip.waitCause || "primary"] = (trip.delays[trip.waitCause || "primary"] || 0) + late;
    for (const u of units) {
      u.status = "service";
      u.trip = trip;
      u.inDepot = false;
      u.at = null;
    }
    this.desk.depart(trip, "driver", driver.person, driver.substitute);
    if (conductor) this.desk.depart(trip, "conductor", conductor.person, conductor.substitute);
    else if (trip.conductor) {
      this.stat("noConductor", 1);
      this.incident({ type: "no_conductor", cause: trip.pieces.conductor?.duty?.absentCause || "crew", ref: trip.id });
    }
    if (short > 0) {
      this.stat("tripsShort", 1);
      const cause = shortCauses[0] || "fleet";
      this.incident({ type: "short", cause, km: trip.km, units: short, ref: trip.id });
      this.log(`${trip.lineName} ${hhmm(trip.dep)} runs with ${units.length} instead of ${units.length + short} units`, "fleet");
    }
    // running time: primary delays, slow units, a little recovery of a delay
    const rng = stream(this.seed, "run", trip.id);
    const dl = d.delays;
    const primary = rng.next() < dl.p ? Math.min(dl.max_min, lognormal(rng, dl.median_min, dl.sigma)) : 0;
    let defect = 0;
    for (const u of units) defect = Math.max(defect, u.defectDelay(this.softKinds));
    const recover = Math.min(Math.max(0, late), d.recovery_min);
    if (primary) trip.delays.primary = (trip.delays.primary || 0) + primary;
    if (defect) trip.delays.defect = (trip.delays.defect || 0) + defect;
    const run = trip.arr - trip.dep + primary + defect - recover;
    trip.arrE = now + Math.max(1, run);
    trip.comfortUnits = units.filter((u) => u.hasComfortDefect(this.softKinds)).map((u) => u.id);
    // failures on the way
    for (const u of units) {
      const draw = this._failureDraw(u, trip), f = u.type.failure;
      if (draw.hard) this.queue.push(now + (f.start_share + (1 - f.start_share) * draw.fHard) * run, "unit.fail", { unit: u.id, trip: trip.id, f: draw.fHard }, PRIO.arr);
      if (draw.soft) this.queue.push(now + draw.fSoft * run, "unit.defect", { unit: u.id, trip: trip.id, f: draw.fSoft }, PRIO.arr);
    }
    this.queue.push(trip.arrE, "trip.arr", { trip: trip.id, token: trip.token }, PRIO.arr);
    this.emit("trip.departed", { trip });
  }

  _arrive(trip, token) {
    if (!trip || trip.state !== "running" || token !== trip.token) return;
    const now = this.now, m = this.model, d = m.dispatch;
    trip.state = "done";
    trip.arrA = now;
    trip.delay = Math.max(0, now - trip.arr);
    this.running.delete(trip);
    const lateCause = this._dominant(trip);
    for (const u of trip.unitObjs) {
      u.run(trip.km, now);
      u.trip = null;
      u.at = trip.to;
      u.lateCause = lateCause;
      if (u.status === "service") u.status = "ready";
      // the rotation this unit ran the trip for
      const rot = trip.rots.find((r) => r.unit === u) ?? null;
      const i = rot ? rot.trips.indexOf(trip) : -1;
      const next = rot && i >= 0 ? rot.trips.slice(i + 1).find((t) => t.state === "planned" || t.state === "waiting") : null;
      if (rot && !next) {
        rot.done = true;
        if (u.rotation === rot) {
          u.rotation = u.queued ?? null;
          u.queued = null;
        }
      }
      if (u.failPending) {
        u.failPending = false;
        u.status = "failed";
        this._toDepot(u, trip.to, now);
        if (rot) rot.unit = null;
        u.rotation = null;
      } else if (!next || !rot) {
        this._toDepot(u, trip.to, now);
      } else if (trip.to === this.depot && (u.defectDelay(this.softKinds) > 0 || (u.job && u.job.state !== "done" && u.job.plannedStart <= now)) && this._swapForRepair(u, rot)) {
        // a spare took over its rotation: in to the workshop
        this._toDepot(u, trip.to, now);
      } else if (trip.to === this.depot && next.dep - now >= d.stable_after_min) {
        u.inDepot = true;
        u.readyAt = now + d.pull_in_min;
        this._kickJobs(u);
      } else {
        u.inDepot = false;
        u.readyAt = now + (this.lines.get(trip.line)?.turn_min ?? 5);
      }
    }
    const cause = this._dominant(trip);
    this.desk.arrived(trip, "driver", now, cause);
    if (trip.conductor) this.desk.arrived(trip, "conductor", now, cause);
    this.desk.tripArrived(trip, now);
    const day = trip.day;
    this.stat("tripsRun", 1, null, day);
    this.stat("kmRun", trip.km, null, day);
    this.stat("delayMin", trip.delay, null, day);
    const threshold = this.ledger.authorityContract()?.penalties.late_threshold_min ?? 5;
    if (trip.delay < threshold) this.stat("onTime", 1, null, day);
    else {
      this.stat("late", 1, null, day);
      this.stat("delay", 1, cause || "primary", day);
      this.incident({ type: "late", cause: cause || "primary", minutes: trip.delay, ref: trip.id });
    }
    this.emit("trip.arrived", { trip });
  }

  /**
   * A unit standing at a station away from the depot with nothing more to do there today (its trip
   * was cancelled) goes back to the depot.
   */
  _sendHomeIfIdle(u, station) {
    if (!u || u.trip || u.at !== station || station === this.depot || u.status === "failed") return;
    // still needed here by its rotation (a unit for the peaks parked between them)?
    const rots = [u.rotation, u.queued].filter((r) => r?.unit === u);
    if (rots.some((r) => r.trips.some((t) => (t.state === "planned" || t.state === "waiting") && t.from === station))) return;
    const rot = u.rotation?.unit === u ? u.rotation : null;
    if (rot) {
      rot.unit = null;
      u.rotation = null;
    }
    this.log(`${u.id} runs empty from ${this.stations.get(station)?.name ?? station} to the depot`, "fleet");
    this._toDepot(u, station, this.now);
  }

  /** A spare at the depot takes over the rest of a unit's rotation (so that it can go to the workshop). */
  _swapForRepair(u, rot) {
    const s = this._spare(u.type.id, this.now + this.model.dispatch.pull_out_min);
    if (!s || s === u) return false;
    rot.unit = s;
    s.rotation = rot;
    u.rotation = null;
    this.log(`${s.id} takes over ${rot.tpl.id} from ${u.id}, which goes to the workshop`, "fleet");
    return true;
  }

  /** A unit goes back to the depot (with an empty run from where it is). */
  _toDepot(u, from, t) {
    const m = this.model;
    const empty = emptyRunMin(m, from, this.depot);
    if (empty > 0) {
      const km = emptyRunKm(m, from, this.depot);
      u.run(km, t + empty);
      this.stat("emptyKm", km);
    }
    u.at = this.depot;
    u.inDepot = true;
    u.readyAt = t + empty + m.dispatch.pull_in_min;
    this._kickJobs(u);
  }

  /** Cancel a trip, and the trips of its piece of work that would start where it does not go. */
  _cancel(trip, cause, { chain = true } = {}) {
    if (!trip || (trip.state !== "planned" && trip.state !== "waiting")) return;
    trip.state = "cancelled";
    trip.cause = cause;
    const day = trip.day;
    this.stat("tripsCancelled", 1, null, day);
    this.stat("kmCancelled", trip.km, null, day);
    this.stat("cancel", 1, cause, day);
    this.incident({ type: "cancel", cause, km: trip.km, ref: trip.id });
    for (const rot of trip.rots) {
      rot.lastCancelCause = cause;
      this._sendHomeIfIdle(rot.unit, trip.from);
    }
    if (this.today >= this.measureFrom) this.log(`${trip.lineName} ${hhmm(trip.dep)} cancelled: ${causeWord(cause)}`, "cancel");
    this.emit("trip.cancelled", { trip, cause });
    this.desk.tripCancelled(trip);
    if (chain) {
      for (const role of ["driver", "conductor"]) {
        const pi = trip.pieces[role];
        if (!pi) continue;
        // the unit and its crew stay where the cancelled trip starts: the trips that start elsewhere cannot run
        const i = pi.trips.indexOf(trip);
        for (const t2 of pi.trips.slice(i + 1)) {
          if ((t2.state !== "planned" && t2.state !== "waiting") || t2.from === trip.from) break;
          this._cancel(t2, cause, { chain: false });
        }
      }
    }
    for (const role of ["driver", "conductor"]) {
      const pi = trip.pieces[role];
      if (pi && pi.trips.every((t2) => t2.state !== "planned" && t2.state !== "waiting" && t2.state !== "running")) this.desk.pieceDropped(pi);
    }
  }

  /* ================================================================ failures */

  /** Mark a unit failed, book it and tell the maintenance planning. */
  _fail(u, trip, where) {
    const repeatDays = Math.max(...this.model.contracts.map((c) => c.penalties.repeat_days || 0), 14);
    const repeat = this.now - u.lastWorkshop <= repeatDays * DAY;
    u.failCause = repeat ? "repeat" : "failure";
    u.status = "failed";
    u.failedAt = this.now;
    this.stat("hardFailures", 1);
    if (repeat) this.stat("repeatFailures", 1);
    this.incident({ type: "hard_failure", cause: u.failCause, ref: u.id });
    if (repeat) this.incident({ type: "repeat_failure", cause: "repeat", ref: u.id });
    this.log(`${u.id} failed ${where}${trip ? ` (${trip.lineName} ${hhmm(trip.dep)})` : ""}${repeat ? ", again soon after the workshop" : ""}`, "failure");
    this.emit("unit.failed", { unit: u, trip });
    for (const r of [u.rotation, u.queued]) if (r?.unit === u) r.unit = null;
    u.rotation = null;
    u.queued = null;
    this._report(u, "repair");
  }

  _hardFailure(u, trip, f) {
    if (!u || !trip || trip.state !== "running" || u.trip !== trip || u.failPending) return;
    const ft = u.type.failure;
    const rng = stream(this.seed, "breakdown", u.id, trip.id);
    this._fail(u, trip, "on the way");
    u.status = "service";
    if (rng.chance(ft.limp_share)) {
      // the train limps on to its destination, late
      const extra = lognormal(rng, ft.breakdown_min, 0.5);
      trip.delays[u.failCause] = (trip.delays[u.failCause] || 0) + extra;
      trip.arrE += extra;
      trip.token++;
      u.failPending = true;
      this.queue.push(trip.arrE, "trip.arr", { trip: trip.id, token: trip.token }, PRIO.arr);
      return;
    }
    // stranded: the trip ends here; the units are towed to the depot
    const done = Math.max(0, Math.min(1, f));
    trip.state = "terminated";
    trip.cause = u.failCause;
    trip.arrA = this.now;
    trip.token++;
    this.running.delete(trip);
    const kmRun = trip.km * done, rest = trip.km - kmRun;
    for (const x of trip.unitObjs) {
      x.run(kmRun, this.now);
      x.trip = null;
      x.at = this.depot;
      x.inDepot = true;
      x.readyAt = this.now + ft.tow_min;
      if (x === u) x.status = "failed";
      else if (x.status === "service") x.status = "ready";
      if (x.rotation?.unit === x) x.rotation.unit = null;
      x.rotation = null;
    }
    const day = trip.day;
    this.stat("tripsTerminated", 1, null, day);
    this.stat("kmRun", kmRun, null, day);
    this.stat("kmCancelled", rest, null, day);
    this.stat("cancel", 1, u.failCause, day);
    this.incident({ type: "cancel", cause: u.failCause, km: rest, ref: trip.id });
    for (const role of ["driver", "conductor"]) {
      const pid = role === "driver" ? trip.driver : trip.conductor;
      if (pid) this.desk.stuck(pid, this.now + ft.tow_min / 2 + deadheadMin(this.model, trip.to, this.base));
      const pi = trip.pieces[role];
      if (pi) {
        const i = pi.trips.indexOf(trip);
        for (const t2 of pi.trips.slice(i + 1)) this._cancel(t2, u.failCause, { chain: false });
        this.desk.pieceDropped(pi);
      }
    }
    this.log(`${trip.lineName} ${hhmm(trip.dep)} stopped on the way; ${trip.unitIds.join(" + ")} towed to the depot`, "failure");
    this.emit("trip.terminated", { trip, unit: u });
  }

  _softFailure(u, trip, f) {
    if (!u || !trip || trip.state !== "running" || u.trip !== trip) return;
    const kinds = this.model.maintenance.soft;
    if (!kinds.length) return;
    const draw = this._failureDraw(u, trip);
    let r = draw.kind * kinds.reduce((s, k) => s + k.share, 0), kind = kinds[kinds.length - 1];
    for (const k of kinds) {
      if (r < k.share) {
        kind = k;
        break;
      }
      r -= k.share;
    }
    if (u.defects.some((x) => x.kind === kind.id)) return;
    u.defects.push({ kind: kind.id, since: this.now, deadline: kind.deadline_h ? this.now + kind.deadline_h * 60 : null });
    this.stat("softFailures", 1);
    if (kind.delay_min) {
      const extra = kind.delay_min * (1 - f);
      trip.delays.defect = (trip.delays.defect || 0) + extra;
      trip.arrE += extra;
      trip.token++;
      this.queue.push(trip.arrE, "trip.arr", { trip: trip.id, token: trip.token }, PRIO.arr);
    }
    if (kind.comfort && !trip.comfortUnits.includes(u.id)) trip.comfortUnits.push(u.id);
    this.log(`${u.id}: ${kind.label.toLowerCase()} (${trip.lineName} ${hhmm(trip.dep)})`, "defect");
    this.emit("unit.defect", { unit: u, trip, kind });
    if (kind.deadline_h) this._report(u, "defect");
  }

  /* ================================================================ maintenance: planning (function 3) */

  /** The operator reports a unit to the maintenance planning (a failure, an overdue unit, a defect with a deadline). */
  _report(u, why) {
    const e = this.model.ecm;
    const at = this.deliver(this.model.operator, e.planning, this.now) + this.model.maintenance.planning.reaction_min;
    this.queue.push(at, "plan.repair", { unit: u.id, why }, PRIO.work);
  }

  /** Km of a unit as the planning sees it: late mileage data are extrapolated from the week before. */
  _plannerKm(u) {
    const e = this.model.ecm;
    const lat = e.planning === this.model.operator ? 0 : e.data_latency_h * 60;
    if (!lat) return u.km;
    const cut = this.now - lat;
    const seen = u.kmAt(cut), before = u.kmAt(cut - 7 * DAY);
    const rate = Math.max(0, seen - before) / (7 * DAY);
    return seen + rate * lat;
  }

  /** When a unit is free for the planning (after today's rotation, its job, its repair). */
  _freeFrom(u) {
    const transfer = this.model.maintenance.workshop.transfer_min;
    if (u.outUntil != null && this.now < u.outUntil) return u.outUntil;
    if (u.job && u.job.state !== "done") return (u.job.end ?? u.job.plannedEnd) + transfer;
    if (u.status === "failed") return Infinity;
    if (u.rotation && !u.rotation.done && u.rotation.day >= this.today) return u.rotation.pullIn;
    return Math.max(this.now, u.readyAt);
  }

  /** Km still to run today by the plan. */
  _remainingKm(u) {
    const rot = u.rotation;
    if (!rot || rot.done || rot.unit !== u) return 0;
    return rot.trips.filter((t) => t.state === "planned" || t.state === "waiting" || t.state === "running").reduce((s, t) => s + t.km, 0) + rot.emptyKm / 2;
  }

  /** The initial plan, made as if the planning had worked the day before: day 0 until its first working day. */
  _planInitial() {
    const planner = this.model.ecm.planning, at = this.model.maintenance.planning.at;
    let last = 0;
    while (last < 7 && !isOpen(this.hoursOf(planner), last * DAY + at, this.wd0)) last++;
    const proj = new Map();
    for (let D = 0; D <= last; D++) this._planDay(D, proj);
  }

  /** The daily planning run: plans the days until the planning works again. */
  _planRun(d) {
    const planner = this.model.ecm.planning, at = this.model.maintenance.planning.at;
    let last = d + 1;
    while (last < d + 8 && !isOpen(this.hoursOf(planner), last * DAY + at, this.wd0)) last++;
    const proj = new Map();
    for (let D = d + 1; D <= last; D++) this._planDay(D, proj);
  }

  /**
   * Plan one day: workshop jobs for the units that are due (in the night before, or during the day
   * when they must), then the units for the rotations (the most km left for the longest rotation).
   */
  _planDay(D, proj) {
    if (this.unitPlan.has(D) && D <= this.today) return;
    const m = this.model, w = m.maintenance.workshop, pl = m.maintenance.planning;
    const tpl = this.templates(D), base = D * DAY;
    const rots = tpl.rotations.map((r) => ({ r, pullOut: base + r.pullOut, pullIn: base + r.pullIn, km: r.km + r.emptyKm }));
    const firstOut = rots.length ? Math.min(...rots.map((r) => r.pullOut)) : base + 300;
    const avgKm = rots.length ? rots.reduce((s, r) => s + r.km, 0) / rots.length : 0;
    const pj = (u) => {
      let p = proj.get(u.id);
      if (!p) {
        p = { km: this._plannerKm(u) + this._remainingKm(u), free: this._freeFrom(u) };
        proj.set(u.id, p);
      }
      return p;
    };
    // what is due
    const needs = [];
    for (const u of this.units.values()) {
      const p = pj(u);
      if (u.status === "failed" || !Number.isFinite(p.free) || p.free > base + DAY) continue;
      if (u.job && u.job.state !== "done") continue;
      const prog = u.type.program;
      const after = u.mostDue(prog, base + DAY, p.km + avgKm);
      let level = null, mandatory = false;
      if (after && after.ratio >= 1) {
        mandatory = true;
        level = after.level;
      }
      // the highest level that is far enough on (it includes the lower ones)
      for (const l of prog) {
        const r = u.usage(l, base, p.km) / u.limit(l);
        if (r >= pl.early_share && (pl.strategy === "windows" || mandatory)) level = !level || l.includes.includes(level.id) || l.includes.length > level.includes.length ? l : level;
      }
      const defects = u.defects.filter((x) => !x.planned);
      const defectWork = defects.reduce((s, x) => s + (this.softKinds.get(x.kind)?.repair_h ?? 1) * 60, 0);
      const urgent = defects.some((x) => x.deadline != null && x.deadline < base + DAY);
      if (!level && !defectWork) continue;
      needs.push({ u, level, mandatory: mandatory || urgent, ratio: after?.ratio ?? 0, defects, defectWork });
    }
    needs.sort((a, b) => b.mandatory - a.mandatory || b.ratio - a.ratio || a.u.id.localeCompare(b.u.id));
    for (const need of needs) {
      const u = need.u, p = pj(u);
      const work = (need.level ? need.level.hours * 60 : 0) * w.speed + need.defectWork * w.speed;
      const earliest = Math.max(this.now, p.free) + w.transfer_min;
      const spec = { kind: need.level ? "inspection" : "defects", level: need.level, defects: need.defects, work, earliest };
      let job = this._book(u, { ...spec, latest: firstOut - w.transfer_min });
      if (!job && need.mandatory) job = this._book(u, { ...spec, latest: Infinity });
      if (job) {
        p.free = job.plannedEnd + w.transfer_min;
        if (need.mandatory && need.level) {
          const limitAt = this._limitTime(u, need.level, p.km);
          if (job.plannedStart > limitAt) this._requestExtension(u, need.level);
        }
      } else if (need.mandatory && need.level) this._requestExtension(u, need.level);
    }
    // units for the rotations
    const plan = new Map();
    plan.shortfallCause = new Map();
    const assigned = new Set();
    for (const rot of [...rots].sort((a, b) => b.km - a.km || a.pullOut - b.pullOut)) {
      let best = null;
      for (const u of this.units.values()) {
        if (assigned.has(u) || u.type.id !== rot.r.vehicle) continue;
        if (u.status === "failed" || (u.outUntil != null && rot.pullOut < u.outUntil)) continue;
        const p = pj(u);
        if (p.free > rot.pullOut) continue;
        const prog = u.type.program;
        const left = u.kmLeft(prog, base, p.km);
        if (left < rot.km || u.daysLeft(prog, base + DAY) < 0) continue;
        if (!best || left > best.left) best = { u, left };
      }
      if (!best) {
        // why: units kept for maintenance, or too few units
        const inJobs = [...this.units.values()].some((u) => u.type.id === rot.r.vehicle && u.job && u.job.state !== "done" && u.job.kind !== "repair" && !assigned.has(u));
        plan.shortfallCause.set(rot.r.id, inJobs ? "planning" : [...this.units.values()].some((u) => u.status === "failed") ? "failure" : "fleet");
        this.stat("shortfallRotations", 1, null, D);
        continue;
      }
      plan.set(rot.r.id, best.u.id);
      assigned.add(best.u);
      const p = pj(best.u);
      p.km += rot.km;
      p.free = rot.pullIn;
    }
    this.unitPlan.set(D, plan);
  }

  /** When a unit reaches its limit for a level (by km at the average daily km, or by days). */
  _limitTime(u, level, km) {
    const c = u.counters[level.id] || { km: 0, t: 0 };
    const lim = u.limit(level);
    let t = Infinity;
    if (level.every_km) t = Math.min(t, this.now + ((c.km + level.every_km * lim - km) / Math.max(1, this.avgKmPerDay)) * DAY);
    if (level.every_days) t = Math.min(t, c.t + level.every_days * DAY * lim);
    return t;
  }

  /** Ask the maintenance development (function 2) for a one-time extension of an interval. */
  _requestExtension(u, level) {
    const dev = this.model.maintenance.development;
    if (!(dev.extension > 0)) return;
    const key = `${level.id}@${u.counters[level.id]?.t ?? 0}`;
    u.requested ||= new Set();
    if (u.requested.has(key)) return;
    u.requested.add(key);
    const e = this.model.ecm;
    this.stat("extensionRequests", 1);
    const asked = this.deliver(e.planning, e.development, this.now);
    const decided = addWork(this.hoursOf(e.development), asked, dev.approval_h * 60, this.wd0);
    this.queue.push(this.deliver(e.development, e.planning, decided), "dev.decide", { unit: u.id, level: level.id }, PRIO.work);
  }

  _decideExtension(u, levelId) {
    if (!u) return;
    const level = u.type.program.find((l) => l.id === levelId);
    if (!level) return;
    if (stream(this.seed, "extension", u.id, levelId, this.today).chance(this.model.maintenance.development.grant)) {
      u.extensions[levelId] = this.model.maintenance.development.extension;
      u.overdueReported = false;
      this.stat("extensionsGranted", 1);
      this.log(`${u.id}: interval of ${level.name} extended once by ${Math.round(this.model.maintenance.development.extension * 100)} %`, "workshop");
    } else {
      u.extensionRefused = true;
      this.log(`${u.id}: no extension of ${level.name}`, "workshop");
    }
  }

  /** The planning learns of a failed, overdue or defective unit: a repair (or the job that is due) as soon as possible. */
  _planRepair(u) {
    if (!u) return;
    const m = this.model, w = m.maintenance.workshop;
    const rng = stream(this.seed, "repair", u.id, Math.round(u.failedAt ?? this.now));
    if (u.status === "failed" || u.failPending) {
      if (u.job && u.job.kind === "repair" && u.job.state !== "done") return;
      if (u.job && u.job.state === "planned") this._unbook(u.job);
      const ft = u.type.failure;
      const work = lognormal(rng, ft.repair_h * 60, ft.repair_sigma) * w.speed;
      const parts = rng.chance(w.parts_p) ? this.now + lognormal(rng, w.parts_h * 60, 0.5) : null;
      this.stat("repairs", 1);
      this._book(u, { kind: "repair", work, earliest: Math.max(this.now, u.readyAt), latest: Infinity, partsAt: parts });
      return;
    }
    if (u.job && u.job.state !== "done") return;
    if (this._overdue(u) || u.defects.some((x) => x.deadline != null && !x.planned)) {
      const due = u.mostDue(u.type.program, this.now);
      const level = due && due.ratio >= 0.95 ? due.level : null;
      const defects = u.defects.filter((x) => !x.planned);
      const work = ((level ? level.hours * 60 : 0) + defects.reduce((s, x) => s + (this.softKinds.get(x.kind)?.repair_h ?? 1) * 60, 0)) * w.speed;
      if (work > 0) this._book(u, { kind: level ? "inspection" : "defects", level, defects, work, earliest: Math.max(this.now, u.readyAt), latest: Infinity });
    }
  }

  /* ================================================================ maintenance: the workshop (function 4) */

  /** Book a job in the earliest bay slot within [earliest, latest]; null if none. */
  _book(u, { kind, level = null, defects = [], work, earliest, latest, partsAt = null }) {
    const w = this.model.maintenance.workshop, H = w.hours;
    let best = null;
    for (const bay of this.bays) {
      const books = bay.bookings.filter((b) => b.state !== "done").sort((a, b) => a.plannedStart - b.plannedStart);
      let s = earliest;
      for (let i = 0; i <= books.length; i++) {
        const start = nextOpen(H, s, this.wd0);
        const end = addWork(H, start, work, this.wd0);
        const b = books[i];
        const bEnd = b ? Math.max(b.plannedEnd, b.end ?? 0) : 0;
        if (!b || end <= b.plannedStart) {
          if (end <= latest && (!best || end < best.end)) best = { bay, start, end };
          break;
        }
        s = Math.max(s, bEnd);
      }
    }
    if (!best) return null;
    const e = this.model.ecm;
    const job = {
      id: `J${++this._jobSeq}`, unit: u.id, kind, level: level?.id ?? null, levelName: level?.name ?? null, defects: defects.map((x) => x.kind),
      work, plannedStart: best.start, plannedEnd: best.end, bay: best.bay.id, state: "planned",
      orderAt: this.deliver(e.planning, e.delivery, this.now), partsAt, start: null, end: null,
    };
    for (const x of defects) x.planned = job.id;
    this.jobs.set(job.id, job);
    best.bay.bookings.push(job);
    u.job = job;
    this.queue.push(best.start, "job.check", { job: job.id }, PRIO.work);
    this.emit("job.planned", { job, unit: u });
    return job;
  }

  _unbook(job) {
    const bay = this.bays.find((b) => b.id === job.bay);
    if (bay) bay.bookings = bay.bookings.filter((b) => b !== job);
    job.state = "done";
    job.cancelled = true;
    const u = this.units.get(job.unit);
    if (u?.job === job) u.job = null;
    for (const x of u?.defects || []) if (x.planned === job.id) x.planned = null;
  }

  /** A unit got to the depot: its job may start. */
  _kickJobs(u) {
    const job = u.job;
    if (job && (job.state === "planned" || job.state === "waiting") && job.plannedStart <= this.now + 1) {
      this.queue.push(Math.max(this.now, u.readyAt), "job.check", { job: job.id }, PRIO.work);
    }
  }

  /** Start a job when its unit is at the depot, its order and parts are there and its bay is free. */
  _jobCheck(job) {
    if (!job || (job.state !== "planned" && job.state !== "waiting")) return;
    const u = this.units.get(job.unit);
    const w = this.model.maintenance.workshop;
    if (!u) return this._unbook(job);
    const now = this.now;
    const external = w.transfer_min > 0;
    if (!(external && job.transferred)) {
      const atDepot = u.at === this.depot && u.inDepot && !u.trip && u.readyAt <= now + 0.01;
      // a unit still needed in service today waits for its job (unless it may not run anyway)
      const busy = u.rotation && !u.rotation.done && u.rotation.unit === u && u.status !== "failed" && !this._overdue(u)
        && u.rotation.trips.some((t) => (t.state === "planned" || t.state === "waiting") && t.dep < now + job.work);
      if (!atDepot || busy) {
        job.state = "waiting";
        if (!busy && u.status !== "service") this.queue.push(Math.max(now + 15, u.readyAt), "job.check", { job: job.id }, PRIO.work);
        return;
      }
    }
    const later = Math.max(job.orderAt, job.partsAt ?? -Infinity);
    if (later > now) {
      job.state = "waiting";
      if (u.status === "ready") u.status = "waiting";
      this.queue.push(later, "job.check", { job: job.id }, PRIO.work);
      return;
    }
    const bay = this.bays.find((b) => b.id === job.bay);
    if (bay.job && bay.job !== job) {
      job.state = "waiting";
      return;
    }
    // a workshop elsewhere: the unit runs there first
    if (external && !job.transferred) {
      job.transferred = true;
      job.state = "waiting";
      if (u.status !== "failed") u.status = "transfer";
      u.inDepot = false;
      u.at = "workshop";
      u.readyAt = now + w.transfer_min;
      this.stat("emptyKm", w.transfer_min);
      this.queue.push(u.readyAt, "job.check", { job: job.id }, PRIO.work);
      return;
    }
    if (external && u.readyAt > now + 0.01) {
      this.queue.push(u.readyAt, "job.check", { job: job.id }, PRIO.work);
      return;
    }
    // the work: planned hours with a spread, and findings that grow with the wear
    const rng = stream(this.seed, "job", job.id);
    let actual = job.work * Math.exp(w.spread * rng.normal() - (w.spread * w.spread) / 2);
    // a unit with more wear than its interval brings findings the plan did not expect
    if (job.kind === "inspection") actual += job.work * w.findings * Math.min(1.5, Math.max(0, u.wear / wearInterval(u.type.program) - 1)) * rng.uniform(0.5, 1.5);
    job.state = "running";
    job.start = now;
    job.actualWork = actual;
    job.end = addWork(w.hours, now, actual, this.wd0);
    bay.job = job;
    u.status = "job";
    u.inDepot = true;
    this.queue.push(job.end, "job.end", { job: job.id }, PRIO.work);
    this.emit("job.started", { job, unit: u });
  }

  _jobEnd(job) {
    if (!job || job.state !== "running") return;
    const u = this.units.get(job.unit);
    const m = this.model, w = m.maintenance.workshop, e = m.ecm;
    const now = this.now;
    job.state = "done";
    const bay = this.bays.find((b) => b.id === job.bay);
    if (bay) {
      bay.job = null;
      bay.bookings = bay.bookings.filter((b) => b !== job);
    }
    this.stat("workshopMin", job.actualWork);
    if (job.kind === "inspection") this.stat("inspections", 1);
    if (job.kind === "defects") this.stat("defectJobs", 1);
    if (u) {
      u.job = null;
      if (job.kind === "inspection" && job.level) {
        const level = u.type.program.find((l) => l.id === job.level);
        if (level) u.maintained(level, u.type.program, now, w.quality);
        u.defects = [];
      } else if (job.kind === "repair") {
        u.wear *= 1 - w.quality * 0.3;
        u.defects = u.defects.filter((x) => x.deadline == null);
      } else u.defects = u.defects.filter((x) => !job.defects.includes(x.kind));
      u.failCause = null;
      u.status = "ready";
      u.overdueReported = false;
      u.extensionRefused = false;
      u.lastWorkshop = now;
      u.at = this.depot;
      u.inDepot = true;
      u.readyAt = now + w.transfer_min;
      if (w.transfer_min) this.stat("emptyKm", w.transfer_min);
      // the release reaches the operator through the planning
      const released = this.deliver(e.planning, m.operator, this.deliver(e.delivery, e.planning, now));
      u.released = released <= now;
      if (!u.released) this.queue.push(released, "unit.release", { unit: u.id, job: job.id }, PRIO.work);
    }
    // late: longer than the planned work would have taken from the actual start
    const due = addWork(w.hours, job.start, job.work, this.wd0);
    const over = now - due;
    if (over > Math.max(30, 0.1 * job.work)) {
      this.stat("jobsLate", 1);
      this.stat("lateReleaseH", over / 60);
      this.incident({ type: "late_release", cause: "overrun", hours: over / 60, ref: job.id });
    }
    this.log(`${job.unit}: ${jobWord(job)} finished${over > Math.max(30, 0.1 * job.work) ? `, ${Math.round(over)} min late` : ""}`, "workshop");
    this.emit("job.finished", { job, unit: u });
    // the next job in the bay
    for (const b of bay?.bookings || []) if (b.state === "waiting" || (b.state === "planned" && b.plannedStart <= now)) this.queue.push(now, "job.check", { job: b.id }, PRIO.work);
  }

  _release(u, jobId) {
    if (!u || u.released) return;
    u.released = true;
    this.log(`${u.id} released for service`, "workshop");
    this.emit("unit.released", { unit: u, job: jobId });
  }

  /* ================================================================ crews: helpers for the desk */

  /** The latest trip from one station to another that arrives by `latest` (for crews coming to work by train). */
  commuteTrip(from, to, latest, day) {
    let best = null;
    for (const d of [day - 1, day]) {
      for (const trip of this.days.get(d)?.trips || []) {
        const i = trip.stops.findIndex((s) => s.station === from), j = trip.stops.findIndex((s) => s.station === to);
        if (i < 0 || j <= i) continue;
        const arr = trip.stops[j].arr;
        if (arr > latest || (best && arr <= best.arr)) continue;
        best = trip;
      }
    }
    return best;
  }

  /** The next trip of the same line and direction. */
  nextTripLike(trip) {
    for (const d of [trip.day, trip.day + 1]) {
      const list = this.days.get(d)?.trips || [];
      const next = list.filter((t) => t.line === trip.line && t.dir === trip.dir && t.dep > trip.dep && t.state === "planned").sort((a, b) => a.dep - b.dep)[0];
      if (next) return next;
    }
    return null;
  }

  tripsRunning() {
    return this.running;
  }

  /** Live: a crew member reached the crew base. */
  crewArrived(personId) {
    this.desk.arrivedAtBase(personId, this.now);
  }

  /* ================================================================ samples, stress, results */

  _sample() {
    for (const u of this.units.values()) {
      // idle away from the depot with nothing to do there in the next hours: back to the depot
      if (!u.trip && u.at && u.at !== this.depot && u.at !== "workshop" && u.status !== "failed" && u.readyAt <= this.now) {
        this._sendHomeIfIdle(u, u.at);
      }
      this.stat("unitMinTotal", SAMPLE_MIN);
      if (u.status === "service") this.stat("unitMinService", SAMPLE_MIN);
      else if (u.status === "job" || u.status === "transfer" || u.status === "waiting" || (u.job && u.job.state === "running")) this.stat("unitMinWorkshop", SAMPLE_MIN);
      else if (u.status === "failed" || (u.outUntil != null && this.now < u.outUntil)) this.stat("unitMinFailed", SAMPLE_MIN);
      else if (u.released && !this._overdue(u)) this.stat("unitMinAvailable", SAMPLE_MIN);
    }
    this.queue.push(this.now + SAMPLE_MIN, "sample", {}, PRIO.close);
  }

  /**
   * A stress event now: {type: "sick", count, notice_min} | {type: "failure", kind: "hard" | "soft", unit?}
   * | {type: "unit_out", count, days} | {type: "staff_loss", count | share} | {type: "workshop_closed", hours}
   * | {type: "station_closed" | "delay", station?, minutes}
   * @returns {string} what happened
   */
  inject(event) {
    const now = this.now;
    switch (event?.type) {
      case "sick": {
        const n = this.desk.sickNow(Math.max(1, Math.round(event.count ?? 1)), event.notice_min ?? 30);
        return `${n} sick call${n === 1 ? "" : "s"}`;
      }
      case "failure": {
        const list = [...this.running].flatMap((t) => t.unitObjs.map((u) => ({ u, t }))).filter((x) => !event.unit || x.u.id === event.unit);
        list.sort((a, b) => a.u.id.localeCompare(b.u.id));
        const pick = list[stream(this.seed, "inject", now).int(Math.max(1, list.length))];
        if (!pick) return "no train running";
        if (event.kind === "soft") this._softFailure(pick.u, pick.t, 0.5);
        else this._hardFailure(pick.u, pick.t, 0.5);
        return `${pick.u.id} failed`;
      }
      case "unit_out": {
        const units = [...this.units.values()].filter((u) => u.status !== "failed" && !(u.outUntil > now));
        units.sort((a, b) => (a.trip ? 1 : 0) - (b.trip ? 1 : 0) || a.id.localeCompare(b.id));
        const out = units.slice(0, Math.max(1, Math.round(event.count ?? 1)));
        for (const u of out) {
          u.outUntil = now + (event.days ?? 7) * DAY;
          if (u.rotation?.unit === u && !u.trip) u.rotation.unit = null;
        }
        this.log(`${out.map((u) => u.id).join(", ")} out of service for ${event.days ?? 7} days`, "fleet");
        return `${out.length} unit${out.length === 1 ? "" : "s"} out of service`;
      }
      case "staff_loss": {
        const drivers = [...this.desk.people.values()].filter((p) => p.role === "driver" && p.left == null).length;
        const n = this.desk.leave(Math.round(event.count ?? (event.share ?? 0.1) * drivers), this.today + 1);
        this.log(`${n} drivers leave the company`, "crew");
        return `${n} drivers leave`;
      }
      case "workshop_closed": {
        const until = now + (event.hours ?? 24) * 60;
        for (const bay of this.bays) bay.bookings.push({ id: `closed-${now}`, state: "planned", plannedStart: now, plannedEnd: until, closed: true });
        this.log(`Workshop closed until ${this.timeText(until)}`, "workshop");
        return "workshop closed";
      }
      case "station_closed":
      case "delay": {
        const station = event.station ?? "*", until = now + (event.minutes ?? 30);
        this.blocked.set(station, { until, cancel: event.type === "station_closed" });
        this.queue.push(until, "unblock", { station }, PRIO.close);
        return event.type === "delay" ? "trains held" : "station closed";
      }
      default:
        return "unknown event";
    }
  }

  /** Schedule stress events (from a stress test) relative to the first measured day. */
  scheduleStress(events = []) {
    for (const ev of events) {
      const at = (this.dayOffset + (Number(ev.day) || 0)) * DAY + (clockOf(ev.at) ?? 360);
      if (at >= this.now) this.queue.push(at, "stress", { event: ev }, PRIO.work);
    }
  }

  /**
   * Totals of the counters over days [from, to): by default the measured days up to today (or up to
   * yesterday without `includeToday`).
   */
  totals({ includeToday = true, from = this.measureFrom, to = includeToday ? Infinity : this.today } = {}) {
    const out = { days: 0, byCause: { cancel: {}, delay: {}, missing: {} } };
    for (const k of COUNTERS) out[k] = 0;
    for (const [day, d] of this.daily) {
      if (day < from || day >= to) continue;
      out.days++;
      for (const k of COUNTERS) out[k] += d[k] || 0;
      for (const g of Object.keys(out.byCause)) for (const [c, v] of Object.entries(d.byCause[g])) out.byCause[g][c] = (out.byCause[g][c] || 0) + v;
    }
    return out;
  }

  /** Penalties of the measured days: by contract, by cause and per party (paid, received, net). */
  penalties({ from = this.measureFrom * DAY, to = Infinity } = {}) {
    const byContract = {}, byCause = {}, parties = {};
    for (const p of this.model.parties) parties[p.id] = { paid: 0, received: 0 };
    for (const e of this.ledger.entries) {
      if (e.t < from || e.t >= to) continue;
      byContract[e.contract] = (byContract[e.contract] || 0) + e.amount;
      const key = `${e.contract}|${e.cause}`;
      byCause[key] = (byCause[key] || 0) + e.amount;
      parties[e.payer].paid += e.amount;
      parties[e.payee].received += e.amount;
    }
    for (const p of Object.values(parties)) p.net = p.received - p.paid;
    return { byContract, byCause, parties };
  }
}

const clockOf = (v) => {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Plain words for a cause (log lines). */
export function causeWord(cause) {
  return {
    crew: "no driver", commute: "driver late to work", sick: "driver off sick", rest: "driver's rest time", primary: "delay",
    capacity: "platform occupied", fleet: "no unit", failure: "unit failure", defect: "unit defect", overrun: "workshop late",
    repeat: "unit failed again", release: "release not passed on", planning: "unit in the workshop", overdue: "maintenance overdue",
    extension: "no interval extension", infrastructure: "infrastructure", external: "unit damaged",
  }[cause] || cause;
}

/** "inspection IS1", "repair", "defects" */
export function jobWord(job) {
  if (job.kind === "inspection") return job.levelName || job.level || "inspection";
  return job.kind === "repair" ? "repair" : "defect repair";
}

export { OPS_DEFAULTS };
