/**
 * Example simulation: passengers at stop areas (platforms, bus terminals).
 *
 * People arrive through the entrances of a stop area, wait near the edge where their
 * vehicle will stop, board through the doors, or alight and walk to an exit. A simple
 * social-force model keeps them apart. Their colour shows their mood (Türkis = happy, Gelb =
 * so-so, Rot = annoyed): waiting, crowding and disruptions make it worse, boarding makes it better.
 *
 * Everything is in prototype metres and simulated seconds. The simulation only uses the
 * generic stop-area/dock/vehicle interfaces, so it works for new object types, too.
 *
 * Other simulations can hand their own people over at stops (the town simulation and the
 * journeys do): `enter()` puts an *agent* on a stop area to wait for a vehicle (optionally only a
 * certain line, or the vehicles a function accepts), `alight()` lets agents get off a vehicle, and
 * the events `passenger.boarded`, `passenger.exited` and `passenger.removed` tell the owner what
 * happened to its agents. With `others: false` only such agents use the stops: nobody else comes to
 * wait or gets off the vehicles.
 *
 * Every person has a profile of characteristics (core/mobility.js: age, a walking aid or a pram,
 * luggage, a driving licence; agents bring their owner's): it sets how fast they walk, how long
 * they take at a door and how much room they take. People go through a door one after the other
 * (those getting off first), each as long as their profile and the step between the platform or
 * kerb (`area.height_m`) and the vehicle's floor (`entry_m`) make it; people with an aid, a pram
 * or bulky luggage take the door of the multi-purpose area. A wheelchair user gets on only at level
 * boarding or with help (the vehicle's ramp, the station's staff), and only where a wheelchair
 * place is free. Vehicles hold spaces, not heads (seats and standing room): a person gets on if
 * their space fits, squeezed down to its least (which costs mood), else they are left behind
 * (`passenger.denied`) and wait for the next one. The doors stay open while somebody is in them,
 * and for those waiting at them a little longer (`holdUntil`): the dwell follows the boarding. The
 * settings of the people for the whole layout are this simulation's (`mobility`, see
 * `mobilityOf(world)`).
 * @module arail/sims/passengers
 */
import { Simulation } from "../core/simulation.js";
import { grey, mix, moodColor, OVERLAY } from "../core/colors.js";
import { rectAround } from "../core/math.js";
import {
  DEFAULT_MOBILITY, MOBILITY_KEYS, MOBILITY_PARAMS, boardingTime, drawProfile, drivingWords, isLevel, mobilityOf, mobilitySettings,
  profileGroups, profileWords, spaceOf, walkingSpeed,
} from "../core/mobility.js";

/** Colour of people who are not agents of another simulation, when people show their trip purpose. */
export const NEUTRAL_PERSON = "#e3e3e3";

/**
 * A stop shorter than this on the screen (CSS px) gets a small badge (its sign letter or number
 * and the people waiting) instead of the full board, so that the boards of far away stops do not
 * cover the town (the flyover's overview, a phone).
 */
export const BOARD_MIN_PX = 60;

/**
 * The load of a stop (Auslastung, the Overview): the people waiting against what its area holds at
 * {@link STOP_CAPACITY_PER_M2} (people standing close, about Fruin's level of service D). Up to
 * {@link STOP_LOAD_EASY} of that is easy going (score 1); the score falls to 0 when it is full.
 */
export const STOP_CAPACITY_PER_M2 = 2;
export const STOP_LOAD_EASY = 0.25;

/** The load of a stop area (0 … 1 and more) and its score (1: easy going … 0: full). */
export function stopLoad(area, waiting) {
  const load = waiting / Math.max(1, area.L * area.W * STOP_CAPACITY_PER_M2);
  return { load, score: Math.min(1, Math.max(0, (1 - load) / (1 - STOP_LOAD_EASY))) };
}

/** Length (CSS px) of the longest of the stop areas on the screen (0 when it is not in front of the camera). */
function screenLength(view, areas) {
  let best = 0;
  for (const a of areas) {
    const p = a.toLayout(0, 0), q = a.toLayout(a.L, 0);
    const P = view.project(p[0], p[1], 0), Q = view.project(q[0], q[1], 0);
    if (P && Q) best = Math.max(best, Math.hypot(P[0] - Q[0], P[1] - Q[1]) / (view.px || 1));
  }
  return best;
}

/** At most this many people come to wait at a bus or tram stop in the street (agents of other simulations aside). */
const ROAD_STOP_MAX = 40;

/** People closer than this (m) count as neighbours (they slow each other down and get unhappy). */
const NEIGHBOUR_M = 1.3;
/** People closer than this (m) push each other apart: two people of one space each (the radius of a person of `space` spaces is half of it × √space). */
const PUSH_M = 0.6;

/** Station staff help wheelchair users (a ramp, a lift) from 06:00 to 22:00 (clock minutes). */
export const STAFF_HOURS = [6 * 60, 22 * 60];
/**
 * The doors stay open this long (simulated s) past the dwell for the people waiting at them, and for
 * those getting on and off one after the other at most {@link HOLD_MAX_S}; for a ramp or a lift in use
 * as long as it takes.
 */
export const HOLD_S = 20;
export const HOLD_MAX_S = 60;
/** The trips of the other passengers (km, for their luggage): at a station, at a bus or tram stop. */
const OTHERS_KM = { rail: 30, road: 4 };
/** Clock minutes the other passengers ride: their squeezed spaces cost mood for so long. */
const OTHERS_RIDE_MIN = 10;

/** The radius of a person in the crowd (m): half of {@link PUSH_M} for one space, with the square root of their space. */
export const personRadius = (space = 1) => (PUSH_M / 2) * Math.sqrt(Math.max(0.1, space));

/** Does a person take the door of the multi-purpose area (an aid, a pram, bulky luggage)? */
const needsRoom = (profile) => (profile?.aid && profile.aid !== "none") || profile?.luggage === "bulky";

/**
 * How people get on and off a vehicle of this kind at a stop area: the step between the platform or
 * the kerb and the floor at its doors (m, + up into the vehicle; 0 where either is not known), the
 * gap, whether that is level boarding, and the help a wheelchair user gets: the vehicle's ramp
 * (`assist: "ramp"` of its type), else the station's staff ({@link STAFF_HOURS}), else none.
 * @param {object} world
 * @param {import("../core/stops.js").StopArea} area
 * @param {string} kind the vehicle's kind (train, bus, tram)
 * @param {number | null} [minutes] the time of day (clock minutes) for the staff's hours; default: now
 * @returns {{step_m: number, gap_m: number, level: boolean, assist: "ramp" | "lift" | null}}
 */
export function boardingAccess(world, area, kind, minutes = null) {
  const def = world.registry.vehicles.get(kind);
  const entry = def?.entry_m ?? def?.floor_m ?? null;
  const step_m = area?.height_m != null && entry != null ? Math.round((entry - area.height_m) * 1000) / 1000 : 0;
  const gap_m = area?.gap_m ?? def?.door_gap_m ?? 0;
  const m = minutes ?? world.clock?.minutes ?? 12 * 60;
  const staff = area?.assist === "staff" && m >= STAFF_HOURS[0] && m < STAFF_HOURS[1];
  return { step_m, gap_m, level: isLevel(step_m, gap_m), assist: def?.assist === "ramp" ? "ramp" : staff ? "lift" : null };
}

/**
 * What a vehicle holds: seats, spaces (seats and standing room at `standing_per_m2`) and wheelchair
 * places, from its type (core/vehicles.js; a train by the cars along its dock).
 * @param {object} world
 * @param {{kind: string, dock?: object}} vehicle
 * @param {Readonly<Record<string, number>>} [mob]
 * @returns {{seats: number, spaces: number, wheelchair: number}}
 */
export function vehicleSpaces(world, vehicle, mob = DEFAULT_MOBILITY) {
  const def = world.registry.vehicles.get(vehicle?.kind);
  let seats = def?.seats ?? 30, standing = def?.standing_m2 ?? 10;
  if (def?.seats_per_car != null) {
    const [a, b] = vehicle?.dock && def.extent ? def.extent(vehicle.dock) : [0, def.carLength_m || 26];
    const cars = Math.max(1, Math.round((b - a) / (def.carLength_m || 26)));
    seats = cars * def.seats_per_car;
    standing = cars * (def.standing_per_car_m2 ?? 10);
  }
  return { seats, spaces: Math.round(seats + standing * mob.standing_per_m2), wheelchair: def?.wheelchair_places ?? 1 };
}

/**
 * Neighbours and repulsion in a crowd (social forces), in the stop area's (s, t) frame (m): for
 * each person the number of people closer than 1.3 m, and the push away from those closer than
 * the sum of their radii (`radius`, 0.3 m for one space: 0.6 m between two such people; a
 * wheelchair or a pram keeps more distance). Pairs that are 1.3 m or more apart along s or t are
 * skipped before the distance is worked out; the result is the same as for all pairs (same sums,
 * in the same order).
 * @param {{pos: number[], radius?: number}[]} people
 * @returns {{neighbours: number[], push: number[][]}}
 */
export function crowdForces(people) {
  const n = people.length, N = NEIGHBOUR_M, r0 = PUSH_M / 2;
  const neighbours = new Array(n).fill(0), push = people.map(() => [0, 0]);
  for (let i = 0; i < n; i++) {
    const pi = people[i].pos, ri = people[i].radius ?? r0;
    for (let j = i + 1; j < n; j++) {
      const pj = people[j].pos, dx = pi[0] - pj[0], dy = pi[1] - pj[1];
      // the distance is at least |dx| and |dy|
      if (dx >= N || dx <= -N || dy >= N || dy <= -N) continue;
      const d = Math.max(Math.hypot(dx, dy), 1e-6);
      if (d < N) {
        neighbours[i]++;
        neighbours[j]++;
      }
      const R = Math.min(N, ri + (people[j].radius ?? r0));
      if (d < R) {
        const w = (((R - d) / R) * 1.4) / d;
        push[i][0] += dx * w;
        push[i][1] += dy * w;
        push[j][0] -= dx * w;
        push[j][1] -= dy * w;
      }
    }
  }
  return { neighbours, push };
}

/** Ids of the people at the stops, given when they are first pointed at (core/pick.js). */
let nextPersonUid = 1;

