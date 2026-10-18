/**
 * Road traffic (simulation type `traffic`): cars on the streets of the road network, with drivers,
 * passengers and parking.
 *
 * Every car has a **driver** (a person), sometimes **passengers** (by the purpose of the trip:
 * 1.1 people per car to work, about 1.5 to the shops, MiD 2017), a **start** and a **goal** and a
 * **planned route**: the driver plans the drive on the map before leaving (`planDrive`): the
 * fastest route on the streets, and for a goal in the town a parking space near it, chosen by the
 * drive, the walk from the space and what it costs (a supermarket is free for its customers, a
 * factory for its employees, residents' parking needs a permit; core/parking.js, objects/parking.js).
 *
 * - **Through traffic** enters where streets end at the edge of the layout (dead ends,
 *   `boundaryNodes()`), drives to another street end on the fastest route (sometimes with a detour)
 *   and leaves the layout again. On streets without dead ends (a ring) cars appear on the streets
 *   and drive from place to place.
 * - **Destination traffic** (`destinations`, a share of the cars coming in) drives to a building in
 *   the town: to work, shopping or a visit by the time of day. At the space the car parks and pays,
 *   its people walk to the building and come back after their stay; then the car leaves. A full
 *   facility makes the driver look for the next one.
 * - **Residents' cars** (`parked`, the share of residents' spaces taken at night) stand in the
 *   residential streets and garages; many leave in the morning and come back in the evening.
 *
 * Cars keep to the right lane and the speed limit, keep their distance to the vehicle ahead (cars,
 * buses, trams, bikes that hold them up), obey traffic lights, Stop and give way, wait for people on
 * zebra crossings and at closed level crossings, wait beside a tram at a stop without an island,
 * give way at junctions (first come, first served, at most 4 s, so nothing gets stuck) and overtake
 * a bike only when the other lane is free (StVO § 5: 1.5 m in towns). Their number follows
 * `cars_per_km` and the time of day (`clock.demand("car")`).
 *
 * The example plugin `web/plugins/road-traffic.js` is a simpler version (cars per street, no
 * junctions); both can run side by side.
 * @module arail/sims/traffic
 */
import { Simulation } from "../core/simulation.js";
import { createRng, dist2, dot2, pointSegment, polylineAt, polylineProject, rectBetween, sub2, unit2 } from "../core/math.js";
import { CD, grey, mix, shade } from "../core/colors.js";
import { APPROACH_M, approachPrio, boxFaces, junctionPatience, leaderAhead, lightAt, mustYield, RoadUsers, roomAfter, squeezing, waitFor } from "../core/transit.js";
import { hiddenAt, joinPaths } from "../core/network.js";
import { Person, Population } from "../core/people.js";
import { parkingTerms } from "../objects/parking.js";
import { drawPerson } from "./passengers.js";

/** Muted CD colours, and many greys, white and black (most cars are). */
export const CAR_COLOURS = [
  grey(0.94), grey(0.9), grey(0.72), grey(0.55), grey(0.38), grey(0.16), grey(0.1),
  mix(CD.tuerkis, grey(0.5), 0.3), mix(CD.dunkelblau, grey(0.5), 0.2), mix(CD.rot, grey(0.45), 0.35),
  mix(CD.brillantblau, grey(0.5), 0.4), mix(CD.orange, grey(0.5), 0.4),
];

/**
 * How many passengers ride with the driver, by the purpose of the trip: shares of 0, 1, 2, 3
 * passengers (MiD 2017: 1.1 people per car to work, about 1.5 for shopping and leisure, 1.4 overall).
 */
export const OCCUPANCY_BY_PURPOSE = {
  work: [0.92, 0.07, 0.01],
  shopping: [0.6, 0.3, 0.07, 0.03],
  visit: [0.55, 0.32, 0.09, 0.04],
  home: [0.8, 0.15, 0.04, 0.01],
  through: [0.68, 0.24, 0.06, 0.02],
};

/** Labels of the purposes for the cards. */
const PURPOSE_WORDS = { work: "to work", shopping: "to the shops", visit: "a visit", home: "home", through: "through the town" };

const LENGTH_M = 4.4;
const WIDTH_M = 1.8;
const ACCEL = 2.0; // m/s²
const BRAKE = 2.5; // comfortable braking (m/s²)
const HARD = 7; // hardest braking (m/s²)
const GAP_M = 2.5; // distance to the vehicle ahead when standing (m)
const WALK_MPS = 1.3; // walking speed of drivers and passengers (m/s)
const MAX_WALK_M = 400; // the farthest a driver parks from the goal (m)
const EUR_PER_MIN = 0.2; // what a minute is worth to a driver (12 € an hour): weighs fees against time
const PASS_AFTER_S = 2; // a car behind a bike waits this long before it looks for a chance to overtake
const ONCOMING_M = 60; // overtaking needs the other lane free this far ahead (m)

function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let nextCarId = 1;

/** The network, or null (while it is built, or without streets). */
function networkOf(world) {
  try {
    return world.network?.() || null;
  } catch {
    return null;
  }
}

/** The entrances of a building: [{pos, key}]. */
function entrancesOf(world, id) {
  const o = world.getObject(id);
  const list = o?.geometry && typeof o.entrances === "function" ? o.entrances() : [];
  return list.map((e, i) => ({ pos: e.pos, key: `building:${o.id}:${i}` }));
}

