/**
 * Journeys (`{"type": "journeys", …}` in the layout's `simulations`): travellers made one by one,
 * each with a start, an aim and the travel plan its maker chose (planner.js), instead of a town
 * full of generated people. Made for exercises in a railway operations lab: every attendee makes a
 * traveller, chooses a plan with transfers and follows it on the layout.
 *
 * At its departure time a traveller sets off and takes its plan leg by leg: it walks over the road
 * network, waits at the stop (handed over to the passenger simulation, like the town's residents),
 * gets on the bus of its line or a train of its line towards its station, rides, gets off and
 * changes. A train it misses (or one that is cancelled) is not the end: it takes the next one of
 * the same line. Beyond the layout it rides along the timetable and arrives at the trip's time
 * (with the delay the train had). What happened is logged per traveller; `results()` compares the
 * planned and the real arrival.
 *
 * The trains come from rail.js: the journeys' own timetable, which the journeys run at the
 * platforms (as the services' planner), or the trips of the rail operations when they run. The
 * travellers are kept in the layout (`travellers`), so a layout carries an exercise; the state of a
 * journey is not: after loading, the journeys start again.
 * @module arail/journeys/simulation
 */
import { Simulation } from "../core/simulation.js";
import { CD, CD_LIGHT, mix, OVERLAY } from "../core/colors.js";
import { hashKey, polylineAt, rectAround } from "../core/math.js";
import { hiddenAt } from "../core/network.js";
import { Person, Population } from "../core/people.js";
import { drawPerson } from "../sims/passengers.js";
import { opsOf } from "../ops/simulation.js";
import { DAY, hhmm } from "../ops/util.js";
import { OperationsRail, TimetableRail, depAt, reaches, sameLine, worldNow } from "./rail.js";
import { Planner, WALK_MPS, areaName, placePoint, walkPath } from "./planner.js";

/** Colours of the travellers, by their number (CD colours and mixes of them, apart from each other). */
export const TRAVELLER_COLOURS = Object.freeze([
  CD.orange, CD.tuerkis, CD.brillantblau, CD.rot, CD.gelb, CD_LIGHT.tuerkis, mix(CD.rot, CD.brillantblau, 0.45), mix(CD.tuerkis, CD.gelb, 0.45),
  CD_LIGHT.orange, mix(CD.brillantblau, "#ffffff", 0.35), mix(CD.rot, CD.gelb, 0.35), mix(CD.tuerkis, CD.dunkelblau, 0.4),
]);

/** Words for the states of a traveller (the panel shows them). */
export const TRAVELLER_STATES = {
  home: "not left yet", walking: "walking", waiting: "waiting", bus: "on the bus", train: "on the train", beyond: "waiting beyond the layout",
  alighting: "getting off", outside: "outside a closed stop", arrived: "arrived", stuck: "cannot go on",
};

/** Clock minutes after its train's arrival a traveller coming in by train is put on the platform if no train came. */
const ARRIVAL_GRACE_MIN = 10;
/** Simulated seconds a traveller waits outside a closed stop before trying again. */
const RETRY_S = 5;
/** Longest time (simulated s) a bus waits for a traveller who is getting on. */
const BUS_HOLD_S = 20;

/** A traveller of the journeys: a Person with its plan and where it is on it. */
export class Traveller extends Person {
  constructor(spec) {
    super(spec);
    /** Number shown in its badge (1, 2, …). */
    this.number = Number(spec.number) || 1;
    this.colour = typeof spec.colour === "string" && spec.colour ? spec.colour : TRAVELLER_COLOURS[(this.number - 1) % TRAVELLER_COLOURS.length];
    this.from = spec.from;
    this.to = spec.to;
    /** Departure: minutes after 00:00 of the journey's day. */
    this.leave = Number(spec.leave) || 0;
    this.transfer = Number(spec.transfer_min ?? 3);
    /** The plan (times relative to the journey's day, like `leave`). */
    this.plan = spec.plan && Array.isArray(spec.plan.legs) ? spec.plan : { legs: [], dep: this.leave, arr: this.leave };
    this.reset(0);
  }

  /** Back to the start: the journey on world day `day`, not begun. */
  reset(day) {
    this.day = day;
    /** home | walking | waiting | bus | train | beyond | alighting | outside | arrived | stuck */
    this.state = "home";
    this.leg = -1;
    this.pos = null;
    this.dir = null;
    this.path = null;
    this.s = 0;
    this.phase = 0;
    this.then = null;
    this.person = null;
    this.area = null;
    this.vehicle = null;
    this.trip = null;
    this.retryAt = 0;
    /** Changing to this platform (stop area id) / walking over to it. */
    this.moveTo = null;
    this.target = null;
    /** The leg whose cancelled or missed train was logged. */
    this.noticed = -1;
    this.note = "";
    this.missed = 0;
    this.started = null;
    this.arrived = null;
    this.log = [];
  }

  /** World time of a time of the journey's day. */
  at(minutes) {
    return this.day * DAY + minutes;
  }

  /** The leg it is on (or about to begin), or null. */
  get current() {
    return this.plan.legs[this.leg] ?? null;
  }

  /** The planned arrival (world time). */
  get plannedArrival() {
    return this.at(this.plan.arr);
  }

  /** For the layout file: who it is and its plan. */
  toJSON() {
    return { id: this.id, name: this.name, number: this.number, colour: this.colour, from: this.from, to: this.to, leave: this.leave, transfer_min: this.transfer, plan: this.plan };
  }
}

export class JourneysSimulation extends Simulation {
  static type = "journeys";
  static label = "Journeys (travellers with travel plans)";
  static description = "Travellers made one by one, each with a start, an aim and a chosen travel plan with transfers, instead of generated people.";
  static params = [
    { key: "transfer_min", label: "Transfer time", type: "number", unit: "clock min", min: 0, max: 60, step: 1, default: 3, help: "The least time a new plan keeps between getting to a platform or off a vehicle and the next train." },
  ];