class Person {
  /**
   * @param {object} profile the person's characteristics (core/mobility.js)
   * @param {Readonly<Record<string, number>>} mob the settings of mobility
   */
  constructor(rng, pos, target, state, mood, dock, profile, mob = DEFAULT_MOBILITY) {
    this.pos = pos.slice();
    this.vel = [0, 0];
    this.target = target.slice();
    /** @type {"arriving" | "waiting" | "boarding" | "onboard" | "leaving"} */
    this.state = state;
    this.mood = Math.min(1, Math.max(0, mood));
    this.wait = 0;
    /** Age, aid, luggage, licence (core/mobility.js); an agent's is its owner's. */
    this.profile = profile;
    /** Walking speed (m/s), from the profile. */
    this.speed = walkingSpeed(profile, mob);
    /** Spaces it takes (in a vehicle: as squeezed), and its radius in the crowd (m). */
    this.space = spaceOf(profile, {}, mob).space;
    this.radius = personRadius(this.space);
    this.height = profile?.age === "child" ? rng.uniform(1.1, 1.5) : rng.uniform(1.62, 1.92);
    this.trail = [];
    this.trailT = 0;
    this.delay = 0;
    this.phase = rng.uniform(0, 2 * Math.PI);
    /** ID of the dock whose vehicle this person wants to take (null = none). */
    this.dock = dock;
    /** Agent of another simulation (e.g. a resident of the town) this person stands for, or null. */
    this.agent = null;
    /** Only board vehicles of this line (`vehicle.lineId`), or any (null). */
    this.line = null;
    /** Board a vehicle at any dock of the area (e.g. the next train on either side). */
    this.anyDock = false;
    /** Only board vehicles this function accepts (`(vehicle, dock) => boolean`), or any (null). */
    this.accept = null;
    /** The vehicle this person is boarding. */
    this.vehicle = null;
    /** The door of its vehicle it goes to (index of the vehicle's doors). */
    this.door = null;
    /** When it is through the door (the crowd's clock, s), and how long it takes there (s). */
    this.stepUntil = null;
    this.doorS = 0;
    /** Spaces it was squeezed out of in the vehicle; whether a ramp or a lift helps it at the door. */
    this.squeezed = 0;
    this.helped = false;
    /** Times it could not get on, and the vehicle that left it behind (it waits for the next one). */
    this.denied = 0;
    this.deniedBy = null;
    /** Clock minutes it will ride: its squeezed spaces cost mood for so long. */
    this.rideMin = OTHERS_RIDE_MIN;
  }
}

/** The mean of {@link Crowd#wave}. */
const WAVE_MEAN = 0.65;

/** The figures of a stop since the layout was loaded (see `PassengerSimulation.stats`). */
function emptyStats() {
  return {
    boarded: 0, alighted: 0, doorS: 0, extra: { age: 0, aid: 0, luggage: 0 }, luggage: 0, aids: 0, squeezed: 0, moodLost: 0, held: 0,
    denied: { step: 0, full: 0, wheelchair: 0 }, deniedGroups: {},
  };
}

class Crowd {
  constructor(area, rng) {
    this.area = area;
    this.people = [];
    this.t = 0;
    this.wavePhase = rng.uniform(0, 2 * Math.PI);
    this.inTimes = [];
    this.outTimes = [];
    /** When each door of the vehicles here is free again (crowd clock, s), by "vehicle id|door". */
    this.doors = new Map();
    /** The doors with a ramp or a lift out (by "vehicle id|door"): it serves the next wheelchair user too. */
    this.ramps = new Map();
    /** Boarding, alighting and who was left behind, since the layout was loaded. */
    this.stats = emptyStats();
  }

  /** Slowly varying demand (0.3 .. 1.0), period 3 minutes. */
  wave() {
    return 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((2 * Math.PI * this.t) / 180 + this.wavePhase));
  }

  visible() {
    return this.people.filter((p) => p.state !== "onboard");
  }
}

export class PassengerSimulation extends Simulation {
  static type = "passengers";
  static label = "Passengers";
  static description = "Passengers arrive, wait, board and alight; their colour shows their mood.";
  static params = [
    {
      key: "base_rate", label: "Arrivals", type: "number", unit: "people/s per 25 m", min: 0, max: 5, step: 0.05, default: 0.5,
      help: "Other passengers at a stop without a town simulation. With a town they follow its residents.",
    },
    { key: "max_per_area", label: "Max. people per stop", type: "number", min: 10, max: 500, step: 10, default: 140 },
    {
      key: "others", label: "Other passengers", type: "boolean", default: true,
      help: "People who are not residents of the town or travellers of the journeys: they come to the stops and get off the trains and buses.",
    },
    // the characteristics of the people of the whole layout (core/mobility.js)
    ...MOBILITY_PARAMS,
  ];

  constructor(world, config) {
    super(world, config);
    /** @type {Map<string, Crowd>} */
    this.crowds = new Map();
    /** Boarding on each bus and tram line (by its id) since the layout was loaded: {boarded, doorS, luggage, luggageS}. */
    this.lineStats = new Map();
    const on = (name, fn) => world.events.on(name, fn);
    this._unsubscribe = [
      on("vehicle.arrived", (e) => this._arrived(e)),
      on("vehicle.departing", (e) => this._departing(e)),
      on("vehicle.cancelled", (e) => this._cancelled(e)),
    ];
  }

  get rng() {
    return this.world.rng;
  }

  /** The settings of the people's characteristics (core/mobility.js) for the whole layout: this simulation's. */
  get mobility() {
    const key = MOBILITY_KEYS.map((k) => this.config[k]).join("|");
    if (key !== this._mobilityKey) {
      this._mobilityKey = key;
      this._mobility = mobilitySettings(this.config);
    }
    return this._mobility;
  }

  /** A profile for another passenger at a stop area: their trip is a regional one at a station, a short one at a bus or tram stop. */
  _profile(a) {
    return drawProfile(this.rng, { km: a.kind === "rail" ? OTHERS_KM.rail : OTHERS_KM.road }, this.mobility);
  }

  /** A new person at a stop area (see Person). */
  _person(a, pos, state, mood, dock, profile = null) {
    return new Person(this.rng, pos, [0, 0], state, mood, dock, profile ?? this._profile(a), this.mobility);
  }

  dispose() {
    this._unsubscribe.forEach((off) => off());
  }

  clear() {
    for (const c of this.crowds.values()) {
      this._dropped(c.people);
      c.people = [];
    }
  }

  /** The figures of a bus or tram line (by its id): {boarded, doorS, luggage, luggageS}, see `lineStats`. */
  lineFigures(lineId) {
    return this.lineStats.get(lineId) ?? null;
  }

  /**
   * Remove agents (without events): their owner places them itself, e.g. after a clock jump.
   * @param {((agent: object) => boolean) | null} [which] only the agents it is true for (an owner's own), else all
   */
  removeAgents(which = null) {
    for (const c of this.crowds.values()) c.people = c.people.filter((p) => !p.agent || (which && !which(p.agent)));
  }

  /** Do people other than agents come to the stops and get off the vehicles? */
  get others() {
    return this.config.others !== false;
  }

  /** Tell the owners of agents among `people` that they are gone. */
  _dropped(people) {
    for (const p of people) if (p.agent) this.world.events.emit("passenger.removed", { agent: p.agent, person: p });
  }

  /** The other passengers a stop area gets from the town (people per simulated second by day), or null without a town. */
  _othersFromTown(area) {
    const town = this.world.simulations.find((s) => s !== this && s.enabled && typeof s.othersAt === "function");
    const r = town?.othersAt(area);
    return Number.isFinite(r) ? r : null;
  }

  /**
   * Other passengers coming to a stop area now (people per simulated second, before the hour, the
   * global demand and disruptions): what the town says when one runs, else `base_rate` per 25 m;
   * with the slow wave.
   */
  _othersRate(c) {
    const town = this._othersFromTown(c.area);
    return town != null ? town * (c.wave() / WAVE_MEAN) : this.config.base_rate * c.wave() * (c.area.L / 25);
  }

  /** Time (simulated s) between two vehicles like this one at the dock: its line's interval, or the timetable's. */
  _interval(vehicle, dock) {
    const line = vehicle?.lineId ? this.world.transit?.lines?.get?.(vehicle.lineId) : null;
    if (line?.headway > 0) return line.headway;
    const h = dock.managed ? null : this.world.services.headwayOf?.(dock);
    return h > 0 ? h : 120;
  }

  _sync() {
    const areas = this.world.stopAreas();
    const seen = new Set();
    for (const area of areas) {
      seen.add(area.id);
      const c = this.crowds.get(area.id);
      if (c) c.area = area;
      else this.crowds.set(area.id, new Crowd(area, this.rng));
    }
    for (const [id, c] of [...this.crowds]) {
      if (seen.has(id)) continue;
      this._dropped(c.people);
      this.crowds.delete(id);
    }
  }

  /**
   * The figures of a stop area: people there and their mood, in and out per minute; since the layout
   * was loaded the people who got on and off, their seconds at the doors (in all, and what age, aids
   * and luggage added), those with heavy or bulky luggage and with an aid, those squeezed and the mood
   * it cost them, the seconds the doors were held past the dwell, and the people left behind (by
   * reason: step, full, wheelchair; and by group, core/mobility.js GROUPS).
   */
  stats(areaId) {
    const c = this.crowds.get(areaId);
    if (!c) return null;
    const vis = c.visible();
    return {
      count: vis.length,
      mood: vis.length ? vis.reduce((s, p) => s + p.mood, 0) / vis.length : 1,
      inPerMin: c.inTimes.length,
      outPerMin: c.outTimes.length,
      ...structuredClone(c.stats),
    };
  }

  /**
   * The stops by their load and the mood of the people waiting there (the mean of both; a stop
   * nobody waits at is as good as it gets), and every person waiting by their mood.
   */
  states() {
    const stops = [], people = [];
    const areas = this.world.stopAreas();
    for (const c of this.crowds.values()) {
      const a = c.area, owner = a.owner;
      if (!owner) continue;
      const vis = c.visible(), mood = vis.length ? vis.reduce((s, p) => s + p.mood, 0) / vis.length : 1;
      // a bus stop on both sides of the street: "Altmarkt · Stop A", as on its board
      const name = areas.filter((x) => x.owner === owner).length > 1 && a.docks[0]?.label ? `${owner.name} · ${a.docks[0].label}` : owner.name;
      const load = stopLoad(a, vis.length);
      stops.push({ name, score: (load.score + mood) / 2, text: `${vis.length} waiting · ${Math.round(load.load * 100)} % full · mood ${Math.round(mood * 100)} %`, key: `object:${owner.id}` });
      for (const p of vis) {
        p.uid ??= nextPersonUid++;
        people.push({ name: p.agent?.name || "Passenger", score: p.mood, text: `mood ${Math.round(p.mood * 100)} % · ${owner.name}`, key: `passenger:${p.uid}` });
      }
    }
    // the vehicles at the stops by their load in spaces
    const vehicles = [];
    for (const c of this.crowds.values()) {
      for (const d of c.area.docks) {
        const v = this._vehicleAt(d.id), load = v?.load;
        if (!v || !load || load.dock !== d.id || v.phase !== "dwelling" || !(load.cap.spaces > 0)) continue;
        const name = v.kind === "bus" && v.line && !/^bus\b/i.test(v.line) ? `Bus ${v.line}` : v.kind === "tram" && v.line ? `Tram ${v.line}` : v.line || (v.kind === "bus" ? "Bus" : "Train");
        vehicles.push({
          name, score: Math.max(0, 1 - load.spaces / load.cap.spaces), text: `${Math.round(load.spaces)} of ${load.cap.spaces} spaces · ${c.area.owner?.name ?? ""}`,
          key: v.source === "line" ? `${v.kind}:${v.id}` : `vehicle:${v.id}`,
        });
      }
    }
    return [
      { id: "stops", label: "Stops", measure: "load and mood", items: stops },
      { id: "people-waiting", label: "People waiting", measure: "mood", items: people },
      { id: "vehicles", label: "Vehicles at the stops", measure: "room left", items: vehicles },
    ];
  }

