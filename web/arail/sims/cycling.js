/**
 * Bikes and e-scooters (simulation type `cycling`): riders on the streets, bike lanes and paths of
 * the road network.
 *
 * Where a rider rides follows the rules (`ridingSurface`): on a bike lane, a bike path or a shared
 * foot and bike path where the street has one (with the signs 237, 240, 241 they must, StVO § 2
 * Abs. 4); else on the road, near the curb. The sidewalk is for people on foot: bikes may use it
 * only where a sign allows it ("Radverkehr frei"), e-scooters only with "E-Scooter frei" (eKFV § 10;
 * "Radverkehr frei" covers them only from March 2027), children under 10 on bikes may and under 8
 * must (StVO § 2 Abs. 5). In a pedestrian zone bikes ride where "Radverkehr frei" allows it, at
 * walking pace; e-scooters go round it. A share of the riders breaks the rules (`rule_breakers`):
 * they ride on the sidewalk anyway and now and then through a red light.
 *
 * - **Bikes hold up cars** where a car cannot pass them at 1.5 m (StVO § 5) within its lane: on a
 *   narrow street without a bike lane, next to an advisory lane that is too narrow, on a bike lane
 *   below the minimum (`obstruct` of the street, objects/street-profile.js). There the riders are
 *   road users for the cars (`roadUsers()`), which follow them or overtake when the other lane is free.
 * - **Riders and people on foot** get in each other's way on shared paths, on sidewalks and next to
 *   narrow bike paths: the narrower, the more often (`conflict` of the street). A rider then slows
 *   to walking pace, and both get angry (the rider's mood, and that of the town's people:
 *   `annoy()`); the streets count the conflicts of the last hour.
 * - **Parking**: a rider who goes to a building locks the bike to a street lamp (two bikes each) or a
 *   bike stand near it (core/parking.js) and rides on after the stay.
 * @module arail/sims/cycling
 */
import { Simulation } from "../core/simulation.js";
import { createRng, dist2, dot2, polylineAt, rectBetween, sub2, unit2 } from "../core/math.js";
import { CD, OVERLAY, grey, mix, moodColor } from "../core/colors.js";
import { APPROACH_M, approachPrio, junctionPatience, leaderAhead, lightAt, mustYield, RoadUsers, squeezing, waitFor } from "../core/transit.js";
import { Person, Population } from "../core/people.js";
import { bikeColour, drawBike } from "../core/vehicles.js";

/** The riders: label, top speed (km/h, e-scooters at most 20, eKFV), length and width of the vehicle (m). */
export const RIDERS = {
  bike: { label: "Bike", speed_kmh: [14, 22], length_m: 1.8, width_m: 0.65 },
  scooter: { label: "E-scooter", speed_kmh: [15, 20], length_m: 1.2, width_m: 0.5 },
};

/** Speeds (km/h): walking pace where riding on the sidewalk is allowed and in a pedestrian zone, rule-breakers on a sidewalk, a shared path, behind people on foot. */
const SIDEWALK_KMH = 7;
const ILLEGAL_SIDEWALK_KMH = 11;
const SHARED_KMH = 15;
const BEHIND_PEOPLE_KMH = 5;
const ACCEL = 1.2; // m/s²
const BRAKE = 2.0;
const GAP_M = 1.5;
/** Two riders and a person closer than this sideways (m, plus the street's `conflict` × 1.5 m) are in each other's way. */
const NEAR_M = 0.9;
/** Colours of the riders' clothes and bikes. */
const RIDER_COLOURS = [CD.tuerkis, CD.orange, CD.brillantblau, grey(0.25), grey(0.6), mix(CD.rot, grey(0.5), 0.3), mix(CD.gelb, grey(0.4), 0.3)];

function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let nextRiderId = 1;

/**
 * Where a rider rides on an edge of the road network: "lane" (a bike lane or path, a shared path),
 * "road" (on the carriageway near the curb) or "sidewalk", by the rules and whether the rider keeps
 * to them.
 * @param {object} edge an edge of core/network.js
 * @param {{kind: "bike" | "scooter", compliant: boolean, child?: boolean}} rider
 */
export function ridingSurface(edge, rider) {
  const way = edge.bikeWay || "none";
  if (edge.kind !== "road") return way === "none" ? "sidewalk" : "lane";
  if (way !== "road") return "lane";
  if (rider.kind === "bike" && rider.child) return "sidewalk";
  const allowed = rider.kind === "scooter" ? edge.sidewalkScooters : edge.sidewalkBikes;
  if (allowed) return "sidewalk-allowed";
  return rider.compliant ? "road" : "sidewalk";
}

