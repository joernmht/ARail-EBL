/**
 * Town simulation: a simple day and night routine.
 *
 * Residents live in the residential buildings of the layout. Following the fast clock
 * (`world.clock`), they go to work, to school and shopping and come home again; some work
 * elsewhere and take the train, others come in by train in the morning and leave in the
 * evening. They walk on the sidewalks of the road network (`world.network()`), take a bus
 * line when the way is long and a line connects both ends (`world.transit`), and take
 * trains at the platforms. At stops they are handed over to the passenger simulation
 * (`enter`, `alight` and the `passenger.*` events), so waiting, boarding and alighting look
 * the same for everybody.
 *
 * Inside a building people are not drawn; `world.occupancy` (building id -> people inside,
 * in real persons) lets buildings light their windows at night.
 *
 * Everything degrades gracefully: without roads people walk straight, without bus lines
 * they walk, without platforms nobody commutes by train, without a passenger simulation
 * stops are skipped.
 * @module arail/sims/town
 */
import { Simulation } from "../core/simulation.js";
import { CD, moodColor } from "../core/colors.js";
import { createRng, dist2, hashKey, polylineAt, polylineLengths } from "../core/math.js";
import { DAY_MINUTES, formatTime, wrapMinutes } from "../core/clock.js";
import { Person, Population, residentialBuildings } from "../core/people.js";
import { drawPerson } from "./passengers.js";

/** Colours of people by the purpose of their trip (corporate design colours). */
export const PURPOSE_COLOURS = {
  work: CD.tuerkis,
  school: CD.orange,
  shopping: CD.gelb,
  home: CD.brillantblau,
  train: CD.rot,
};

export const PURPOSE_LABELS = { work: "to work", school: "to school", shopping: "shopping", home: "home", train: "to the train" };

/** Opening hours (minutes) of the destinations. */
const OPEN = { shop: [7 * 60, 21 * 60], school: [7 * 60 + 30, 15 * 60 + 30] };

const WALK_SPEED = [1.05, 1.5]; // m/s prototype
const BUS_SPEED = 25 / 3.6; // average speed of a bus incl. stops, for planning (m/s)
const PATIENCE_MIN = 20; // clock minutes an agent waits for a bus or train
const ACCESS_M = 300; // longest walk to a bus stop (prototype metres)

/** Uniform time between two clock times (minutes). */
const between = (rng, a, b) => rng.uniform(a, b);
const hm = (h, m = 0) => h * 60 + m;

/**
 * A person of the town. `role`: "worker" | "commuter" (works elsewhere, train) | "pupil" | "senior" |
 * "visitor" (comes by train); `home`: a house on the layout ({kind: "layout", building, entrance}),
 * for visitors a station beyond it.
 */
class Agent extends Person {
  constructor(spec) {
    super(spec);
    this.job = null;
    this.school = null;
    /** Today's plan: [{at: minutes, purpose, to: {kind: "building", id} | {kind: "home"} | {kind: "station"} | {kind: "shop"}}]. */
    this.plan = [];
    this.planDay = -1;
    this.next = 0;
    /** "inside" | "walking" | "stop" (with the passenger simulation) | "riding" | "away" */
    this.state = "inside";
    /** Building id while inside, else null. */
    this.inside = null;
    this.purpose = "home";
    /** Current trip: {legs, leg, purpose, dest} */
    this.trip = null;
    this.pos = null;
    this.path = null;
    this.s = 0;
    this.speed = 1.3;
    this.phase = 0;
    this.person = null;
    this.waitSince = 0;
    this.vehicle = null;
    /** Visitors and commuters: earliest clock time to come (back) by train. */
    this.trainFrom = null;
  }

  /** The home building ({building, entrance}), null for people who live beyond the layout. */
  get house() {
    return this.home?.kind === "layout" ? this.home : null;
  }

  /** Colour of the person (by trip purpose). */
  get colour() {
    return PURPOSE_COLOURS[this.purpose] || PURPOSE_COLOURS.home;
  }
}

export class TownSimulation extends Simulation {
  static type = "town";
  static label = "Town (day and night)";
  static description = "Residents go to work, school and shopping and come home, on foot, by bus and by train, following the clock.";
  static params = [
    { key: "people_per_100", label: "People shown", type: "number", unit: "per 100 residents", min: 1, max: 100, step: 1, default: 12 },
    { key: "max_people", label: "Max. people", type: "number", min: 0, max: 2000, step: 10, default: 300 },
    { key: "walk_max_m", label: "Longest walk", type: "number", unit: "m", min: 20, max: 3000, step: 10, default: 150, help: "Longer ways are taken by bus when a line connects both ends." },
    { key: "bus_share", label: "Take the bus", type: "number", unit: "share of long ways", min: 0, max: 1, step: 0.05, default: 0.8 },
    { key: "commuters_out", label: "Work elsewhere (train)", type: "number", unit: "share of workers", min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: "commuters_in", label: "Come by train", type: "number", unit: "per 100 local jobs", min: 0, max: 200, step: 5, default: 40 },
    { key: "shopping", label: "Shopping", type: "number", unit: "share of adults per day", min: 0, max: 1, step: 0.05, default: 0.5 },
  ];