  /* ---------------------------------------------------------------- hand-over of agents */

  /**
   * Put an agent of another simulation on a stop area: it walks in from the nearest entrance,
   * waits and boards a matching vehicle. Agents are not limited by `max_per_area`.
   * @param {string} areaId stop area
   * @param {object} options
   * @param {object} options.agent the owner's object for this person (returned in events)
   * @param {string | null} [options.dockId] dock to wait at (default: any dock of the area, see anyDock)
   * @param {string | null} [options.line] only board vehicles with this `lineId`
   * @param {((vehicle: object, dock: object) => boolean) | null} [options.accept] only board vehicles it accepts
   * @param {boolean} [options.anyDock] board at any dock of the area (default: true without dockId)
   * @param {number[] | null} [options.at] layout point (mm) the person comes from
   * @param {number} [options.mood]
   * @param {object | null} [options.profile] its characteristics (default: the agent's `profile`, else drawn)
   * @param {number} [options.rideMin] clock minutes it will ride (a squeezed space costs mood for so long)
   * @returns {Person | null} null if the area does not exist
   */
  enter(areaId, { agent, dockId = null, line = null, accept = null, anyDock = dockId == null, at = null, mood, profile = null, rideMin = null } = {}) {
    this._sync();
    const c = this.crowds.get(areaId);
    if (!c) return null;
    const a = c.area, rng = this.rng;
    const dock = dockId && a.docks.some((d) => d.id === dockId) ? dockId : a.docks.length ? (anyDock ? null : a.docks[0].id) : null;
    let start;
    if (at) {
      const [s, t] = a.fromLayout(at);
      const e = a.access.reduce((best, x) => (Math.hypot(x.s - s, x.t - t) < Math.hypot(best.s - s, best.t - t) ? x : best), a.access[0]);
      start = [e.s, e.t];
    } else start = this._access(c);
    const p = this._person(a, start, "arriving", mood ?? rng.uniform(0.7, 0.95), dock, profile ?? agent?.profile ?? null);
    p.agent = agent ?? null;
    if (rideMin > 0) p.rideMin = rideMin;
    p.line = line;
    p.accept = typeof accept === "function" ? accept : null;
    p.anyDock = !!anyDock;
    p.target = dock ? this._waitingSpot(c, dock) : [rng.uniform(0.25, 0.75) * a.L, rng.uniform(-0.25, 0.25) * a.W];
    c.people.push(p);
    c.inTimes.push(c.t);
    // its vehicle stands there already: straight to the doors
    this._boardStanding(p, a);
    return p;
  }

  /**
   * Let agents get off a vehicle that stands at `dock` (doors open): they appear at the doors
   * and walk to an exit; `passenger.exited` reports when they have left the stop area.
   * @param {object} vehicle
   * @param {object} dock
   * @param {object[]} agents
   * @param {{towards?: ((agent: object) => number | null) | null}} [options] towards: where along the stop
   *   (m) an agent will leave it; it gets off at the door closest to that
   * @returns {Person[]}
   */
  alight(vehicle, dock, agents, { towards = null } = {}) {
    this._sync();
    const c = this.crowds.get(dock.area.id);
    if (!c || !agents.length) return [];
    const doors = this._doors(vehicle);
    const a = c.area, rng = this.rng, out = [];
    const access = this.access(a, vehicle);
    for (const agent of agents) {
      const p = this._person(a, [0, 0], "onboard", rng.uniform(0.7, 0.92), null, agent?.profile ?? null);
      p.agent = agent;
      // a traveller who knows the exit it takes rode near it: off at the door closest to it
      const aim = towards?.(agent);
      const door = aim != null && doors.length ? doors.reduce((b, d, i) => (Math.abs(d - aim) < Math.abs(doors[b] - aim) ? i : b), 0) : null;
      this._getOff(c, p, vehicle, dock, doors, access, door);
      c.people.push(p);
      out.push(p);
    }
    return out;
  }

  /* ---------------------------------------------------------------- doors */

  /**
   * How people get on and off a vehicle at a stop area: the step, the gap, level boarding and the
   * help for a wheelchair user (see {@link boardingAccess}).
   */
  access(area, vehicle) {
    return boardingAccess(this.world, area, vehicle?.kind);
  }

  /** What a vehicle holds (see {@link vehicleSpaces}). */
  spaces(vehicle) {
    return vehicleSpaces(this.world, vehicle, this.mobility);
  }

  /**
   * The door (index of `doors`) a person goes to: with an aid, a pram or bulky luggage the door of
   * the multi-purpose area (`access_door` of the vehicle's type, else the middle one), else the
   * door nearest to `s` (m along the stop).
   */
  _doorOf(p, vehicle, doors, s) {
    if (!doors.length) return null;
    if (needsRoom(p.profile)) {
      const i = this.world.registry.vehicles.get(vehicle?.kind)?.access_door;
      return Math.min(doors.length - 1, Math.max(0, Number.isInteger(i) ? i : Math.floor((doors.length - 1) / 2)));
    }
    let best = 0;
    doors.forEach((d, i) => {
      if (Math.abs(d - s) < Math.abs(doors[best] - s)) best = i;
    });
    return best;
  }

  /**
   * Use a door of a vehicle for `s` seconds: from when it is free (people go through a door one
   * after the other, so a slow one holds up those behind). Returns when the person is through
   * (the crowd's clock).
   */
  _useDoor(c, vehicle, door, s) {
    const key = `${vehicle?.id ?? "?"}|${door ?? 0}`;
    const from = Math.max(c.doors.get(key) ?? 0, c.t);
    c.doors.set(key, from + s);
    return from + s;
  }

  /** The seconds a person takes at a door (a boarding time): the help only once, while the ramp or the lift is out there. */
  _doorTime(c, vehicle, door, t) {
    if (!t.assist) return t.s;
    // a ramp or a lift in use: the doors stay open for it
    const key = `${vehicle?.id ?? "?"}|${door ?? 0}`;
    const out = c.ramps.has(key);
    c.ramps.set(key, c.t);
    return out ? Math.round((t.s - t.help) * 10) / 10 : t.s;
  }

  /**
   * A person gets off a vehicle: at a door (`door`, else the one {@link _doorOf} gives) after the
   * people before it there, for as long as its profile takes with the step (a wheelchair without
   * level boarding or help gets off with the help of the others, as long as a lift).
   */
  _getOff(c, p, vehicle, dock, doors, access, door = null) {
    const a = c.area, rng = this.rng, mob = this.mobility;
    const guess = doors.length ? rng.pick(doors) : rng.uniform(0.2, 0.8) * a.L;
    p.door = door ?? this._doorOf(p, vehicle, doors, guess);
    p.pos = [(p.door != null ? doors[p.door] : guess) + rng.uniform(-0.4, 0.4), this._doorT(a, dock) - dock.side * 0.2];
    const t = boardingTime(p.profile, access, mob);
    p.doorS = t.ok ? this._doorTime(c, vehicle, p.door, t) : Math.round((mob.lift_s + mob.board_s * mob.board_wheelchair) * 10) / 10;
    p.helped = !t.ok || !!t.assist;
    p.delay = doors.length ? this._useDoor(c, vehicle, p.door, p.doorS) - c.t : p.doorS;
    p.alighting = vehicle;
    p.target = this._exit(c, p.pos);
    c.stats.alighted++;
  }

  /** A waiting person gives up and walks to the nearest exit (then `passenger.exited`). */
  release(person) {
    for (const c of this.crowds.values()) {
      if (!c.people.includes(person)) continue;
      person.state = "leaving";
      person.vehicle = null;
      person.target = this._exit(c, person.pos);
      return true;
    }
    return false;
  }

  /** Does person `p` want the vehicle at `dock`? */
  _wants(p, dock, vehicle) {
    if (p.state !== "waiting" && p.state !== "arriving") return false;
    if (p.dock !== dock.id && !(p.anyDock && p.dock == null)) return false;
    if (p.line && vehicle?.lineId !== p.line) return false;
    if (vehicle?.outOfService) return false; // a bus on its way to the depot
    if (vehicle && p.deniedBy === vehicle) return false; // left behind by it: the next one
    if (p.accept && !p.accept(vehicle, dock)) return false;
    return true;
  }

  /** Door positions (s) of a vehicle standing at its dock. */
  _doors(vehicle) {
    return this.world.services.doors(vehicle);
  }

  /** The vehicle standing at (or coming to) a dock: timetable/feed services or bus lines. */
  _vehicleAt(dockId) {
    return this.world.services.docks.get(dockId)?.vehicle || this.world.transit?.vehicleAt?.(dockId) || null;
  }

  /* ---------------------------------------------------------------- places */

  /**
   * Do vehicles come to a stop area now? Not at night: timetables and bus lines follow the clock
   * (`clock.demand`), while a control system may send its trains at any time.
   */
  _inService(a) {
    // a stop of bus lines that no line in operation serves (yet, or any more): no bus comes
    const lines = this.world.transit?.lines;
    if (lines && a.docks.length && a.docks.every((d) => d.managed) && ![...lines.values()].some((l) => l.ok && l.visits.some((v) => v.areaId === a.id))) return false;
    if (this.world.clock.demand(a.kind === "bus" || a.kind === "tram" ? "bus" : "rail") > 0) return true;
    return this.world.services.forArea(a.id).some((st) => st.mode === "feed" || st.vehicle)
      || a.docks.some((d) => d.managed && this.world.transit?.vehicleAt?.(d.id));
  }