  /**
   * Problems of a journeys entry (validateLayout prefixes them).
   * @param {object} cfg the entry as written in the file
   * @param {object} layout the normalized layout
   */
  static validate(cfg, layout) {
    return validateJourneys(cfg, layout);
  }

  constructor(world, config = {}) {
    super(world, config);
    /** @type {Traveller[]} */
    this.travellers = (Array.isArray(config.travellers) ? config.travellers : []).filter((t) => t && typeof t === "object" && t.id).map((t) => new Traveller(t));
    for (const t of this.travellers) t.reset(world.clock.day);
    /** The traveller chosen in the panel (drawn with a ring). */
    this.selected = null;
    this.planner = new Planner(this);
    this._own = new TimetableRail(this);
    this._ops = null;
    const on = (name, fn) => world.events.on(name, fn);
    this._offs = [
      on("passenger.boarded", (e) => this._boarded(e)),
      on("passenger.exited", (e) => this._exited(e)),
      on("passenger.removed", (e) => this._removed(e)),
      on("vehicle.arrived", (e) => this._vehicleArrived(e)),
      on("clock.set", () => this._clockSet()),
    ];
    // the trains at the platforms: run by this timetable, unless the rail operations of the layout run them
    const ops = (world.layout?.simulations || []).some((s) => s.type === "operations" && s.enabled !== false);
    if (this.enabled && !ops && !world.services.planner) {
      world.services.planner = this;
      world.services.refreshModes();
    }
  }

  dispose() {
    this._offs.forEach((off) => off());
    if (this.world.services.planner === this) {
      this.world.services.planner = null;
      this.world.services.refreshModes();
    }
    this._own.reset();
  }

  /** The layout as it is now (objects edited since it was loaded). */
  layout() {
    return { ...this.world.layout, objects: this.world.objects.map((o) => o.spec) };
  }

  get passengers() {
    return this.world.simulations.find((s) => s.enabled && typeof s.enter === "function" && typeof s.alight === "function") || null;
  }

  /** The trains: the rail operations' trips when they run the trains, else the journeys' own timetable. */
  rail() {
    const ops = opsOf(this.world);
    if (ops?.active) {
      if (this._ops?.ops !== ops) this._ops = new OperationsRail(this, ops);
      return this._ops;
    }
    return this._own;
  }

  /** Runs: enabled, and the layout's first journeys simulation (another one stays idle). */
  get active() {
    return this.enabled && this.world.simulations.find((s) => s.constructor.type === JourneysSimulation.type) === this;
  }

  /** Does this simulation run the trains at the platforms (the services' planner)? */
  get runsTrains() {
    return this.enabled && this.world.services.planner === this;
  }

  /** ServiceManager planner: the platforms of the stations on the layout. */
  claims(dock) {
    return this.runsTrains && this._own.claims(dock);
  }

  /** Board lines of a platform: the next departures. */
  statusLines(area) {
    return this.runsTrains ? this._own.statusLines(area) : [];
  }

  clear() {}

  /* ---------------------------------------------------------------- travellers (the panel) */

  /** Places to start from and to go to (see Planner.places). */
  places() {
    return this.planner.places();
  }

  /**
   * World time for a time of day ("07:40" or minutes) at the clock's day: a time that passed more
   * than half an hour ago is tomorrow's.
   */
  departureTime(value) {
    const m = typeof value === "number" ? value : clockOf(value);
    if (m == null) return null;
    const now = worldNow(this.world), t = this.world.clock.day * DAY + m;
    return t < now - 30 ? t + DAY : t;
  }

  /**
   * Travel plans (see Planner.plan) from a place to another one.
   * @param {{from: object, to: object, leave: number | string, transfer?: number}} request
   *   `leave`: a time of day ("07:40") or a world time (number)
   */
  plan({ from, to, leave, transfer = this.config.transfer_min }) {
    const t = typeof leave === "string" ? this.departureTime(leave) : leave;
    if (t == null) return [];
    return this.planner.plan({ from, to, leave: t, transfer });
  }

  /** A name for a new traveller ("S. Fink"), not used by another one. */
  newName(n = this.travellers.length + 1) {
    const pop = new Population(this.world.seed, "journeys", this.travellers);
    for (let i = n; i < n + 50; i++) {
      const { name } = pop.name(["traveller", i]);
      if (!this.travellers.some((t) => t.name === name)) return name;
    }
    return `Traveller ${n}`;
  }

  /**
   * Add a traveller with the plan chosen for it (a plan of `plan()`, world times).
   * @param {{name?: string, from: object, to: object, plan: object, transfer?: number, colour?: string}} spec
   * @returns {Traveller}
   */
  addTraveller({ name, from, to, plan, transfer = this.config.transfer_min, colour }) {
    if (!plan?.legs?.length) throw new Error("Choose a travel plan first");
    const number = Math.max(0, ...this.travellers.map((t) => t.number)) + 1;
    let id = `t${number}`;
    while (this.travellers.some((t) => t.id === id)) id += "x";
    const day = Math.floor(plan.dep / DAY), base = day * DAY;
    const rel = (v) => (typeof v === "number" ? Math.round((v - base) * 100) / 100 : v);
    const legs = plan.legs.map((l) => ({ ...l, dep: rel(l.dep), arr: rel(l.arr), ...(l.type === "train" ? { day: l.day - day } : {}) }));
    const t = new Traveller({
      id, number, name: String(name || "").trim() || this.newName(number), colour, from, to, leave: rel(plan.dep), transfer_min: transfer,
      plan: { legs, dep: rel(plan.dep), arr: rel(plan.arr), transfers: plan.transfers },
    });
    t.reset(day);
    this.travellers.push(t);
    this.world.events.emit("journeys.traveller.added", { simulation: this, traveller: t });
    return t;
  }

  /** Remove a traveller (it leaves the stop or the bus it is on). */
  removeTraveller(id) {
    const t = this.travellers.find((x) => x.id === id);
    if (!t) return false;
    this._takeOff(t);
    this.travellers = this.travellers.filter((x) => x !== t);
    if (this.selected === id) this.selected = null;
    return true;
  }

