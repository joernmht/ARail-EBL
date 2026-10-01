/**
 * Road traffic (simulation type `traffic`): cars on the streets of the road network.
 *
 * Cars enter where streets end at the edge of the layout (dead ends, `boundaryNodes()`), drive to
 * another street end on the fastest route (sometimes with a detour, so not all take the same
 * way), keep to the right lane and the speed limit of the street, keep a safe gap to the vehicle
 * ahead (cars and the buses of bus lines), wait before a junction while another vehicle is
 * crossing it (a few seconds at most, so nothing gets stuck) and leave the layout again. Their
 * number follows `cars_per_km` and the time of day (`clock.demand("car")`). On streets without
 * dead ends (a ring) cars appear on the streets and drive from one place to the next.
 *
 * The example plugin `web/plugins/road-traffic.js` is a simpler version (cars per street, no
 * junctions); both can run side by side.
 * @module arail/sims/traffic
 */
import { Simulation } from "../core/simulation.js";
import { createRng, dist2, polylineAt, sub2, unit2 } from "../core/math.js";
import { CD, grey, mix, shade } from "../core/colors.js";
import { APPROACH_M, boxFaces, gapAhead, JUNCTION_WAIT_S, mustYield, RoadUsers } from "../core/transit.js";
import { joinPaths } from "../core/network.js";

/** Muted CD colours, and many greys, white and black (most cars are). */
export const CAR_COLOURS = [
  grey(0.94), grey(0.9), grey(0.72), grey(0.55), grey(0.38), grey(0.16), grey(0.1),
  mix(CD.tuerkis, grey(0.5), 0.3), mix(CD.dunkelblau, grey(0.5), 0.2), mix(CD.rot, grey(0.45), 0.35),
  mix(CD.brillantblau, grey(0.5), 0.4), mix(CD.orange, grey(0.5), 0.4),
];

const LENGTH_M = 4.4;
const WIDTH_M = 1.8;
const ACCEL = 2.0; // m/s²
const BRAKE = 2.5; // comfortable braking (m/s²)
const HARD = 7; // hardest braking (m/s²)
const GAP_M = 2.5; // distance to the vehicle ahead when standing (m)

function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let nextCarId = 1;

export class TrafficSimulation extends Simulation {
  static type = "traffic";
  static label = "Road traffic";
  static description = "Cars drive on the streets: they come in where streets end at the edge of the layout, keep their distance, wait at junctions and leave again.";
  static params = [
    { key: "cars_per_km", label: "Cars", type: "number", unit: "per km of street", min: 0, max: 200, step: 5, default: 20, help: "At normal daytime traffic; more in the rush hours, few at night." },
  ];

  constructor(world, config) {
    super(world, config);
    /** Cars: {id, path (driving line), s (front, mm), v (m/s), colour, ...}. */
    this.cars = [];
    this._net = null;
    this._spawn = 0;
    this._users = [];
    this.rng = createRng(hash(world.seed, "traffic"));
  }