  _access(c) {
    const a = c.area;
    const i = this.rng.weighted(a.access.map((x) => x.weight ?? 1));
    const e = a.access[i];
    const jitter = Math.abs(e.t) > 0.1 ? 0.1 : 0.25;
    return [e.s + (e.s < 1 || e.s > a.L - 1 ? 0 : this.rng.uniform(-0.5, 0.5)), e.t + this.rng.uniform(-jitter, jitter) * a.W];
  }

  _exit(c, pos) {
    const a = c.area;
    const w = a.access.map((e) => Math.exp(-Math.abs(e.s - pos[0]) / 6) * (e.weight ?? 1));
    const e = a.access[this.rng.weighted(w)];
    return [e.s, e.t + this.rng.uniform(-0.2, 0.2) * a.W * (Math.abs(e.t) > 0.1 ? 0.2 : 1)];
  }

  _waitingSpot(c, dockId) {
    const a = c.area;
    const dock = a.docks.find((d) => d.id === dockId);
    if (!dock) return [this.rng.uniform(0.06, 0.94) * a.L, this.rng.uniform(-0.38, 0.38) * a.W];
    const s = this.rng.uniform(dock.s0 + 0.06 * (dock.s1 - dock.s0), dock.s1 - 0.06 * (dock.s1 - dock.s0));
    const both = a.docks.some((d) => d.side !== dock.side);
    const [lo, hi] = both ? (dock.side > 0 ? [0.02, 0.38] : [-0.38, -0.02]) : dock.side > 0 ? [-0.1, 0.38] : [-0.38, 0.1];
    return [s, this.rng.uniform(lo, hi) * a.W];
  }

  /** Where a person stands at a door (index of `doors`) of the vehicle at a dock. */
  _doorSpot(dock, doors, door) {
    return [doors[door ?? 0] + this.rng.uniform(-0.3, 0.3), this._doorT(dock.area, dock) - dock.side * 0.15];
  }

  /** How far across the area (m) the doors of a vehicle at a dock are: beyond the strip people cross to a tram in the middle of the street. */
  _doorT(a, dock) {
    return dock.side * (a.W / 2 + (a.crossing?.kind === "board" ? a.crossing.reach : 0));
  }

  /** May people step onto the area's strip with traffic now (core/stop-signals.js)? Where it has no lights, always. */
  _walk(a) {
    return this.world.transit?.signals?.walk(a.id) ?? true;
  }

  /**
   * Where a person heads for now (area m): the target, but over a strip with traffic only while the
   * lights let people cross, and straight over it; to an island in a street only at its crossing (4 m
   * wide: towards the island on one half, away from it on the other, each person in a lane of it).
   */
  _goal(a, p, walk) {
    const x = a.crossing, h = a.W / 2, [s, t] = p.pos, [gs, gt] = p.target;
    if (x.kind === "board") {
      // the strip lies beyond the edge of the docks: from the curb to the doors
      if (t <= h + 0.05 && gt > h + 0.05 && !walk) return [gs, h - 0.25];
      return p.target;
    }
    // an island: the strip is the car lane beyond its other edge, crossed at x.s
    const far = -h - x.reach;
    const where = (v) => (v > -h + 0.05 ? 1 : v < far - 0.05 ? -1 : 0);
    const from = where(t), to = where(gt);
    if (from === to && from !== 0) return p.target;
    p.crossLane ??= this.rng.uniform(0.2, 1.7);
    const at = x.s + (to === 1 ? 1 : -1) * p.crossLane;
    if (from === 0) return [at, to >= 0 ? -h + 0.3 : far - 0.4];
    const edge = from === 1 ? -h + 0.25 : far - 0.25;
    if (!walk || Math.abs(s - at) > 0.5 || Math.abs(t - edge) > 0.4) return [at, edge];
    return [at, to === 1 ? -h + 0.3 : far - 0.4];
  }

  /* ---------------------------------------------------------------- events */

  /** Board a vehicle the person wants that stands at a dock of the area (doors open, not about to leave). */
  _boardStanding(p, a) {
    const docks = p.dock ? a.docks.filter((d) => d.id === p.dock) : p.anyDock ? a.docks : [];
    for (const d of docks) {
      const v = this._vehicleAt(d.id);
      if (v && v.phase === "dwelling" && (v.dwellLeft > 6 || v.source === "feed") && this._wants(p, d, v)) {
        this._board(p, d, this._doors(v), 0, v);
        return true;
      }
    }
    return false;
  }

  _board(p, dock, doors, delay, vehicle = null) {
    p.state = "boarding";
    p.dock = dock.id;
    p.vehicle = vehicle;
    p.delay = delay ?? this.rng.uniform(0.3, 6);
    p.door = this._doorOf(p, vehicle, doors, p.pos[0]);
    p.stepUntil = null;
    p.target = this._doorSpot(dock, doors, p.door);
    p.mood = Math.min(1, p.mood + 0.15); // finally!
  }

  /**
   * A person at the door of its vehicle: on if it can, through the door after the people before it
   * and its own time there. A wheelchair needs level boarding or help, and a wheelchair place;
   * everybody needs room: their space, else squeezed down to its least (the squeezed spaces cost
   * mood per minute of the ride), else they are left behind.
   */
  _atDoor(c, p, a) {
    const v = p.vehicle, dock = a.docks.find((d) => d.id === p.dock) || null, mob = this.mobility;
    const t = boardingTime(p.profile, this.access(a, v), mob);
    if (!t.ok) return this._deny(c, p, a, dock, "step");
    const load = this._load(v, dock);
    const room = spaceOf(p.profile, { racks: !!this.world.registry.vehicles.get(v?.kind)?.racks }, mob);
    if (room.wheelchair && load.wheelchairs >= load.cap.wheelchair) return this._deny(c, p, a, dock, "wheelchair");
    const free = load.cap.spaces - load.spaces;
    if (free < room.min - 1e-9) return this._deny(c, p, a, dock, "full");
    const taken = Math.min(room.space, Math.max(room.min, free));
    p.space = Math.round(taken * 100) / 100;
    p.squeezed = Math.round((room.space - taken) * 100) / 100;
    load.spaces += taken;
    if (room.wheelchair) load.wheelchairs++;
    const st = c.stats;
    if (p.squeezed > 0) {
      const lost = Math.min(p.mood, p.squeezed * mob.squeeze_mood * p.rideMin);
      p.mood -= lost;
      load.squeezed++;
      st.squeezed++;
      st.moodLost += lost;
    }
    p.doorS = this._doorTime(c, v, p.door, t);
    p.helped = !!t.assist;
    p.stepUntil = this._useDoor(c, v, p.door, p.doorS);
    st.boarded++;
    st.doorS += p.doorS;
    for (const k of ["age", "aid", "luggage"]) st.extra[k] += t.extra[k];
    st.extra.aid -= t.s - p.doorS; // the ramp was out already
    const luggage = p.profile?.luggage === "heavy" || p.profile?.luggage === "bulky";
    if (luggage) st.luggage++;
    if (p.profile?.aid && p.profile.aid !== "none") st.aids++;
    // and on the line of a bus or tram
    if (v?.lineId) {
      const L = this.lineStats.get(v.lineId) || { boarded: 0, doorS: 0, luggage: 0, luggageS: 0 };
      L.boarded++;
      L.doorS += p.doorS;
      L.luggageS += t.extra.luggage;
      if (luggage) L.luggage++;
      this.lineStats.set(v.lineId, L);
    }
  }

  /**
   * A person cannot get on (`why`: "step": a wheelchair without level boarding or help, "full",
   * "wheelchair": no wheelchair place free): back to wait for the next vehicle, the mood down; the
   * other passengers give up the second time.
   */
  _deny(c, p, a, dock, why) {
    const v = p.vehicle;
    p.state = "waiting";
    p.vehicle = null;
    p.stepUntil = null;
    p.door = null;
    if (p.anyDock) p.dock = null;
    p.deniedBy = v;
    p.denied++;
    p.target = dock ? this._waitingSpot(c, dock.id) : p.pos.slice();
    p.mood = Math.max(0, p.mood - 0.25);
    const st = c.stats;
    st.denied[why] = (st.denied[why] || 0) + 1;
    for (const g of profileGroups(p.profile)) st.deniedGroups[g] = (st.deniedGroups[g] || 0) + 1;
    this.world.events.emit("passenger.denied", { area: a, dock, vehicle: v, person: p, agent: p.agent, reason: why });
    if (!p.agent && p.denied >= 2) {
      p.state = "leaving";
      p.target = this._exit(c, p.pos);
    }
  }

  /**
   * The load of a vehicle at a stop ({cap, spaces, wheelchairs, squeezed}): made when it comes in
   * (see {@link _comeIn}), else now.
   */
  _load(vehicle, dock) {
    if (!vehicle) return { cap: { seats: 0, spaces: Infinity, wheelchair: Infinity }, spaces: 0, wheelchairs: 0, squeezed: 0 };
    if (!vehicle.load || vehicle.load.dock !== dock?.id) this._comeIn(vehicle, dock);
    return vehicle.load;
  }

  /**
   * A vehicle comes in at a dock: its load is the riders of other simulations who stay on (the town's,
   * the journeys': `vehicle.riders`) and the people riding through (`onboard_share` of its spaces ×
   * the hour's demand × the passenger demand); those who get off here are not counted any more.
   */
  _comeIn(vehicle, dock) {
    const cap = this.spaces(vehicle), mob = this.mobility;
    const staying = (vehicle.riders || []).filter((r) => r.toDockId !== dock?.id);
    let spaces = 0, wheelchairs = 0;
    for (const r of staying) {
      const sp = spaceOf(r.agent?.profile, {}, mob);
      spaces += sp.space;
      if (sp.wheelchair) wheelchairs++;
    }
    const through = cap.spaces * mob.onboard_share * this.world.clock.demand("passengers") * this.world.demand;
    vehicle.load = { dock: dock?.id ?? null, cap, spaces: Math.min(cap.spaces, spaces + through), wheelchairs: Math.min(cap.wheelchair, wheelchairs), squeezed: 0 };
    vehicle.held = 0;
  }