  /** Start a traveller's journey again (at its departure time on the clock's day; at once if that has passed). */
  restart(id) {
    const t = this.travellers.find((x) => x.id === id);
    if (!t) return false;
    this._takeOff(t);
    t.reset(this.world.clock.day);
    return true;
  }

  /** Where a traveller is on the layout (layout mm), or null (inside, beyond the layout). */
  positionOf(id) {
    const t = this.travellers.find((x) => x.id === id);
    if (!t) return null;
    if (t.state === "walking") return t.pos;
    if (t.person && t.area) {
      const area = this.world.getStopArea(t.area);
      return area ? area.toLayout(t.person.pos[0], t.person.pos[1]) : null;
    }
    if (t.state === "bus" && t.vehicle?._pose) return t.vehicle._pose.front;
    if (t.state === "outside") return t.pos;
    if (t.state === "home") return t.from?.kind === "building" ? this._point(t, "from")?.pos ?? null : null;
    if (t.state === "arrived") return t.to?.kind === "building" ? t.pos ?? this._point(t, "to")?.pos ?? null : null;
    return null;
  }

  /** The place at the start or the aim of a traveller on the layout ({pos, key}), or null. */
  _point(t, end) {
    const legs = t.plan.legs, leg = end === "from" ? legs[0] : legs[legs.length - 1];
    if (!leg || leg.type !== "walk") return null;
    return placePoint(this.world, end === "from" ? leg.from : leg.to);
  }

  /* ---------------------------------------------------------------- status (the panel) */

  /**
   * What a traveller is doing, in words, with the planned and expected arrival (world times) and
   * the delay so far (minutes): {text, tone ("" | "ok" | "warn" | "bad"), planned, expected, delay}.
   */
  status(t) {
    const now = worldNow(this.world), rail = this.rail(), leg = t.current, planned = t.plannedArrival;
    const expected = this.expectedArrival(t);
    const delay = expected != null ? Math.round(expected - planned) : null;
    const tone = t.state === "stuck" ? "bad" : delay != null && delay >= 5 ? "bad" : delay != null && delay >= 1 ? "warn" : "ok";
    const out = (text, tn = tone) => ({ text, tone: tn, planned, expected, delay });
    switch (t.state) {
      case "home": return out(`Not left yet: leaves at ${hhmm(t.at(t.leave))}`, "");
      case "walking": return out(`Walking to ${leg?.toName ?? "the next stop"}`);
      case "outside": return out(t.note || "Waiting outside the stop", "warn");
      case "alighting": return out(`Getting off at ${leg?.type === "bus" ? leg.toName : leg?.toPlatform ?? leg?.toName ?? ""}`);
      case "bus": return out(`On ${leg.name} to ${leg.toName}`);
      case "waiting": {
        if (leg?.type === "bus") return out(`Waiting for ${leg.name} at ${leg.fromName}`);
        const trip = this._plannedTrip(t, leg), next = this._nextTrain(t, leg, now);
        const at = leg?.platform ? ` at ${leg.platform}` : "";
        if (trip && !trip.cancelled && !rail.departedFrom(trip, leg.from, now)) {
          const late = Math.round(trip.delay || 0);
          return out(`Waiting for ${leg.name} → ${leg.towards} ${hhmm(depAt(trip, leg.from))}${late >= 1 ? ` (+${late})` : ""}${at}`);
        }
        const why = trip?.cancelled ? `${leg.name} ${hhmm(t.at(leg.dep))} cancelled` : `Missed ${leg.name} ${hhmm(t.at(leg.dep))}`;
        return out(`${why}; next ${next ? hhmm(depAt(next, leg.from)) : "–"}${at}`, "warn");
      }
      case "beyond": {
        const trip = t.trip ? rail.trip(t.trip) : null;
        return out(`At ${leg?.fromName}, ${leg?.name} leaves ${trip ? hhmm(rail.expected(trip, leg.from, "dep")) : hhmm(t.at(leg?.dep ?? t.leave))}`);
      }
      case "train": {
        const trip = t.trip ? rail.trip(t.trip) : null;
        const eta = trip ? rail.expected(trip, leg.to, "arr") : null;
        return out(`On ${leg.name} to ${leg.toName}${eta != null ? `, arrives ${hhmm(eta)}` : ""}`);
      }
      case "arrived": return out(`Arrived at ${hhmm(t.arrived)}${delay >= 1 ? ` (+${delay} min)` : delay <= -1 ? ` (${delay} min)` : " (on time)"}`, delay >= 5 ? "bad" : delay >= 1 ? "warn" : "ok");
      case "stuck": return out(`Cannot go on: ${t.note}`, "bad");
      default: return out(t.state);
    }
  }

  /**
   * When a traveller is expected at its aim (world time): when it arrived; else the arrival of the
   * trains ahead of it, each the planned one if it can still be caught (after the train before and
   * the walks in between), else the next one of its line, plus what is left of the plan after the
   * last one. Without trains ahead: the plan's arrival (later by as much as it set off late).
   * Null when it cannot go on.
   */
  expectedArrival(t) {
    if (t.state === "arrived") return t.arrived;
    if (t.state === "stuck") return null;
    const rail = this.rail(), now = worldNow(this.world), legs = t.plan.legs;
    const late = t.state === "home" ? Math.max(0, now - t.at(t.leave)) : t.started != null ? Math.max(0, t.started - t.at(t.leave)) : 0;
    let end = null, last = -1;
    for (let i = Math.max(0, t.leg); i < legs.length; i++) {
      const leg = legs[i];
      if (leg.type !== "train") continue;
      let trip = null;
      if (i === t.leg && t.trip && (t.state === "train" || t.state === "beyond")) trip = rail.trip(t.trip);
      else {
        // when it can be at this train: after the train before and the walks between, else when it planned to be there (as late as it set off)
        const ready = end != null
          ? end + legs.slice(last + 1, i).reduce((sum, l) => sum + (l.type === "walk" ? l.min : l.arr - l.dep), 1)
          : t.at(i > 0 ? legs[i - 1].arr : t.leave) + late;
        trip = this._plannedTrip(t, leg);
        const dep = trip ? rail.expected(trip, leg.from, "dep") : null;
        if (!trip || trip.cancelled || dep < ready - 0.01 || rail.departedFrom(trip, leg.from, now)) trip = this._nextTrain(t, leg, Math.max(now, ready));
      }
      const eta = trip ? rail.expected(trip, leg.to, "arr") : null;
      if (eta == null) return null;
      end = eta;
      last = i;
    }
    return end == null ? t.plannedArrival + late : end + (t.plan.arr - legs[last].arr);
  }

