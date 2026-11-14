/**
 * The visitors of a market (in the lab example the Striezelmarkt, the Christmas market on the
 * Marktplatz): people come while it is open, from the houses of the town, from the ends of the
 * streets and by train, walk onto the square, queue at the stalls (objects/market.js), drink their
 * Glühwein at a standing table, look at the Christmas tree, ride the ferris wheel, the carousel and
 * the mini train, and go home again, those who came by train to the station, where the passenger
 * simulation takes them on.
 *
 * On the square people walk along **flow fields**: the square is a grid of 1 m cells without the
 * stalls and rides; for each place people go to (a counter, a gate, a table) the walking distance
 * of every cell to it is worked out once (Dijkstra over eight neighbours), and people step to the
 * neighbour cell nearest to it, pushed apart by the crowd (`crowdForces`). Off the square they walk
 * the road network like the town's residents. Stays are clock minutes, walking and serving
 * simulated seconds (as everywhere in ARail).
 * @module arail/sims/market
 */
import { Simulation } from "../core/simulation.js";
import { Population, Person, residentialBuildings } from "../core/people.js";
import { drawProfile, mobilityOf, walkingSpeed } from "../core/mobility.js";
import { hiddenAt } from "../core/network.js";
import { clamp, createRng, hashKey, pointInPolygon, pointSegment, polylineAt, rectAround } from "../core/math.js";
import { formatTime, parseTime, profileAt } from "../core/clock.js";
import { CD, grey, moodColor } from "../core/colors.js";
import { MARKET_GOODS, Ride } from "../objects/market.js";
import { crowdForces, drawPerson, personLooks, profileRows } from "./passengers.js";

/** How many people are at the market over the day, as a share of `visitors` ([hour, share]). */
export const MARKET_PROFILE = [[0, 0.5], [10, 0.3], [12, 0.45], [14, 0.55], [16, 0.85], [17.5, 1], [20.5, 1], [22, 0.75], [24, 0.5]];

/** No one comes in the last half hour before the market closes (clock minutes). */
const LAST_ENTRY_MIN = 30;
/** Seconds of a step at most (people do not walk through the stalls at a high speed). */
const SUBSTEP_S = 0.25;
/** Spacing of the people in a queue (m). */
const QUEUE_M = 0.7;
/** A queue this long sends people to the next best stall of the same kind; all that long, they give up what they wanted (people). */
const QUEUE_MAX = 12;
/** Clock minutes people wait at the station for a train home before they go another way. */
const STATION_PATIENCE_MIN = 75;
/** Mood lost per second of waiting in a queue after the first minute. */
const QUEUE_ANNOY = 0.0015;
/** Coats people wear (the picture of a winter evening; with the setting peopleColour `auto`). */
const COATS = [CD.dunkelblau, grey(0.3), "#6b2433", "#2f4f3a", "#7a6248", CD.tuerkis, grey(0.55), "#3a3f6b", CD.rot];
/** The colour of market visitors when people show the purpose of their trip. */
export const MARKET_COLOUR = CD.rot;

/** What people do at the market, in words. */
const ACTIVITY = { drink: "a hot drink", food: "something to eat", sweets: "something sweet", crafts: "a look at the crafts", tree: "a look at the tree", ride: "a ride" };
/** On a ride, and queueing for it, in words. */
const RIDING = { "ferris-wheel": "On the ferris wheel", carousel: "On the carousel", "mini-train": "On the mini train" };
const RIDE_QUEUE = { "ferris-wheel": "Queueing for the ferris wheel", carousel: "Queueing for the carousel", "mini-train": "Queueing for the mini train" };

/** A visitor: a person of the market's population. */
class Visitor extends Person {}

/* ================================================================ the square as a grid */

/**
 * A market square as a walking grid of 1 m cells: what is walkable (on the square, not on a stall
 * or a ride) and the flow fields to the places people go to.
 */