  _arrived({ vehicle, dock }) {
    this._sync();
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    const doors = this._doors(vehicle);
    if (!doors.length) return;
    const rng = this.rng, a = c.area;
    this._comeIn(vehicle, dock);
    // a ramp put out at an earlier stop (a line's bus comes again) is in again
    for (const k of c.ramps.keys()) if (k.startsWith(`${vehicle.id}|`)) c.ramps.delete(k);
    const fx = this.world.disruptions.effectsFor(a);
    const len = dock.s1 - dock.s0;
    const bus = dock.kind === "bus" || dock.kind === "tram";
    const tod = this.world.clock.demand("passengers");
    // with a town: as many as came to the stops served by one vehicle (what boards elsewhere comes back)
    const town = this._othersFromTown(a);
    const mean = town != null
      ? town * this._interval(vehicle, dock) * this.world.demand * (c.wave() / WAVE_MEAN)
      : (bus ? 1 : 2) + (bus ? 3 : 6) * this.world.demand * c.wave() * (len / 25);
    const n = fx.closed || !this.others ? 0 : rng.poisson(mean * Math.min(1, 0.25 + tod));
    const late = vehicle.delayMin > 0.5;
    const access = this.access(a, vehicle);
    for (let i = 0; i < n && c.people.length < this.config.max_per_area; i++) {
      const p = this._person(a, [0, 0], "onboard", rng.uniform(0.6, 0.92) - (late ? 0.35 : 0), null);
      this._getOff(c, p, vehicle, dock, doors, access);
      c.people.push(p);
    }
    for (const p of c.people) {
      // agents always take their vehicle; a few other people wait for the next one
      if (this._wants(p, dock, vehicle) && (p.agent || rng.chance(0.95))) this._board(p, dock, doors, undefined, vehicle);
    }
  }

  _departing({ dock }) {
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    for (const p of c.people) {
      if (p.state === "boarding" && p.dock === dock.id) {
        // missed it (from the strip in the street back onto the sidewalk)
        p.state = "waiting";
        p.vehicle = null;
        p.stepUntil = null;
        if (p.anyDock) p.dock = null;
        p.target = c.area.crossing?.kind === "board" ? [p.pos[0], Math.min(p.pos[1], c.area.W / 2 - 0.4)] : p.pos.slice();
        p.mood = Math.max(0, p.mood - 0.35);
      } else if (p.state === "onboard") {
        p.delay = 0;
      }
    }
  }

  _cancelled({ dock }) {
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    for (const p of c.people) if ((p.state === "waiting" || p.state === "arriving") && p.dock === dock.id) p.mood = Math.max(0, p.mood - 0.15);
  }

  /* ---------------------------------------------------------------- simulation step */

  step(dt) {
    if (!this.enabled) return;
    this._sync();
    for (const c of this.crowds.values()) this._stepCrowd(c, dt);
  }

  _stepCrowd(c, dt) {
    const rng = this.rng, a = c.area, world = this.world;
    const fx = world.disruptions.effectsFor(a);
    c.t += dt;
    const disrupted = fx.hold || fx.cancel;
    // no service (the night): nobody comes to wait, and the people waiting go home after a while
    const service = this._inService(a);
    // the tracks of a platform closed on their own (a track closure, a story's train): nobody comes to
    // wait there; those waiting go over to another track, or leave when none is open
    const open = a.docks.filter((d) => !world.disruptions.effectsFor(a, d).closed);
    const shut = !fx.closed && open.length < a.docks.length;
    const rate = fx.closed || !service || !this.others || (a.docks.length && !open.length) ? 0 : this._othersRate(c) * world.demand * fx.demand * world.clock.demand("passengers");
    const n = rng.poisson(rate * dt);
    // a bus or tram stop in the street holds fewer people than a platform
    const max = a.kind === "bus" || a.kind === "tram" ? Math.min(this.config.max_per_area, ROAD_STOP_MAX) : this.config.max_per_area;
    for (let i = 0; i < n && c.people.length < max; i++) {
      const dock = open.length ? rng.pick(open).id : null;
      const p = this._person(a, this._access(c), "arriving", rng.uniform(0.62, 0.95) - (disrupted ? 0.3 : 0), dock);
      p.target = this._waitingSpot(c, dock);
      c.people.push(p);
      c.inTimes.push(c.t);
    }
    if (shut) {
      for (const p of c.people) {
        if ((p.state !== "waiting" && p.state !== "arriving") || p.dock == null || open.some((d) => d.id === p.dock)) continue;
        if (open.length) {
          p.dock = rng.pick(open).id;
          p.target = this._waitingSpot(c, p.dock);
        } else if (rng.chance(0.25 * dt)) {
          p.state = "leaving";
          p.target = this._exit(c, p.pos);
        }
      }
    }
    // give up and leave (closures, replacement services; the night, except agents: their owners decide)
    if (fx.leave || !service) {
      for (const p of c.people) {
        if ((p.state === "waiting" || p.state === "arriving") && (fx.leave || !p.agent) && rng.chance((fx.leave ? 0.25 : 0.02) * dt)) {
          p.state = "leaving";
          p.target = this._exit(c, p.pos);
        }
      }
    }
    this._move(c, dt, fx);
    this._holdDoors(c, dt);
    for (const q of [c.inTimes, c.outTimes]) while (q.length && q[0] < c.t - 60) q.shift();
  }

  /**
   * The doors of a vehicle at the stop stay open while somebody is in a door (getting on or off; at
   * most {@link HOLD_MAX_S} past its dwell, as long as it takes for a ramp or a lift in use), and for
   * the people waiting at a door at most {@link HOLD_S}: `holdUntil` (world time) keeps the timetable,
   * the lines and the planners from closing them. The seconds past the dwell are counted (`held`).
   */
  _holdDoors(c, dt) {
    const busy = new Map();
    for (const p of c.people) {
      const v = p.state === "boarding" && p.stepUntil != null ? p.vehicle : p.state === "onboard" && p.delay > 0 ? p.alighting : null;
      if (!v) continue;
      const end = p.state === "boarding" ? p.stepUntil : c.t + p.delay;
      const inDoor = end - p.doorS <= c.t + 1e-9;
      const b = busy.get(v) || { inDoor: false, helped: false };
      b.inDoor ||= inDoor;
      b.helped ||= inDoor && p.helped;
      busy.set(v, b);
    }
    for (const [v, b] of busy) {
      if (v.phase !== "dwelling" || v.source === "feed") continue;
      const over = !(v.dwellLeft > 0) || v.dwellRemaining <= 0;
      if (over) v.held = (v.held || 0) + dt;
      if (b.helped || (b.inDoor && !(v.held > HOLD_MAX_S)) || !(v.held > HOLD_S)) {
        v.holdUntil = this.world.time + 0.5;
        if (over) c.stats.held += dt;
      }
    }
    // doors of vehicles gone long ago
    if (c.doors.size > 64) for (const [k, t] of c.doors) if (t < c.t - 60) c.doors.delete(k);
    if (c.ramps.size > 16) for (const [k, t] of c.ramps) if (t < c.t - 300) c.ramps.delete(k);
  }

  _move(c, dt, fx) {
    const rng = this.rng, a = c.area, L = a.L, W = a.W;
    const x = a.crossing, walk = x ? this._walk(a) : true;
    let crossing = 0, waiting = 0;
    for (const p of c.people) {
      if (p.state !== "onboard") continue;
      p.delay -= dt;
      if (p.delay > 0) continue;
      // off the tram over the strip only while the lights hold the traffic; till then they wait for it
      if (x?.kind === "board" && !walk) waiting++;
      else {
        p.state = "leaving";
        c.inTimes.push(c.t);
      }
    }
    const active = c.visible(), n = active.length;
    // how far people may go beyond the area: onto the strip to the tram, or over the lane to an island
    const lo = x?.kind === "island" ? -W / 2 - x.reach - 0.8 : null, hi = x?.kind === "board" ? W / 2 + x.reach - 0.1 : null;
    if (!n) {
      if (x) this.world.transit?.signals?.report(a.id, 0, waiting);
      return;
    }
    const { neighbours, push } = crowdForces(active);
    const gone = new Set();
    active.forEach((p, i) => {
      const density = Math.max(0, neighbours[i] - 2), t0 = p.pos[1];
      const goal = x ? this._goal(a, p, walk) : p.target;
      const zx = goal[0] - p.pos[0], zy = goal[1] - p.pos[1], dist = Math.hypot(p.target[0] - p.pos[0], p.target[1] - p.pos[1]);
      const ahead = Math.hypot(zx, zy);
      const walking = p.state === "arriving" || p.state === "leaving" || (p.state === "boarding" && p.delay <= 0);
      let vx, vy;
      if (walking) {
        const k = (p.speed * Math.min(1, ahead / 0.8)) / (1 + 0.12 * density) / Math.max(ahead, 1e-6);
        vx = zx * k + push[i][0];
        vy = zy * k + push[i][1];
      } else {
        vx = zx * 0.6 + 0.7 * push[i][0];
        vy = zy * 0.6 + 0.7 * push[i][1];
      }
      const acc = Math.min(1, 4 * dt);
      p.vel[0] += (vx - p.vel[0]) * acc;
      p.vel[1] += (vy - p.vel[1]) * acc;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      const margin = p.state === "boarding" ? 0.12 : 0.22;
      // while the lights hold the people, nobody steps (or is pushed) onto the strip
      let bottom = lo ?? -W / 2 + margin, top = hi ?? W / 2 - margin;
      if (x && !walk) {
        if (x.kind === "board" && t0 <= W / 2 + 0.05) top = W / 2 - margin;
        if (x.kind === "island" && t0 >= -W / 2 - 0.05) bottom = -W / 2 + margin;
        if (x.kind === "island" && t0 <= -W / 2 - x.reach - 0.05) top = -W / 2 - x.reach - 0.1;
      }
      p.pos[0] = Math.min(Math.max(p.pos[0], 0.1), L - 0.1);
      p.pos[1] = Math.min(Math.max(p.pos[1], bottom), top);
      if (x) {
        const t = p.pos[1];
        if (x.kind === "board" ? t > W / 2 + 0.05 : t < -W / 2 - 0.05 && t > -W / 2 - x.reach + 0.05) crossing++;
        else if (goal !== p.target && (x.kind === "island" || !walk)) waiting++;
      }
      const speed = Math.hypot(p.vel[0], p.vel[1]);
      p.phase += speed * dt * 5;
      // walking trail
      p.trailT += dt;
      if (speed > 0.3) {
        if (p.trailT > 0.4) {
          p.trail.push(p.pos.slice());
          if (p.trail.length > 12) p.trail.shift();
          p.trailT = 0;
        }
      } else if (p.trail.length && p.trailT > 0.3) {
        p.trail.shift();
        p.trailT = 0;
      }
      // state changes
      if (p.state === "arriving") {
        if (dist < 0.4) {
          p.state = "waiting";
          this._boardStanding(p, a);
        }
      } else if (p.state === "waiting") {
        p.wait += dt;
        if (rng.next() < 0.04 * dt) {
          // shifting from one foot to the other
          p.target = [Math.min(Math.max(p.target[0] + 0.4 * rng.normal(), 0.5), L - 0.5), Math.min(Math.max(p.target[1] + 0.4 * rng.normal(), -0.38 * W), 0.38 * W)];
        }
      } else if (p.state === "boarding") {
        if (p.delay > 0) p.delay -= dt;
        else if (p.stepUntil != null) {
          // in the door (or waiting for it): on board when through
          if (c.t >= p.stepUntil) {
            gone.add(p);
            c.outTimes.push(c.t);
            if (p.agent) this.world.events.emit("passenger.boarded", { area: a, dock: a.docks.find((d) => d.id === p.dock) || null, vehicle: p.vehicle, person: p, agent: p.agent });
          }
        } else if (dist < 0.35) this._atDoor(c, p, a);
      } else if (p.state === "leaving" && dist < 0.5) {
        gone.add(p);
        c.outTimes.push(c.t);
        if (p.agent) this.world.events.emit("passenger.exited", { area: a, person: p, agent: p.agent, pos: a.toLayout(p.pos[0], p.pos[1]) });
      }
      // mood
      if (p.state === "arriving" || p.state === "waiting") {
        p.mood -= (0.002 + 0.005 * density + (p.wait > 60 ? 0.006 : 0) - (fx.mood || 0)) * dt;
      } else if (p.state === "boarding") p.mood += 0.02 * dt;
      else p.mood += (0.008 - 0.004 * density) * dt;
      p.mood = Math.min(1, Math.max(0, p.mood));
    });
    if (gone.size) c.people = c.people.filter((p) => !gone.has(p));
    if (x) this.world.transit?.signals?.report(a.id, crossing, waiting);
  }