export class CyclingSimulation extends Simulation {
  static type = "cycling";
  static label = "Bikes and e-scooters";
  static description = "Riders on bikes and e-scooters: on bike lanes and paths where there are some, else on the road; on the sidewalk only where a sign allows it (or when they break the rules). Bikes in a narrow lane hold up the cars; riders and people on foot get in each other's way on shared paths. Bikes are locked to street lamps and bike stands.";
  static params = [
    { key: "riders_per_km", label: "Riders", type: "number", unit: "per km of street", min: 0, max: 200, step: 1, default: 8, help: "At normal daytime traffic; more in the rush hours, few at night." },
    { key: "scooters", label: "E-scooters", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: "rule_breakers", label: "Rule-breakers", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.15, help: "Riders who ride on sidewalks where it is not allowed and now and then through a red light." },
    { key: "children", label: "Children", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.08, help: "Children under 10 on bikes may (under 8 must) ride on the sidewalk (StVO § 2 Abs. 5)." },
    { key: "to_buildings", label: "Riders to buildings", type: "number", unit: "share", min: 0, max: 1, step: 0.05, default: 0.4, help: "They lock their bike near a building for a while." },
  ];

  constructor(world, config) {
    super(world, config);
    /** Riders on the way: {id, kind, person, compliant, child, colour, route, line, s, v, vmax, ...}. */
    this.riders = [];
    /** Bikes locked near a building: {rider, until (absolute clock minutes)}. */
    this.locked = [];
    /** Conflicts between riders and people on foot: [{at (clock minutes), road, pos, t (simulated s)}]. */
    this.conflicts = [];
    this._net = null;
    this._spawn = 0;
    this._users = [];
    this._road = [];
    /** Riders made so far (their `seq`, the order at junctions when two arrive at once). */
    this._seq = 0;
    this.rng = createRng(hash(world.seed, "cycling"));
    this.people = new Population(world.seed, "riders");
  }

  clear() {
    for (const l of this.locked) this.world.parking?.unlockBike(l.rider);
    this.riders = [];
    this.locked = [];
    this.conflicts = [];
    this._users = [];
    this._road = [];
  }

  dispose() {
    this.clear();
  }

  mm(m) {
    return (m * 1000) / this.world.scale;
  }

  meters(mm) {
    return (mm * this.world.scale) / 1000;
  }

  _now() {
    const c = this.world.clock;
    return (c?.day ?? 0) * 1440 + (c?.minutes ?? 0);
  }

  _network() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /** Riders wanted now: density × street length × the hour's demand. */
  targetCount(net = this._network()) {
    if (!net) return 0;
    let km = 0;
    for (const e of net.edges) if (e.kind === "road" && e.car) km += this.meters(e.length) / 1000;
    return Math.round((+this.config.riders_per_km || 0) * km * this.world.clock.demand("car"));
  }

  /** The riders that hold up cars (in a car lane too narrow to pass them): road users for the cars and buses. */
  roadUsers() {
    return this._road;
  }

  /* ---------------------------------------------------------------- riders */

  /** A new rider: a person, bike or e-scooter, keeping the rules or not, a child or not. */
  _rider() {
    const r = this.rng, kind = r.chance(+this.config.scooters || 0) ? "scooter" : "bike";
    // the id is unique in the program, the name stays the same for a seed (by the order the riders come)
    const id = nextRiderId++, seq = ++this._seq;
    const person = new Person({ id: `rider-${seq}`, ...this.people.name(["rider", seq]), role: "rider" });
    const child = kind === "bike" && r.chance(+this.config.children || 0);
    const R = RIDERS[kind];
    const kmh = child ? r.uniform(10, 14) : r.uniform(R.speed_kmh[0], R.speed_kmh[1]);
    return {
      id: `${kind}${id}`, seq, kind, person, child, compliant: child || !r.chance(+this.config.rule_breakers || 0), colour: r.pick(RIDER_COLOURS),
      vmax: kmh / 3.6, v: 0, s: 0, mood: 0.85, met: new Set(), waited: 0,
    };
  }