class Venue {
  /**
   * @param {object} square the `market-square` object
   * @param {object[]} things the stalls, rides and the tree on it
   * @param {number} k layout mm per metre
   */
  constructor(square, things, k) {
    this.square = square;
    this.id = square.id;
    this.k = k;
    this.stalls = things.filter((o) => o.marketInfo()?.kind === "stall");
    this.rides = things.filter((o) => o instanceof Ride && o.marketInfo());
    this.sights = things.filter((o) => o.marketInfo()?.kind === "sight");
    this.gates = square.entrances().map((g, i) => ({ ...g, i, key: `building:${square.id}:${i}` }));
    const poly = square.geometry.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    this.x0 = x0;
    this.y0 = y0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / k));
    this.ny = Math.max(1, Math.ceil((y1 - y0) / k));
    this.walkable = new Uint8Array(this.nx * this.ny);
    const blocks = things.map((o) => o.footprint()).filter((f) => f && f.length >= 3);
    /** The outlines of the stalls and rides, with their boxes: nobody stands in them. */
    this.blocks = blocks.map((f) => ({ f, box: [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))] }));
    const margin = 0.2 * k;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const c = this.center(i, j);
        if (!pointInPolygon(c, poly) || this._edgeDistance(c, poly) < 0.3 * k) continue;
        let free = true;
        for (const f of blocks) {
          if (pointInPolygon(c, f) || this._edgeDistance(c, f) < margin) {
            free = false;
            break;
          }
        }
        if (free) this.walkable[j * this.nx + i] = 1;
      }
    }
    this._keepLargestArea();
    // gates: where people step onto the square (the walkable cell nearest to the gate); a gate
    // that a stall or a ride closes is left out
    const open = this.gates.map((g) => {
      const c = this.nearestCell(g.pos);
      const inside = c >= 0 ? this.center(c % this.nx, Math.floor(c / this.nx)) : null;
      return { ...g, inside };
    }).filter((g) => g.inside);
    const near = open.filter((g) => Math.hypot(g.inside[0] - g.pos[0], g.inside[1] - g.pos[1]) <= 3 * k);
    this.gates = near.length ? near : open;
    /** @type {Map<string, Float64Array>} */
    this.fields = new Map();
  }

  /** Only the largest connected walkable area is walkable (no islands behind stalls). */
  _keepLargestArea() {
    const W = this.walkable, nx = this.nx, label = new Int32Array(W.length).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    for (let s = 0; s < W.length; s++) {
      if (!W[s] || label[s] >= 0) continue;
      const stack = [s];
      label[s] = id;
      let size = 0;
      while (stack.length) {
        const c = stack.pop();
        size++;
        const i = c % nx, j = (c - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= this.ny) continue;
          const n = jj * nx + ii;
          if (W[n] && label[n] < 0) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = id;
      }
      id++;
    }
    for (let c = 0; c < W.length; c++) if (W[c] && label[c] !== best) W[c] = 0;
  }

  _edgeDistance(p, poly) {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
    return d;
  }

  center(i, j) {
    return [this.x0 + (i + 0.5) * this.k, this.y0 + (j + 0.5) * this.k];
  }

  cellOf(p) {
    const i = Math.floor((p[0] - this.x0) / this.k), j = Math.floor((p[1] - this.y0) / this.k);
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny ? j * this.nx + i : -1;
  }

  /** Can people stand at a layout point? On a walkable cell, and not on a stall or ride. */
  free(p) {
    const c = this.cellOf(p);
    if (c < 0 || this.walkable[c] !== 1) return false;
    for (const { f, box } of this.blocks) if (p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && pointInPolygon(p, f)) return false;
    return true;
  }

  /** The walkable cell nearest to a layout point (-1 when there is none). */
  nearestCell(p) {
    const c = this.cellOf(p);
    if (c >= 0 && this.walkable[c]) return c;
    let best = -1, bd = Infinity;
    for (let n = 0; n < this.walkable.length; n++) {
      if (!this.walkable[n]) continue;
      const q = this.center(n % this.nx, Math.floor(n / this.nx)), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** The flow field to a layout point: the walking distance (cells) of every cell to it. */
  field(p) {
    const key = `${Math.round(p[0])}:${Math.round(p[1])}`;
    let f = this.fields.get(key);
    if (f) return f;
    f = new Float64Array(this.walkable.length).fill(Infinity);
    const start = this.nearestCell(p);
    if (start >= 0) {
      // Dijkstra over eight neighbours (no cutting of corners), with a small binary heap
      const heap = [[0, start]];
      f[start] = 0;
      const nx = this.nx, W = this.walkable;
      while (heap.length) {
        const [d, c] = heapPop(heap);
        if (d > f[c]) continue;
        const i = c % nx, j = (c - i) / nx;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= this.ny) continue;
            const n = jj * nx + ii;
            if (!W[n] || (di && dj && (!W[j * nx + ii] || !W[jj * nx + i]))) continue;
            const nd = d + (di && dj ? Math.SQRT2 : 1);
            if (nd < f[n]) {
              f[n] = nd;
              heapPush(heap, [nd, n]);
            }
          }
        }
      }
    }
    this.fields.set(key, f);
    return f;
  }

  /** Which way to walk from p towards the place of a field (a unit vector), or null when there is no way. */
  direction(f, p, target) {
    const k = this.k, dx = target[0] - p[0], dy = target[1] - p[1], d = Math.hypot(dx, dy);
    if (d < 2.2 * k) return d > 1e-6 ? [dx / d, dy / d] : [0, 0];
    let c = this.cellOf(p);
    if (c < 0 || !this.walkable[c]) c = this.nearestCell(p);
    if (c < 0) return null;
    const i = c % this.nx, j = (c - i) / this.nx;
    let best = f[c], bi = i, bj = j;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
        const v = f[jj * this.nx + ii];
        if (v < best - 1e-6) {
          best = v;
          bi = ii;
          bj = jj;
        }
      }
    }
    if (!Number.isFinite(best)) return null;
    const q = bi === i && bj === j ? target : this.center(bi, bj);
    const ex = q[0] - p[0], ey = q[1] - p[1], e = Math.hypot(ex, ey);
    return e > 1e-6 ? [ex / e, ey / e] : [0, 0];
  }

  /** A random walkable point (layout mm), or null. */
  randomPoint(rng) {
    for (let n = 0; n < 60; n++) {
      const c = rng.int(this.walkable.length);
      if (this.walkable[c]) {
        const q = this.center(c % this.nx, Math.floor(c / this.nx));
        return [q[0] + rng.uniform(-0.4, 0.4) * this.k, q[1] + rng.uniform(-0.4, 0.4) * this.k];
      }
    }
    return null;
  }
}

function heapPush(h, x) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

/* ================================================================ the simulation */

export class MarketSimulation extends Simulation {
  static type = "market";
  static label = "Market visitors";
  static description = "Visitors of a market on a market square: they come from the town, the streets and by train, queue at the stalls, stay at standing tables, look at the tree, take rides and go home.";
  static params = [
    { key: "visitors", label: "Visitors at the busiest time", type: "number", min: 0, max: 2000, step: 10, default: 240, help: "People on the market at once in the evening" },
    { key: "open", label: "Opens", type: "text", default: "10:00" },
    { key: "close", label: "Closes", type: "text", default: "22:00" },
    { key: "by_train", label: "Come by train", type: "number", min: 0, max: 1, step: 0.05, default: 0.3, help: "Share of the visitors who come by train and go back to the station" },
    { key: "from_homes", label: "Come from the town", type: "number", min: 0, max: 1, step: 0.05, default: 0.45, help: "Of the others, the share who come from the houses of the town; the rest come from the ends of the streets" },
    { key: "children", label: "Children", type: "number", min: 0, max: 0.6, step: 0.05, default: 0.15 },
    { key: "seed", label: "Random seed", type: "number", min: 1, max: 9999, step: 1, default: 1 },
  ];

  constructor(world, config) {
    super(world, config);
    /** @type {Visitor[]} */
    this.visitors = [];
    this.rng = createRng(hashKey(world.seed ?? 1, "market", this.config.seed ?? 1));
    this.population = new Population(this.config.seed ?? 1, "market");
    this.count = 0;
    /** Per stall id: {queue: Visitor[], serving: number, sold, takings, waits: [s]}; per ride id: {queue}. */
    this.stalls = new Map();
    this.rideQueues = new Map();
    /** Per table key: the visitors at it. */
    this.tables = new Map();
    /** Since midnight: sold per goods id, visitors who came, by how they came. */
    this.today = this._emptyDay();
    this._venues = null;
    this._venueKey = null;
    this._wasOpen = null;
    const on = (name, fn) => world.events.on(name, fn);
    this._off = [
      on("passenger.exited", (e) => this._exited(e)),
      on("passenger.boarded", (e) => this._boarded(e)),
      on("passenger.removed", (e) => this._gone(e.agent)),
      on("vehicle.arrived", (e) => this._vehicleArrived(e)),
      on("clock.set", () => {
        if (!this.enabled) return;
        this._afterJump();
        this._wasOpen = this.isOpen(); // filled now: the first step does not fill it again
      }),
      on("clock.day", () => this._newDay()),
    ];
  }