  /* ---------------------------------------------------------------- pointing at people and stops */

  /** The people at the stops as pickables (core/pick.js). */
  pickables(view) {
    if (!this.enabled) return [];
    const out = [];
    for (const c of this.crowds.values()) {
      const a = c.area;
      if (!a.owner?.geometry) continue;
      for (const p of c.visible()) {
        p.uid ??= nextPersonUid++;
        const at = a.toLayout(p.pos[0], p.pos[1]);
        out.push({ key: `passenger:${p.uid}`, kind: "person", label: p.agent?.name || "Passenger", outline: rectAround(at, view.m(0.7), view.m(0.7)), z0: 0, z1: view.m(p.height), owner: this, ref: { person: p, area: a } });
      }
    }
    return out;
  }

  /**
   * The card of a person at a stop: a person of another simulation (a resident, a traveller) as
   * that one describes it (`describeAgent`), and what it does here: waiting, for what, how long,
   * its mood.
   */
  card(hit) {
    const { person: p, area } = hit.ref;
    let base = null;
    if (p.agent) for (const s of this.world.simulations) if (s !== this && s.enabled !== false && (base = s.describeAgent?.(p.agent))) break;
    const owner = area.owner, dock = p.dock ? area.docks.find((d) => d.id === p.dock) : null;
    const card = { title: hit.label, subtitle: `Passenger · ${owner?.name ?? "stop"}`, ...base };
    card.rows = [...(base?.rows || [])];
    const doing = { arriving: "Walking onto the stop", waiting: "Waiting", boarding: "Boarding", onboard: "Getting off", leaving: "Leaving the stop" }[p.state] || p.state;
    card.status = base ? `${doing} · ${owner?.name ?? "stop"}` : doing;
    const line = p.line ? this.world.transit?.lines?.get?.(p.line) : null;
    const noun = area.kind === "bus" ? "bus" : area.kind === "tram" ? "tram" : "train";
    const wants = line ? `${line.noun ?? "Bus"} ${line.label}` : p.line || (dock ? `the ${noun}${dock.label ? ` at ${dock.label}` : ""}` : p.state === "waiting" || p.state === "arriving" ? `the next ${noun}` : null);
    if (wants) card.rows.push(["Waiting for", wants]);
    if (p.state === "waiting") card.rows.push(["Waited", `${Math.round((p.wait * this.world.clock.factor) / 60)} min`]);
    if (p.denied) card.rows.push(["Left behind", p.denied === 1 ? "once" : `${p.denied} times`]);
    if (p.state === "boarding" && p.stepUntil != null) card.rows.push(["At the door", `${p.doorS.toFixed(1)} s`]);
    // what the person is like (an agent's owner may have said it already)
    if (p.profile && !card.rows.some((r) => r[0] === "Characteristics")) card.rows.push(...profileRows(p.profile, p.speed, p.space));
    card.rows.push(["Mood", `${Math.round(p.mood * 100)} %`]);
    card.tone = p.mood < 0.35 ? "bad" : p.mood < 0.6 ? "warn" : "ok";
    card.related = [...(base?.related || []), ...(owner?.id ? [owner.id] : [])];
    return card;
  }

  /** At a stop: the people waiting, their mood and the next vehicles. */
  describeObject(o, card) {
    // a bus or tram line: the people who got on its vehicles, their time at the doors and their luggage
    const L = this.lineStats.get(o.id);
    if (L?.boarded) {
      card.rows.push(["Got on", `${L.boarded} ${L.boarded === 1 ? "person" : "people"} · ${(L.doorS / L.boarded).toFixed(1)} s each at the door`]);
      card.rows.push(["With luggage", `${Math.round((L.luggage / L.boarded) * 100)} % heavy or bulky · luggage +${(L.luggageS / L.boarded).toFixed(1)} s`]);
    }
    const areas = this.world.stopAreas().filter((a) => a.owner === o);
    if (!areas.length) return;
    let count = 0, mood = 0;
    for (const a of areas) {
      for (const p of this.crowds.get(a.id)?.visible() || []) {
        count++;
        mood += p.mood;
      }
    }
    card.rows.push(["Waiting", count ? `${count} ${count === 1 ? "person" : "people"} · mood ${Math.round((mood / count) * 100)} %` : "nobody"]);
    for (const row of this._intervalRows(areas)) card.rows.push(row);
    for (const row of this._boardingRows(areas)) card.rows.push(row);
    const others = areas.map((a) => this._othersFromTown(a)).filter((r) => r != null);
    if (others.length) {
      const perHour = (others.reduce((s, r) => s + r, 0) * 3600) / Math.max(1e-6, this.world.clock.factor || 12);
      card.rows.push(["Others", `${perHour < 10 ? perHour.toFixed(1) : Math.round(perHour)} people per hour by day (from the town)`]);
    }
    const next = boardStatus(this.world, areas, 4);
    if (next.length) {
      card.status ||= next[0];
      card.sections = [...(card.sections || []), { title: "Next", lines: next }];
    }
  }

  /**
   * How people get on and off at the stop areas of a stop: the step into its vehicles and the help
   * there, the people who got on with their mean seconds at the door (and what age, aids and luggage
   * add to them), those with luggage, the people left behind and squeezed, the doors held past the
   * dwell: [label, text] rows.
   */
  _boardingRows(areas) {
    const rows = [], seen = new Set();
    for (const a of areas) {
      for (const kind of new Set(a.docks.map((d) => this._kindAt(d)))) {
        const x = this.access(a, { kind }), noun = kind === "bus" ? "bus" : kind === "tram" ? "tram" : "train";
        const step = Math.round(Math.abs(x.step_m) * 100);
        const text = `${x.level ? "level boarding" : `a step of ${step} cm ${x.step_m < 0 ? "down" : "up"}${x.gap_m > 0.05 + 1e-9 ? " and a gap" : ""}`} · ${x.assist === "ramp" ? `the ${noun}'s ramp` : x.assist === "lift" ? "station staff help" : x.level ? "no help needed" : "no help for wheelchairs"}`;
        const row = [`Into the ${noun}`, text];
        if (!seen.has(row.join("|"))) rows.push(row);
        seen.add(row.join("|"));
      }
    }
    const st = emptyStats();
    for (const a of areas) {
      const s = this.crowds.get(a.id)?.stats;
      if (!s) continue;
      for (const k of ["boarded", "alighted", "doorS", "luggage", "aids", "squeezed", "moodLost", "held"]) st[k] += s[k];
      for (const k of Object.keys(st.extra)) st.extra[k] += s.extra[k];
      for (const [k, n] of Object.entries(s.denied)) st.denied[k] = (st.denied[k] || 0) + n;
    }
    if (st.boarded) {
      const each = (x) => (x / st.boarded).toFixed(1);
      // what age, aids and luggage add to each one on average (where it is 0.05 s or more)
      const parts = [["age", "age"], ["aid", "aids"], ["luggage", "luggage"]].filter(([k]) => st.extra[k] / st.boarded >= 0.05).map(([k, w]) => `${w} +${each(st.extra[k])} s`);
      rows.push(["Got on", [`${st.boarded} ${st.boarded === 1 ? "person" : "people"}`, `${each(st.doorS)} s each at the door`, ...parts].join(" · ")]);
      rows.push(["With luggage", `${Math.round((st.luggage / st.boarded) * 100)} % heavy or bulky · ${Math.round((st.aids / st.boarded) * 100)} % with an aid or a pram`]);
    }
    const denied = Object.values(st.denied).reduce((sum, n) => sum + n, 0);
    if (denied) {
      const why = [["step", "no level boarding"], ["full", "vehicle full"], ["wheelchair", "no wheelchair place"]].filter(([k]) => st.denied[k]).map(([k, w]) => `${st.denied[k]} ${w}`);
      rows.push(["Left behind", [`${denied} ${denied === 1 ? "person" : "people"}`, ...why].join(" · ")]);
    }
    if (st.squeezed) rows.push(["Squeezed in", `${st.squeezed} ${st.squeezed === 1 ? "person" : "people"} · mood −${Math.round(st.moodLost * 100)} %`]);
    if (st.held >= 1) rows.push(["Doors held", `${Math.round(st.held)} s past the dwell`]);
    return rows;
  }

  /** The kind of vehicle that stops at a dock: a registered one of its kind (a tram), else a train or a bus. */
  _kindAt(dock) {
    if (this.world.registry.vehicles.has(dock.kind)) return dock.kind;
    return dock.kind === "bus" ? "bus" : "train";
  }

  /** A vehicle's card: its load in spaces at the stop. */
  describeVehicle(v, card) {
    const load = v.load && v.phase !== "driving" ? v.load : null;
    if (!load || !(load.cap?.spaces > 0)) return;
    card.rows.push(["Occupancy", `${Math.round(load.spaces)} of ${load.cap.spaces} spaces · ${load.cap.seats} seats`]);
    card.rows.push(["Wheelchair places", `${load.wheelchairs} of ${load.cap.wheelchair} taken`]);
    if (load.squeezed) card.rows.push(["Squeezed in", `${load.squeezed} ${load.squeezed === 1 ? "person" : "people"}`]);
  }