  /** Rows for the results: who went where, planned and real arrival, delay, missed trains. */
  results() {
    return this.travellers.map((t) => {
      const st = this.status(t);
      return {
        id: t.id, number: t.number, name: t.name, from: placeName(this, t.from), to: placeName(this, t.to),
        leave: t.at(t.leave), planned: t.plannedArrival, arrived: t.arrived, expected: st.expected, delay: st.delay,
        transfers: t.plan.transfers ?? Math.max(0, t.plan.legs.filter((l) => l.type !== "walk").length - 1), missed: t.missed, state: t.state, status: st.text,
      };
    });
  }

  /* ---------------------------------------------------------------- the journey */

  step(dt) {
    if (!this.active) return;
    const rail = this.rail();
    if (this.runsTrains) this._own.step();
    else rail.ensure?.();
    const now = worldNow(this.world);
    for (const t of this.travellers) this._stepTraveller(t, now, dt);
  }

  _log(t, text, now = worldNow(this.world)) {
    t.log.push({ t: now, text });
    if (t.log.length > 60) t.log.shift();
  }

  _stepTraveller(t, now, dt) {
    switch (t.state) {
      case "home":
        if (now >= t.at(t.leave)) this._start(t, now);
        break;
      case "walking":
        this._walk(t, dt, now);
        break;
      case "waiting":
        if (t.person && !t.moveTo && !this._onStop(t)) this._enter(t, now, t.area); // taken off the stop without a word: back to it
        else {
          this._checkPlatform(t);
          this._holdBus(t, dt);
          this._notice(t, now);
        }
        break;
      case "beyond":
        this._waitBeyond(t, now);
        break;
      case "train":
        this._ride(t, now);
        break;
      case "bus":
        this._checkBus(t, now);
        break;
      case "outside":
        if (this.world.time >= t.retryAt) this._retry(t, now);
        break;
    }
  }

  _start(t, now) {
    t.started = now;
    const late = Math.round(now - t.at(t.leave));
    this._log(t, `Left ${placeName(this, t.from)}${late >= 2 ? ` (${late} min late)` : ""}`, now);
    t.leg = 0;
    this._begin(t, now);
  }

  /** Begin the current leg. */
  _begin(t, now) {
    const leg = t.current;
    if (!leg) return this._finish(t, now);
    if (leg.type === "walk") return this._walkLeg(t, leg);
    if (leg.type === "bus") return this._enter(t, now);
    if (leg.type === "train") {
      const rail = this.rail();
      if (rail.station(leg.from)?.on_layout) return this._enter(t, now);
      // beyond the layout: there until the train leaves (the next one, if it set off too late for its own)
      t.state = "beyond";
      t.pos = null;
      let trip = this._plannedTrip(t, leg);
      if (trip && !trip.cancelled && rail.departedFrom(trip, leg.from, now)) {
        const next = this._nextTrain(t, leg, now);
        if (next) {
          t.missed++;
          this._log(t, `Too late for ${leg.name} ${hhmm(depAt(trip, leg.from))}: takes the one at ${hhmm(depAt(next, leg.from))}`, now);
        }
        trip = next;
      }
      t.trip = trip?.id ?? null;
      return this._waitBeyond(t, now);
    }
    return this._stuck(t, `unknown leg "${leg.type}"`);
  }

  _walkLeg(t, leg) {
    const from = t.pos ? { pos: t.pos, key: null } : placePoint(this.world, leg.from);
    const to = placePoint(this.world, leg.to);
    if (!from || !to) return this._stuck(t, `${!from ? leg.fromName : leg.toName} is not on the layout any more`);
    this._walkTo(t, from, to, "next");
  }

  /** Walk from a place to another one; then go on with `then` ("next": the next leg, "enter": the stop of the leg). */
  _walkTo(t, from, to, then) {
    t.path = walkPath(this.world, from, to);
    t.pos = from.pos.slice();
    t.s = 0;
    t.then = then;
    t.state = "walking";
    t.person = null;
    t.area = null;
  }

  _walk(t, dt, now) {
    const path = t.path;
    if (!path) return this._next(t, now);
    t.s += ((WALK_MPS * 1000) / this.world.scale) * dt;
    t.phase += WALK_MPS * dt * 5;
    if (t.s >= path.length) {
      t.pos = path.points[path.points.length - 1].slice();
      t.path = null;
      if (t.then === "platform") return this._enter(t, now, t.target);
      return this._next(t, now);
    }
    const at = polylineAt(path.points, t.s, path.lengths);
    t.pos = at.point;
    t.dir = at.dir;
  }

  _next(t, now) {
    t.leg++;
    this._begin(t, now);
  }

  /**
   * On to the stop of the current leg (a bus or a train from a platform of the layout), or to
   * another platform of its station (`areaId`, its train is there).
   */
  _enter(t, now, areaId = null) {
    const leg = t.current, pax = this.passengers;
    areaId ??= leg.type === "bus" ? leg.fromArea : leg.area;
    const area = areaId ? this.world.getStopArea(areaId) : null;
    if (!pax || !area) return this._stuck(t, `${leg.type === "bus" ? leg.fromName : leg.platform ?? leg.fromName} cannot be used`);
    const opts = leg.type === "bus"
      ? { dockId: area.docks.some((d) => d.id === leg.fromDock) ? leg.fromDock : null, line: leg.line, anyDock: !area.docks.some((d) => d.id === leg.fromDock) }
      : { anyDock: true, accept: (v) => this._takes(t, leg, v) };
    const p = pax.enter(area.id, { agent: t, at: t.pos, ...opts });
    if (!p) return this._stuck(t, `${areaName(area)} cannot be used`);
    t.person = p;
    t.area = area.id;
    t.state = "waiting";
    t.waitSince = now;
  }