/**
 * Plan a drive on the map: the fastest route from a node of the road network to a goal, and for a
 * building as the goal a parking space near it. The parking spaces are ranked by the drive, the
 * walk from the space to the building (counted 1.5 times) and the fee for the stay (12 € an hour
 * of time); spaces the driver may not use (customers, employees, residents only) are left out,
 * full ones count as a long search.
 * @param {import("../core/world.js").World} world
 * @param {{from: number | object, to: string | number | {node: number}, purpose?: string, driver?: object,
 *   stayMin?: number, avoid?: string[]}} o from: a node (or its id); to: a building id or a node;
 *   driver: {purpose, destId, home, permits} for parkingTerms; avoid: facilities tried already
 * @returns {{route: object, minutes: number, km: number, facility: object | null, fee: number, walkM: number,
 *   free: boolean, why: string, options: object[]} | null}
 */
export function planDrive(world, { from, to, purpose = "visit", driver = {}, stayMin = 60, avoid = [] }) {
  const net = networkOf(world);
  if (!net || net.empty) return null;
  const a = net.node(from);
  if (!a) return null;
  const minutesOf = (route) => (route ? net.distance(a, route.nodes[route.nodes.length - 1], "car") / 60 : Infinity);
  const kmOf = (route) => (route ? net.meters(route.length) / 1000 : 0);
  if (typeof to !== "string") {
    const b = net.node(to?.node ?? to);
    const route = b ? net.route(a, b, { mode: "car" }) : null;
    return route ? { route, minutes: minutesOf(route), km: kmOf(route), facility: null, fee: 0, walkM: 0, free: true, why: "", options: [] } : null;
  }
  const doors = entrancesOf(world, to);
  if (!doors.length) return null;
  const who = { ...driver, purpose, destId: to };
  const options = [];
  for (const f of world.parking?.facilities?.() || []) {
    if (avoid.includes(f.id)) continue;
    const terms = parkingTerms(f, who);
    if (!terms.allowed) continue;
    const exit = f.exit || f.entry || f.spots[0]?.pos;
    if (!exit) continue;
    const door = doors.reduce((b, d) => (dist2(d.pos, exit) < dist2(b.pos, exit) ? d : b), doors[0]);
    const straight = net.meters(dist2(door.pos, exit));
    if (straight > MAX_WALK_M) continue;
    const entry = net.nearestNode(f.entry || exit, { mode: "car" });
    if (!entry) continue;
    const time = net.distance(a, entry, "car");
    if (!Number.isFinite(time)) continue;
    const walkM = Math.max(straight, net.meters(net.walk(exit, door.pos, { toKey: door.key }).length));
    const fee = terms.fee(stayMin), full = (world.parking?.free?.(f.id) ?? 1) <= 0;
    const cost = time / 60 + (1.5 * walkM) / WALK_MPS / 60 + fee / EUR_PER_MIN + (full ? 10 : 0);
    options.push({ facility: f, entry, door, walkM, fee, free: terms.free, why: terms.why, full, cost, minutes: time / 60 });
  }
  if (!options.length) return null;
  options.sort((x, y) => x.cost - y.cost);
  const best = options[0];
  const route = net.route(a, best.entry, { mode: "car" });
  if (!route) return null;
  return {
    route, minutes: best.minutes, km: kmOf(route), facility: best.facility, entry: best.entry, door: best.door, fee: best.fee, walkM: best.walkM, free: best.free,
    why: best.why, options: options.slice(0, 3).map((o) => ({ label: o.facility.label, minutes: o.minutes, walkM: o.walkM, fee: o.fee, full: o.full })),
  };
}

export class TrafficSimulation extends Simulation {
  static type = "traffic";
  static label = "Road traffic";
  static description = "Cars with drivers and passengers: they come in where streets end at the edge of the layout, drive through the town or to a building, park there and pay, keep their distance, obey signs and lights, and leave again.";
  static params = [
    { key: "cars_per_km", label: "Cars", type: "number", unit: "per km of street", min: 0, max: 200, step: 5, default: 20, help: "Driving at normal daytime traffic; more in the rush hours, few at night." },
    { key: "destinations", label: "Cars to the town", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.5, help: "Share of the cars coming in that drive to a building and park there (when there is parking); the others drive through." },
    { key: "parked", label: "Residents' cars", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.7, help: "Share of the residents' parking spaces taken at night; many of them leave in the morning." },
  ];

  constructor(world, config) {
    super(world, config);
    /** Driving cars: {id, driver, passengers, purpose, path (driving line), s (front, mm), v (m/s), ...}. */
    this.cars = [];
    /** Parked cars: {car, facility, slot, spot, until (absolute clock minutes)}. */
    this.parkedCars = [];
    /** People on foot between a car and a building: {car, people, walk, s, speed, back}. */
    this.walkers = [];
    this._net = null;
    this._spawn = 0;
    this._users = [];
    this._filledParking = false;
    /** Cars made so far (their `seq`, the order at junctions when two arrive at once). */
    this._seq = 0;
    this.rng = createRng(hash(world.seed, "traffic"));
    this.people = new Population(world.seed, "drivers");
    this._off = world.events.on("clock.set", () => this._resetParking());
  }

  dispose() {
    this._off?.();
    for (const p of this.parkedCars) this.world.parking?.release(p.facility.id, p.car);
  }

  clear() {
    for (const p of this.parkedCars) this.world.parking?.release(p.facility.id, p.car);
    this.cars = [];
    this.parkedCars = [];
    this.walkers = [];
    this._users = [];
    this._filledParking = false;
  }

  get scale() {
    return this.world.scale;
  }

  mm(m) {
    return (m * 1000) / this.world.scale;
  }

  meters(mm) {
    return (mm * this.world.scale) / 1000;
  }

  /** Absolute clock minutes (days count on). */
  _now() {
    const c = this.world.clock;
    return (c?.day ?? 0) * 1440 + (c?.minutes ?? 0);
  }