  constructor(world, config) {
    super(world, config);
    /** @type {Agent[]} */
    this.agents = [];
    this._built = null;
    this._lastMinutes = null;
    this._lastDay = null;
    this._check = 0;
    world.occupancy = new Map();
    const on = (name, fn) => world.events.on(name, fn);
    this._unsubscribe = [
      on("passenger.boarded", (e) => this._boarded(e)),
      on("passenger.exited", (e) => this._exited(e)),
      on("passenger.removed", (e) => this._removed(e)),
      on("vehicle.arrived", (e) => this._vehicleArrived(e)),
      on("clock.set", () => this.enabled && this._placeAll()),
      on("layout.loaded", () => (this._built = null)),
    ];
  }

  dispose() {
    this._unsubscribe.forEach((off) => off());
    if (this.world.occupancy && this._ownsOccupancy()) this.world.occupancy = new Map();
  }

  _ownsOccupancy() {
    return this.world.simulations?.filter((s) => s.constructor.type === "town").length <= 1;
  }

  /** Real people one agent stands for (in `world.occupancy`). */
  _personWeight() {
    return this._weight || 1 / this.scale;
  }

  /** Visible people per real person. */
  get scale() {
    return Math.max(0.001, (+this.config.people_per_100 || 12) / 100);
  }

  get passengers() {
    return this.world.simulations.find((s) => s.enabled && typeof s.enter === "function" && typeof s.alight === "function") || null;
  }

  clear() {
    this._removeAgents();
    this._built = null;
  }

  /** Take this town's people off the stops and buses (the agents of other simulations stay). */
  _removeAgents() {
    this.passengers?.removeAgents((agent) => agent instanceof Agent);
    for (const v of this.world.transit?.buses || []) if (Array.isArray(v.riders)) v.riders = v.riders.filter((r) => !(r.agent instanceof Agent));
  }

  /* ================================================================ population */

  /** Buildings with a capacity, by use. */
  _buildings() {
    const out = { residential: residentialBuildings(this.world).map(({ o }) => ({ o, cap: o.capacity() || {} })), work: [], school: [], shop: [] };
    for (const o of this.world.objects) {
      if (!o.geometry || typeof o.capacity !== "function") continue;
      const cap = o.capacity() || {};
      const use = typeof o.use === "function" ? o.use() : o.constructor.use;
      if (cap.jobs > 0) out.work.push({ o, cap });
      if (use === "school" && cap.pupils > 0) out.school.push({ o, cap });
      if (use === "shop") out.shop.push({ o, cap });
    }
    return out;
  }

  /** Key that changes when the buildings or the settings change (then the town is rebuilt). */
  _populationKey(b) {
    const ids = (list) => list.map((x) => `${x.o.id}:${x.cap.residents || 0}:${x.cap.jobs || 0}:${x.cap.pupils || 0}`).join(",");
    return [ids(b.residential), ids(b.work), ids(b.school), ids(b.shop), JSON.stringify(this.config)].join("/");
  }

  _build() {
    const w = this.world;
    const quick = `${w.objectsVersion ?? ""}:${w.map.version}:${w.scale}:${JSON.stringify(this.config)}`;
    if (this._built && w.objectsVersion != null && quick === this._quick) return false;
    if (this._built && w.objectsVersion == null && (this._sinceBuild = (this._sinceBuild || 0) + 1) < 20) return false;
    this._sinceBuild = 0;
    this._quick = quick;
    const b = this._buildings();
    const key = this._populationKey(b);
    if (this._built === key) return false;
    this._built = key;
    this._removeAgents();
    this.places = b;
    const rng = createRng(hashKey(this.world.seed, "town"));
    const people = new Population(this.world.seed, "town");
    const scale = this.scale, max = Math.max(0, Math.round(+this.config.max_people || 0));
    // residents: proportional to the residents of each building, fair when capped
    const wanted = b.residential.map(({ cap }) => Math.max(1, Math.round(cap.residents * scale)));
    const total = wanted.reduce((s, v) => s + v, 0);
    const k = total > max ? max / total : 1;
    const agents = [];
    const workPlaces = b.work;
    const jobs = workPlaces.reduce((s, x) => s + x.cap.jobs, 0);
    const hasPlatform = this.world.stopAreas().some((a) => a.kind === "rail");
    b.residential.forEach(({ o }, i) => {
      const n = Math.floor(wanted[i] * k + rng.next());
      const entrances = this._entrances(o);
      for (let j = 0; j < n; j++) {
        const r = rng.next();
        let role = r < 0.15 ? "pupil" : r < 0.4 ? "senior" : "worker";
        if (role === "pupil" && !b.school.length) role = "senior";
        if (role === "worker" && hasPlatform && (rng.chance(+this.config.commuters_out || 0) || !jobs)) role = "commuter";
        if (role === "worker" && !jobs) role = "senior";
        const home = { kind: "layout", building: o.id, entrance: rng.int(Math.max(1, entrances.length)) };
        const a = people.add([o.id, j], { id: `${o.id}#${j}`, role, home }, Agent);
        if (role === "worker") a.job = this._pickWeighted(rng, workPlaces, (x) => x.cap.jobs);
        if (role === "pupil") a.school = this._pickWeighted(rng, b.school, (x) => x.cap.pupils);
        agents.push(a);
      }
    });
    // incoming commuters (by train)
    if (hasPlatform && jobs > 0) {
      const n = Math.min(Math.max(0, max - agents.length), Math.round((jobs * (+this.config.commuters_in || 0)) / 100 * scale));
      for (let j = 0; j < n; j++) {
        const a = people.add(["visitor", j], { id: `visitor#${j}`, role: "visitor", home: { kind: "station" } }, Agent);
        a.job = this._pickWeighted(rng, workPlaces, (x) => x.cap.jobs);
        agents.push(a);
      }
    }
    for (const a of agents) a.speed = createRng(hashKey(a.id, "speed")).uniform(...WALK_SPEED);
    this.agents = agents;
    // real people per agent (the cap makes it more than 100 / people_per_100)
    const residents = b.residential.reduce((s, x) => s + x.cap.residents, 0);
    const shown = agents.filter((a) => a.role !== "visitor").length;
    this._weight = shown > 0 ? residents / shown : 1 / scale;
    this._placeAll();
    return true;
  }