  /**
   * Waiting for a train: when its train stands (or comes in) at another platform of the station
   * and none at this one, the traveller goes over there (a change of platform).
   */
  _checkPlatform(t) {
    const leg = t.current;
    if (leg?.type !== "train" || !t.person || t.moveTo || t.person.state !== "waiting") return;
    const station = this.rail().station(leg.from);
    if (!station?.on_layout) return;
    let here = false, there = null;
    for (const st of this.world.services.docks.values()) {
      const v = st.vehicle;
      if (!v || (v.phase !== "arriving" && v.phase !== "dwelling") || !station.platforms.includes(st.dock.area.owner?.id) || !this._takes(t, leg, v)) continue;
      if (st.dock.area.id === t.area) here = true;
      else there ??= st.dock.area;
    }
    if (here || !there || !this.passengers?.release(t.person)) return;
    t.moveTo = there.id;
    this._log(t, `${leg.name} is at ${there.owner?.name ?? there.id}: changes platform`);
  }

  /** Waiting for a train: its planned train is cancelled or gone (logged once). */
  _notice(t, now) {
    const leg = t.current;
    if (leg?.type !== "train" || t.noticed === t.leg) return;
    const rail = this.rail(), trip = this._plannedTrip(t, leg);
    if (!trip || (!trip.cancelled && !rail.departedFrom(trip, leg.from, now))) return;
    t.noticed = t.leg;
    const next = this._nextTrain(t, leg, now);
    const when = next ? ` Next: ${hhmm(depAt(next, leg.from))}.` : "";
    this._log(t, `${leg.name} ${hhmm(depAt(trip, leg.from))} ${trip.cancelled ? "is cancelled" : "has left without it"}.${when}`, now);
  }

  /** The driver waits for a traveller who is getting on the bus (a little while). */
  _holdBus(t, dt) {
    const p = t.person, v = p?.vehicle;
    if (p?.state !== "boarding" || v?.kind !== "bus" || v.phase !== "dwelling") {
      t.holding = 0;
      return;
    }
    t.holding = (t.holding || 0) + dt;
    if (t.holding < BUS_HOLD_S) v.dwellLeft = Math.max(v.dwellLeft, 1);
  }

  /** A person getting off at a stop leaves it by the exit the next walk of the plan starts from. */
  _exitAsPlanned(t, p, area) {
    const next = t.plan.legs[t.leg + 1];
    const e = next?.type === "walk" && next.from?.kind === "area" && next.from.id === area.id ? area.access[next.from.access ?? 0] : null;
    if (e) p.target = [e.s, e.t];
  }

  /** Is the traveller's person still on its stop (the passenger simulation may drop people)? */
  _onStop(t) {
    const crowd = this.passengers?.crowds?.get(t.area);
    return !!crowd?.people.includes(t.person);
  }

  /** Does a traveller get on this train? A train of its line that goes to its station. */
  _takes(t, leg, v) {
    const trip = this.rail().tripOf(v);
    if (trip) return trip.line === leg.line && !trip.cancelled && reaches(trip, leg.from, leg.to);
    if (v?.journeys || v?.ops) return false; // a train of the timetable that ends here or waits for another trip
    return sameLine(v?.line, leg.name); // a train of the control system (or the built-in timetable): by its line
  }

  /** The trip of the plan for a train leg (the trip it planned with), or null. */
  _plannedTrip(t, leg) {
    if (!leg || leg.type !== "train") return null;
    return this.rail().find(t.day + (leg.day ?? 0), leg.trip);
  }

  /** The next trip of a train leg's line from its station to its aim, leaving at `after` or later. */
  _nextTrain(t, leg, after) {
    if (!leg) return null;
    const rail = this.rail(), d0 = Math.floor(after / DAY);
    let best = null;
    for (let d = d0 - 1; d <= d0 + 1; d++) {
      for (const trip of rail.trips(d)) {
        if (trip.line !== leg.line || trip.cancelled || !reaches(trip, leg.from, leg.to)) continue;
        const dep = rail.expected(trip, leg.from, "dep");
        if (dep < after || rail.departedFrom(trip, leg.from, after)) continue;
        if (!best || dep < rail.expected(best, leg.from, "dep")) best = trip;
      }
    }
    return best;
  }

  /** At a station beyond the layout: the train leaves (the planned one, or the next one if it is cancelled). */
  _waitBeyond(t, now) {
    const rail = this.rail(), leg = t.current;
    let trip = t.trip ? rail.trip(t.trip) : null;
    if (!trip || trip.cancelled) {
      const next = this._nextTrain(t, leg, Math.max(now, trip ? depAt(trip, leg.from) : t.at(leg.dep)));
      if (!next) return this._stuck(t, `no more ${leg.name} from ${leg.fromName}`);
      if (trip) {
        t.missed++;
        this._log(t, `${leg.name} ${hhmm(t.at(leg.dep))} from ${leg.fromName} cancelled: takes the one at ${hhmm(depAt(next, leg.from))}`, now);
      }
      trip = next;
      t.trip = next.id;
    }
    if (!rail.departedFrom(trip, leg.from, now)) return;
    t.state = "train";
    const late = Math.round(rail.expected(trip, leg.from, "dep") - depAt(trip, leg.from));
    this._log(t, `${leg.name} ${hhmm(depAt(trip, leg.from))} from ${leg.fromName}${late >= 1 ? ` (+${late})` : ""}`, now);
  }