  /** The lateral position (mm, right of the direction of travel) of a rider on an edge. */
  _offset(e, rider) {
    const where = ridingSurface(e, rider);
    if (where === "sidewalk" || where === "sidewalk-allowed") return e.walkOffset > 0 ? e.walkOffset - this.mm(0.4) : this.mm(0.4);
    if (e.kind !== "road") return e.bikeWay === "shared" || e.bikeWay === "zone" ? e.bikeOffset || this.mm(0.5) : this.mm(0.4);
    return e.bikeOffset || e.laneOffset;
  }

  /** Give a rider a route from a node to a node: its riding line, junctions, crossings and the surface of each part. */
  _route(rider, net, from, to) {
    const route = net.route(from, to, { mode: rider.kind === "scooter" ? "scooter" : "bike" });
    if (!route || route.length < this.mm(8)) return false;
    const line = net.drivingLine(route, { offsetKey: (e) => this._offset(e, rider), minLoop: this.mm(1.5) });
    // the surface and speed of each segment of the riding line
    const surfaces = [], limits = [];
    for (let i = 1; i < line.points.length; i++) {
      const c = (line.centre[i - 1] + (line.centre[i] ?? line.centre[i - 1])) / 2;
      const e = net.edgeAt(route, c)?.edge;
      const where = e ? ridingSurface(e, rider) : "road";
      surfaces.push({ where, edge: e });
      // a pedestrian zone with "Radverkehr frei": at walking pace, as on a sidewalk where bikes are allowed
      const kmh = where === "sidewalk-allowed" || e?.bikeWay === "zone" ? SIDEWALK_KMH : where === "sidewalk" ? ILLEGAL_SIDEWALK_KMH : e?.bikeWay === "shared" ? SHARED_KMH : Infinity;
      limits.push(Math.min(rider.vmax, kmh / 3.6, e?.car ? e.speed : Infinity));
    }
    Object.assign(rider, {
      route, line, surfaces, limits, s: 0, dest: route.nodes[route.nodes.length - 1], net,
      junctions: net.junctionsAlong(route, line), crossings: net.crossingsAlong(route, line), passed: new Set(),
    });
    return true;
  }

  /** A new rider where a street ends at the edge of the layout, or riding off from a building where the bike was locked. */
  _enter(net) {
    const ends = net.boundaryNodes(), anywhere = net.nodes.filter((n) => n.edges.some((id) => net.edges[id].bike));
    if (!anywhere.length) return;
    const from = ends.length ? this.rng.pick(ends) : this.rng.pick(anywhere);
    const rider = this._rider();
    // to a building (the bike is locked near it), or through
    let to = null;
    if (this.rng.chance(+this.config.to_buildings || 0)) {
      const goal = this._goal(net);
      if (goal) {
        to = goal.node;
        rider.goal = goal;
      }
    }
    if (!to) to = this.rng.pick((ends.length > 1 ? ends : anywhere).filter((n) => n !== from));
    if (!to || !this._route(rider, net, from, to)) return;
    for (const u of this._users) if (dist2(u.front, from.pos) < this.mm(4)) return;
    rider.v = rider.vmax * 0.6;
    this.riders.push(rider);
  }

  /** A building to ride to, with the node next to it: {id, name, node, pos}. */
  _goal(net) {
    const list = this.world.objects.filter((o) => o.geometry && typeof o.entrances === "function" && typeof o.capacity === "function" && o.entrances().length);
    if (!list.length) return null;
    const o = this.rng.pick(list), e = o.entrances()[0];
    const node = net.place(`building:${o.id}:0`) ? net.nearestNode(e.pos, { mode: "bike" }) : null;
    return node ? { id: o.id, name: o.name, node, pos: e.pos } : null;
  }