  dispose() {
    this._off.forEach((off) => off());
  }

  /** Midnight: the figures of today start again, the market's and each stall's. */
  _newDay() {
    this.today = this._emptyDay();
    for (const s of this.stalls.values()) {
      s.sold = 0;
      s.takings = 0;
      s.waits = [];
    }
  }

  _emptyDay() {
    return { sold: {}, takings: 0, came: { home: 0, street: 0, train: 0 }, left: { home: 0, street: 0, train: 0, other: 0 }, rides: 0 };
  }

  /** Opening hours (clock minutes). */
  hours() {
    return { open: parseTime(this.config.open) ?? 600, close: parseTime(this.config.close) ?? 1320 };
  }

  /** Is the market open (at a time of day, default now)? */
  isOpen(minutes = this.world.clock.minutes) {
    const { open, close } = this.hours();
    return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
  }

  /** Minutes until it closes (Infinity while closed). */
  _toClose(minutes = this.world.clock.minutes) {
    if (!this.isOpen(minutes)) return Infinity;
    const { close } = this.hours();
    return (close - minutes + 1440) % 1440;
  }

  /** How many people are at the market at this time of day (while it is open). */
  present() {
    if (!this.isOpen()) return 0;
    return Math.round((+this.config.visitors || 0) * profileAt(MARKET_PROFILE, this.world.clock.minutes));
  }

  /** How many people should be at the market now: none come in the last half hour. */
  target() {
    return this._toClose() < LAST_ENTRY_MIN ? 0 : this.present();
  }

  get passengers() {
    return this.world.simulations.find((s) => s.enabled && typeof s.enter === "function" && typeof s.alight === "function") || null;
  }

  /* ---------------------------------------------------------------- venues */

  /** The market squares with their stalls (rebuilt when objects change). */
  venues() {
    const w = this.world, key = `${w.objectsVersion ?? ""}:${w.map?.version ?? ""}:${w.scale}`;
    if (this._venues && key === this._venueKey) return this._venues;
    this._venueKey = key;
    const k = 1000 / (w.scale || 87);
    this._venues = w.objects
      .filter((o) => o.type === "market-square" && o.geometry)
      .map((sq) => new Venue(sq, sq.contents(), k))
      .filter((v) => v.stalls.length || v.rides.length);
    // people whose square is gone go home; the others keep where they are
    const ids = new Set(this._venues.map((v) => v.id));
    for (const v of [...this.visitors]) if (!ids.has(v.venue)) this._remove(v);
    // riders of a ride that is gone are back on the square
    for (const v of this.visitors) {
      if (v.state !== "riding") continue;
      const venue = this._venues.find((x) => x.id === v.venue);
      if (venue && !venue.rides.some((r) => r.id === v.ride)) this._enterSquare(v, venue, null);
    }
    // what people on the square are doing stays valid where its stall, ride or gate is still there
    for (const v of this.visitors) {
      if (v.state !== "market" || !v.task) continue;
      const venue = this._venues.find((x) => x.id === v.venue), t = v.task;
      let ok = true;
      if (t.type === "queue") ok = venue.stalls.some((o) => o.id === t.stall);
      else if (t.type === "ride") ok = venue.rides.some((o) => o.id === t.ride);
      else if (t.type === "leave") ok = !!(t.gate = venue.gates.find((g) => g.key === t.gate.key) || this._nearestGate(venue, t.gate.pos));
      if (!ok) {
        this._leaveQueues(v);
        this._leaveTable(v);
        v.task = null;
      }
    }
    return this._venues;
  }

  _venue(id) {
    return this.venues().find((v) => v.id === id) || null;
  }

  _stall(id) {
    let s = this.stalls.get(id);
    if (!s) this.stalls.set(id, (s = { queue: [], serving: 0, sold: 0, takings: 0, waits: [] }));
    return s;
  }

  _rideQueue(id) {
    let q = this.rideQueues.get(id);
    if (!q) this.rideQueues.set(id, (q = []));
    return q;
  }

  /* ---------------------------------------------------------------- people */

  _newVisitor(venue, origin) {
    const rng = this.rng, mob = mobilityOf(this.world);
    const n = ++this.count;
    const child = rng.chance(clamp(+this.config.children || 0, 0, 0.6));
    const profile = drawProfile(rng, { age: child ? "child" : rng.chance(mob.old?.share ?? 0.2) ? "old" : "adult", luggage: "none" }, mob);
    const v = this.population.add(`v-${n}`, { role: "visitor" }, Visitor);
    Object.assign(v, {
      venue: venue.id, origin, profile, speed: walkingSpeed(profile, mob) * 0.85, mood: 0.95, spent: 0, bought: [],
      height: profile.age === "child" ? rng.uniform(1.1, 1.45) : rng.uniform(1.6, 1.9), phase: rng.uniform(0, 2 * Math.PI),
      coat: rng.pick(COATS), colour: MARKET_COLOUR, state: "new", pos: null, dir: [1, 0], walk: null, s: 0, task: null, came: this.world.clock.minutes,
    });
    v.plan = this._plan(v, rng);
    this.visitors.push(v);
    this.today.came[origin.kind] = (this.today.came[origin.kind] || 0) + 1;
    return v;
  }

  /** What a visitor wants to do: 2 to 5 things, a hot drink first for most grown-ups. */
  _plan(v, rng) {
    const child = v.profile.age === "child", out = [];
    const n = 2 + rng.int(child ? 3 : 4);
    if (!child && rng.chance(0.75)) out.push("drink");
    const pool = child
      ? [["ride", 5], ["sweets", 2], ["drink", 2], ["food", 2], ["tree", 1.5]]
      : [["food", 3], ["drink", 2.5], ["sweets", 2], ["crafts", 2.5], ["tree", 2], ["ride", 0.8]];
    while (out.length < n) {
      const pick = pool[rng.weighted(pool.map((x) => x[1]))][0];
      if (pick === "ride" && out.filter((x) => x === "ride").length >= 2) continue;
      out.push(pick);
    }
    return out;
  }