  /** On a train: arrived at a station beyond the layout at the trip's time; at a platform of the layout when the train comes in. */
  _ride(t, now) {
    const rail = this.rail(), leg = t.current;
    const trip = t.trip ? rail.trip(t.trip) : null;
    const eta = trip ? rail.expected(trip, leg.to, "arr") : t.at(leg.arr) + (t.lateBy || 0);
    if (rail.station(leg.to)?.on_layout) {
      // the traveller gets off when its train comes in (vehicle.arrived); if none comes (no free track, a clock jump): on the platform anyway
      if (eta != null && now > eta + ARRIVAL_GRACE_MIN) this._alightWithout(t, leg, now);
      return;
    }
    if (eta != null && now >= eta) {
      this._log(t, `Arrived at ${leg.toName} by ${leg.name}`, now);
      t.trip = null;
      this._next(t, now);
    }
  }

  /** Put a traveller whose train did not come in on the platform (it walks off as if it got off). */
  _alightWithout(t, leg, now) {
    const area = leg.toArea ? this.world.getStopArea(leg.toArea) : null;
    const dock = area?.docks.find((d) => d.kind === "rail") || area?.docks[0];
    const pax = this.passengers;
    t.trip = null;
    this._log(t, `Off ${leg.name} at ${leg.toPlatform ?? leg.toName}`, now);
    if (!dock || !pax) return this._next(t, now);
    t.state = "alighting";
    const [p] = pax.alight({ kind: "train", dock }, dock, [t]);
    if (!p) return this._next(t, now);
    this._alighted(p, area);
  }

  /** On the bus: if the bus is gone (out of service, the line changed), off where it is and on foot to the stop. */
  _checkBus(t, now) {
    const bus = t.vehicle, buses = this.world.transit?.buses || [];
    if (bus && buses.includes(bus) && bus.phase !== "gone" && bus.riders?.some((r) => r.agent === t)) return;
    const leg = t.current;
    const to = placePoint(this.world, { kind: "area", id: leg.toArea, access: 0 });
    t.vehicle = null;
    this._log(t, `${leg.name} went out of service: on foot to ${leg.toName}`, now);
    const at = bus?._pose?.front ?? t.pos;
    if (!to || !at) return this._next(t, now);
    this._walkTo(t, { pos: at, key: null }, to, "next");
  }

  /** In front of a closed stop: in again when it opens. */
  /** The stop area where the traveller's current leg begins (a bus stop, or a platform), or null. */
  _legArea(t) {
    const leg = t.current;
    return (leg && this.world.getStopArea(leg.type === "bus" ? leg.fromArea : leg.area)) || null;
  }

  _retry(t, now) {
    const area = this._legArea(t);
    // still closed, or still sending people away (rail replacement): wait on
    const fx = area ? this.world.disruptions.effectsFor(area) : null;
    if (fx && (fx.closed || fx.leave)) {
      t.retryAt = this.world.time + RETRY_S;
      return;
    }
    t.note = "";
    this._enter(t, now);
  }

  _finish(t, now) {
    t.state = "arrived";
    t.arrived = t.arrived ?? now;
    t.person = null;
    t.area = null;
    t.vehicle = null;
    t.trip = null;
    t.path = null;
    const late = Math.round(t.arrived - t.plannedArrival);
    this._log(t, `Arrived at ${placeName(this, t.to)}${late >= 1 ? `, ${late} min late` : late <= -1 ? `, ${-late} min early` : ", on time"}`, now);
    this.world.events.emit("journeys.traveller.arrived", { simulation: this, traveller: t, delay: late });
  }

  _stuck(t, why) {
    t.state = "stuck";
    t.note = why;
    t.person = null;
    t.area = null;
    this._log(t, `Cannot go on: ${why}`);
  }

  /** Take a traveller off its stop and its bus (it is removed or starts again). */
  _takeOff(t) {
    if (t.person) {
      const crowd = this.passengers?.crowds?.get(t.area);
      if (crowd) crowd.people = crowd.people.filter((p) => p !== t.person);
    }
    if (t.vehicle?.riders) t.vehicle.riders = t.vehicle.riders.filter((r) => r.agent !== t);
    t.person = null;
    t.vehicle = null;
  }

  /* ---------------------------------------------------------------- events */

  _ours(agent) {
    return agent instanceof Traveller && this.travellers.includes(agent) ? agent : null;
  }

  _boarded({ agent, vehicle }) {
    const t = this._ours(agent);
    if (!t) return;
    const now = worldNow(this.world), leg = t.current;
    t.person = null;
    t.area = null;
    if (leg?.type === "bus") {
      t.state = "bus";
      t.vehicle = vehicle;
      if (!Array.isArray(vehicle.riders)) vehicle.riders = [];
      vehicle.riders.push({ agent: t, toDockId: leg.toDock });
      this._log(t, `${leg.name} from ${leg.fromName}`, now);
      return;
    }
    if (leg?.type === "train") {
      const rail = this.rail(), trip = rail.tripOf(vehicle), planned = this._plannedTrip(t, leg);
      t.state = "train";
      t.vehicle = null;
      t.pos = null;
      t.trip = trip?.id ?? null;
      t.lateBy = trip ? 0 : Math.max(0, now - t.at(leg.dep));
      const dep = trip ? depAt(trip, leg.from) : null;
      if (trip && planned && trip.id !== planned.id) {
        t.missed++;
        this._log(t, `${leg.name} ${hhmm(dep)} instead of ${hhmm(t.at(leg.dep))}`, now);
      } else this._log(t, `${leg.name} → ${leg.towards}${dep != null ? ` ${hhmm(dep)}` : ""} from ${leg.platform ?? leg.fromName}`, now);
      return;
    }
    this._stuck(t, "got on something unexpected");
  }