  /** How often vehicles stop here (by day), and whether that is what the town needs: [label, text] rows. */
  _intervalRows(areas) {
    const factor = this.world.clock.factor > 0 ? this.world.clock.factor : 12;
    const every = (m, demand) => `every ${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)} min${demand ? " (what the town needs)" : ""}`;
    const rows = [];
    const seen = new Set();
    for (const a of areas) {
      for (const dock of a.docks) {
        if (dock.managed || !this.world.services.intervalOf) continue;
        const iv = this.world.services.intervalOf(dock);
        const row = [dock.kind === "rail" ? "Trains" : "Buses", every(iv.minutes, iv.from === "demand")];
        if (!seen.has(row.join("|"))) rows.push(row);
        seen.add(row.join("|"));
      }
    }
    for (const line of this.world.transit?.lines?.values?.() || []) {
      if (!line.ok || !line.visits?.some((v) => areas.some((a) => a.id === v.area?.id))) continue;
      rows.push([`${line.noun} ${line.label}`, every((line.headway * factor) / 60, line.auto && line.minutes != null)]);
    }
    return rows;
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.enabled) return;
    const settings = this.world.settings;
    // one board per stop object (a bus stop on both sides of the street has two stop areas)
    const boards = new Map();
    for (const c of this.crowds.values()) {
      const a = c.area;
      if (!a.owner?.geometry) continue;
      const vis = c.visible();
      const moodSum = vis.reduce((s, p) => s + p.mood, 0);
      const mood = vis.length ? moodSum / vis.length : 1;
      view.polygon(a.outline(), { fill: moodColor(mood), alpha: 0.3, order: 5 });
      this._drawPeople(view, a, vis, settings.trails);
      if (settings.spaceCircles) this._drawLoads(view, a);
      if (!settings.labels) continue;
      const b = boards.get(a.owner);
      if (b) b.push({ c, count: vis.length, moodSum });
      else boards.set(a.owner, [{ c, count: vis.length, moodSum }]);
    }
    for (const [owner, parts] of boards) this._drawSign(view, owner, parts);
  }

  /**
   * With the room people take shown (setting `spaceCircles`): over each vehicle standing at the area
   * its load in spaces ("54/76"), not in heads, coloured by how full it is.
   */
  _drawLoads(view, a) {
    for (const d of a.docks) {
      const v = this._vehicleAt(d.id), load = v?.load;
      if (!v || !load || load.dock !== d.id || v.phase !== "dwelling" || !(load.cap?.spaces > 0)) continue;
      const doors = this._doors(v);
      const s = doors.length ? doors.reduce((x, y) => x + y, 0) / doors.length : (d.s0 + d.s1) / 2;
      const at = a.toLayout(s, this._doorT(a, d) + d.side * 1.3);
      const share = load.spaces / load.cap.spaces;
      view.label([at[0], at[1], view.m(4)], `${Math.round(load.spaces)}/${load.cap.spaces}`, { size: 11, padding: 3, badge: "◯", badgeColor: moodColor(1 - share), order: 2, fit: true });
    }
  }

  _drawPeople(view, a, people, trails) {
    // "auto": agents of other simulations by trip purpose, everybody else by mood
    const mode = this.world.settings.peopleColour || "auto";
    const [ux, uy] = a.dir, [nx, ny] = a.normal;
    for (const p of people) {
      const purpose = mode === "purpose" || (mode === "auto" && !!p.agent?.colour);
      const [x, y] = a.toLayout(p.pos[0], p.pos[1]);
      if (!view.inImage(x, y, 0)) continue;
      if (trails && p.trail.length) {
        const pts = p.trail.concat([p.pos]).map((q) => a.toLayout(q[0], q[1]));
        view.line(pts, { stroke: purpose ? personColour(p) : moodColor(p.mood, 1, 0.8), width: 2, alpha: 0.6, order: 8 });
      }
      // velocity in the stop area's (s, t) frame -> direction on the layout (standing: the way it last walked)
      const [vs, vt] = p.vel, speed = Math.hypot(vs, vt);
      if (speed > 0.3) p.heading = [ux * vs + nx * vt, uy * vs + ny * vt];
      drawPerson(view, [x, y], {
        dir: [ux * vs + nx * vt, uy * vs + ny * vt], heading: p.heading ?? null, speed, phase: p.phase, height: p.height,
        colour: purpose ? personColour(p) : moodColor(p.mood), legs: purpose ? null : moodColor(p.mood, 1, 0.55),
        ...personLooks(this.world, p.profile, p.space), ring: moodColor(p.mood),
      });
    }
  }

  /**
   * The board of a stop object over its stop areas: name, people waiting, mood and the next
   * vehicle (for a bus stop on both sides of the street: per side; at a bus terminal: per line,
   * see {@link boardStatus}). Without the setting `stopBoards` (the default: the Stops tab has the
   * figures), and seen from far away (the stop shorter than {@link BOARD_MIN_PX} on the screen), only
   * a small badge with the people waiting.
   * @param {import("../core/view.js").View} view
   * @param {object} owner the stop object
   * @param {Array<{c: Crowd, count: number, moodSum: number}>} parts its stop areas
   */
  _drawSign(view, owner, parts) {
    const areas = parts.map((p) => p.c.area), first = areas[0];
    const count = parts.reduce((s, p) => s + p.count, 0);
    const mood = count ? parts.reduce((s, p) => s + p.moodSum, 0) / count : 1;
    // above the middle of the stop (between both sides of the street), or the start of a platform
    const ends = areas.flatMap((a) => [a.toLayout(0, 0), a.toLayout(a.L, 0)]);
    const at = areas.length > 1 ? [ends.reduce((s, p) => s + p[0], 0) / ends.length, ends.reduce((s, p) => s + p[1], 0) / ends.length] : first.toLayout(0, 0);
    const z = view.m(4.5);
    const road = first.kind === "bus" || first.kind === "tram";
    const badge = owner.spec.number || (road ? "H" : null);
    // the badge of bus and tram stops keeps the green of the German stop sign ("H"), platforms get CD Türkis
    const badgeColor = road ? OVERLAY.busStop : OVERLAY.sign;
    const fxs = areas.map((a) => this.world.disruptions.effectsFor(a));
    const alert = fxs.find((fx) => fx.messages.length)?.messages[0];
    const length = screenLength(view, areas);
    const small = { size: 11, padding: 3, anchor: "bottom", badge: badge || "·", badgeColor: alert ? OVERLAY.danger : badgeColor, order: 1, fit: true };
    if (!this.world.settings.stopBoards || length < BOARD_MIN_PX) {
      view.label([at[0], at[1], z], String(count), small);
      return;
    }
    const lines = [`${owner.name} · ${count} ${count === 1 ? "person" : "people"} · ${(mood * 100).toFixed(0)} %`];
    lines.push(...(alert ? [alert] : boardStatus(this.world, areas)));
    // the boards of the stops largest in the picture (the nearest) first; where the picture is
    // crowded the others are badges (core/view.js, LABEL_SHARE)
    view.label([at[0], at[1], z], lines, {
      size: 12, anchor: "bottom", badge: badge || undefined, badgeColor,
      colors: [null, ...lines.slice(1).map(() => (alert ? OVERLAY.alert : OVERLAY.status))], bar: mood, barColor: moodColor(mood),
      order: 1 + 0.5 / (1 + length / 100), compact: { text: String(count), style: small },
    });
  }
}

/**
 * Short status text for the docks of an area ("Train arriving", "Next train in 25 s", "Bus 62 to
 * Station in 3 min", ...): the first of {@link statusLines}.
 */
export function dockStatus(world, area) {
  return statusLines(world, area)[0] ?? "";
}

/**
 * Status texts for the docks of an area, the most important first: a timetable vehicle at a dock
 * ("RE 1 boarding", "Bus 305 arriving"), the next bus of each bus line that stops here (asked from
 * `world.transit`; the bays of a bus terminal can serve several lines), else the next vehicle of
 * the timetable at the tracks that are open ("Next train in 25 s"; none when every track is closed).
 * @returns {string[]}
 */
export function statusLines(world, area) {
  const states = world.services.forArea(area.id);
  const lines = world.transit ? [...new Set(area.docks.filter((d) => d.managed).map((d) => world.transit.statusFor(d.id)).filter(Boolean))] : [];
  if (!states.length) return lines;
  const noun = area.kind === "bus" ? "Bus" : area.kind === "tram" ? "Tram" : "Train";
  const busy = states.find((st) => st.vehicle);
  if (busy) {
    const v = busy.vehicle;
    const verb = { arriving: "arriving", dwelling: "boarding", departing: "departing" }[v.phase];
    // a bus of the timetable says "Bus 305 …", like the buses of the lines
    const name = !v.line ? noun : noun === "Bus" && !/^bus\b/i.test(v.line) ? `Bus ${v.line}` : v.line;
    return [`${name} ${verb}${states.length > 1 && busy.dock.label ? ` (${busy.dock.label})` : ""}`, ...lines];
  }
  if (lines.length) return lines;
  if (states.every((st) => st.mode === "feed")) return ["Waiting for the next train"];
  // trains of a planner (the operations simulation): its next departures
  if (states.some((st) => st.mode === "plan")) {
    const planned = world.services.planner?.statusLines?.(area) || [];
    if (planned.length || states.every((st) => st.mode !== "timetable")) return planned.length ? planned : ["No more trains today"];
  }
  // a closed track (a track closure, a story's train) and one kept for a story's own train have no
  // next train of the timetable: its timer has run out
  const open = states.filter((st) => {
    const fx = world.disruptions.effectsFor(area, st.dock);
    return !fx.closed && !fx.reserved;
  });
  if (!open.length) return [];
  const next = Math.min(...open.map((st) => st.timer)) / (world.speed || 1);
  return [`Next ${noun.toLowerCase()} in ${Math.max(0, next).toFixed(0)} s`];
}

/**
 * Status lines for the board of a stop object over its stop areas (a bus stop on both sides of
 * the street has two): the most important line of each area first (the next bus on each side),
 * then the others (the next bus of the other lines at a terminal); at most `max`.
 * @param {object} world
 * @param {object[]} areas
 * @param {number} [max=2]
 */
export function boardStatus(world, areas, max = 2) {
  const per = areas.map((a) => statusLines(world, a));
  return [...new Set([...per.map((s) => s[0]), ...per.flatMap((s) => s.slice(1))].filter(Boolean))].slice(0, max);
}

/**
 * The rows of a person's card for their characteristics: what they are like, how fast they walk, the
 * room they take, whether they may drive.
 * @param {object} profile
 * @param {number} speed walking speed (m/s)
 * @param {number} [space] spaces (as squeezed in a vehicle)
 * @returns {Array<[string, string]>}
 */