  clear() {
    this.cars = [];
    this._users = [];
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

  _network() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /** Cars wanted now: density × street length × demand at this time of day. */
  targetCount(net = this._network()) {
    if (!net) return 0;
    let km = 0;
    for (const e of net.edges) if (e.kind === "road" && e.car) km += this.meters(e.length) / 1000;
    return Math.round((+this.config.cars_per_km || 0) * km * this.world.clock.demand("car"));
  }

  /** Front, rear and direction of every car (for gaps; transit reads them for its buses). */
  roadUsers() {
    return this._users;
  }

  _pose(car) {
    const p = car.path;
    const front = polylineAt(p.points, car.s, p.lengths).point;
    const rear = polylineAt(p.points, Math.max(0, car.s - this.mm(LENGTH_M)), p.lengths).point;
    const d = sub2(front, rear);
    const dir = Math.hypot(d[0], d[1]) > 1e-6 ? unit2(d) : polylineAt(p.points, car.s, p.lengths).dir;
    // the junction it is about to enter (others give way to the first)
    const j = car.junctions.find((x) => x.s + x.r > car.s);
    const approach = j && car.s < j.s - j.r && j.s - car.s < this.mm(APPROACH_M) ? { key: j.key, d: j.s - car.s } : null;
    const pose = { vehicle: car, front, rear, dir, speed: car.v, approach };
    car._pose = pose;
    return pose;
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
  _car(net, route, dest, s0 = 0) {
    if (!route || route.length < this.mm(LENGTH_M * 2)) return null;
    const path = net.drivingLine(route);
    const junctions = net.junctionsAlong(route, path);
    return {
      id: `car${nextCarId++}`, kind: "car", path, dest, destPos: net.nodes[dest]?.pos, junctions, s: s0, v: 0, waited: 0,
      factor: this.rng.uniform(0.85, 1.05), colour: this.rng.pick(CAR_COLOURS), net,
    };
  }

  /** A new car where a street ends at the edge of the layout (or anywhere on a ring). */
  _enter(net) {
    const ends = net.boundaryNodes();
    const anywhere = net.nodes.filter((n) => n.carDegree >= 1);
    if (!anywhere.length) return;
    const from = ends.length ? this.rng.pick(ends) : this.rng.pick(anywhere);
    const pool = (ends.length > 1 ? ends : anywhere).filter((n) => n !== from);
    if (!pool.length) return;
    const to = this.rng.pick(pool);
    const clear = this.mm(LENGTH_M + 6);
    for (const u of this._allUsers()) if (dist2(u.front, from.pos) < clear || dist2(u.rear, from.pos) < clear) return;
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

  /** The streets changed: put the cars on the new network (or let them go). */
  _rebind(net) {
    const out = [];
    for (const car of this.cars) {
      const pose = this._pose(car);
      const oldDest = car.destPos;
      const ahead = [pose.front[0] + pose.dir[0] * this.mm(6), pose.front[1] + pose.dir[1] * this.mm(6)];
      const from = net.nearestNode(ahead, { mode: "car" });
      if (!from || dist2(from.pos, pose.front) > this.mm(40)) continue;
      const ends = net.boundaryNodes();
      let to = null;
      for (const n of ends.length ? ends : net.nodes) if (n !== from && n.carDegree && (!to || dist2(n.pos, oldDest || from.pos) < dist2(to.pos, oldDest || from.pos))) to = n;
      const route = to ? net.route(from, to, { mode: "car" }) : null;
      const next = route ? this._car(net, route, to.id) : null;
      if (!next) continue;
      next.id = car.id;
      next.colour = car.colour;
      next.factor = car.factor;
      next.v = car.v;
      out.push(next);
    }
    this.cars = out;
  }

  _allUsers() {
    const buses = this.world.transit?.roadUsers?.() || [];
    return buses.length ? this._users.concat(buses) : this._users;
  }

  /* ---------------------------------------------------------------- step */

  step(dt) {
    if (!this.enabled) return;
    const net = this._network();
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
    this._users = this.cars.map((c) => this._pose(c));
    const target = this.targetCount(net);
    this._spawn -= dt;
    if (this.cars.length < target && this._spawn <= 0) {
      this._enter(net);
      this._users = this.cars.map((c) => this._pose(c));
      this._spawn = 1.5 / Math.max(1, net.boundaryNodes().length);
    }
    const users = new RoadUsers(this._allUsers(), this.mm(25));
    const gone = new Set();
    for (const car of this.cars) {
      if (this._drive(car, dt, users, net)) gone.add(car);
    }
    if (gone.size) this.cars = this.cars.filter((c) => !gone.has(c));
  }

  /** Move one car; true when it has left the layout. */
  _drive(car, dt, users, net) {
    const p = car.path;
    const me = car._pose || this._pose(car);
    const seg = segmentIndex(p.lengths, car.s);
    let vT = (p.speeds[seg] ?? 8) * car.factor;
    // the end of the route: slow down a little where the street leaves the layout
    const toEnd = this.meters(p.length - car.s);
    vT = Math.min(vT, Math.sqrt(2 * BRAKE * toEnd) + 4);
    // the vehicle ahead
    const look = this.mm((car.v * car.v) / (2 * BRAKE) + GAP_M + 12);
    const gap = gapAhead(car, me.front, me.dir, users, look, this.mm(1.3));
    if (gap < Infinity) vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(gap) - GAP_M)));
    // junctions: wait before one while another vehicle is crossing it
    const j = car.junctions.find((x) => x.s + x.r > car.s);
    if (j) {
      const dStop = this.meters(j.s - j.r - this.mm(1) - car.s);
      if (dStop < -1) car.waited = 0; // in the junction: go on
      else if (dStop < (car.v * car.v) / (2 * BRAKE) + 3 && car.waited < JUNCTION_WAIT_S && mustYield(car, j, j.s - car.s, users)) {
        vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, dStop)));
        if (car.v < 0.3) car.waited += dt;
      }
    }
    car.v = vT > car.v ? Math.min(vT, car.v + ACCEL * dt) : Math.max(vT, car.v - HARD * dt, 0);
    let move = this.mm(car.v * dt);
    // never into the vehicle ahead
    if (gap < Infinity && move > gap - this.mm(0.3)) {
      move = Math.max(0, gap - this.mm(0.3));
      car.v = Math.min(car.v, this.meters(move) / Math.max(dt, 1e-6));
    }
    car.s = Math.min(p.length, car.s + move);
    if (car.s >= p.length - this.mm(0.5)) {
      // arrived: leave at the edge of the layout, or drive on to another place (ring roads)
      const node = car.net === net ? net.nodes[car.dest] : net.nearestNode(car.destPos, { mode: "car" });
      if (!node || node.carDegree <= 1 || this.cars.length > this.targetCount(net)) return true;
      const pool = net.nodes.filter((n) => n.carDegree >= 1 && n !== node);
      const to = this.rng.pick(pool);
      const next = to ? this._car(net, this._route(net, node, to), to.id) : null;
      if (!next) return true;
      Object.assign(car, { path: next.path, junctions: next.junctions, dest: next.dest, destPos: next.destPos, s: 0, net });
    }
    return false;
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
  }
}

function midpoint(u) {
  return [(u.front[0] + u.rear[0]) / 2, (u.front[1] + u.rear[1]) / 2];
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