  _exited({ agent, pos }) {
    const t = this._ours(agent);
    if (!t) return;
    const now = worldNow(this.world);
    t.person = null;
    t.area = null;
    if (pos) t.pos = pos.slice();
    if (t.state === "alighting") return this._next(t, now);
    if (t.state === "waiting" && t.moveTo) {
      // over to the platform where its train is
      const area = this.world.getStopArea(t.moveTo);
      t.moveTo = null;
      const i = area ? nearestAccess(area, t.pos) : 0;
      const to = area ? placePoint(this.world, { kind: "area", id: area.id, access: i }) : null;
      if (!to || !t.pos) return this._enter(t, now);
      t.target = area.id;
      return this._walkTo(t, { pos: t.pos, key: null }, to, "platform");
    }
    if (t.state === "waiting") {
      // left the stop without getting on: it is closed, or nothing runs from it (rail replacement)
      const at = this._legArea(t);
      const fx = at ? this.world.disruptions.effectsFor(at) : null;
      t.state = "outside";
      t.note = fx && !fx.closed && fx.leave ? "Nothing runs from this stop: waiting outside" : "The stop is closed: waiting outside";
      t.retryAt = this.world.time + RETRY_S;
      this._log(t, t.note, now);
    }
  }

  _removed({ agent }) {
    const t = this._ours(agent);
    if (!t) return;
    t.person = null;
    t.area = null;
    if (t.state === "waiting") {
      t.state = "outside";
      t.retryAt = this.world.time + 1;
    } else if (t.state === "alighting") this._next(t, worldNow(this.world));
  }

  _vehicleArrived({ vehicle, dock }) {
    if (!vehicle || !dock) return;
    const now = worldNow(this.world), pax = this.passengers;
    // travellers on a bus get off at their stop
    if (Array.isArray(vehicle.riders) && vehicle.riders.length) {
      const off = vehicle.riders.filter((r) => r.toDockId === dock.id && this._ours(r.agent));
      if (off.length) {
        vehicle.riders = vehicle.riders.filter((r) => !off.includes(r));
        const agents = off.map((r) => r.agent);
        for (const t of agents) {
          t.vehicle = null;
          t.state = "alighting";
          this._log(t, `Off at ${t.current?.toName ?? dock.area.owner?.name}`, now);
        }
        if (pax) for (const p of pax.alight(vehicle, dock, agents)) this._alighted(p, dock.area);
        else for (const t of agents) this._next(t, now);
      }
    }
    // travellers on a train that comes in at a platform of the layout
    if (dock.kind !== "rail" && vehicle.kind !== "train") return;
    const rail = this.rail();
    const station = rail.stations.find((s) => s.on_layout && s.platforms.includes(dock.area.owner?.id));
    if (!station) return;
    const came = rail.arrivedTripOf(vehicle);
    const off = this.travellers.filter((t) => {
      const leg = t.current;
      if (t.state !== "train" || leg?.type !== "train" || leg.to !== station.id) return false;
      if (came) return came.id === t.trip;
      return !vehicle.journeys && !vehicle.ops && sameLine(vehicle.line, leg.name);
    });
    if (!off.length) return;
    for (const t of off) {
      t.state = "alighting";
      t.trip = null;
      this._log(t, `Off ${t.current.name} at ${dock.area.owner?.name ?? station.name}`, now);
    }
    if (pax) for (const p of pax.alight(vehicle, dock, off)) this._alighted(p, dock.area);
    else for (const t of off) this._next(t, now);
  }

  /** A traveller's person got off at a stop area. */
  _alighted(p, area) {
    const t = p.agent;
    t.person = p;
    t.area = area.id;
    this._exitAsPlanned(t, p, area);
  }

  /** The clock was set: travellers whose departure is still ahead start again. */
  _clockSet() {
    this._own.reset();
    const now = worldNow(this.world), day = this.world.clock.day;
    for (const t of this.travellers) {
      if (now >= day * DAY + t.leave) continue;
      this._takeOff(t);
      t.reset(day);
    }
  }

  /* ---------------------------------------------------------------- pointing at travellers */

  /**
   * The travellers walking and those at their start as pickables (core/pick.js); at a stop they are
   * the passenger simulation's people, on a bus or a train they are out of sight.
   */
  pickables(view) {
    if (!this.active) return [];
    const out = [];
    for (const t of this.travellers) {
      let at = null;
      if (t.state === "walking" && t.pos && !hiddenAt(t.path, t.s)) at = t.pos;
      else if (t.state === "home" || (t.state === "arrived" && this.selected === t.id)) at = this.positionOf(t.id);
      if (at) out.push({ key: `traveller:${t.id}`, kind: "person", label: t.name, outline: rectAround(at, view.m(0.9), view.m(0.9)), z0: 0, z1: view.m(1.8), owner: this, ref: t });
    }
    return out;
  }

  card(hit) {
    return this.describeAgent(hit.ref);
  }