export function profileRows(profile, speed, space = null) {
  const rows = [["Characteristics", profileWords(profile)], ["Walking speed", `${speed.toFixed(1)} m/s`]];
  if (space != null && Math.abs(space - 1) > 0.01) rows.push(["Room", `${space.toFixed(1)} spaces in a vehicle`]);
  const drive = drivingWords(profile);
  if (drive) rows.push(["Driving licence", drive]);
  return rows;
}

/** Colour of a person when people show their trip purpose: the agent's colour, else neutral. */
function personColour(p) {
  return p.agent?.colour || NEUTRAL_PERSON;
}

/**
 * How a person is drawn besides its colour (the options of {@link drawPerson}): its aid and
 * luggage, and, with the setting `spaceCircles` (Settings → View), the room it takes.
 * @param {object} world
 * @param {object | null} profile its characteristics (core/mobility.js)
 * @param {number | null} [space] its spaces (as squeezed); default: by its profile
 * @returns {{aid: string | null, luggage: string | null, space: number | null}}
 */
export function personLooks(world, profile, space = null) {
  return {
    aid: profile?.aid && profile.aid !== "none" ? profile.aid : null,
    luggage: profile?.luggage === "heavy" || profile?.luggage === "bulky" ? profile.luggage : null,
    space: world.settings?.spaceCircles ? space ?? spaceOf(profile, {}, mobilityOf(world)).space : null,
  };
}

/** Colours of what people have with them: a pram, a rollator, a wheelchair's wheels, luggage (greys, like buildings). */
const BELONGINGS = { pram: grey(0.3), frame: grey(0.18), wheel: grey(0.12), case: grey(0.4), bulky: grey(0.28) };

/**
 * Draw one walking or standing person (stick figure with a shadow) at a layout point.
 * Used by the passenger simulation and by other simulations with people (the town).
 * With `space` a circle on the ground whose area is the room the person takes (core/mobility.js:
 * a person alone 1, a pram 2.5 …), in the colour `ring` (else the person's); with `aid` and
 * `luggage` what the person has with it: a pram or a rollator ahead, a stick, a wheelchair (the
 * person drawn sitting), a suitcase or bulky luggage beside.
 * @param {import("../core/view.js").View} view
 * @param {number[]} at layout point (mm)
 * @param {{dir?: number[], heading?: number[] | null, speed?: number, phase?: number, height?: number, colour: string, legs?: string | null,
 *   girth?: number, space?: number | null, ring?: string | null, aid?: string | null, luggage?: string | null}} o
 *   dir: walking direction on the layout (any length), heading: where a standing person faces (default
 *   dir), speed in m/s (legs swing when walking), phase: step phase (radians), height in prototype
 *   metres, girth: how stout (1 = as everybody; a story's traveller is drawn stouter, to be found at once)
 */
export function drawPerson(view, at, { dir = [1, 0], heading = null, speed = 0, phase = 0, height = 1.75, colour, legs = null, girth = 1, space = null, ring = null, aid = null, luggage = null }) {
  const [x, y] = at;
  const m = view.m(1);
  if (space > 0) {
    const r = personRadius(space) * m, tone = ring || colour;
    view.polygon(Array.from({ length: 18 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 9), y + r * Math.sin((i * Math.PI) / 9)]), { fill: tone, alpha: 0.3, stroke: tone, width: 1.5, order: 6.5 });
  }
  const dl = Math.hypot(dir[0], dir[1]);
  const [dx, dy] = speed > 0.15 && dl > 1e-9 ? [dir[0] / dl, dir[1] / dl] : unitOr(heading ?? dir);
  const qx = -dy, qy = dx;
  const seated = aid === "wheelchair";
  const h = seated ? Math.min(height, 1.3) : height;
  // a box on the ground `a` m ahead (along the way) and `b` m to the left, `l` long and `w` wide, z0 to z1 (m)
  const box = (a, b, l, w, z0, z1, fill) => {
    const c = [x + (dx * a + qx * b) * m, y + (dy * a + qy * b) * m], u = [dx * (l / 2) * m, dy * (l / 2) * m], v = [qx * (w / 2) * m, qy * (w / 2) * m];
    view.prism([[c[0] - u[0] - v[0], c[1] - u[1] - v[1]], [c[0] + u[0] - v[0], c[1] + u[1] - v[1]], [c[0] + u[0] + v[0], c[1] + u[1] + v[1]], [c[0] - u[0] + v[0], c[1] - u[1] + v[1]]], z0 * m, z1 * m, { side: view.dim(fill, 0.5), top: view.dim(fill, 0.4) });
  };
  if (aid === "pram") box(0.75, 0, 0.8, 0.55, 0.35, 0.95, BELONGINGS.pram);
  if (luggage === "heavy") box(-0.1, -0.38, 0.4, 0.22, 0, 0.62, BELONGINGS.case);
  else if (luggage === "bulky") box(0, -0.45, 1.6, 0.2, 0.2, 1, BELONGINGS.bulky);
  if (view.simple) {
    // the simple view (core/simple.js): a plain block (a wheelchair and a rollator as a block too)
    const r = 0.3 * m * girth;
    if (seated) box(0, 0, 0.9, 0.65, 0, 0.55, BELONGINGS.wheel);
    else if (aid === "rollator") box(0.45, 0, 0.35, 0.55, 0, 0.85, BELONGINGS.frame);
    view.block([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], seated ? 0.45 * m : 0, h * m, colour);
    return;
  }
  const amp = seated ? 0 : 0.3 * Math.min(1, speed) * Math.sin(phase);
  const P = (ox, oy, z = 0) => view.project(x + ox * m, y + oy * m, z * m);
  const foot = P(0, 0), side = P(0.3 * dx, 0.3 * dy), top = P(0, 0, h);
  const hip = P(0, 0, 0.5 * h), shoulder = P(0, 0, 0.8 * h), head = P(0, 0, 0.91 * h);
  // sitting in a wheelchair: the legs forward from the seat; else the feet swing when walking
  const fl = seated ? P(dx * 0.4 + qx * 0.1, dy * 0.4 + qy * 0.1, 0.12) : P(dx * amp + qx * 0.1, dy * amp + qy * 0.1);
  const fr = seated ? P(dx * 0.4 - qx * 0.1, dy * 0.4 - qy * 0.1, 0.12) : P(-dx * amp - qx * 0.1, -dy * amp - qy * 0.1);
  if (!foot || !side || !top || !hip || !shoulder || !head || !fl || !fr) return;
  // the things it holds: a rollator's frame, a stick, a wheelchair's wheels (projected points)
  const parts = [];
  if (aid === "rollator") {
    for (const b of [0.25, -0.25]) parts.push({ pts: [P(dx * 0.55 + qx * b, dy * 0.55 + qy * b), P(dx * 0.4 + qx * b, dy * 0.4 + qy * b, 0.85)], style: BELONGINGS.frame });
    parts.push({ pts: [P(dx * 0.4 + qx * 0.25, dy * 0.4 + qy * 0.25, 0.85), P(dx * 0.4 - qx * 0.25, dy * 0.4 - qy * 0.25, 0.85)], style: BELONGINGS.frame });
  } else if (aid === "stick") parts.push({ pts: [P(dx * 0.15 - qx * 0.25, dy * 0.15 - qy * 0.25, 0.8), P(dx * 0.3 - qx * 0.3, dy * 0.3 - qy * 0.3)], style: BELONGINGS.frame });
  else if (seated) {
    for (const b of [0.32, -0.32]) {
      parts.push({ pts: Array.from({ length: 13 }, (_, i) => P(dx * 0.3 * Math.cos((i * Math.PI) / 6) + qx * b, dy * 0.3 * Math.cos((i * Math.PI) / 6) + qy * b, 0.3 + 0.3 * Math.sin((i * Math.PI) / 6))), style: BELONGINGS.wheel, wheel: true });
    }
  }
  if (parts.some((q) => q.pts.some((p) => !p))) parts.length = 0;
  const vertical = Math.hypot(top[0] - foot[0], top[1] - foot[1]) / h;
  const ground = Math.hypot(side[0] - foot[0], side[1] - foot[1]) / 0.3;
  const ref = Math.max(vertical, 0.5 * ground); // px per prototype metre
  // shadow and figure set all the canvas state they use: "plain" drawings (see View#add)
  const shadow = (ctx) => {
    ctx.globalAlpha *= 0.45 * (1 - 0.6 * view.darkness);
    ctx.fillStyle = "#141414";
    const r = Math.hypot(side[0] - foot[0], side[1] - foot[1]) * girth;
    ctx.beginPath();
    ctx.ellipse(foot[0], foot[1], r, r * 0.45, 0, 0, 2 * Math.PI);
    ctx.fill();
  };
  shadow.plain = true;
  view.ground(7, shadow);
  // people are under street and station lights: only half as dark at night
  const body = view.dim(colour, 0.5), legColour = view.dim(legs || shadeLegs(colour), 0.5);
  const figure = (ctx) => {
    const bw = Math.max(2, ref * 0.42 * girth), lw = Math.max(1, ref * 0.14 * girth), headR = Math.max(1.6, ref * 0.15 * Math.sqrt(girth));
    ctx.lineCap = "round";
    const line = (u, v, w, style) => {
      ctx.beginPath();
      ctx.moveTo(u[0], u[1]);
      ctx.lineTo(v[0], v[1]);
      ctx.lineWidth = w;
      ctx.strokeStyle = style;
      ctx.stroke();
    };
    for (const q of parts) {
      ctx.beginPath();
      q.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.lineWidth = Math.max(1, ref * (q.wheel ? 0.06 : 0.05));
      ctx.strokeStyle = view.dim(q.style, 0.5);
      ctx.stroke();
    }
    for (const f of [fl, fr]) {
      line(hip, f, lw + 2, "#191919");
      line(hip, f, lw, legColour);
    }
    line(hip, shoulder, bw + 2, "#191919");
    line(hip, shoulder, bw, body);
    ctx.beginPath();
    ctx.arc(head[0], head[1], headR + 1, 0, 2 * Math.PI);
    ctx.fillStyle = "#191919";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head[0], head[1], headR, 0, 2 * Math.PI);
    ctx.fillStyle = body;
    ctx.fill();
  };
  figure.plain = true;
  view.solid(view.depth(x, y, 0), figure);
}

/** A unit vector of `v`, else [1, 0]. */
function unitOr(v) {
  const l = Math.hypot(v?.[0] ?? 0, v?.[1] ?? 0);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : [1, 0];
}

/** Legs a bit darker than the body. */
function shadeLegs(colour) {
  return mix(colour, "#000000", 0.45);
}