  /** Cars wanted now: density × street length × demand at this time of day. */
  targetCount(net = networkOf(this.world)) {
    if (!net) return 0;
    let km = 0;
    for (const e of net.edges) if (e.kind === "road" && e.car) km += this.meters(e.length) / 1000;
    return Math.round((+this.config.cars_per_km || 0) * km * this.world.clock.demand("car"));
  }

  /** Front, rear and direction of every car (for gaps; transit reads them for its buses). */
  roadUsers() {
    return this._users;
  }

  /** The people of the cars walking to or from a building (zebra crossings ask for them). */
  pedestrians() {
    return this.walkers.map((w) => ({ pos: w.pos || w.walk.points[0], dir: w.dir || [1, 0] }));
  }

  _pose(car) {
    const p = car.path;
    let front = polylineAt(p.points, car.s, p.lengths).point;
    let rear = polylineAt(p.points, Math.max(0, car.s - this.mm(LENGTH_M)), p.lengths).point;
    const d = sub2(front, rear);
    const dir = Math.hypot(d[0], d[1]) > 1e-6 ? unit2(d) : polylineAt(p.points, car.s, p.lengths).dir;
    // overtaking a bike: on the other lane for a while
    if (car.shift) {
      const n = [-dir[1] * car.shift, dir[0] * car.shift];
      front = [front[0] + n[0], front[1] + n[1]];
      rear = [rear[0] + n[0], rear[1] + n[1]];
    }
    // the junction it is about to enter (others give way to the first, or to a green light)
    const j = car.junctions.find((x) => x.s + x.r > car.s);
    const approach = j && car.s < j.s - j.r && j.s - car.s < this.mm(APPROACH_M) ? { key: j.key, d: j.s - car.s, prio: approachPrio(j, this.world.time) } : null;
    const pose = { vehicle: car, front, rear, dir, speed: car.v, approach };
    car._pose = pose;
    return pose;
  }

  /* ---------------------------------------------------------------- people and trips */

  /** A driver and the passengers for a trip of this purpose (their names stay the same for a seed and car). */
  _crew(purpose) {
    const n = this.rng.weighted(OCCUPANCY_BY_PURPOSE[purpose] || OCCUPANCY_BY_PURPOSE.through);
    // by the order the cars come (their seq), not by their program-wide id
    const id = this._seq + 1;
    const person = (key, role) => new Person({ id: key.join("-"), ...this.people.name(key), role });
    return { driver: person(["car", id, "driver"], "driver"), passengers: Array.from({ length: n }, (_, k) => person(["car", id, "passenger", k], "passenger")) };
  }

  /** What draws people into the town now: buildings by purpose ([{id, name, purpose, weight}]). */
  _goals() {
    const minutes = this.world.clock.minutes, h = minutes / 60, out = [];
    for (const o of this.world.objects) {
      if (!o.geometry || typeof o.capacity !== "function" || typeof o.entrances !== "function" || !o.entrances().length) continue;
      const cap = o.capacity() || {}, use = typeof o.use === "function" ? o.use() : o.constructor.use;
      if (use === "shop" && h >= 7.5 && h < 20.5) out.push({ id: o.id, name: o.name, purpose: "shopping", weight: 1 + (cap.visitors || 0) / 50 });
      if ((cap.jobs || 0) > 0 && h >= 5.5 && h < 10) out.push({ id: o.id, name: o.name, purpose: "work", weight: (cap.jobs || 0) / 10 });
      if (use === "residential" && h >= 9 && h < 22) out.push({ id: o.id, name: o.name, purpose: "visit", weight: 0.3 + (cap.residents || 0) / 100 });
      if (use === "residential" && h >= 15.5 && h < 21) out.push({ id: o.id, name: o.name, purpose: "home", weight: (cap.residents || 0) / 40 });
    }
    return out;
  }

  /** How long people stay at their goal (clock minutes), by purpose. */
  _stay(purpose) {
    const r = this.rng;
    if (purpose === "work") return r.uniform(420, 540);
    if (purpose === "shopping") return r.uniform(20, 60);
    if (purpose === "home") return r.uniform(600, 840);
    return r.uniform(60, 180);
  }

  /* ---------------------------------------------------------------- routes */

  /** A route for a car from a node to a destination, sometimes via a detour. */
  _route(net, from, to) {
    const direct = net.route(from, to, { mode: "car" });
    if (!direct || !this.rng.chance(0.3)) return direct;
    const nodes = net.nodes.filter((n) => n.carDegree >= 2);
    if (!nodes.length) return direct;
    const via = this.rng.pick(nodes);
    const a = net.route(from, via, { mode: "car" }), b = net.route(via, to, { mode: "car" });
    if (!a || !b || a.length + b.length > 1.5 * direct.length) return direct;
    if (a.edges.length && b.edges.length && a.edges[a.edges.length - 1].edge === b.edges[0].edge) return direct; // would turn back
    return joinPaths([a, b]);
  }

  /** Make a car for a route (centre-line path); null if the route is too short. */
  _car(net, route, dest, s0 = 0, crew = null) {
    if (!route || route.length < this.mm(LENGTH_M * 2)) return null;
    const path = net.drivingLine(route);
    const junctions = net.junctionsAlong(route, path);
    const crossings = net.crossingsAlong(route, path);
    const people = crew || this._crew("through");
    return {
      id: `car${nextCarId++}`, seq: ++this._seq, kind: "car", path, route, dest, destPos: net.nodes[dest]?.pos, junctions, crossings, s: s0, v: 0, waited: 0,
      factor: this.rng.uniform(0.85, 1.05), colour: this.rng.pick(CAR_COLOURS), net, purpose: "through", shift: 0,
      driver: people.driver, passengers: people.passengers, origin: net.nodes[route.nodes[0]]?.pos ?? null,
    };
  }