  /** Where people come from that are not by train: a house of the town, or the end of a street. */
  _origin(venue, rng) {
    const net = this.world.network();
    const homes = residentialBuildings(this.world).filter(({ o }) => o.entrances?.().length);
    if (homes.length && rng.chance(clamp(+this.config.from_homes || 0, 0, 1))) {
      const h = homes[rng.weighted(homes.map((x) => x.residents))];
      const i = rng.int(h.o.entrances().length);
      return { kind: "home", building: h.id, name: h.o.spec.name || h.id, pos: h.o.entrances()[i].pos, key: `building:${h.id}:${i}` };
    }
    const ends = net && !net.empty ? net.boundaryNodes() : [];
    if (ends.length) {
      const e = rng.pick(ends);
      return { kind: "street", pos: e.pos.slice(), key: null };
    }
    return { kind: "street", pos: null, key: null };
  }

  /** Walk from a layout point onto the square (its nearest gate). */
  _comeIn(v, from, fromKey = null) {
    const venue = this._venue(v.venue);
    if (!venue) return this._remove(v);
    const gate = this._nearestGate(venue, from);
    if (!gate || !from) return this._enterSquare(v, venue, gate);
    const net = this.world.network();
    v.walk = net ? net.walk(from, gate.pos, { fromKey, toKey: gate.key }) : null;
    v.gate = gate;
    v.s = 0;
    v.state = "coming";
    v.pos = from.slice();
    if (!v.walk || v.walk.offstage || !v.walk.points?.length) this._enterSquare(v, venue, gate);
  }