  /** The card of a traveller: what it does, its plan, when it arrives. */
  describeAgent(t) {
    if (!this.travellers.includes(t)) return null;
    const st = this.status(t);
    const legs = (t.plan.legs || []).map((leg) => leg.type === "walk"
      ? `${hhmm(t.at(leg.dep))} walk to ${leg.toName} (${leg.min} min)`
      : `${hhmm(t.at(leg.dep))} ${leg.name} ${leg.fromName} → ${leg.toName}`);
    const rows = [["Leaves", hhmm(t.at(t.leave))], ["Planned arrival", hhmm(st.planned)]];
    if (st.expected != null && st.expected !== st.planned) rows.push(["Expected arrival", hhmm(st.expected)]);
    return {
      title: t.name,
      subtitle: `Traveller ${t.number} · journeys`,
      status: st.text,
      tone: st.tone,
      rows,
      sections: legs.length ? [{ title: "Travel plan", lines: legs }] : [],
      actions: [{ id: "follow", label: "Follow" }],
    };
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.active) return;
    const labels = this.world.settings.labels !== false;
    for (const t of this.travellers) {
      const chosen = this.selected === t.id;
      let at = null;
      let hidden = false;
      if (t.state === "walking" && t.pos) {
        // the walk is on the sidewalks already (RoadNetwork.walkLine)
        at = t.pos.slice();
        const dir = t.dir || [1, 0];
        // in the underpass or off stage: out of sight (the chosen traveller keeps its ring and name)
        hidden = hiddenAt(t.path, t.s);
        if (hidden && !chosen) continue;
        if (!hidden && view.inImage(at[0], at[1], 0)) drawPerson(view, at, { dir, speed: WALK_MPS, phase: t.phase, height: 1.7 + (hashKey(t.id) % 20) / 100, colour: t.colour });
      } else at = this.positionOf(t.id);
      if (!at) continue;
      if (t.state === "home" || t.state === "arrived") {
        // at the start (or the aim): a dot at the door; the name only for the chosen traveller
        if (!chosen && t.state === "arrived") continue;
        view.polygon(circle(at, view.m(0.9)), { fill: t.colour, stroke: "#ffffff", width: 1.5, order: 9 });
      }
      if (chosen) view.polygon(circle(at, view.m(2.2)), { stroke: OVERLAY.selection, width: 3, order: 9 });
      if (!labels && !chosen) continue;
      const text = t.state === "home" ? `${t.name} · ${hhmm(t.at(t.leave))}` : t.state === "arrived" ? `${t.name} · arrived` : hidden ? `${t.name} · ${t.path?.offstage ? "out of sight" : "underpass"}` : t.name;
      view.label([at[0], at[1], view.m(t.state === "bus" ? 4.6 : 2.4)], text, {
        size: 11, padding: 4, anchor: "bottom", badge: String(t.number), badgeColor: t.colour, order: chosen ? 4 : 3, optional: t.state === "home" && !chosen,
      });
    }
  }

  toJSON() {
    return { ...this.config, travellers: this.travellers.map((t) => t.toJSON()) };
  }
}

/** Index of the access point of a stop area nearest to a layout point. */
function nearestAccess(area, p) {
  let best = 0, bd = Infinity;
  area.access.forEach((e, i) => {
    const q = area.toLayout(e.s, e.t), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** A circle (layout mm) as a polygon. */
function circle(c, r, n = 20) {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
}

/** "07:40" -> 460; null if invalid. */
function clockOf(value) {
  const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** The name of a place ({kind, id}) of a journey. */
export function placeName(sim, ref) {
  if (ref?.kind === "building") return sim.world.getObject(ref.id)?.name ?? ref.id;
  if (ref?.kind === "station") return sim.rail().station(ref.id)?.name ?? ref.id;
  return "?";
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** Journeys entries checked per layout (validateLayout checks them in order: all but the first are reported). */
const CHECKED = new WeakMap();

/**
 * Problems of a journeys entry, in plain words: its stations and lines (as in the rail operations)
 * and its travellers.
 * @param {object} cfg the entry as written in the file
 * @param {object} layout the normalized layout
 * @returns {string[]}
 */
export function validateJourneys(cfg, layout) {
  const problems = [];
  const objects = new Map((layout?.objects || []).map((o) => [o.id, o]));
  const stations = new Set();
  if (cfg.stations != null && !Array.isArray(cfg.stations)) problems.push("stations must be a list");
  (Array.isArray(cfg.stations) ? cfg.stations : []).forEach((s, i) => {
    if (!isObject(s) || typeof s.id !== "string" || !s.id) return problems.push(`stations[${i}] needs an id`);
    if (stations.has(s.id)) problems.push(`stations[${i}]: duplicate id "${s.id}"`);
    stations.add(s.id);
    for (const p of Array.isArray(s.platforms) ? s.platforms : []) if (objects.get(p)?.type !== "platform") problems.push(`stations[${i}] (${s.id}): no platform "${p}" on the layout`);
  });
  if (cfg.lines != null && !Array.isArray(cfg.lines)) problems.push("lines must be a list");
  (Array.isArray(cfg.lines) ? cfg.lines : []).forEach((l, i) => {
    const name = `lines[${i}]${isObject(l) && l.id != null ? ` (${l.id})` : ""}`;
    if (!isObject(l) || l.id == null) return problems.push(`lines[${i}] needs an id`);
    const route = Array.isArray(l.route) ? l.route : [];
    if (route.length < 2) problems.push(`${name}: route needs at least two stations`);
    if (Array.isArray(cfg.stations)) for (const s of route) if (!stations.has(s)) problems.push(`${name}: no station "${s}"`);
    for (const key of ["first", "last"]) if (l[key] != null && !/^\d{1,2}:\d{2}$/.test(String(l[key])) && typeof l[key] !== "number") problems.push(`${name}: ${key} must be a time like "05:30"`);
  });
  if (cfg.travellers != null && !Array.isArray(cfg.travellers)) problems.push("travellers must be a list");
  const ids = new Set();
  (Array.isArray(cfg.travellers) ? cfg.travellers : []).forEach((t, i) => {
    const where = `travellers[${i}]${isObject(t) && t.name ? ` (${t.name})` : ""}`;
    if (!isObject(t) || typeof t.id !== "string" || !t.id) return problems.push(`travellers[${i}] needs an id`);
    if (ids.has(t.id)) problems.push(`${where}: duplicate id "${t.id}"`);
    ids.add(t.id);
    for (const k of ["from", "to"]) {
      const p = t[k];
      if (!isObject(p) || !["building", "station"].includes(p.kind) || !p.id) problems.push(`${where}: ${k} must be {"kind": "building" | "station", "id": …}`);
      else if (p.kind === "building" && !objects.has(p.id)) problems.push(`${where}: ${k}: no building "${p.id}" on the layout`);
    }
    if (!isObject(t.plan) || !Array.isArray(t.plan.legs) || !t.plan.legs.length) problems.push(`${where}: plan.legs must be a list of legs`);
  });
  // one per layout
  if (layout && (Array.isArray(layout.simulations) ? layout.simulations : []).filter((s) => isObject(s) && s.type === "journeys" && s.patch !== true).length > 1) {
    const n = CHECKED.get(layout) ?? 0;
    CHECKED.set(layout, n + 1);
    if (n > 0) problems.push("only one journeys entry per layout (the first one is used)");
  }
  return problems;
}