  /** Point a car (or a new one) at a new route. */
  _setRoute(car, net, route, dest) {
    const next = this._car(net, route, dest, 0, car);
    if (!next) return false;
    Object.assign(car, { path: next.path, route, junctions: next.junctions, crossings: next.crossings, dest, destPos: next.destPos, s: 0, net, passing: null, shift: 0, behind: 0 });
    return true;
  }

  /** A new car where a street ends at the edge of the layout (or anywhere on a ring): through the town or to a building in it. */
  _enter(net) {
    const ends = net.boundaryNodes();
    const anywhere = net.nodes.filter((n) => n.carDegree >= 1);
    if (!anywhere.length) return;
    const from = ends.length ? this.rng.pick(ends) : this.rng.pick(anywhere);
    const clear = this.mm(LENGTH_M + 6);
    for (const u of this._allUsers()) if (dist2(u.front, from.pos) < clear || dist2(u.rear, from.pos) < clear) return;
    // to the town: a building to drive to, and a parking space near it
    if (this.rng.chance(+this.config.destinations || 0)) {
      const goals = this._goals();
      if (goals.length) {
        const goal = goals[this.rng.weighted(goals.map((g) => g.weight))];
        const crew = this._crew(goal.purpose);
        const stay = this._stay(goal.purpose);
        // residents coming home have a permit for the residents' parking near their house
        const driver = goal.purpose === "home" ? { home: goal.id, resident: true } : {};
        const plan = planDrive(this.world, { from, to: goal.id, purpose: goal.purpose, driver, stayMin: stay });
        if (plan) {
          const car = this._car(net, plan.route, plan.entry.id, 0, crew);
          if (car) {
            Object.assign(car, { purpose: goal.purpose, destId: goal.id, destName: goal.name, plan, stay, tried: [], who: driver });
            car.v = Math.min(8, car.path.speeds[0] || 8) * 0.6;
            this.cars.push(car);
            return;
          }
        }
      }
    }
    const pool = (ends.length > 1 ? ends : anywhere).filter((n) => n !== from);
    if (!pool.length) return;
    const to = this.rng.pick(pool);
    const car = this._car(net, this._route(net, from, to), to.id);
    if (!car) return;
    car.v = Math.min(8, car.path.speeds[0] || 8) * 0.6;
    this.cars.push(car);
  }