  _nearestGate(venue, p) {
    if (!venue.gates.length) return null;
    if (!p) return venue.gates[0];
    let best = null, bd = Infinity;
    for (const g of venue.gates) {
      const d = Math.hypot(g.pos[0] - p[0], g.pos[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  _enterSquare(v, venue, gate) {
    let p = gate ? gate.inside.slice() : venue.randomPoint(this.rng);
    if (p && !venue.free(p)) {
      const c = venue.nearestCell(p);
      p = c >= 0 ? venue.center(c % venue.nx, Math.floor(c / venue.nx)) : null;
    }
    if (!p) return this._remove(v);
    v.pos = p;
    v.state = "market";
    v.walk = null;
    v.task = null;
  }

  /* ---------------------------------------------------------------- arrivals */

  _spawn(dt) {
    const venues = this.venues();
    if (!venues.length) return;
    const target = this.target();
    if (!target) return;
    const pax = this.passengers;
    const rail = pax && this.world.stopAreas().some((a) => a.kind === "rail");
    const byTrain = rail ? clamp(+this.config.by_train || 0, 0, 1) : 0;
    const here = this.visitors.filter((v) => v.state !== "going" && v.state !== "station");
    const others = here.filter((v) => v.origin.kind !== "train").length;
    const want = target * (1 - byTrain) - others;
    if (want <= 0) return;
    // fill up within about 45 simulated seconds
    let n = (want * dt) / 45;
    while (n > 0) {
      if (n < 1 && !this.rng.chance(n)) break;
      n -= 1;
      const venue = this._pickVenue(venues);
      const origin = this._origin(venue, this.rng);
      const v = this._newVisitor(venue, origin);
      this._comeIn(v, origin.pos, origin.key);
    }
  }

  _pickVenue(venues) {
    return venues.length === 1 ? venues[0] : venues[this.rng.weighted(venues.map((x) => x.stalls.length + x.rides.length))];
  }

  /** A train at the station brings visitors (as many as are missing of those who come by train). */
  _vehicleArrived({ vehicle, dock }) {
    if (!this.enabled || !vehicle || !dock) return;
    if (dock.kind !== "rail" && vehicle.kind !== "train") return;
    const venues = this.venues(), target = this.target(), pax = this.passengers;
    if (!venues.length || !target || !pax) return;
    const byTrain = clamp(+this.config.by_train || 0, 0, 1);
    const here = this.visitors.filter((v) => v.origin.kind === "train" && v.state !== "going" && v.state !== "station").length;
    const n = Math.min(20, Math.round(target * byTrain - here));
    if (n <= 0) return;
    const agents = [];
    for (let i = 0; i < n; i++) {
      const v = this._newVisitor(this._pickVenue(venues), { kind: "train", area: dock.area?.id ?? null, line: vehicle.line ?? vehicle.lineId ?? null });
      v.state = "train";
      agents.push(v);
    }
    const off = new Set();
    for (const p of pax.alight(vehicle, dock, agents)) {
      p.agent.person = p;
      off.add(p.agent);
    }
    // those the passengers did not take off: from the platform's exit
    const acc = dock.area?.access?.[0], at = acc ? dock.area.toLayout(acc.s, acc.t) : null;
    for (const v of agents) if (!off.has(v)) this._comeIn(v, at);
  }

  _exited({ agent, pos }) {
    const v = this._ours(agent);
    if (!v) return;
    v.person = null;
    if (v.state === "train") this._comeIn(v, pos ? pos.slice() : null);
    else this._gone(v); // gave up waiting at the station: home another way
  }

  _boarded({ agent }) {
    const v = this._ours(agent);
    if (!v) return;
    this._remove(v, false, "train");
  }

  /** Taken off by the passengers (gave up waiting at the station, the stop removed): home another way. */
  _gone(agent) {
    const v = this._ours(agent);
    if (!v) return;
    this._remove(v, false);
  }

  _ours(agent) {
    return agent instanceof Visitor && this.visitors.includes(agent) ? agent : null;
  }

  /** Take a visitor away (from queues, tables, rides; from the stops too unless `passengers` is false). */
  _remove(v, passengers = true, how = "other") {
    const i = this.visitors.indexOf(v);
    if (i < 0) return;
    this.visitors.splice(i, 1);
    // how they left (`today.left`): home, to the street ends, by train, or otherwise (gave up, square gone)
    this.today.left[how in this.today.left ? how : "other"]++;
    this._leaveQueues(v);
    this._leaveTable(v);
    for (const venue of this._venues || []) for (const r of venue.rides) r.clearRiders((a) => a === v);
    if (passengers && (v.state === "station" || v.state === "train")) this.passengers?.removeAgents((a) => a === v);
    this.population.people.delete(v.id);
    this.population.names.delete(v.name);
  }

  _leaveQueues(v) {
    for (const s of this.stalls.values()) {
      const i = s.queue.indexOf(v);
      if (i >= 0) {
        s.queue.splice(i, 1);
        if (i === 0) s.serving = 0;
      }
    }
    for (const q of this.rideQueues.values()) {
      const i = q.indexOf(v);
      if (i >= 0) q.splice(i, 1);
    }
  }

  _leaveTable(v) {
    if (!v.table) return;
    const t = this.tables.get(v.table);
    if (t) t.delete(v);
    v.table = null;
  }

  /** The clock was set: people are put on the market as it would be at that time. */
  _afterJump() {
    this.clear();
    const venues = this.venues(), target = this.present();
    if (!venues.length || !target) return;
    for (let i = 0; i < Math.round(target * 0.8); i++) {
      const venue = this._pickVenue(venues);
      const train = this.rng.chance(clamp(+this.config.by_train || 0, 0, 1)) && this.world.stopAreas().some((a) => a.kind === "rail");
      const origin = train ? { kind: "train", area: null, line: null } : this._origin(venue, this.rng);
      const v = this._newVisitor(venue, origin);
      v.plan.splice(0, this.rng.int(Math.max(1, v.plan.length - 1)));
      this._enterSquare(v, venue, null);
    }
  }

  clear() {
    const ours = (a) => a instanceof Visitor;
    this.passengers?.removeAgents(ours);
    for (const venue of this._venues || []) for (const r of venue.rides) r.clearRiders(ours);
    for (const v of this.visitors) {
      this.population.people.delete(v.id);
      this.population.names.delete(v.name);
    }
    this.today.left.other += this.visitors.length;
    this.visitors = [];
    this.stalls.clear();
    this.rideQueues.clear();
    this.tables.clear();
  }

  /* ---------------------------------------------------------------- the step */

  step(dt) {
    if (!this.enabled || !(dt > 0)) return;
    const open = this.isOpen();
    if (this._wasOpen === null && open) this._afterJump();
    // closing time: the stalls stop serving and the queues break up; people finish what is in their
    // hands (a drink, a ride) and go
    if (this._wasOpen && !open) {
      for (const v of this.visitors) {
        v.plan = [];
        if (v.task?.type === "queue" || v.task?.type === "ride") {
          this._leaveQueues(v);
          v.task = null;
        }
      }
    }
    this._wasOpen = open;
    this._spawn(dt);
    this._giveUp();
    for (const venue of this.venues()) this._rides(venue);
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(SUBSTEP_S, left);
      left -= h;
      this._serve(h);
      this._move(h);
    }
  }

  /** Who waits at the station for longer than {@link STATION_PATIENCE_MIN} goes home another way (no train after midnight). */
  _giveUp() {
    const pax = this.passengers, limit = this._seconds(STATION_PATIENCE_MIN);
    for (const v of [...this.visitors]) {
      if (v.state !== "station" || this.world.time - (v.since ?? this.world.time) < limit) continue;
      if (v.person && pax?.release) pax.release(v.person);
      this._remove(v);
    }
  }

  /** People get off rides that have ended and on rides that board. */
  _rides(venue) {
    for (const r of venue.rides) {
      for (const a of r.takeAlighted()) {
        const v = this._ours(a);
        if (!v) continue;
        const g = r.marketInfo().gate;
        v.pos = [g[0] + this.rng.uniform(-1.5, 1.5) * venue.k, g[1] + this.rng.uniform(-1.5, 1.5) * venue.k];
        if (!venue.free(v.pos)) v.pos = g.slice();
        v.state = "market";
        v.task = null;
        v.rides = (v.rides || 0) + 1;
        this.today.rides++;
      }
      const q = this._rideQueue(r.id), k = venue.k, gate = r.marketInfo().gate;
      while (q.length && r.canBoard()) {
        const v = q[0];
        if (Math.hypot(v.pos[0] - gate[0], v.pos[1] - gate[1]) > 2.5 * k) break;
        q.shift();
        r.board(v);
        v.state = "riding";
        v.ride = r.id;
        v.task = null;
      }
    }
  }

  /** The first in each queue is served; when done, the next. */
  _serve(dt) {
    if (!this.isOpen()) return;
    for (const venue of this._venues || []) {
      for (const o of venue.stalls) {
        const s = this._stall(o.id), v = s.queue[0];
        if (!v) continue;
        const info = o.marketInfo(), goods = MARKET_GOODS[info.goods];
        if (Math.hypot(v.pos[0] - info.counter[0], v.pos[1] - info.counter[1]) > 1.3 * venue.k) continue;
        s.serving += dt;
        if (s.serving < goods.serve_s * (v.serveF ??= this.rng.uniform(0.7, 1.4))) continue;
        s.queue.shift();
        s.serving = 0;
        v.serveF = null;
        // a craft stall: not everybody buys
        const buys = goods.kind !== "crafts" || this.rng.chance(0.45);
        if (buys) {
          s.sold++;
          s.takings += goods.price;
          this.today.sold[info.goods] = (this.today.sold[info.goods] || 0) + 1;
          this.today.takings += goods.price;
          v.spent += goods.price;
          v.bought.push(info.goods);
        }
        if (v.queuedAt != null) s.waits.push(this.world.time - v.queuedAt);
        if (s.waits.length > 30) s.waits.shift();
        v.queuedAt = null;
        const stay = buys ? goods.stay : [0, 0];
        if (stay[1] > 0) this._stayAt(v, venue, o, info, this.rng.uniform(stay[0], stay[1]), info.goods);
        else v.task = null;
      }
    }
  }

  /** After buying: stand at a free place of a standing table, else in front of the stall, for some clock minutes. */
  _stayAt(v, venue, o, info, minutes, goods) {
    const k = venue.k;
    let at = null;
    for (let t = 0; t < info.tables.length && !at; t++) {
      const key = `${o.id}:${t}`;
      const holders = this.tables.get(key) || new Set();
      this.tables.set(key, holders);
      if (holders.size >= 4) continue;
      const used = new Set([...holders].map((h) => h.slot));
      for (let slot = 0; slot < 4; slot++) {
        if (used.has(slot)) continue;
        const a = (slot * Math.PI) / 2 + Math.PI / 4, p = [info.tables[t][0] + Math.cos(a) * 0.62 * k, info.tables[t][1] + Math.sin(a) * 0.62 * k];
        holders.add(v);
        v.table = key;
        v.slot = slot;
        v.facing = info.tables[t];
        at = p;
        break;
      }
    }
    if (!at) {
      for (let i = 0; i < 8 && !at; i++) {
        const side = this.rng.uniform(-3, 3), out = this.rng.uniform(2.5, 6);
        const p = [info.counter[0] + info.out[0] * out * k - info.out[1] * side * k, info.counter[1] + info.out[1] * out * k + info.out[0] * side * k];
        if (venue.free(p)) at = p;
      }
      v.facing = info.counter;
    }
    v.task = { type: "stay", at: at || v.pos.slice(), until: this.world.time + this._seconds(minutes), what: goods, stall: o.id };
  }

  /** Simulated seconds of clock minutes. */
  _seconds(minutes) {
    return (minutes * 60) / Math.max(0.05, this.world.clock.factor || 1);
  }

  /** The next thing a visitor on the square does. */
  _nextTask(v, venue) {
    const rng = this.rng;
    while (v.plan.length) {
      const what = v.plan.shift();
      const child = v.profile.age === "child";
      if (what === "tree") {
        const tree = venue.sights.length ? rng.pick(venue.sights) : null;
        if (!tree) continue;
        const info = tree.marketInfo();
        for (let i = 0; i < 10; i++) {
          const a = rng.uniform(0, 2 * Math.PI), r = info.radius + rng.uniform(1, 3.5) * venue.k;
          const p = [info.at[0] + Math.cos(a) * r, info.at[1] + Math.sin(a) * r];
          if (venue.free(p)) {
            v.facing = info.at;
            return { type: "stay", at: p, until: null, minutes: rng.uniform(2, 6), what: "tree", object: tree.id };
          }
        }
        continue;
      }
      if (what === "ride") {
        const rides = venue.rides.filter((r) => (child ? r.marketInfo().kids || rng.chance(0.4) : !r.marketInfo().kids));
        if (!rides.length) continue;
        const r = rides[rng.weighted(rides.map((x) => 1 / (1 + this._rideQueue(x.id).length / 8)))];
        if (this._rideQueue(r.id).length >= r.places() * 2) continue;
        this._rideQueue(r.id).push(v);
        return { type: "ride", ride: r.id };
      }
      const kinds = what === "drink" ? ["drink"] : what === "food" ? ["food"] : what === "sweets" ? ["sweets"] : ["crafts"];
      const stalls = venue.stalls.filter((o) => {
        const g = MARKET_GOODS[o.marketInfo().goods];
        return kinds.includes(g.kind) && (!child || g.kids || g.kind === "food");
      });
      if (!stalls.length) continue;
      const score = (o) => {
        const info = o.marketInfo(), g = MARKET_GOODS[info.goods], q = this._stall(o.id).queue.length;
        const d = Math.hypot(info.counter[0] - v.pos[0], info.counter[1] - v.pos[1]) / venue.k;
        return (g.weight * (child && g.kids ? 3 : 1)) / (1 + q / 4) / (1 + d / 40) * rng.uniform(0.6, 1.4);
      };
      // the best stall whose queue is not full; all full: give it up, annoyed
      const best = stalls.map((o) => [score(o), o]).sort((a, b) => b[0] - a[0]).map(([, o]) => o).find((o) => this._stall(o.id).queue.length < QUEUE_MAX);
      if (!best) {
        v.mood = Math.max(0, v.mood - 0.08);
        continue;
      }
      const s = this._stall(best.id);
      s.queue.push(v);
      v.queuedAt = this.world.time;
      return { type: "queue", stall: best.id };
    }
    return null;
  }

  /** Where a visitor wants to be now (layout mm), and the place of the flow field. */
  _goal(v, venue) {
    const t = v.task, k = venue.k;
    if (!t) return null;
    if (t.type === "queue") {
      const o = venue.stalls.find((x) => x.id === t.stall), s = this._stall(t.stall);
      if (!o) return null;
      const info = o.marketInfo(), i = Math.max(0, s.queue.indexOf(v));
      v.facing = info.counter.map((c, j) => c - info.out[j] * k);
      return { at: [info.counter[0] + info.out[0] * QUEUE_M * i * k, info.counter[1] + info.out[1] * QUEUE_M * i * k], field: info.counter };
    }
    if (t.type === "ride") {
      const r = venue.rides.find((x) => x.id === t.ride);
      if (!r) return null;
      const info = r.marketInfo(), i = Math.max(0, this._rideQueue(r.id).indexOf(v));
      // the queue bends to the side after eight people
      const along = Math.min(i, 8) * 0.6, side = Math.max(0, i - 8) * 0.6;
      v.facing = info.gate.map((c, j) => c - info.out[j] * k);
      return { at: [info.gate[0] + info.out[0] * along * k - info.out[1] * side * k, info.gate[1] + info.out[1] * along * k + info.out[0] * side * k], field: info.gate };
    }
    if (t.type === "stay") return { at: t.at, field: t.at };
    if (t.type === "leave") return { at: t.gate.inside, field: t.gate.inside };
    return null;
  }

  /** Everybody walks: on the square by the flow fields, in the streets along their walks. */
  _move(dt) {
    const crowd = [];
    for (const v of [...this.visitors]) {
      if (v.state === "coming" || v.state === "going") {
        this._walkStreet(v, dt);
        continue;
      }
      if (v.state !== "market") continue;
      const venue = this._venue(v.venue);
      if (!venue) {
        this._remove(v);
        continue;
      }
      if (!v.task) {
        v.task = this._nextTask(v, venue);
        if (!v.task) v.task = this._leaveTask(v, venue);
        if (!v.task) {
          this._remove(v);
          continue;
        }
      }
      crowd.push({ v, venue, pos: [v.pos[0] / venue.k, v.pos[1] / venue.k], radius: v.profile.aid === "pram" ? 0.5 : 0.3 });
    }
    const { neighbours, push } = crowdForces(crowd);
    crowd.forEach(({ v, venue }, i) => this._stepOnSquare(v, venue, dt, push[i], neighbours[i]));
  }

  _leaveTask(v, venue) {
    const dest = this._destination(v);
    const gate = this._nearestGate(venue, dest?.pos ?? null);
    if (!gate) return null;
    return { type: "leave", gate, dest };
  }

  /** Where a visitor goes home to: the house, the end of the street, or the station (by train). */
  _destination(v) {
    const o = v.origin;
    if (o.kind === "train") {
      const areas = this.world.stopAreas().filter((a) => a.kind === "rail" && (!o.area || a.id === o.area));
      const all = areas.length ? areas : this.world.stopAreas().filter((a) => a.kind === "rail");
      if (all.length && this.passengers) {
        const a = all[hashKey(v.id) % all.length], i = 0, acc = a.access?.[i];
        if (acc) return { kind: "train", area: a.id, pos: a.toLayout(acc.s, acc.t), key: `area:${a.id}:${i}` };
      }
      return { kind: "street", pos: null, key: null };
    }
    return { kind: o.kind, pos: o.pos, key: o.key };
  }

  _stepOnSquare(v, venue, dt, push, neighbours) {
    const k = venue.k, t = v.task;
    // stays end; mood suffers in long queues
    if (t.type === "stay") {
      if (t.until == null) t.until = this.world.time + this._seconds(t.minutes);
      if (this.world.time >= t.until) {
        this._leaveTable(v);
        v.task = null;
        return;
      }
    }
    if (t.type === "queue" && v.queuedAt != null && this.world.time - v.queuedAt > 60) v.mood = Math.max(0, v.mood - QUEUE_ANNOY * dt);
    else v.mood = Math.min(0.95, v.mood + 0.0005 * dt);
    const goal = this._goal(v, venue);
    if (!goal) {
      this._leaveQueues(v);
      v.task = null;
      return;
    }
    const dx = goal.at[0] - v.pos[0], dy = goal.at[1] - v.pos[1], d = Math.hypot(dx, dy);
    if (t.type === "leave" && d < 1.2 * k) return this._goOut(v, t);
    let vx = 0, vy = 0;
    const crowded = 1 / (1 + 0.12 * Math.max(0, neighbours - 2));
    if (d > 0.25 * k) {
      const dir = venue.direction(venue.field(goal.field), v.pos, goal.at);
      if (dir) {
        const speed = Math.min(v.speed * crowded, d / k / Math.max(dt, 0.05));
        vx = dir[0] * speed;
        vy = dir[1] * speed;
      }
    }
    // pushed by the crowd (standing people give way less)
    const standing = d <= 0.6 * k;
    const f = standing ? 0.35 : 0.8;
    vx += push[0] * f;
    vy += push[1] * f;
    const nx = v.pos[0] + vx * dt * k, ny = v.pos[1] + vy * dt * k;
    // (someone who stands where nobody may, after a stall was moved, walks out)
    if (venue.free([nx, ny]) || !venue.free(v.pos)) v.pos = [nx, ny];
    else if (venue.free([nx, v.pos[1]])) v.pos = [nx, v.pos[1]];
    else if (venue.free([v.pos[0], ny])) v.pos = [v.pos[0], ny];
    const sp = Math.hypot(vx, vy);
    v.moving = sp;
    if (sp > 0.15) v.dir = [vx, vy];
    else if (v.facing) v.dir = [v.facing[0] - v.pos[0], v.facing[1] - v.pos[1]];
    v.phase += sp * dt * 4;
  }

  /** At the gate: out into the streets, home, or to the station. */
  _goOut(v, t) {
    this._leaveQueues(v);
    this._leaveTable(v);
    const dest = t.dest;
    const net = this.world.network();
    if (!dest?.pos || !net) {
      return this._remove(v, true, v.origin.kind === "train" ? "other" : v.origin.kind);
    }
    v.walk = net.walk(t.gate.pos, dest.pos, { fromKey: t.gate.key, toKey: dest.key });
    if (!v.walk || v.walk.offstage || !v.walk.points?.length) {
      return this._remove(v, true, dest.kind === "train" ? "other" : dest.kind);
    }
    v.dest = dest;
    v.state = "going";
    v.s = 0;
    v.task = null;
  }

  _walkStreet(v, dt) {
    const w = v.walk;
    if (!w) return this._remove(v);
    v.s += v.speed * 1.15 * dt * (1000 / (this.world.scale || 87));
    if (v.s >= w.length) {
      if (v.state === "coming") {
        const venue = this._venue(v.venue);
        return venue ? this._enterSquare(v, venue, v.gate) : this._remove(v);
      }
      // home, or at the station: the passenger simulation takes over
      const dest = v.dest, pax = this.passengers;
      if (dest?.kind === "train" && pax) {
        v.state = "station";
        v.pos = w.points[w.points.length - 1].slice();
        const p = pax.enter(dest.area, { agent: v, anyDock: true, at: v.pos, profile: v.profile, mood: v.mood });
        v.since = this.world.time;
        if (p) v.person = p;
        else this._remove(v);
        return;
      }
      return this._remove(v, true, dest?.kind ?? "street");
    }
    const { point, dir } = polylineAt(w.points, v.s, w.lengths);
    v.dir = dir;
    v.pos = point;
    v.moving = v.speed;
    v.phase += v.speed * dt * 4;
  }

  /* ---------------------------------------------------------------- drawing and cards */

  _visible(v) {
    if (v.state === "market") return !!v.pos;
    if (v.state === "coming" || v.state === "going") return !!v.pos && !hiddenAt(v.walk, v.s);
    return false;
  }

  _colour(v) {
    const mode = this.world.settings.peopleColour || "auto";
    return mode === "mood" ? moodColor(v.mood) : mode === "purpose" ? v.colour : v.coat;
  }

  draw(view) {
    if (!this.enabled) return;
    for (const v of this.visitors) {
      if (!this._visible(v) || !view.inImage(v.pos[0], v.pos[1], 0)) continue;
      drawPerson(view, v.pos, {
        dir: v.dir, speed: v.moving || 0, phase: v.phase, height: v.height, colour: this._colour(v), ...personLooks(this.world, v.profile),
      });
    }
  }

  pickables(view) {
    if (!this.enabled) return [];
    const out = [];
    for (const v of this.visitors) {
      if (!this._visible(v)) continue;
      out.push({ key: `market:${v.id}`, kind: "person", label: v.name, outline: rectAround(v.pos, view.m(0.7), view.m(0.7)), z0: 0, z1: view.m(v.height), owner: this, ref: v });
    }
    return out;
  }

  card(hit) {
    return { ...this.describeAgent(hit.ref), actions: [{ id: "follow", label: "Follow" }] };
  }

  /** What a visitor is doing, in words. */
  doing(v) {
    const t = v.task, name = (id) => this.world.getObject(id);
    const goodsOf = (id) => MARKET_GOODS[name(id)?.spec?.goods]?.name ?? "the stall";
    if (v.state === "coming") return v.origin.kind === "train" ? "On the way from the station to the market" : "On the way to the market";
    if (v.state === "going") return v.dest?.kind === "train" ? "On the way to the station" : "On the way home";
    if (v.state === "station") return "Waiting for a train home";
    if (v.state === "train") return "Getting off the train";
    if (v.state === "riding") return RIDING[name(v.ride)?.type] ?? "On a ride";
    if (!t) return "At the market";
    if (t.type === "queue") {
      const i = this._stall(t.stall).queue.indexOf(v);
      return i === 0 ? `Buying ${goodsOf(t.stall)}` : `Queueing for ${goodsOf(t.stall)} (${i + 1}.)`;
    }
    if (t.type === "ride") return RIDE_QUEUE[name(t.ride)?.type] ?? "Queueing for a ride";
    if (t.type === "stay") {
      if (t.what === "tree") return "Looking at the Christmas tree";
      const g = MARKET_GOODS[t.what];
      return g ? `${g.kind === "drink" ? "Drinking" : "Eating"} ${g.name}${v.table ? " at a standing table" : ""}` : "At the market";
    }
    if (t.type === "leave") return v.origin.kind === "train" ? "Leaving for the station" : "Leaving the market";
    return "At the market";
  }

  describeAgent(agent) {
    const v = this._ours(agent);
    if (!v) return null;
    const from = { home: v.origin.name ?? "the town", street: "beyond the layout", train: "by train" }[v.origin.kind];
    const rows = [["Came", formatTime(v.came)], ["From", from]];
    if (v.bought.length) rows.push(["Bought", v.bought.map((id) => MARKET_GOODS[id]?.name ?? id).join(" · ")], ["Spent", `${v.spent.toFixed(2)} €`]);
    if (v.rides) rows.push(["Rides", String(v.rides)]);
    if (v.plan.length) rows.push(["Still wants", v.plan.map((x) => ACTIVITY[x]).join(" · ")]);
    rows.push(...profileRows(v.profile, v.speed));
    if (v.mood < 0.8) rows.push(["Mood", `${Math.round(v.mood * 100)} %: the queues were long`]);
    return {
      title: v.name,
      subtitle: `Market visitor${v.profile.age === "child" ? " · child" : ""}`,
      status: this.doing(v),
      rows,
      related: [v.venue, v.task?.stall, v.task?.ride, v.ride, v.origin.building].filter((id) => id && this.world.getObject(id)),
    };
  }

  /** The queue, sales and takings of a stall; the queue and riders of a ride; the visitors of a square. */
  describeObject(o, card) {
    if (!this.enabled) return;
    if (o.type === "market-stall") {
      const s = this._stall(o.id), g = MARKET_GOODS[o.marketInfo()?.goods];
      const wait = s.waits.length ? s.waits.reduce((a, b) => a + b, 0) / s.waits.length : null;
      card.rows.push(["Queue now", `${s.queue.length} people`]);
      if (wait != null) card.rows.push(["Waiting time", `${Math.round(wait)} s on average`]);
      card.rows.push(["Sold today", `${s.sold} × ${g?.name ?? ""}`.trim()], ["Takings today", `${s.takings.toFixed(2)} €`]);
      return;
    }
    if (o instanceof Ride) {
      card.rows.push(["Queue now", `${this._rideQueue(o.id).length} people`]);
      return;
    }
    if (o.type === "market-square") {
      const here = this.visitors.filter((v) => v.venue === o.id && ["market", "riding"].includes(v.state)).length;
      const { open, close } = this.hours();
      card.rows.push(["Visitors now", String(here)], ["Opening hours", `${formatTime(open)}–${formatTime(close)}`]);
      const sold = Object.entries(this.today.sold).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (sold.length) card.sections = [...(card.sections || []), { title: "Sold today", lines: sold.map(([id, n]) => `${n} × ${MARKET_GOODS[id]?.name ?? id}`) }];
      card.rows.push(["Takings today", `${Math.round(this.today.takings)} €`]);
    }
  }

  /** The stalls by their queue, the visitors by their mood. */
  states() {
    if (!this.enabled) return [];
    const stalls = [];
    for (const venue of this._venues || []) {
      for (const o of venue.stalls) {
        const q = this._stall(o.id).queue.length;
        stalls.push({ name: o.spec.name || MARKET_GOODS[o.marketInfo().goods]?.name || o.id, score: clamp(1 - q / QUEUE_MAX, 0, 1), text: `queue ${q}`, key: `object:${o.id}` });
      }
    }
    const people = this.visitors.filter((v) => this._visible(v)).map((v) => ({ name: v.name, score: v.mood, text: `mood ${Math.round(v.mood * 100)} %`, key: `market:${v.id}` }));
    const out = [];
    if (stalls.length) out.push({ id: "market-stalls", label: "Market stalls", measure: "queue", items: stalls });
    if (people.length) out.push({ id: "market-visitors", label: "Market visitors", measure: "mood", items: people });
    return out;
  }

  /** Counts for a panel: visitors by what they do, sold today by goods, takings. */
  marketStats() {
    const out = { total: this.visitors.length, coming: 0, market: 0, queueing: 0, staying: 0, riding: 0, going: 0, station: 0 };
    for (const v of this.visitors) {
      if (v.state === "coming" || v.state === "train") out.coming++;
      else if (v.state === "going") out.going++;
      else if (v.state === "station") out.station++;
      else if (v.state === "riding") out.riding++;
      else {
        out.market++;
        if (v.task?.type === "queue" || v.task?.type === "ride") out.queueing++;
        else if (v.task?.type === "stay") out.staying++;
      }
    }
    return { ...out, open: this.isOpen(), sold: { ...this.today.sold }, takings: this.today.takings, came: { ...this.today.came }, left: { ...this.today.left }, rides: this.today.rides };
  }
}