  /** Fill the streets at once: riders spread over routes. */
  _fill(net, n) {
    const ends = net.boundaryNodes(), anywhere = net.nodes.filter((x) => x.edges.some((id) => net.edges[id].bike));
    const pool = ends.length > 1 ? ends : anywhere;
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const from = this.rng.pick(pool), to = this.rng.pick(pool);
      if (!from || !to || from === to) continue;
      const rider = this._rider();
      if (!this._route(rider, net, from, to)) continue;
      rider.s = this.rng.uniform(0, rider.line.length * 0.9);
      rider.v = rider.vmax * 0.7;
      this.riders.push(rider);
      k++;
    }
  }

  _pose(rider) {
    const L = rider.line, R = RIDERS[rider.kind];
    const front = polylineAt(L.points, rider.s, L.lengths).point;
    const rear = polylineAt(L.points, Math.max(0, rider.s - this.mm(R.length_m)), L.lengths).point;
    const d = sub2(front, rear);
    const dir = Math.hypot(d[0], d[1]) > 1e-6 ? unit2(d) : polylineAt(L.points, rider.s, L.lengths).dir;
    const j = rider.junctions.find((x) => x.s + x.r > rider.s);
    const approach = j && rider.s < j.s - j.r && j.s - rider.s < this.mm(APPROACH_M) ? { key: j.key, d: j.s - rider.s, prio: approachPrio(j, this.world.time) } : null;
    const pose = { vehicle: rider, front, rear, dir, speed: rider.v, approach };
    rider._pose = pose;
    return pose;
  }

  /** The segment of a rider's line it is on: {where, edge}. */
  _surface(rider) {
    const i = segmentIndex(rider.line.lengths, rider.s);
    return rider.surfaces[Math.min(i, rider.surfaces.length - 1)] || { where: "road", edge: null };
  }

  /* ---------------------------------------------------------------- step */

  step(dt) {
    if (!this.enabled) return;
    const net = this._network();
    if (!net || net.empty) {
      this.riders = [];
      this._users = [];
      this._road = [];
      this._net = net;
      return;
    }
    if (net !== this._net) {
      const first = !this._net || this._net.empty;
      // the streets changed: riders ride on to where they wanted to go, from where they are
      if (this._net && net.carKey !== this._net.carKey) this.riders = this.riders.filter((r) => this._reroute(r, net));
      this._net = net;
      if (first) this._fill(net, this.targetCount(net));
    }
    this._users = this.riders.map((r) => this._pose(r));
    this._road = this._users.filter((u) => {
      const sf = this._surface(u.vehicle);
      return sf.edge?.obstruct && (sf.where === "road" || sf.where === "lane") && sf.edge.kind === "road";
    });
    const target = this.targetCount(net);
    this._spawn -= dt;
    if (this.riders.length < target && this._spawn <= 0) {
      this._enter(net);
      this._spawn = 2 / Math.max(1, net.boundaryNodes().length);
    }
    this._unlock(net);
    const others = [...(this.world.transit?.roadUsers?.() || [])];
    for (const s of this.world.simulations || []) if (s !== this && s.enabled !== false && typeof s.roadUsers === "function") others.push(...s.roadUsers());
    const users = new RoadUsers(this._users.concat(others), this.mm(25));
    const people = [];
    for (const s of this.world.simulations || []) if (s.enabled !== false && typeof s.pedestrians === "function") for (const p of s.pedestrians()) people.push({ ...p, sim: s });
    const gone = new Set();
    for (const r of this.riders) if (this._ride(r, dt, users, people, net)) gone.add(r);
    if (gone.size) this.riders = this.riders.filter((r) => !gone.has(r));
    // conflicts older than an hour are forgotten
    const now = this._now();
    if (this.conflicts.length && now - this.conflicts[0].at > 60) this.conflicts = this.conflicts.filter((c) => now - c.at <= 60);
    for (const r of this.riders) r.mood = Math.min(0.85, r.mood + 0.002 * dt);
  }

  /** A rider whose streets changed rides on from the nearest node; false if there is no way. */
  _reroute(rider, net) {
    const pose = rider._pose || this._pose(rider);
    const from = net.nearestNode(pose.front, { mode: "bike" }), to = net.nearestNode(rider.net?.nodes[rider.dest]?.pos ?? pose.front, { mode: "bike" });
    return !!(from && to && from !== to && this._route(rider, net, from, to));
  }

  /** Bikes locked near buildings whose riders come back: they ride on to the edge of the layout. */
  _unlock(net) {
    const now = this._now(), keep = [];
    for (const l of this.locked) {
      if (now < l.until) {
        keep.push(l);
        continue;
      }
      const from = net.nearestNode(l.spot.pos, { mode: "bike" }), ends = net.boundaryNodes().filter((n) => n !== from);
      const to = ends.length ? this.rng.pick(ends) : null;
      if (!from || !to || !this._route(l.rider, net, from, to)) {
        keep.push(Object.assign(l, { until: now + 5 }));
        continue;
      }
      this.world.parking?.unlockBike(l.rider);
      l.rider.goal = null;
      l.rider.v = 0;
      this.riders.push(l.rider);
    }
    this.locked = keep;
  }

  /** Move one rider; true when it has left (out of the layout, or locked the bike). */
  _ride(rider, dt, users, people, net) {
    const L = rider.line, me = rider._pose || this._pose(rider);
    const seg = segmentIndex(L.lengths, rider.s), sf = rider.surfaces[Math.min(seg, rider.surfaces.length - 1)] || { where: "road" };
    let vT = rider.limits[Math.min(seg, rider.limits.length - 1)] ?? rider.vmax;
    vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(L.length - rider.s))) + 0.5);
    const look = this.mm((rider.v * rider.v) / (2 * BRAKE) + GAP_M + 6);
    const lead = squeezing(rider) ? { gap: Infinity, user: null } : leaderAhead(rider, me.front, me.dir, users, look, this.mm(0.9));
    const gap = lead.gap;
    waitFor(rider, lead.user, dt);
    if (gap < Infinity) vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(gap) - GAP_M)));
    let stopAt = Infinity;
    const hold = (mm) => {
      vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(mm))));
      stopAt = Math.min(stopAt, Math.max(0, mm));
    };
    // junctions: lights (rule-breakers now and then ride through red), Stop, give way
    const now = this.world.time;
    const j = rider.junctions.find((x) => x.s + x.r > rider.s);
    if (j && sf.where !== "sidewalk" && sf.where !== "sidewalk-allowed") {
      const line = j.s - j.r - this.mm(0.5) - rider.s, dStop = this.meters(line);
      const light = lightAt(j, now), prio = approachPrio(j, now);
      if (dStop < -1) {
        rider.waited = 0;
        rider.stopped = null;
      } else if (light !== "green" && !(light === "amber" && dStop < (rider.v * rider.v) / (2 * BRAKE))) {
        // decided once per light: rule-breakers ride through every other red light
        if (!rider.passed.has(j.key)) {
          rider.passed.add(j.key);
          rider.redRun = !rider.compliant && this.rng.chance(0.5);
        }
        if (!rider.redRun) hold(line);
      } else if (j.rule?.stop && rider.stopped !== j.key) {
        hold(line);
        if (rider.v < 0.2 && dStop < 1.5) rider.stopped = j.key;
      } else if (dStop < (rider.v * rider.v) / (2 * BRAKE) + 2 && rider.waited < junctionPatience(prio) && mustYield(rider, j, j.s - rider.s, users, prio)) {
        hold(line);
        if (rider.v < 0.3) rider.waited += dt;
      }
    }
    for (const x of rider.crossings || []) {
      const e = x.s - x.half - this.mm(0.5) - rider.s;
      if (e < -this.mm(0.3) || e > look + this.mm(6)) continue;
      if (x.kind === "zebra" ? sf.where === "road" && x.obj.busy() : x.obj.closed(now)) hold(e);
    }
    // people on foot in the way on a sidewalk or a shared path: walking pace behind them, and anger
    if (sf.where !== "road" && sf.edge && people.length) this._meetPeople(rider, me, sf, people, () => (vT = Math.min(vT, BEHIND_PEOPLE_KMH / 3.6)));
    rider.v = vT > rider.v ? Math.min(vT, rider.v + ACCEL * dt) : Math.max(vT, rider.v - 2 * BRAKE * dt, 0);
    let move = Math.min(this.mm(rider.v * dt), stopAt);
    if (gap < Infinity && move > gap - this.mm(0.2)) {
      move = Math.max(0, gap - this.mm(0.2));
      rider.v = Math.min(rider.v, this.meters(move) / Math.max(dt, 1e-6));
    }
    rider.s = Math.min(L.length, rider.s + move);
    if (rider.s < L.length - this.mm(0.3)) return false;
    // arrived: lock the bike near the building for a while, or leave the layout
    if (rider.goal) {
      const spot = this.world.parking?.lockBike(rider, rider.goal.pos, this.mm(60));
      if (spot) {
        const stay = rider.child ? this.rng.uniform(30, 120) : this.rng.uniform(20, 240);
        this.locked.push({ rider, spot, until: this._now() + stay });
      }
    }
    return true;
  }

  /**
   * Riders meeting people on foot on a sidewalk, a shared path or next to a narrow bike path: the
   * rider slows down behind them; once per person, by the street's `conflict` (and always where the
   * rider should not be on the sidewalk), both get angry and the street counts it.
   */
  _meetPeople(rider, me, sf, people, slow) {
    const e = sf.edge, tol = this.mm(NEAR_M + 1.5 * (e.conflict || 0)), ahead = this.mm(4);
    for (const p of people) {
      const d = sub2(p.pos, me.front), along = dot2(d, me.dir);
      if (along < -this.mm(0.5) || along > ahead) continue;
      if (Math.abs(d[0] * me.dir[1] - d[1] * me.dir[0]) > tol) continue;
      slow();
      const key = p.agent?.id ?? `${Math.round(p.pos[0])},${Math.round(p.pos[1])}`;
      if (rider.met.has(key)) continue;
      rider.met.add(key);
      const chance = sf.where === "sidewalk" ? 0.9 : sf.where === "sidewalk-allowed" ? 0.4 : Math.max(0.1, e.conflict || 0);
      if (!this.rng.chance(chance)) continue;
      rider.mood = Math.max(0, rider.mood - 0.25);
      p.sim?.annoy?.(p.agent, 0.25);
      this.conflicts.push({ at: this._now(), road: e.road, pos: p.pos.slice(), t: this.world.time, illegal: sf.where === "sidewalk" });
    }
  }

  /* ---------------------------------------------------------------- cards */

  /** The riders as pickables (core/pick.js). */
  pickables() {
    if (!this.enabled) return [];
    return this.riders.map((r) => {
      const { front, rear } = r._pose || this._pose(r);
      return { key: `${r.kind}:${r.id}`, kind: r.kind, label: RIDERS[r.kind].label, outline: rectBetween(rear, front, this.mm(1)), z0: 0, z1: this.mm(1.9), owner: this, ref: r };
    });
  }

  /** The card of a rider: who, where it rides (and whether it may), its speed and mood. */
  card(hit) {
    const r = hit.ref, sf = this._surface(r), kmh = Math.round(r.v * 3.6);
    const where = { lane: sf.edge?.bikeWay === "shared" ? "on the shared path" : sf.edge?.bikeWay === "zone" ? "in the pedestrian zone (allowed, at walking pace)" : sf.edge?.kind === "road" ? "on the bike lane or path" : "on the path", road: "on the road", "sidewalk-allowed": "on the sidewalk (allowed by a sign)", sidewalk: r.child ? "on the sidewalk (a child may)" : "on the sidewalk (not allowed)" }[sf.where] || sf.where;
    const rows = [["Rider", r.person.name], ["Riding", where], ["Speed", `${kmh} km/h`], ["Keeps the rules", r.compliant ? "yes" : "no"], ["Mood", `${Math.round(r.mood * 100)} %`]];
    if (r.child) rows.push(["Age", "a child under 10"]);
    if (sf.edge?.obstruct && sf.where !== "sidewalk" && sf.where !== "sidewalk-allowed") rows.push(["Cars behind", "cannot pass it at 1.5 m: they wait"]);
    if (r.goal) rows.push(["To", r.goal.name]);
    return { title: RIDERS[r.kind].label, subtitle: "Bikes and e-scooters", status: kmh >= 2 ? `Riding at ${kmh} km/h` : "Waiting", tone: r.mood < 0.4 ? "bad" : r.mood < 0.65 ? "warn" : "ok", rows };
  }

  /** On a street's card: riders and people on foot in each other's way in the last hour; whether bikes hold up cars. */
  describeObject(o, card) {
    if (o.type !== "road") return;
    const n = this.conflicts.filter((c) => c.road === o.id).length;
    if (n) card.rows.push(["Riders and people on foot", `${n} ${n === 1 ? "conflict" : "conflicts"} in the last hour`]);
    const locked = this.locked.filter((l) => l.spot.key?.startsWith(`${o.id}:`)).length;
    if (locked) card.rows.push(["Bikes at the lamps", locked]);
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.enabled) return;
    const m = (x) => view.m(x);
    for (const r of this.riders) {
      const { front, rear } = r._pose || this._pose(r);
      if (!view.inImage(front[0], front[1], 0, 40)) continue;
      // the bike or e-scooter with its rider, pedalling (a turn of the cranks every 4.5 m)
      const colour = this.world.settings.peopleColour === "mood" ? moodColor(r.mood) : r.colour;
      drawBike(view, rear, front, { kind: r.kind, colour: bikeColour(r), scale: r.child ? 0.78 : 1, rider: { colour, phase: (this.meters(r.s) / 4.5) * 2 * Math.PI } });
    }
    // a short "!" where riders and people on foot just got in each other's way
    for (const c of this.conflicts) {
      if (this.world.time - c.t > 4 || !view.inImage(c.pos[0], c.pos[1], 0, 40)) continue;
      view.label([c.pos[0], c.pos[1], m(2.4)], "!", { size: 12, background: c.illegal ? OVERLAY.dangerLabel : OVERLAY.label, order: 3 });
    }
  }
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