  /** Fill the streets at once (a new layout or new streets): cars spread over random routes. */
  _fill(net, n) {
    const anywhere = net.nodes.filter((x) => x.carDegree >= 1);
    const ends = net.boundaryNodes();
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const from = this.rng.pick(ends.length > 1 ? ends : anywhere), to = this.rng.pick(ends.length > 1 ? ends : anywhere);
      if (!from || !to || from === to) continue;
      const route = this._route(net, from, to);
      if (!route) continue;
      const car = this._car(net, route, to.id);
      if (!car) continue;
      car.s = this.rng.uniform(this.mm(LENGTH_M), car.path.length - this.mm(LENGTH_M));
      const pose = this._pose(car);
      const clear = this.mm(LENGTH_M + 8);
      const others = this.cars.map((c) => this._pose(c)).concat(this.world.transit?.roadUsers?.() || []);
      if (others.some((q) => dist2(q.front, pose.front) < clear || dist2(q.rear, pose.front) < clear || dist2(q.front, pose.rear) < clear || dist2(midpoint(q), pose.front) < clear)) continue;
      car.v = (car.path.speeds[0] || 8) * 0.7;
      this.cars.push(car);
      k++;
    }
  }

  /**
   * Residents' cars in the residents' spaces (permits, the garages of houses) and some cars at the
   * other facilities, by the time of day; each with its driver and when it leaves.
   */
  _fillParking() {
    const parking = this.world.parking;
    if (!parking) return;
    const now = this._now(), h = this.world.clock.minutes / 60;
    // residents are home at night, many away at work in the day
    const home = (+this.config.parked || 0) * (h < 6 || h >= 19 ? 1 : h < 8.5 ? 0.85 : h < 16 ? 0.55 : 0.75);
    for (const f of parking.facilities()) {
      const residents = f.access === "residents";
      const share = residents ? home : f.access === "public" ? 0.35 * this.world.clock.demand("car") : 0.25;
      const n = Math.min(f.spaces, Math.round(f.spaces * Math.min(0.95, share) + this.rng.uniform(-0.5, 0.5)));
      for (let k = 0; k < n; k++) {
        const purpose = residents ? "home" : f.access === "employees" ? "work" : f.access === "customers" ? "shopping" : "visit";
        const crew = this._crew(purpose);
        const car = {
          id: `car${nextCarId++}`, seq: ++this._seq, kind: "car", colour: this.rng.pick(CAR_COLOURS), purpose, driver: crew.driver, passengers: crew.passengers,
          destName: f.for ? this.world.getObject(f.for)?.name ?? null : null, permits: residents ? new Set([f.id]) : null, fee: 0, why: "",
        };
        const slot = parking.take(f.id, car, f.spots[this.rng.int(Math.max(1, f.spots.length))]?.pos ?? null);
        if (!slot) break;
        // residents leave in the morning rush or stay; the others by their purpose
        const until = residents ? (h < 8.5 && this.rng.chance(0.5) ? now + this.rng.uniform(0, Math.max(5, (8.5 - h) * 60)) : now + this.rng.uniform(120, 900)) : now + this._stay(purpose) * this.rng.uniform(0.1, 1);
        this.parkedCars.push({ car, facility: f, slot: slot.slot, spot: slot.spot, until });
      }
    }
  }

  /** The clock was set: parked cars and walkers go, the parking fills anew. */
  _resetParking() {
    for (const p of this.parkedCars) this.world.parking?.release(p.facility.id, p.car);
    this.parkedCars = [];
    this.walkers = [];
    this._filledParking = false;
  }

  /**
   * The streets changed (or the scale): put the cars on the new network where they are, or let
   * them go. A car keeps its place when a route from the node behind it passes there; else it
   * moves on to the node ahead. Cars never end up on top of each other (they would block each
   * other for good).
   */
  _rebind(net) {
    const out = [], placed = (this.world.transit?.roadUsers?.() || []).slice();
    const len = this.mm(LENGTH_M);
    const ends = net.boundaryNodes();
    for (const car of this.cars) {
      const pose = this._pose(car);
      const oldDest = car.destPos;
      const ahead = [pose.front[0] + pose.dir[0] * this.mm(6), pose.front[1] + pose.dir[1] * this.mm(6)];
      // the nearest nodes behind the car (one of them begins the street it is on), then the node ahead
      const behind = net.nodes.filter((n) => n.carDegree > 0 && dot2(sub2(n.pos, pose.rear), pose.dir) < 0)
        .map((n) => ({ n, d: dist2(n.pos, pose.rear) })).sort((x, y) => x.d - y.d).slice(0, 3).map((x) => [x.n, true]);
      let next = null;
      for (const [start, keep] of [...behind, [null, false]]) {
        const from = start || net.nearestNode(ahead, { mode: "car" });
        if (!from || dist2(from.pos, keep ? pose.rear : ahead) > this.mm(keep ? 400 : 40)) continue;
        let to = null;
        for (const n of ends.length ? ends : net.nodes) if (n !== from && n.carDegree && (!to || dist2(n.pos, oldDest || from.pos) < dist2(to.pos, oldDest || from.pos))) to = n;
        const route = to ? net.route(from, to, { mode: "car" }) : null;
        const c = route ? this._car(net, route, to.id, 0, car) : null;
        if (!c) continue;
        if (keep) {
          // where the car is on the new route (it must pass there, in the same direction)
          const pr = polylineProject(c.path.points, pose.front, c.path.lengths);
          const dir = polylineAt(c.path.points, pr.s, c.path.lengths).dir;
          if (pr.distance > this.mm(2.5) || pr.s < len || dot2(dir, pose.dir) < 0.7) continue;
          c.s = pr.s;
        } else c.s = Math.min(len, c.path.length - this.mm(0.5));
        next = c;
        break;
      }
      if (!next) continue;
      const np = this._pose(next);
      if (placed.some((u) => overlapping(u, np, this.mm(1.2)))) continue;
      placed.push(np);
      // the car and its people stay the same; it now drives out of the layout
      Object.assign(next, { id: car.id, colour: car.colour, factor: car.factor, v: car.v, driver: car.driver, passengers: car.passengers, purpose: "through" });
      out.push(next);
    }
    this.cars = out;
  }

  /** Every road user the cars keep their distance to: the cars, the buses and trams, other simulations' (bikes that hold cars up). */
  _allUsers() {
    const others = [...(this.world.transit?.roadUsers?.() || [])];
    for (const s of this.world.simulations || []) if (s !== this && s.enabled !== false && typeof s.roadUsers === "function") others.push(...s.roadUsers());
    return others.length ? this._users.concat(others) : this._users;
  }

  /* ---------------------------------------------------------------- step */

  step(dt) {
    if (!this.enabled) return;
    const net = networkOf(this.world);
    if (!net || net.empty) {
      this.cars = [];
      this._users = [];
      this._net = net;
      return;
    }
    if (net !== this._net && this._net && net.carKey === this._net.carKey) {
      // only buildings or other things changed: the cars drive on (their destination is found by position)
      this._net = net;
    }
    if (net !== this._net) {
      const first = !this._net || this._net.empty || !this.cars.length;
      if (this.cars.length) this._rebind(net);
      this._net = net;
      this._users = this.cars.map((c) => this._pose(c));
      if (first) this._fill(net, this.targetCount(net));
    }
    if (!this._filledParking) {
      this._filledParking = true;
      this._fillParking();
    }
    // cars whose space is gone (the street changed) drive off
    const evicted = new Set(this.world.parking?.evicted || []);
    if (evicted.size) {
      this.world.parking.evicted = [];
      this.parkedCars = this.parkedCars.filter((p) => !evicted.has(p.car));
    }
    this._users = this.cars.map((c) => this._pose(c));
    const target = this.targetCount(net);
    this._spawn -= dt;
    if (this.cars.length < target && this._spawn <= 0) {
      this._enter(net);
      this._users = this.cars.map((c) => this._pose(c));
      this._spawn = 1.5 / Math.max(1, net.boundaryNodes().length);
    }
    this._leaveParking(net);
    this._walk(dt);
    const users = new RoadUsers(this._allUsers(), this.mm(25));
    const gone = new Set();
    for (const car of this.cars) {
      if (this._drive(car, dt, users, net)) gone.add(car);
    }
    if (gone.size) this.cars = this.cars.filter((c) => !gone.has(c));
  }

  /** Parked cars whose stay is over: their people come back (a walk), then they drive out of the layout. */
  _leaveParking(net) {
    const now = this._now();
    const keep = [];
    for (const p of this.parkedCars) {
      if (now < p.until || p.leaving) {
        keep.push(p);
        continue;
      }
      // the people walk back from the building to the car, if they came on foot from it
      if (p.back && !p.walked) {
        p.leaving = true;
        p.walked = true;
        this._walkers(p.car, p.back.door, p.spot?.pos ?? p.facility.exit, () => {
          p.leaving = false;
          p.until = this._now() - 1;
        });
        keep.push(p);
        continue;
      }
      if (!this._depart(p, net)) {
        // no way out right now (the exit is blocked): try again in a minute
        p.until = now + 1;
        keep.push(p);
      }
    }
    this.parkedCars = keep;
  }

  /** A parked car drives out of the layout (or to a node on a ring). */
  _depart(p, net) {
    const exit = p.spot?.pos ?? p.facility.entry ?? p.facility.exit;
    const from = exit ? net.nearestNode(exit, { mode: "car" }) : null;
    if (!from) return false;
    const clear = this.mm(LENGTH_M + 3);
    for (const u of this._users) if (dist2(u.front, from.pos) < clear || dist2(u.rear, from.pos) < clear) return false;
    const ends = net.boundaryNodes().filter((n) => n !== from);
    const pool = ends.length ? ends : net.nodes.filter((n) => n.carDegree >= 1 && n !== from);
    if (!pool.length) return false;
    const to = this.rng.pick(pool);
    const car = p.car;
    if (!this._setRoute(Object.assign(car, { factor: car.factor ?? this.rng.uniform(0.85, 1.05), v: 0, waited: 0 }), net, this._route(net, from, to), to.id)) return false;
    this.world.parking?.release(p.facility.id, car);
    car.purpose = car.purpose === "home" ? "work" : "home";
    car.destName = null;
    car.plan = null;
    this.cars.push(car);
    return true;
  }

  /** The people of a car walk from a point to another (on the sidewalks); `then` when they are there. */
  _walkers(car, from, to, then) {
    const net = networkOf(this.world);
    if (!net || !from || !to) return then();
    const walk = net.walk(from.pos ?? from, to.pos ?? to, { fromKey: from.key ?? null, toKey: to.key ?? null });
    if (!walk || walk.offstage) return then();
    this.walkers.push({ car, people: [car.driver, ...(car.passengers || [])].filter(Boolean), walk, s: 0, speed: this.mm(WALK_MPS), then, pos: walk.points[0], dir: [1, 0] });
  }

  _walk(dt) {
    if (!this.walkers.length) return;
    const done = [];
    for (const w of this.walkers) {
      w.s += w.speed * dt;
      const at = polylineAt(w.walk.points, Math.min(w.s, w.walk.length), w.walk.lengths);
      w.pos = at.point;
      w.dir = at.dir;
      if (w.s >= w.walk.length) done.push(w);
    }
    if (!done.length) return;
    this.walkers = this.walkers.filter((w) => !done.includes(w));
    for (const w of done) w.then();
  }

  /** At the end of its route a car with a goal parks: a free space, else it looks for the next one. */
  _park(car, net) {
    const plan = car.plan, parking = this.world.parking;
    const f = plan?.facility ? parking?.facility(plan.facility.id) : null;
    const slot = f ? parking.take(f.id, car, plan.door?.pos ?? null) : null;
    if (!slot) {
      // full (or gone): the driver looks for the next space on the map
      car.tried = [...(car.tried || []), plan?.facility?.id].filter(Boolean);
      const from = net.nodes[car.dest] || net.nearestNode(car.path.points[car.path.points.length - 1], { mode: "car" });
      const next = car.tried.length < 3 && from ? planDrive(this.world, { from, to: car.destId, purpose: car.purpose, driver: car.who || {}, stayMin: car.stay, avoid: car.tried }) : null;
      if (next && this._setRoute(car, net, next.route, next.entry.id)) {
        car.plan = next;
        return false;
      }
      // gives up: drives out of the layout
      car.plan = null;
      const ends = net.boundaryNodes().filter((n) => n !== from);
      const to = ends.length ? this.rng.pick(ends) : null;
      return !(from && to && this._setRoute(car, net, this._route(net, from, to), to.id));
    }
    const terms = parkingTerms(f, { ...(car.who || {}), purpose: car.purpose, destId: car.destId, permits: car.permits });
    car.fee = Math.round(terms.fee(car.stay) * 100) / 100;
    car.why = terms.why;
    const entry = { car, facility: f, slot: slot.slot, spot: slot.spot, until: Infinity, back: { door: plan.door } };
    this.parkedCars.push(entry);
    // the people walk to the building; their stay begins when they are there
    this._walkers(car, slot.spot?.pos ?? f.exit, plan.door, () => {
      entry.until = this._now() + car.stay;
    });
    return true;
  }

  /** Move one car; true when it has left the road (out of the layout, or parked). */
  _drive(car, dt, users, net) {
    const p = car.path;
    const me = car._pose || this._pose(car);
    const seg = segmentIndex(p.lengths, car.s);
    let vT = (p.speeds[seg] ?? 8) * car.factor;
    // the end of the route: slow down a little where the street leaves the layout, stop at a parking space
    const toEnd = this.meters(p.length - car.s);
    vT = Math.min(vT, Math.sqrt(2 * BRAKE * toEnd) + (car.plan ? 0.5 : 4));
    // the vehicle ahead; a bike that holds the car up is overtaken when the other lane is free
    const look = this.mm((car.v * car.v) / (2 * BRAKE) + GAP_M + 12);
    const skip = car.passing ? new Set([car.passing.who]) : null;
    // (cars that wait for each other in a circle squeeze past after a while: see waitFor)
    const lead = squeezing(car) ? { gap: Infinity, user: null } : leaderAhead(car, me.front, me.dir, users, look, this.mm(1.3), skip);
    const gap = lead.gap;
    waitFor(car, lead.user, dt);
    if (lead.user && (lead.user.vehicle.kind === "bike" || lead.user.vehicle.kind === "scooter") && !car.passing) {
      car.behind = (car.behind || 0) + dt;
      if (car.behind > PASS_AFTER_S && this._mayPass(car, me, users, net)) {
        car.passing = { who: lead.user.vehicle, until: car.s + gap + this.mm(LENGTH_M + 12) };
        car.behind = 0;
      }
    } else if (!lead.user) car.behind = 0;
    if (car.passing && car.s > car.passing.until) car.passing = null;
    const laneShift = car.passing ? this._passShift(car) : 0;
    car.shift = approach(car.shift || 0, laneShift, this.mm(1.2) * dt);
    if (gap < Infinity) vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(gap) - GAP_M)));
    // where it has to stand: before a junction, a zebra crossing with people on it, a closed level crossing
    let stopAt = Infinity;
    const hold = (mm) => {
      vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(mm))));
      stopAt = Math.min(stopAt, Math.max(0, mm));
    };
    const now = this.world.time;
    const j = car.junctions.find((x) => x.s + x.r > car.s);
    if (j) {
      const line = j.s - j.r - this.mm(1) - car.s, dStop = this.meters(line);
      const light = lightAt(j, now), prio = approachPrio(j, now);
      if (dStop < -1) {
        car.waited = 0;
        car.stopped = null;
      } else if (light === "red" || light === "red-amber" || (light === "amber" && dStop > (car.v * car.v) / (2 * BRAKE))) hold(line);
      else if (j.rule?.stop && car.stopped !== j.key) {
        hold(line);
        if (car.v < 0.2 && dStop < 2) car.stopped = j.key;
      } else if (dStop < (car.v * car.v) / (2 * BRAKE) + 3 && car.waited < junctionPatience(prio) && mustYield(car, j, j.s - car.s, users, prio)) {
        hold(line);
        if (car.v < 0.3) car.waited += dt;
      }
      // keep the junction clear (StVO § 11): not into it while the way out is blocked
      if (dStop >= 0 && dStop < (car.v * car.v) / (2 * BRAKE) + 3 && j.s + j.r < p.length - this.mm(LENGTH_M)) {
        const out = polylineAt(p.points, j.s + j.r, p.lengths);
        if (!roomAfter(car, out.point, out.dir, users, this.mm(LENGTH_M + GAP_M), this.mm(1.3))) hold(line);
      }
    }
    for (const x of car.crossings || []) {
      const e = x.s - x.half - this.mm(1) - car.s;
      if (e < -this.mm(0.5) || e > look + this.mm(10)) continue;
      if (x.kind === "zebra" ? x.obj.busy() : x.obj.closed(now)) hold(e - this.mm(x.kind === "rail" ? 3 : 0.5));
    }
    car.v = vT > car.v ? Math.min(vT, car.v + ACCEL * dt) : Math.max(vT, car.v - HARD * dt, 0);
    let move = Math.min(this.mm(car.v * dt), stopAt);
    // never into the vehicle ahead
    if (gap < Infinity && move > gap - this.mm(0.3)) {
      move = Math.max(0, gap - this.mm(0.3));
      car.v = Math.min(car.v, this.meters(move) / Math.max(dt, 1e-6));
    }
    car.s = Math.min(p.length, car.s + move);
    if (car.s >= p.length - this.mm(0.5)) {
      // arrived: park at the goal, leave at the edge of the layout, or drive on to another place (ring roads)
      if (car.plan?.facility) return this._park(car, net);
      const node = car.net === net ? net.nodes[car.dest] : net.nearestNode(car.destPos, { mode: "car" });
      if (!node || node.carDegree <= 1 || this.cars.length > this.targetCount(net)) return true;
      const pool = net.nodes.filter((n) => n.carDegree >= 1 && n !== node);
      const to = this.rng.pick(pool);
      if (!to || !this._setRoute(car, net, this._route(net, node, to), to.id)) return true;
    }
    return false;
  }

  /**
   * May a car overtake the bike ahead (StVO § 5)? On a street with one lane each way, with no
   * vehicle coming the other way for 60 m and no junction just ahead.
   */
  _mayPass(car, me, users, net) {
    const at = net.edgeAt(car.route, this._centreS(car));
    const e = at?.edge;
    if (!e || e.carDir || (e.lanes ?? 1) > 1 || e.laneOffset <= 0) return false;
    const j = car.junctions.find((x) => x.s + x.r > car.s);
    if (j && j.s - car.s < this.mm(30)) return false;
    const far = this.mm(ONCOMING_M), left = [-me.dir[1], me.dir[0]];
    for (const u of users.near ? users.near(me.front, far) : users) {
      if (u.vehicle === car || dot2(u.dir, me.dir) > -0.5) continue;
      const d = sub2(u.front, me.front), along = dot2(d, me.dir), side = dot2(d, left);
      if (along > -this.mm(5) && along < far && side > -this.mm(1) && side < 4 * e.laneOffset) return false;
    }
    return true;
  }

  /** How far to the left (mm) a car moves while overtaking: onto the other lane. */
  _passShift(car) {
    const at = car.net?.edgeAt(car.route, this._centreS(car));
    return 2 * (at?.edge.laneOffset || this.mm(1.75));
  }

  /** The arc length on the car's centre-line route of its front. */
  _centreS(car) {
    const C = car.path.centre, L = car.path.lengths;
    if (!C?.length) return car.s;
    let k = 0;
    while (k < L.length - 1 && L[k + 1] < car.s) k++;
    return C[k] ?? car.s;
  }

  /* ---------------------------------------------------------------- pointing at cars */

  /** The cars as pickables (core/pick.js). */
  pickables(view) {
    if (!this.enabled) return [];
    return this.cars.map((car) => {
      const { front, rear } = this._pose(car);
      return { key: `car:${car.id}`, kind: "car", label: "Car", outline: rectBetween(rear, front, this.mm(WIDTH_M)), z0: 0, z1: this.mm(1.45), owner: this, ref: car };
    });
  }

  /** The card of a car: who drives it where, with whom, on which route, where it will park; driving or waiting, its speed. */
  card(hit) {
    const car = hit.ref, kmh = Math.round(car.v * 3.6);
    const rows = [["Speed", `${kmh} km/h`]];
    if (car.driver?.name) rows.push(["Driver", car.driver.name]);
    const n = car.passengers?.length ?? 0;
    rows.push(["Riding along", n ? car.passengers.map((p) => p.name).join(", ") : "nobody"]);
    rows.push(["Trip", PURPOSE_WORDS[car.purpose] ?? car.purpose]);
    if (car.destName) rows.push(["To", car.destName]);
    const plan = car.plan;
    if (plan) {
      rows.push(["Planned route", `${plan.km.toFixed(1)} km, about ${Math.max(1, Math.round(plan.minutes))} min`]);
      if (plan.facility) rows.push(["Parks at", `${plan.facility.label}, ${Math.round(plan.walkM)} m to walk`], ["Parking costs", plan.free ? plan.why || "free" : `${plan.fee.toFixed(2)} € (${plan.why})`]);
    }
    const sections = plan?.options?.length > 1 ? [{ title: "Parking on the map", lines: plan.options.map((o) => `${o.label}: ${Math.round(o.minutes * 10) / 10} min, ${Math.round(o.walkM)} m on foot, ${o.fee ? `${o.fee.toFixed(2)} €` : "free"}${o.full ? ", full" : ""}`) }] : [];
    return {
      title: "Car",
      subtitle: "Road traffic",
      status: car.passing ? "Overtaking a bike" : kmh >= 2 ? `Driving at ${kmh} km/h` : car.behind > 0 ? "Behind a bike" : car.waited > 0 ? "Waiting at a junction" : "Standing",
      rows,
      sections,
      text: "Cars come in where streets end at the edge of the layout, drive through the town or to a building, park and leave again.",
    };
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.enabled) return;
    const m = (x) => view.m(x);
    for (const car of this.cars) {
      const { front, rear, dir } = this._pose(car);
      if (!view.inImage(front[0], front[1], 0, 60)) continue;
      const small = view.pxPerMM(front[0], front[1], 0) * m(LENGTH_M) < 7;
      const body = car.colour;
      const ref = [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2, m(0.7)];
      if (small) {
        view.faces(boxFaces(rear, front, m(WIDTH_M), m(0.2), m(1.45), { side: body, top: shade(body, 0.92) }), ref);
      } else {
        const glass = grey(0.18);
        const faces = boxFaces(rear, front, m(WIDTH_M), m(0.25), m(0.95), { side: body, top: body, end: shade(body, 0.9) });
        const u = dir;
        const c0 = [rear[0] + u[0] * m(0.9), rear[1] + u[1] * m(0.9)], c1 = [front[0] - u[0] * m(1.4), front[1] - u[1] * m(1.4)];
        faces.push(...boxFaces(c0, c1, m(WIDTH_M - 0.2), m(0.95), m(1.45), { side: glass, top: shade(body, 0.95), end: glass }));
        view.faces(faces, ref);
      }
      if (view.darkness > 0.05) {
        const n = [-dir[1], dir[0]];
        for (const k of [-1, 1]) {
          view.glow([front[0] + n[0] * k * m(0.7), front[1] + n[1] * k * m(0.7), m(0.65)], m(0.7), "#fff3d6", 0.85);
          view.glow([rear[0] + n[0] * k * m(0.7), rear[1] + n[1] * k * m(0.7), m(0.7)], m(0.35), CD.rot, 0.8);
        }
        view.lightPool([front[0] + dir[0] * m(4), front[1] + dir[1] * m(4)], m(3), "#fff1c9", 0.3);
      }
    }
    // drivers and passengers on foot
    for (const w of this.walkers) {
      if (!w.pos || hiddenAt(w.walk, w.s) || !view.inImage(w.pos[0], w.pos[1], 0, 40)) continue;
      w.people.forEach((p, i) => {
        const back = i * m(0.7);
        const at = polylineAt(w.walk.points, Math.max(0, Math.min(w.s, w.walk.length) - back), w.walk.lengths).point;
        drawPerson(view, at, { dir: w.dir, speed: 1.3, phase: (this.world.time * 2 + i) % 1, colour: w.car.colour });
      });
    }
  }
}

/** Move a value towards a target by at most `step`. */
function approach(v, target, step) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

function midpoint(u) {
  return [(u.front[0] + u.rear[0]) / 2, (u.front[1] + u.rear[1]) / 2];
}

/** Do two road users ({front, rear}) overlap (closer than `tol` mm between their centre lines)? */
function overlapping(a, b, tol) {
  return pointSegment(a.front, b.rear, b.front).distance < tol || pointSegment(b.front, a.rear, a.front).distance < tol
    || pointSegment(a.rear, b.rear, b.front).distance < tol || pointSegment(b.rear, a.rear, a.front).distance < tol;
}

/** Index of the polyline segment containing arc length s. */
function segmentIndex(lengths, s) {
  let lo = 0, hi = Math.max(0, lengths.length - 2);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lengths[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