  _pickWeighted(rng, list, weight) {
    if (!list.length) return null;
    const i = rng.weighted(list.map(weight));
    return list[i].o.id;
  }

  /* ================================================================ plans */

  _makePlan(a, day) {
    const rng = createRng(hashKey(this.world.seed, a.id, day));
    const plan = [];
    const shop = rng.chance(+this.config.shopping || 0);
    const home = { kind: "home" };
    if (a.role === "worker") {
      plan.push({ at: between(rng, hm(6, 30), hm(8)), purpose: "work", to: { kind: "building", id: a.job } });
      const off = between(rng, hm(15, 30), hm(17, 30));
      if (shop && rng.chance(0.4)) {
        plan.push({ at: off, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: off + between(rng, 15, 40), purpose: "home", to: home, after: true });
      } else plan.push({ at: off, purpose: "home", to: home });
    } else if (a.role === "commuter") {
      plan.push({ at: between(rng, hm(5, 45), hm(7, 45)), purpose: "train", to: { kind: "station" } });
      // back on a train that arrives in the evening, then home (perhaps via the shop)
      a.trainFrom = between(rng, hm(16), hm(18, 30));
      plan.push({ at: a.trainFrom, purpose: "home", to: home, byTrain: true, shop: shop && rng.chance(0.2) });
    } else if (a.role === "pupil") {
      plan.push({ at: between(rng, hm(7), hm(7, 40)), purpose: "school", to: { kind: "building", id: a.school } });
      plan.push({ at: between(rng, hm(12, 30), hm(15)), purpose: "home", to: home });
    } else if (a.role === "senior") {
      if (shop) {
        const t = between(rng, hm(8, 30), hm(11, 30));
        plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: t + between(rng, 20, 60), purpose: "home", to: home, after: true });
      }
      if (rng.chance(0.25)) {
        const t = between(rng, hm(15), hm(17, 30));
        plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: t + between(rng, 20, 45), purpose: "home", to: home, after: true });
      }
    } else if (a.role === "visitor") {
      a.trainFrom = between(rng, hm(6, 30), hm(9));
      plan.push({ at: a.trainFrom, purpose: "work", to: { kind: "building", id: a.job }, byTrain: true });
      plan.push({ at: between(rng, hm(15, 30), hm(18)), purpose: "train", to: { kind: "station" } });
    }
    // evening shopping for some adults
    if (a.role !== "pupil" && a.role !== "visitor" && rng.chance(0.1 * (+this.config.shopping || 0) / 0.5)) {
      const t = between(rng, hm(18, 30), hm(20, 30));
      plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
      plan.push({ at: t + between(rng, 15, 35), purpose: "home", to: home, after: true });
    }
    plan.sort((p, q) => p.at - q.at);
    return plan;
  }

  _ensurePlan(a) {
    const day = this.world.clock.day;
    if (a.planDay === day) return;
    // a new day: commuters still away came home late at night
    if (a.planDay >= 0 && a.role === "commuter" && a.state === "away" && !a.trip) this._setInside(a, a.house?.building);
    a.plan = this._makePlan(a, day);
    a.planDay = day;
    a.next = 0;
  }

  /** Where an agent is (by its plan) at the current time of day, without travelling. */
  _placeAll() {
    const clock = this.world.clock;
    const now = clock.minutes;
    this._removeAgents();
    // every building of the town is listed (0 = nobody in: dark windows at night)
    this.world.occupancy = new Map();
    for (const list of Object.values(this.places || {})) for (const { o } of list) this.world.occupancy.set(o.id, 0);
    for (const a of this.agents) {
      a.planDay = -1;
      this._ensurePlan(a);
      a.inside = null; // counted afresh in the new occupancy (leaving the old building must not subtract)
      a.trip = null;
      a.person = null;
      a.vehicle = null;
      a.path = null;
      let at = a.role === "visitor" ? { kind: "away" } : { kind: "home" };
      let i = 0;
      for (; i < a.plan.length && a.plan[i].at <= now; i++) {
        const step = a.plan[i];
        at = step.to.kind === "station" ? { kind: "away" } : step.to;
        a.purpose = step.purpose;
      }
      a.next = i;
      if (at.kind === "away") this._setAway(a);
      else this._setInside(a, this._resolveBuilding(a, at));
    }
    this._lastMinutes = now;
    this._lastDay = clock.day;
  }

  /* ================================================================ places and ways */

  _entrances(o) {
    const list = typeof o.entrances === "function" ? o.entrances() : null;
    if (list && list.length) return list;
    const p = o.anchorPoint?.();
    return p ? [{ pos: p, dir: [0, -1] }] : [];
  }

  /** Building id for a plan target ({kind: "home" | "building" | "shop"}). */
  _resolveBuilding(a, to, from = null) {
    if (to.kind === "home") return a.house?.building ?? null;
    if (to.kind === "building") return to.id;
    if (to.kind === "shop") return this._nearestShop(from || this._buildingPos(a.house?.building) || [0, 0])?.id ?? a.house?.building ?? null;
    return null;
  }

  _buildingPos(id, entrance = 0) {
    const o = id ? this.world.getObject(id) : null;
    if (!o?.geometry) return null;
    const e = this._entrances(o);
    return e.length ? e[Math.min(entrance, e.length - 1)].pos : null;
  }

  _nearestShop(p) {
    let best = null;
    for (const { o } of this.places?.shop || []) {
      const q = this._buildingPos(o.id);
      if (!q) continue;
      const d = dist2(p, q);
      if (!best || d < best.d) best = { d, o };
    }
    return best?.o || null;
  }

  _network() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /** Network node of a building entrance or a stop area access point, else the nearest node. */
  _node(net, key, pos) {
    if (!net) return null;
    return net.place?.(key) ?? net.nearestNode?.(pos, { mode: "walk" }) ?? null;
  }

  /**
   * A walking path between two layout points (mm), over the network when possible.
   * @returns {{points: number[][], lengths: number[], length: number, net: object | null, route: object | null}}
   */
  _walkPath(from, to, fromKey = null, toKey = null) {
    const net = this._network();
    let route = null;
    if (net) {
      const a = this._node(net, fromKey, from), b = this._node(net, toKey, to);
      if (a != null && b != null) route = net.route?.(a, b, { mode: "walk" }) || null;
    }
    const points = route ? [from, ...route.points, to] : [from, to];
    // drop zero-length steps
    const clean = [points[0]];
    for (const p of points.slice(1)) if (dist2(p, clean[clean.length - 1]) > 0.01) clean.push(p);
    if (clean.length < 2) clean.push(to);
    const lengths = polylineLengths(clean);
    // where the network route starts on this path (for the sidewalk offset)
    const routeStart = route && route.points.length ? dist2(from, route.points[0]) : 0;
    return { points: clean, lengths, length: lengths[lengths.length - 1], route, routeStart };
  }

  _metres(mm) {
    return (mm * this.world.scale) / 1000;
  }

  /** Stop areas served by bus lines, with their access point positions. */
  _busStops() {
    return this.world.stopAreas().filter((a) => a.kind === "bus" && a.docks.some((d) => d.managed));
  }

  _railAreas() {
    return this.world.stopAreas().filter((a) => a.kind === "rail" && a.docks.length);
  }

  _accessPoint(area, i = 0) {
    const e = area.access[Math.min(i, area.access.length - 1)] || { s: 0, t: 0 };
    return area.toLayout(e.s, e.t);
  }

  _nearestAccess(area, p) {
    let best = 0, bd = Infinity;
    area.access.forEach((e, i) => {
      const d = dist2(area.toLayout(e.s, e.t), p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /* ================================================================ trips */

  /** Start the trip of a plan step from where the agent is. */
  _startTrip(a, step) {
    a.purpose = step.purpose;
    const from = a.inside ? this._buildingPos(a.inside, a.inside === a.house?.building ? a.house.entrance : 0) : a.pos;
    const fromKey = a.inside ? `building:${a.inside}:${a.inside === a.house?.building ? a.house.entrance : 0}` : null;
    if (!from) {
      // the building is gone: just be there
      this._arrive(a, step);
      return;
    }
    let destId = null;
    if (step.to.kind !== "station") {
      destId = this._resolveBuilding(a, step.to, from);
      if (!destId || destId === a.inside) return; // nothing to do (e.g. no shop)
      if (step.to.kind === "shop" && !this._open("shop")) return;
    }
    this._leave(a);
    a.pos = from.slice();
    if (step.to.kind === "station") {
      const legs = this._trainLegs(a, from, fromKey);
      if (!legs) {
        // no platform: the agent just leaves the town
        this._setAway(a);
        return;
      }
      a.trip = { legs, leg: 0, purpose: step.purpose, dest: null, station: true };
    } else {
      a.trip = { legs: this._legsTo(a, from, fromKey, destId), leg: 0, purpose: step.purpose, dest: destId };
    }
    this._beginLeg(a);
  }

  _open(kind) {
    const [o, c] = OPEN[kind] || [0, DAY_MINUTES];
    const m = this.world.clock.minutes;
    return m >= o && m < c;
  }

  /** Legs from a point to a building: walk, or walk + bus + walk. */
  _legsTo(a, from, fromKey, destId) {
    const dest = this._buildingPos(destId);
    if (!dest) return [];
    const destKey = `building:${destId}:0`;
    const walk = this._walkPath(from, dest, fromKey, destKey);
    const bus = this._busChoice(a, from, fromKey, dest, destKey, this._metres(walk.length));
    if (bus) return [...this._busLegs(bus), { type: "walk", path: null, toBuilding: destId }];
    return [{ type: "walk", path: walk, toBuilding: destId }];
  }

  /**
   * A bus connection for a way of `walkM` metres, or null: only for long ways (`walk_max_m`),
   * for a share of the people (`bus_share`, a little more for pupils and seniors) and when the
   * bus is not much slower than walking (see `_bestBus`).
   */
  _busChoice(a, from, fromKey, dest, destKey, walkM) {
    const transit = this.world.transit, pax = this.passengers;
    const shareBoost = a.role === "pupil" || a.role === "senior" ? 0.1 : 0;
    const rng = createRng(hashKey(this.world.seed, a.id, this.world.clock.day, a.next, "mode"));
    if (!transit || !pax || !(walkM > (+this.config.walk_max_m || 150)) || !rng.chance(Math.min(1, (+this.config.bus_share || 0) + shareBoost))) return null;
    return this._bestBus(from, dest, fromKey, destKey, walkM);
  }

  /** Walk to the stop, wait for the bus of the connection, ride it to the other stop. */
  _busLegs(bus) {
    return [
      { type: "walk", path: bus.walk1, target: bus.access, to: { area: bus.fromArea.id } },
      { type: "wait", area: bus.fromArea.id, dockId: bus.conn.fromDockId, line: bus.conn.lineId, toDockId: bus.conn.toDockId },
      { type: "ride", toDockId: bus.conn.toDockId, toArea: bus.toArea.id },
    ];
  }

  /** Best bus connection between two points, or null when walking is about as good. */
  _bestBus(from, dest, fromKey, destKey, walkM) {
    const transit = this.world.transit;
    if (typeof transit?.connections !== "function") return null;
    const stops = this._busStops();
    if (!stops.length) return null;
    const near = (p, key) => stops.map((area) => {
      const i = this._nearestAccess(area, p);
      const access = { pos: this._accessPoint(area, i), key: `area:${area.id}:${i}` };
      const path = key === "dest" ? this._walkPath(access.pos, p, access.key, destKey) : this._walkPath(p, access.pos, fromKey, access.key);
      return { area, path, access, m: this._metres(path.length) };
    }).filter((x) => x.m <= ACCESS_M);
    const origins = near(from, "from"), targets = near(dest, "dest");
    let best = null;
    for (const o of origins) {
      for (const t of targets) {
        if (o.area.id === t.area.id) continue;
        for (const conn of transit.connections(o.area.id, t.area.id) || []) {
          const headway = this._headway(conn.lineId);
          const ride = this._metres(conn.rideMM || 0) / BUS_SPEED;
          const time = (o.m + t.m) / 1.3 + headway / 2 + ride;
          if (!best || time < best.time) best = { time, conn, fromArea: o.area, toArea: t.area, walk1: o.path, access: o.access };
        }
      }
    }
    if (!best) return null;
    return best.time < (walkM / 1.3) * 1.3 ? best : null;
  }

  _headway(lineId) {
    const line = this.world.transit?.lines?.get?.(lineId);
    const h = Number(line?.headway ?? line?.obj?.spec?.headway_s ?? this.world.getObject(lineId)?.spec?.headway_s);
    return Number.isFinite(h) && h > 0 ? h : 240;
  }

  /**
   * Legs to the nearest platform and onto any train there. A long way to the station is taken by
   * bus (like other long ways) to a stop near the platform, e.g. the station's bus terminal; from
   * there people walk to the platform.
   */
  _trainLegs(a, from, fromKey) {
    const areas = this._railAreas();
    if (!areas.length) return null;
    let best = null;
    for (const area of areas) {
      const i = this._nearestAccess(area, from);
      const path = this._walkPath(from, this._accessPoint(area, i), fromKey, `area:${area.id}:${i}`);
      if (!best || path.length < best.path.length) best = { area, path, i };
    }
    const target = { pos: this._accessPoint(best.area, best.i), key: `area:${best.area.id}:${best.i}` };
    const toTrain = [
      { type: "walk", path: best.path, target, to: { area: best.area.id } },
      { type: "wait", area: best.area.id, dockId: null, line: null, train: true },
    ];
    const bus = this._busChoice(a, from, fromKey, target.pos, target.key, this._metres(best.path.length));
    if (!bus) return toTrain;
    toTrain[0].path = null; // from the stop where the bus stops
    return [...this._busLegs(bus), ...toTrain];
  }

  _beginLeg(a) {
    const leg = a.trip?.legs[a.trip.leg];
    if (!leg) {
      this._finishTrip(a);
      return;
    }
    if (leg.type === "walk") {
      // planned from another point (e.g. where people leave the platform): from here
      if (leg.path && a.pos && dist2(a.pos, leg.path.points[0]) > 1) leg.path = null;
      if (!leg.path && leg.target) leg.path = this._walkPath(a.pos, leg.target.pos, null, leg.target.key);
      else if (!leg.path) {
        const dest = this._buildingPos(leg.toBuilding);
        if (!dest) return this._finishTrip(a);
        leg.path = this._walkPath(a.pos, dest, null, `building:${leg.toBuilding}:0`);
      }
      a.state = "walking";
      a.path = leg.path;
      a.s = 0;
      a.person = null;
    } else if (leg.type === "wait") {
      const pax = this.passengers;
      a.path = null;
      if (!pax) return this._skipStop(a, leg);
      const p = pax.enter(leg.area, { agent: a, dockId: leg.dockId, line: leg.line, anyDock: !leg.dockId, at: a.pos });
      if (!p) return this._skipStop(a, leg);
      a.person = p;
      a.state = "stop";
      a.waitSince = this.world.time;
    }
  }

  /** The stop cannot be used (no passenger simulation or the stop is gone, or no bus came). */
  _skipStop(a, leg) {
    if (leg.train) return this._setAway(a);
    // on the way to the train: walk to the platform instead
    const k = a.trip?.legs.findIndex((l) => l.type === "wait" && l.train) ?? -1;
    if (k > 0 && a.trip.legs[k - 1].type === "walk") {
      a.trip = { ...a.trip, legs: [{ ...a.trip.legs[k - 1], path: null }, a.trip.legs[k]], leg: 0 };
      return this._beginLeg(a);
    }
    // walk the rest of the way
    const dest = a.trip?.dest;
    if (!dest) return this._goHome(a);
    a.trip = { legs: [{ type: "walk", path: null, toBuilding: dest }], leg: 0, purpose: a.trip.purpose, dest };
    this._beginLeg(a);
  }

  _nextLeg(a) {
    if (!a.trip) return;
    a.trip.leg++;
    this._beginLeg(a);
  }

  _finishTrip(a) {
    const dest = a.trip?.dest ?? null, station = !!a.trip?.station;
    a.trip = null;
    a.path = null;
    a.person = null;
    a.vehicle = null;
    if (dest && this.world.getObject(dest)) this._setInside(a, dest);
    else if (station) this._setAway(a); // on the way to the train (e.g. its bus was taken out of service)
    else this._goHome(a, true);
  }

  _arrive(a, step) {
    if (step.to.kind === "station") this._setAway(a);
    else this._setInside(a, this._resolveBuilding(a, step.to));
  }

  /** Back home (or away for visitors), without travelling. */
  _goHome(a, teleport = true) {
    a.trip = null;
    a.path = null;
    a.person = null;
    a.vehicle = null;
    if (a.role === "visitor" || !a.house) this._setAway(a);
    else if (teleport) this._setInside(a, a.house.building);
  }

  _setInside(a, id) {
    this._leave(a);
    a.state = "inside";
    a.inside = id && this.world.getObject(id) ? id : null;
    if (!a.inside && a.house && this.world.getObject(a.house.building)) a.inside = a.house.building;
    if (!a.inside) {
      a.state = "away";
      return;
    }
    a.pos = null;
    // stay at least a little while (shopping takes some time even when the next plan step is due)
    a.stayUntil = this.world.time + (a.purpose === "shopping" ? 15 : 5) * 60 / Math.max(1e-6, this.world.clock.factor);
    const occ = this.world.occupancy || (this.world.occupancy = new Map());
    occ.set(a.inside, (occ.get(a.inside) || 0) + this._personWeight());
  }

  _setAway(a) {
    this._leave(a);
    a.state = "away";
    a.pos = null;
    a.path = null;
    a.person = null;
  }

  _leave(a) {
    if (a.state === "inside" && a.inside) {
      const occ = this.world.occupancy;
      if (occ) occ.set(a.inside, Math.max(0, (occ.get(a.inside) || 0) - this._personWeight()));
    }
    a.inside = null;
  }

  /* ================================================================ events from stops and vehicles */

  _boarded({ agent, vehicle, dock }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    const leg = a.trip?.legs[a.trip.leg];
    if (leg?.type === "wait" && leg.train) {
      // off by train; visitors and commuters come back by train later
      a.trip = null;
      this._setAway(a);
      return;
    }
    if (leg?.type === "wait" && vehicle) {
      a.trip.leg++;
      const ride = a.trip.legs[a.trip.leg];
      a.state = "riding";
      a.vehicle = vehicle;
      if (!Array.isArray(vehicle.riders)) vehicle.riders = [];
      vehicle.riders.push({ agent: a, toDockId: ride?.toDockId ?? null });
      return;
    }
    // boarded something unexpected: be at the destination
    this._finishTrip(a);
  }

  _exited({ agent, pos }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    a.pos = pos ? pos.slice() : a.pos;
    if (!a.trip) {
      this._goHome(a);
      return;
    }
    const leg = a.trip.legs[a.trip.leg];
    if (leg?.type === "wait") {
      // gave up waiting (or the stop was closed): walk instead, or go home
      if (leg.train) {
        a.trip = null;
        const home = a.house ? this._buildingPos(a.house.building, a.house.entrance) : null;
        if (!home) return this._setAway(a);
        a.trip = { legs: [{ type: "walk", path: null, toBuilding: a.house.building }], leg: 0, purpose: "home", dest: a.house.building };
        a.purpose = "home";
        return this._beginLeg(a);
      }
      return this._skipStop(a, leg);
    }
    // got off the bus or the train: on to the next leg
    this._nextLeg(a);
  }

  _removed({ agent }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    if (a.trip?.dest) this._setInside(a, a.trip.dest);
    else if (a.trip?.station) this._setAway(a);
    else this._goHome(a);
    a.trip = null;
  }

  _vehicleArrived({ vehicle, dock }) {
    if (!vehicle || !dock) return;
    const pax = this.passengers;
    // riders of a bus get off at their stop
    if (Array.isArray(vehicle.riders) && vehicle.riders.length) {
      const off = vehicle.riders.filter((r) => r.toDockId === dock.id && this.agents.includes(r.agent));
      if (off.length) {
        vehicle.riders = vehicle.riders.filter((r) => !off.includes(r));
        const agents = off.map((r) => r.agent);
        for (const a of agents) {
          a.vehicle = null;
          a.state = "stop"; // getting off; leaving the stop (passenger.exited) starts the next leg
        }
        if (pax) {
          for (const p of pax.alight(vehicle, dock, agents)) p.agent.person = p;
        } else for (const a of agents) this._finishTrip(a);
      }
    }
    // trains bring visitors in the morning and commuters back in the evening
    if (dock.kind === "rail" || vehicle.kind === "train") this._trainArrivals(vehicle, dock);
  }

  _trainArrivals(vehicle, dock) {
    const now = this.world.clock.minutes;
    const due = this.agents.filter((a) => a.state === "away" && this._dueByTrain(a, now));
    if (!due.length) return;
    const pax = this.passengers;
    const n = Math.min(due.length, 14);
    // by dock, not by vehicle: vehicle ids count on over all worlds (a layout loaded again), so the same seed would not give the same day
    const rng = createRng(hashKey(this.world.seed, dock.id, this.world.time.toFixed(1)));
    const chosen = [];
    for (let i = 0; i < n; i++) chosen.push(due.splice(rng.int(due.length), 1)[0]);
    for (const a of chosen) {
      const step = a.plan[a.next];
      a.next++;
      a.purpose = step.purpose;
      let destId = step.to.kind === "home" ? a.house?.building : this._resolveBuilding(a, step.to);
      if (step.shop && this._open("shop")) {
        // shopping on the way home: the shop first, home after a short stay
        const shopId = this._nearestShop(this._accessPoint(dock.area))?.id;
        if (shopId) {
          a.purpose = "shopping";
          a.plan.splice(a.next, 0, { at: now + 25, purpose: "home", to: { kind: "home" } });
          destId = shopId;
        }
      }
      // from the platform exit nearest the destination: on foot, or by bus when it is far
      const i = this._nearestAccess(dock.area, this._buildingPos(destId) || this._accessPoint(dock.area));
      const legs = this._legsTo(a, this._accessPoint(dock.area, i), `area:${dock.area.id}:${i}`, destId);
      a.trip = { legs: [{ type: "train-off" }, ...(legs.length ? legs : [{ type: "walk", path: null, toBuilding: destId }])], leg: 0, purpose: a.purpose, dest: destId };
      a.state = "stop";
    }
    if (pax) {
      for (const p of pax.alight(vehicle, dock, chosen)) p.agent.person = p;
    } else {
      for (const a of chosen) {
        a.pos = this._accessPoint(dock.area);
        this._nextLeg(a);
      }
    }
  }

  /** Is an away agent due to come (back) by train now? */
  _dueByTrain(a, now) {
    const step = a.plan[a.next];
    if (!step || !step.byTrain) return false;
    return now >= step.at && now < step.at + 4 * 60;
  }

  /* ================================================================ step */

  step(dt) {
    if (!this.enabled) return;
    if (this._build()) return;
    const clock = this.world.clock, now = clock.minutes;
    // clock jumps (time set by hand) and new days
    if (this._lastMinutes != null) {
      const expected = (dt * clock.factor) / 60;
      const moved = clock.day !== this._lastDay ? now + DAY_MINUTES * (clock.day - this._lastDay) - this._lastMinutes : now - this._lastMinutes;
      if (Math.abs(moved - expected) > Math.max(2, 3 * expected) && !clock.frozen) {
        this._placeAll();
        return;
      }
    }
    this._lastMinutes = now;
    this._lastDay = clock.day;
    const patience = (PATIENCE_MIN * 60) / Math.max(1e-6, clock.factor);
    for (const a of this.agents) {
      this._ensurePlan(a);
      if (a.state === "inside" || (a.state === "away" && !a.trip)) {
        const step = a.plan[a.next];
        if (!step || step.at > now) continue;
        if (a.state === "away") {
          // away agents come (back) by train (see _trainArrivals); other steps wait for that
          if (step.to.kind === "station") a.next++;
          continue;
        }
        a.next++;
        if (step.byTrain) continue; // already here (e.g. walked home instead of taking the train)
        if (a.stayUntil > this.world.time) {
          a.next--;
          continue;
        }
        this._startTrip(a, step);
      } else if (a.state === "walking") {
        this._walk(a, dt);
      } else if (a.state === "stop" && a.person && a.person.state === "waiting" && this.world.time - a.waitSince > patience) {
        this.passengers?.release(a.person);
        a.waitSince = Infinity;
      }
    }
    // second chance: plans whose time passed while the agent was travelling
    if ((this._check += dt) > 2) {
      this._check = 0;
      this._sanity();
    }
  }

  _walk(a, dt) {
    const path = a.path;
    if (!path) return this._nextLeg(a);
    const mmPerS = (a.speed * 1000) / this.world.scale;
    a.s += mmPerS * dt;
    a.phase += a.speed * dt * 5;
    if (a.s >= path.length) {
      a.pos = path.points[path.points.length - 1].slice();
      const leg = a.trip?.legs[a.trip.leg];
      if (leg?.toBuilding && a.trip.leg === a.trip.legs.length - 1) return this._finishTrip(a);
      return this._nextLeg(a);
    }
    const at = polylineAt(path.points, a.s, path.lengths);
    a.pos = at.point;
    a.dir = at.dir;
  }

  /** Repair agents whose stop, vehicle or building disappeared. */
  _sanity() {
    const transit = this.world.transit;
    const buses = new Set(transit?.buses || []);
    for (const a of this.agents) {
      if (a.state === "riding") {
        // the bus is gone (line deleted or changed, out of service) or the agent is not on board
        const rider = a.vehicle?.riders?.find?.((r) => r.agent === a);
        if (!a.vehicle || (transit && !buses.has(a.vehicle)) || !rider) this._finishTrip(a);
        else this._checkRide(a, rider);
      } else if (a.state === "inside" && a.inside && !this.world.getObject(a.inside)) {
        this._goHome(a);
      } else if (a.state === "stop" && !a.person && !a.trip) {
        this._goHome(a);
      }
    }
  }

  /** The stop a rider wants to get off at is not served any more (taken off the line): off at the next stop. */
  _checkRide(a, rider) {
    const bus = a.vehicle, V = this.world.transit?.lines?.get?.(bus.lineId)?.visits;
    if (!V?.length || V.some((v) => v.dockId === rider.toDockId)) return;
    // standing at a stop (also while the doors close): the people for it got off already
    const atStop = bus.phase === "dwelling" || (bus.phase === "departing" && bus.doorsLeft > 0);
    const next = V[(bus.next + (atStop ? 1 : 0)) % V.length];
    rider.toDockId = next?.dockId ?? null;
    const leg = a.trip?.legs[a.trip.leg];
    if (leg?.type === "ride") leg.toDockId = rider.toDockId;
  }

  /* ================================================================ drawing and figures */

  draw(view) {
    if (!this.enabled) return;
    const mode = this.world.settings.peopleColour || "auto";
    const net = this._network();
    for (const a of this.agents) {
      if (a.state !== "walking" || !a.pos) continue;
      let [x, y] = a.pos;
      // walk on the right-hand sidewalk of streets
      const dir = a.dir || [1, 0];
      const at = this._pathAt(net, a);
      if (at?.hidden) continue; // in an underpass
      const off = at?.walkOffset || 0;
      if (off) {
        x += dir[1] * off;
        y -= dir[0] * off;
      }
      if (!view.inImage(x, y, 0)) continue;
      drawPerson(view, [x, y], {
        dir, speed: a.speed, phase: a.phase, height: 1.6 + (hashKey(a.id) % 30) / 100,
        colour: mode === "mood" ? moodColor(0.85) : a.colour,
      });
    }
  }

  /**
   * Where a walker is on its network route: {walkOffset} (mm, from the path's centre line:
   * sidewalks along streets) and {hidden} (in an underpass); null off the network.
   */
  _pathAt(net, a) {
    if (!net || !a.path?.route || typeof net.pathAt !== "function") return null;
    const r = a.path.route;
    // a.s counts from the agent's start point; the route starts after the first segment
    const s = a.s - (a.path.routeStart || 0);
    if (s <= 0 || s >= r.length) return null;
    return net.pathAt(r, s);
  }

  /** Counts for the panel: where people are and what they are doing. */
  townStats() {
    const out = { total: this.agents.length, home: 0, work: 0, school: 0, shopping: 0, walking: 0, waiting: 0, riding: 0, away: 0, byPurpose: {} };
    const use = (id) => {
      const o = id ? this.world.getObject(id) : null;
      return o ? (typeof o.use === "function" ? o.use() : o.constructor.use) : null;
    };
    for (const a of this.agents) {
      if (a.state === "inside") {
        if (a.house && a.inside === a.house.building) out.home++;
        else {
          const u = use(a.inside);
          if (u === "school" && a.role === "pupil") out.school++;
          else if (u === "shop" && a.purpose === "shopping") out.shopping++;
          else out.work++;
        }
      } else if (a.state === "walking") {
        out.walking++;
        out.byPurpose[a.purpose] = (out.byPurpose[a.purpose] || 0) + 1;
      } else if (a.state === "stop") out.waiting++;
      else if (a.state === "riding") out.riding++;
      else out.away++;
    }
    return out;
  }

  /** Time of day as text (for messages). */
  timeLabel() {
    return formatTime(this.world.clock.minutes);
  }
}

export { wrapMinutes };
