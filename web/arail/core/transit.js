/**
 * Bus and tram lines in operation (`world.transit`).
 *
 * For every bus line (objects/bus-line.js) and tram line (objects/tram.js) the transit finds the
 * route over the road network (core/network.js) through all its stops: a closed circuit of
 * **visits** (the stop docks in the order the vehicles serve them). A line that runs back and forth
 * serves its stops in order and then in reverse (for a stop on both sides of the street, the side
 * in the direction of travel); a loop runs round. Where a direction begins (the termini; the first
 * stop of a loop) vehicles lay over and are dispatched: every `headway_s` (outside the rush hours)
 * × `clock.demand("bus")`, none at night. A line without `headway_s` runs as often as the town
 * needs (`serviceInterval` of the town simulation, sims/town.js), else (without a town, or with
 * `services.auto_interval` false) every 240 s (trams 300 s).
 *
 * Buses drive along the circuit on the right lane, trams on their track (the right one of two),
 * with acceleration, braking and the speed limit of the street, keep their distance to the vehicle
 * ahead (other buses and trams, the cars and bikes of the simulations), obey traffic lights, Stop
 * and give way, wait at closed level crossings and (buses) at zebra crossings with people on them,
 * stop at each stop with the front at the end of the stop (`BUS.extent`, `TRAM.extent`, so the
 * doors are where the passenger simulation expects them) and emit the usual events with
 * `{vehicle, dock, area}`: `vehicle.arriving` (about 60 m before), `vehicle.arrived` (doors
 * open), `vehicle.departing` (doors close) and `vehicle.departed`. A tram enters a stretch of a
 * single track only when no tram comes the other way on it (and none at all where it turns at its
 * end). While a tram stands at a stop without an island (on the road, a raised road, a curb
 * extension), cars in the lane beside it wait: people cross it to get on and off (StVO § 20).
 *
 * For passengers and the town simulation: `lines`, `connections(fromAreaId, toAreaId)`,
 * `vehicleAt(dockId)`, `statusFor(dockId)` and `buses` (the vehicles of all lines, each with
 * `riders`, an array the town fills with the people on board).
 * @module arail/core/transit
 */
import { clamp, createRng, cross2, dist2, dot2, pointSegment, polylineAt, polylineProject, rectBetween, sub2, unit2 } from "./math.js";
import { driveS, joinPaths } from "./network.js";
import { TRAM_CURVES, roundCorners } from "./curves.js";
import { StopSignals } from "./stop-signals.js";
import { CD, PALETTE, grey, mix, shade } from "./colors.js";

const ACCEL = 1.0; // m/s²
const BRAKE = 1.3; // comfortable braking (m/s²)
const HARD = 3.5; // hardest braking (m/s²)
const GAP_M = 3; // distance kept to the vehicle ahead when standing (m)
const ARRIVING_M = 60; // vehicle.arriving this far before a stop (m)
const DEPARTED_M = 15; // vehicle.departed when the front is this far beyond the stop (m)
const DOORS_S = 2.5; // doors closing before the bus moves (s)
const SPAWN_M = 45; // new buses come in this far before their first stop (m)
const MIN_DWELL_S = 8;
const MISALIGNED_S = 300; // route cost of serving a stop against its direction (s)
const REVERSE_S = 20; // a tram at the end of a stub track: the driver changes ends (s)

/** The object types of lines and the vehicles they run. */
export const LINE_TYPES = { "bus-line": "bus", "tram-line": "tram" };

/** Ids of the lines that stop at an object (a bus stop or terminal, a tram stop), sorted. */
export function linesServing(world, objectId) {
  return world.objects
    .filter((o) => LINE_TYPES[o.constructor.type] && Array.isArray(o.spec.stops) && o.spec.stops.includes(objectId))
    .map((o) => o.id)
    .sort();
}

/** Small string hash for per-line random streams. */
function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const right = (d) => [d[1], -d[0]];

/**
 * How often a closed polyline turns round: +1 counter-clockwise, -1 clockwise (seen from above:
 * the layout's x to the right, y away from the viewer), 0 for a figure eight.
 * @param {number[][]} points
 */
export function turningNumber(points) {
  // without repeated points (a corner between two of them would not count) and the closing point
  const P = [];
  for (const p of points) if (!P.length || dist2(p, P[P.length - 1]) > 1e-6) P.push(p);
  if (P.length > 1 && dist2(P[0], P[P.length - 1]) <= 1e-6) P.pop();
  const n = P.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const u = sub2(P[i], P[(i - 1 + n) % n]), v = sub2(P[(i + 1) % n], P[i]);
    total += Math.atan2(cross2(u, v), dot2(u, v));
  }
  return Math.round(total / (2 * Math.PI)) || 0;
}

/**
 * Where the buses of a loop line go, as on their destination sign: "Ring ↻" (clockwise),
 * "Ring ↺" (counter-clockwise) or "Ring" (like the Berlin Ringbahn). Lines that run back and
 * forth go "to <terminus>".
 * @param {number} turns turning number of the route (see {@link turningNumber})
 */
export function ringName(turns) {
  return turns < 0 ? "Ring ↻" : turns > 0 ? "Ring ↺" : "Ring";
}

/** The words for the direction of a line: "to Bahnhof", or "Ring ↻" for a loop. */
export function towards(destination, loop) {
  return destination ? (loop ? destination : `to ${destination}`) : "";
}

/**
 * Faces of a box vehicle between its rear and front point (layout mm) on the ground.
 * @param {number[]} rear
 * @param {number[]} front
 * @param {number} width mm
 * @param {number} z0 bottom (mm)
 * @param {number} z1 top (mm)
 * @param {{side: string, top: string, end?: string, alpha?: number}} colours
 * @param {(face: object, P: Function, len: number, hw: number) => object[]} [decorate] decals per face
 *   (`face.side` = "left" | "right" | "front" | "back" | "top"); P(along, across, z) -> layout point,
 *   along from the rear (mm), across + = left (mm)
 */
export function boxFaces(rear, front, width, z0, z1, colours, decorate = null) {
  const len = Math.max(1e-6, dist2(rear, front));
  const u = unit2(sub2(front, rear)), n = [-u[1], u[0]], hw = width / 2;
  const P = (a, t, z) => [rear[0] + u[0] * a + n[0] * t, rear[1] + u[1] * a + n[1] * t, z];
  const alpha = colours.alpha ?? 1, end = colours.end || colours.side;
  const faces = [
    { side: "top", pts: [P(0, -hw, z1), P(len, -hw, z1), P(len, hw, z1), P(0, hw, z1)], normal: [0, 0, 1], color: colours.top, alpha },
    { side: "left", pts: [P(0, hw, z0), P(len, hw, z0), P(len, hw, z1), P(0, hw, z1)], normal: [n[0], n[1], 0], color: colours.side, alpha },
    { side: "right", pts: [P(len, -hw, z0), P(0, -hw, z0), P(0, -hw, z1), P(len, -hw, z1)], normal: [-n[0], -n[1], 0], color: colours.side, alpha },
    { side: "front", pts: [P(len, hw, z0), P(len, -hw, z0), P(len, -hw, z1), P(len, hw, z1)], normal: [u[0], u[1], 0], color: end, alpha },
    { side: "back", pts: [P(0, -hw, z0), P(0, hw, z0), P(0, hw, z1), P(0, -hw, z1)], normal: [-u[0], -u[1], 0], color: end, alpha },
  ];
  if (decorate) for (const f of faces) f.decals = decorate(f, P, len, hw);
  return faces;
}

/**
 * Road users (vehicles: {vehicle, front, rear, dir, approach}) in a grid, for the neighbours of a
 * point without looking at every vehicle.
 */
export class RoadUsers {
  /**
   * @param {object[]} users
   * @param {number} cell grid size (mm)
   */
  constructor(users, cell) {
    this.list = users;
    this.cell = cell;
    this.cells = new Map();
    this._query = 0;
    for (const u of users) {
      u._query = 0;
      const a = this._key(u.front), b = this._key(u.rear);
      this._add(a, u);
      if (b !== a) this._add(b, u);
    }
  }

  _key(p) {
    return `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
  }

  _add(key, u) {
    const c = this.cells.get(key);
    if (c) c.push(u);
    else this.cells.set(key, [u]);
  }

  /** Users with the front or rear within the square of half size r around p (and maybe a few more). */
  near(p, r) {
    const q = ++this._query, out = [];
    const x0 = Math.floor((p[0] - r) / this.cell), x1 = Math.floor((p[0] + r) / this.cell);
    const y0 = Math.floor((p[1] - r) / this.cell), y1 = Math.floor((p[1] + r) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) return this.list;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const u of this.cells.get(`${x},${y}`) || []) {
          if (u._query === q) continue;
          u._query = q;
          out.push(u);
        }
      }
    }
    return out;
  }
}

/** The road users near a point: all of a plain list, or the neighbours from a {@link RoadUsers} grid. */
function around(users, p, r) {
  return users instanceof RoadUsers ? users.near(p, r) : users;
}

/**
 * Distance (mm) from a vehicle's front to the rear of the nearest road user ahead in its lane
 * (same direction), or Infinity.
 * @param {object} self the vehicle itself (skipped)
 * @param {number[]} front
 * @param {number[]} dir unit direction of travel
 * @param {Array<{vehicle: object, rear: number[], dir: number[]}> | RoadUsers} users
 * @param {number} lookMM how far to look ahead
 * @param {number} laneMM half the width of the corridor
 * @param {Set<object> | null} [skip] vehicles to look past (one being overtaken)
 */
export function gapAhead(self, front, dir, users, lookMM, laneMM, skip = null) {
  return leaderAhead(self, front, dir, users, lookMM, laneMM, skip).gap;
}

/** The nearest road user ahead in a vehicle's lane: {gap (mm, or Infinity), user (or null)}; see gapAhead. */
export function leaderAhead(self, front, dir, users, lookMM, laneMM, skip = null) {
  let best = Infinity, who = null;
  for (const o of around(users, front, lookMM + laneMM)) {
    if (o.vehicle === self || o.vehicle.owner === self || skip?.has(o.vehicle)) continue;
    // traffic lights at tram stops hold everybody but trams (at amber those who can still stop)
    if (o.vehicle.obeys && !o.vehicle.obeys(self, front)) continue;
    const d = sub2(o.rear, front);
    const along = dot2(d, dir);
    if (along < -laneMM && best > 0 && dot2(o.dir, dir) >= 0.3) {
      // side by side in the lane (e.g. both turned into it at a junction): the one behind waits;
      // "behind" along both directions, so that two vehicles in different directions do not both wait
      const f = sub2(o.front, front);
      if (dot2(f, [dir[0] + o.dir[0], dir[1] + o.dir[1]]) > 0 && Math.abs(cross2(dir, f)) <= laneMM) {
        best = 0;
        who = o;
      }
      continue;
    }
    if (along < -laneMM || along > lookMM || along >= best) continue;
    if (Math.abs(cross2(dir, d)) > laneMM) continue;
    if (dot2(o.dir, dir) < 0.3) continue;
    // level with or behind this one (two vehicles on one spot would wait for each other for good)
    if (along <= 0 && dot2(sub2(o.front, front), dir) <= 0) continue;
    best = Math.max(0, along);
    who = o;
  }
  return { gap: best, user: who };
}

/** How long (s) vehicles stand in a circle of vehicles that wait for each other before they squeeze past. */
export const GRIDLOCK_S = 8;
/** How long (s) a vehicle squeezes past (it does not wait for the vehicle ahead then). */
const SQUEEZE_S = 4;

/**
 * Who a vehicle waits for, and gridlocks: vehicles that wait for each other in a circle (two that
 * turned into each other's way in a junction, a car and a tram nose to nose) squeeze past each
 * other after GRIDLOCK_S, so that the traffic never stops for good. Call it each step with the
 * road user ahead (`leaderAhead`, or null while the vehicle squeezes past, see `squeezing`).
 * @param {{v: number, leader?: object | null, circled?: number, squeeze?: number}} self the vehicle (car, bike, bus, tram)
 * @param {{vehicle: object} | null} user the road user ahead
 * @param {number} dt simulated seconds
 */
export function waitFor(self, user, dt) {
  if (self.squeeze > 0) self.squeeze -= dt;
  self.leader = user && self.v < 0.2 ? user.vehicle : null;
  let x = self.leader, circle = false;
  for (let k = 0; k < 16 && x; k++) {
    if (x === self) {
      circle = true;
      break;
    }
    x = x.leader;
  }
  self.circled = circle ? (self.circled || 0) + dt : 0;
  if (self.circled > GRIDLOCK_S) {
    self.squeeze = SQUEEZE_S;
    self.circled = 0;
    self.leader = null;
  }
}

/**
 * Is there room behind a junction for a vehicle of `lengthMM` (StVO § 11: nobody drives into a
 * junction where they would have to stop in it)? `exit` is where the vehicle leaves the junction,
 * `dir` its direction there; a road user standing (or crawling) closer than the vehicle's length
 * plus the gap leaves no room.
 */
export function roomAfter(self, exit, dir, users, lengthMM, laneMM) {
  const { gap, user } = leaderAhead(self, exit, dir, users, lengthMM, laneMM);
  return !user || gap >= lengthMM || (user.speed ?? user.vehicle?.v ?? 0) > 1;
}

/** Does a vehicle squeeze past the others now (see waitFor)? */
export function squeezing(self) {
  return self.squeeze > 0;
}

/**
 * Must a vehicle wait before a junction? Yes while another vehicle is in it, or another one is
 * about to enter with priority over it (`approach.prio`: 2 green light or priority road, 1 none,
 * 0 give way or Stop), or with the same priority and closer to it (first come, first served).
 * @param {object} self
 * @param {{key: string, pos: number[], r: number}} j the junction
 * @param {number} d distance (mm) of the vehicle's front from the junction centre
 * @param {Array<{vehicle: object, front: number[], rear: number[], approach?: {key: string, d: number, prio?: number}}> | RoadUsers} users
 * @param {number} [prio] the vehicle's own priority (1: none)
 */
export function mustYield(self, j, d, users, prio = 1) {
  for (const u of around(users, j.pos, Math.max(j.r, APPROACH_MM_MAX))) {
    if (u.vehicle === self) continue;
    const mid = [(u.front[0] + u.rear[0]) / 2, (u.front[1] + u.rear[1]) / 2];
    if (dist2(u.front, j.pos) < j.r || dist2(u.rear, j.pos) < j.r || dist2(mid, j.pos) < j.r) {
      if (u.vehicle.phase === "block") continue;
      return true;
    }
    const a = u.approach;
    if (!a || a.key !== j.key) continue;
    const p = a.prio ?? 1;
    if (p > prio) return true;
    if (p === prio && (a.d < d || (a.d === d && firstOf(u.vehicle, self)))) return true;
  }
  return false;
}

/** Who goes first of two road users as close to a junction: trams, buses, cars, bikes, then the one that came first. */
const RANK = { tram: 0, bus: 1, car: 2, bike: 3, scooter: 3 };

/**
 * Does road user a go before b? By kind, then by `seq` (the order in which its simulation made it),
 * not by its id: ids are numbered program-wide, and the same seed has to give the same simulation.
 */
function firstOf(a, b) {
  const ra = RANK[a.kind] ?? 4, rb = RANK[b.kind] ?? 4;
  return ra !== rb ? ra < rb : (a.seq ?? 0) < (b.seq ?? 0);
}

/** The light for a junction's approach at simulated time t: "green" where there are no traffic lights. */
export function lightAt(j, t) {
  return j?.signal?.obj?.state?.(j.signal.group, t) ?? "green";
}

/** The priority of a vehicle approaching a junction: 2 green light or priority road, 1 none, 0 red, give way or Stop. */
export function approachPrio(j, t) {
  if (j.signal) return lightAt(j, t) === "green" ? 2 : 0;
  return j.rule?.giveWay ? 0 : j.prio ?? 1;
}

/** How long (s) a vehicle waits before a junction at most, by its priority: then it goes, so nothing gets stuck for good. */
export function junctionPatience(prio) {
  return prio === 0 ? 30 : JUNCTION_WAIT_S;
}

/** Longest wait before a junction (s): then a vehicle goes anyway, so nothing gets stuck. */
export const JUNCTION_WAIT_S = 4;

/** Vehicles announce the junction they approach from this distance (m)... */
export const APPROACH_M = 40;
/** ...which is at most this many mm in the smallest scale (Z, 1:220) used for neighbour queries. */
const APPROACH_MM_MAX = (APPROACH_M * 1000) / 22;

let nextBusId = 1;

/** A bus or tram of a line (compatible with the timetable `Vehicle` where passengers need it). */
export class LineBus {
  constructor(line, s, next) {
    this.id = `${line.vehicle || "bus"}${nextBusId++}`;
    /** "bus" or "tram". */
    this.kind = line.vehicle || "bus";
    this.source = "line";
    this.lineId = line.id;
    /** Line label, e.g. "62". */
    this.line = line.label;
    this.colour = line.color;
    /** +1 or -1 (back and forth), +1 on a loop. */
    this.direction = 1;
    /** Name of the terminus. */
    this.destination = "";
    /** People on board (filled by the town simulation): [{agent, toDockId}]. */
    this.riders = [];
    /** The current or last stop dock. */
    this.dock = null;
    /** "driving" | "arriving" | "dwelling" | "departing" */
    this.phase = "driving";
    /** Front of the bus: arc length on the line's circuit (mm). */
    this.s = s;
    /** Speed (m/s). */
    this.v = 0;
    /** Index of the next visit (or of the stop it stands at). */
    this.next = next;
    this.dwellLeft = 0;
    this.doorsLeft = 0;
    this.delayMin = 0;
    this.trainId = null;
    /** Laying over at a terminus until a departure is due. */
    this.waiting = false;
    this.waited = 0;
    /** Takes the next departure at its terminus. */
    this.due = false;
    /** At the end of its last trip: people get off, nobody gets on, then it goes to the depot. */
    this.outOfService = false;
    this._arrivingSent = false;
    this._leaving = null;
  }

  get doorsOpen() {
    return this.phase === "dwelling";
  }

  /** Dwell time left (passengers board while it is more than a few seconds). */
  get dwellRemaining() {
    return this.waiting ? Infinity : this.dwellLeft;
  }
}

export class Transit {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** @type {Map<string, object>} line id -> line in operation */
    this.lines = new Map();
    /** @type {LineBus[]} */
    this.buses = [];
    this._key = null;
    this._users = [];
    /** Buses and trams made so far (their `seq`). */
    this._seq = 0;
    /** The traffic lights of the tram stops in the middle of the street (core/stop-signals.js). */
    this.signals = new StopSignals(world);
    // the clock was set (e.g. from night to day): lines without buses get them at once
    world.events.on("clock.set", () => {
      for (const line of this.lines.values()) if (line.ok && !this.buses.some((b) => b.lineId === line.id)) this._populate(line);
    });
  }

  /** Forget all lines and buses (a new layout). */
  reset() {
    this.lines = new Map();
    this.buses = [];
    this._key = null;
    this._deep = null;
    this._users = [];
    this.signals = new StopSignals(this.world);
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

  /* ---------------------------------------------------------------- lines */

  /** Rebuild the lines when objects, the marker map or the scale changed (buses keep running). */
  sync() {
    const w = this.world;
    const key = `${w.objectsVersion}:${w.map.version}:${w.scale}`;
    if (key === this._key) return;
    this._key = key;
    let net = null;
    try {
      net = w.network();
    } catch (err) {
      console.error("road network", err);
    }
    // only a change of the streets, stops or lines changes the lines (not, say, a house moved)
    const lineObjects = w.objects.filter((o) => LINE_TYPES[o.constructor.type]);
    const stops = new Set(lineObjects.flatMap((o) => (Array.isArray(o.spec.stops) ? o.spec.stops : [])));
    const deep = [net?.carKey ?? "", JSON.stringify(w.layout.services), ...lineObjects.map((o) => JSON.stringify(o.spec)),
      ...[...stops].map((id) => JSON.stringify(w.getObject(id)?.spec ?? null))].join("|");
    if (deep === this._deep) {
      this._refreshDocks();
      return;
    }
    this._deep = deep;
    const old = this.lines;
    this.lines = new Map();
    for (const o of w.objects) {
      if (!LINE_TYPES[o.constructor.type] || !o.geometry) continue;
      this.lines.set(o.id, this._buildLine(o, net, old.get(o.id)));
    }
    const keep = [], moved = new Set();
    for (const bus of this.buses) {
      const line = this.lines.get(bus.lineId);
      if (!line?.ok) {
        this._drop(bus);
        continue;
      }
      bus.line = line.label;
      bus.colour = line.color;
      const before = old.get(bus.lineId);
      if (before?.signature !== line.signature) {
        this._reattach(bus, line, before);
        moved.add(bus);
      }
      keep.push(bus);
    }
    // a bus put back where another one is already (both were on a part of the route that was taken
    // away) would drive through it for good: it goes to the depot instead
    const placed = keep.filter((b) => !moved.has(b));
    this.buses = keep.filter((bus) => {
      if (!moved.has(bus)) return true;
      const me = this._pose(bus, this.lines.get(bus.lineId));
      if (placed.some((o) => o._pose && onTop(me, o._pose, this.mm(1.5)))) {
        this._drop(bus);
        return false;
      }
      placed.push(bus);
      return true;
    });
    for (const line of this.lines.values()) if (line.ok && !old.get(line.id)?.ok) this._populate(line);
  }

  /** The stop areas were recomputed (same geometry): use the current dock objects. */
  _refreshDocks() {
    const docks = new Map();
    for (const a of this.world.stopAreas()) for (const d of a.docks) docks.set(d.id, d);
    for (const line of this.lines.values()) {
      for (const v of line.visits) {
        const d = docks.get(v.dockId);
        if (d) {
          v.dock = d;
          v.area = d.area;
        }
      }
    }
    for (const bus of this.buses) {
      if (bus.dock) bus.dock = docks.get(bus.dock.id) || bus.dock;
      if (bus._leaving) bus._leaving.dock = docks.get(bus._leaving.dock.id) || bus._leaving.dock;
    }
  }

  /** The stop docks of an object a line can use (a terminal: the line's bay), for its vehicles ("bus" or "tram"). */
  _docksFor(o, lineId, net, vehicle = "bus") {
    const areas = this.world.stopAreas().filter((a) => a.owner === o && a.kind === vehicle);
    let docks = areas.flatMap((a) => a.docks.filter((d) => d.kind === vehicle));
    if (typeof o.busLane === "function" && docks.length) {
      const i = Math.max(0, linesServing(this.world, o.id).indexOf(lineId));
      docks = [docks[i % docks.length]];
    }
    return docks.map((dock) => ({ dock, at: net?.dock(dock.id) })).filter((c) => c.at);
  }

  _buildLine(obj, net, old) {
    const spec = obj.spec;
    const vehicle = LINE_TYPES[obj.constructor.type] || "bus", tram = vehicle === "tram";
    const line = {
      id: obj.id, obj, label: obj.lineLabel?.() ?? obj.id, name: obj.name, color: spec.color || CD.tuerkis,
      headway: +spec.headway_s > 0 ? Math.max(10, +spec.headway_s) : tram ? 300 : 240, auto: !(+spec.headway_s > 0) && this.world.layout?.services?.auto_interval !== false, mode: spec.mode === "loop" ? "loop" : "back-and-forth",
      speed: Math.max(2, (+spec.speed_kmh || (tram ? 50 : 40)) / 3.6),
      vehicle, noun: tram ? "Tram" : "Bus", length: tram ? clamp(+spec.length_m || 30, 15, 60) : 12, width: tram ? 2.65 : 2.55,
      ok: false, problems: [], visits: [], directions: [], circuit: null, signature: "", starts: [], single: [], crossings: [],
    };
    const where = tram ? "the tram tracks" : "the streets";
    const stops = [];
    for (const id of Array.isArray(spec.stops) ? spec.stops : []) {
      const o = this.world.getObject(id);
      if (!o) {
        line.problems.push(`Stop "${id}" does not exist any more.`);
        continue;
      }
      if (!o.geometry) {
        line.problems.push(`${o.name} is not placed.`);
        continue;
      }
      const docks = this._docksFor(o, obj.id, net, vehicle);
      if (!docks.length) {
        const own = this.world.stopAreas().some((area) => area.owner === o && area.kind === vehicle);
        if (tram) line.problems.push(own ? `${o.name} is not on a tram track.` : `${o.name} is not a tram stop.`);
        else line.problems.push(own ? `${o.name} is not connected to a street.` : o.type === "bus-stop" ? `${o.name} is not next to a street.` : `${o.name} is not a bus stop.`);
        continue;
      }
      if (stops.length && stops[stops.length - 1].o === o) continue;
      stops.push({ o, docks });
    }
    if (line.mode === "loop" && stops.length > 2 && stops[stops.length - 1].o === stops[0].o) stops.pop();
    if (stops.length < 2) {
      line.problems.push(tram ? "A tram line needs at least two tram stops on tracks." : "A bus line needs at least two stops next to streets.");
      return line;
    }
    // the stops in the order they are served, with the direction of travel
    const n = stops.length;
    const seq = stops.map((st, i) => ({ st, dir: 1, i }));
    if (line.mode !== "loop") for (let i = n - 1; i >= 0; i--) seq.push({ st: stops[i], dir: -1, i });
    const pos = (st) => st.o.anchorPoint() || st.docks[0].at.pose.front;
    const hint = (v) => {
      const here = pos(v.st);
      let next = v.dir > 0 ? stops[v.i + 1] : stops[v.i - 1];
      if (line.mode === "loop") next = stops[(v.i + 1) % n];
      if (next) return unit2(sub2(pos(next), here));
      const prev = v.dir > 0 ? stops[v.i - 1] : stops[v.i + 1];
      return prev ? unit2(sub2(here, pos(prev))) : null;
    };
    const route = (a, b) => net.routeDirected(a.at.node, a.at.dir, b.at.node, b.at.dir, { mode: vehicle });
    // choose a dock per visit (the side in the direction of travel); skip stops that buses
    // could only reach by turning around twice (a stop on the other side of the street)
    const chosen = [];
    let prev = null, dir = 0, starting = false;
    seq.forEach((v, k) => {
      // the first stop served in a direction begins it (buses lay over there)
      if (v.dir !== dir) {
        dir = v.dir;
        starting = true;
      }
      const h = hint(v);
      let best = null;
      for (const c of v.st.docks) {
        let cost = 0;
        if (prev && c.dock === prev.dock) cost = 0;
        else if (prev) {
          const r = route(prev, c);
          if (!r || r.uturns >= 2) continue;
          cost = r.cost;
        } else {
          const next = seq[k + 1];
          const costs = (next?.st.docks || []).map((d) => route(c, d)).filter((r) => r && r.uturns < 2).map((r) => r.cost);
          cost = costs.length ? Math.min(...costs) : 0;
        }
        if (h) cost += MISALIGNED_S * Math.max(0, -dot2(c.at.dir, h));
        if (!best || cost < best.cost) best = { c, cost };
      }
      if (!best) {
        const towards = v.dir > 0 ? stops[n - 1].o.name : stops[0].o.name;
        const them = tram ? "trams" : "buses";
        // trams kept off by a railway crossed at street level (BOStrab § 15) are told so
        const level = tram && net.edges.some((e) => e.tramBlocked) ? ": trams cannot cross the railway at street level" : "";
        line.problems.push(v.st.docks.length > 1
          ? `${v.st.o.name}: ${them} towards ${towards} cannot get there along ${where}${level}.`
          : `${v.st.o.name}: ${them} towards ${towards} cannot stop here (stop on one side only; set Side to both sides).`);
        return;
      }
      if (prev && best.c.dock === prev.dock) {
        // the terminus: the same dock ends one direction and begins the next
        const last = chosen[chosen.length - 1];
        last.dir = v.dir;
        last.start ||= starting;
        starting = false;
        return;
      }
      chosen.push({ o: v.st.o, dock: best.c.dock, at: best.c.at, dir: v.dir, start: starting });
      starting = false;
      prev = best.c;
    });
    if (chosen.length > 1 && chosen[chosen.length - 1].dock === chosen[0].dock) chosen.pop();
    if (chosen.length < 2) {
      line.problems.push(tram ? "The trams cannot serve two different stops." : "The buses cannot serve two different stops.");
      return line;
    }
    if (!chosen.some((v) => v.start)) chosen[0].start = true;
    // routes between the visits (closed circuit)
    const legs = [];
    for (let k = 0; k < chosen.length; k++) {
      const a = chosen[k], b = chosen[(k + 1) % chosen.length];
      const r = net.routeDirected(a.at.node, a.at.dir, b.at.node, b.at.dir, { mode: vehicle });
      if (!r) {
        const level = tram && net.edges.some((e) => e.tramBlocked);
        line.problems.push(level ? `No way along the tram tracks from ${a.o.name} to ${b.o.name}: trams cannot cross the railway at street level.` : `No way along ${where} from ${a.o.name} to ${b.o.name}.`);
        return line;
      }
      legs.push(r);
    }
    const path = joinPaths(legs);
    const busLen = this.mm(line.length);
    const pulls = [];
    let s = 0;
    chosen.forEach((v, k) => {
      const node = v.at.node.pos, F = v.at.pose.front;
      const offset = dot2(sub2(F, node), right(v.at.dir));
      pulls.push({ s, offset, before: busLen + this.mm(3), after: this.mm(1), at: F });
      s += legs[k].length;
    });
    pulls.push({ ...pulls[0], s: path.length, after: 0 });
    // buses pull in at their stops; trams stay on their track, which bends in arcs (core/curves.js)
    let drive = tram
      ? net.drivingLine(path, { pulls: pulls.map((p) => ({ ...p, offset: net.offsetAt(path, Math.min(p.s, path.length - 1e-6), "tramOffset") })), offsetKey: "tramOffset", minLoop: 0 })
      : net.drivingLine(path, { pulls });
    if (!(drive.length > this.mm(5))) {
      line.problems.push("The route is too short.");
      return line;
    }
    line.curves = [];
    if (tram) {
      drive = roundCorners(drive, this.mm(TRAM_CURVES.min_m), { metre: this.mm(1) });
      line.curves = drive.curves.map((c) => ({ ...c, v: Math.sqrt(TRAM_CURVES.lateral * this.meters(c.radius)) }));
      // one problem for each place, with its tightest curve
      const tight = new Map();
      for (const t of drive.tight) {
        const at = this._streetsAt(t.pos, net);
        tight.set(at, Math.min(tight.get(at) ?? Infinity, t.radius));
      }
      for (const [at, r] of tight) line.problems.push(`A curve of ${Math.round(this.meters(r))} m at ${at}: tram tracks need at least ${TRAM_CURVES.min_m} m. Give them more room there.`);
    }
    line.circuit = { points: drive.points, lengths: drive.lengths, length: drive.length, speeds: drive.speeds };
    line.turns = turningNumber(drive.points);
    line.junctions = net.junctionsAlong(path, drive);
    // zebra crossings (trams need not give way there, StVO § 26) and level crossings on the way
    line.crossings = net.crossingsAlong(path, drive).filter((c) => !tram || c.kind !== "zebra");
    if (tram) line.single = singleTrack(path, drive, chosen.length > 1 ? line.mode : "loop");
    // where trams change ends (the end of a stub track): they stop there and go back on the other track
    line.reversals = tram ? reversals(path, drive) : [];
    line.visits = chosen.map((v, k) => ({
      index: k, objectId: v.o.id, name: v.o.name, area: v.dock.area, areaId: v.dock.area.id, dock: v.dock, dockId: v.dock.id,
      dir: v.dir, start: !!v.start, s: k === 0 ? 0 : drive.marks[k], front: v.at.pose.front,
    }));
    // directions: from one start (terminus) to the next
    const V = line.visits, starts = V.filter((v) => v.start).map((v) => v.index);
    starts.forEach((i, g) => {
      const j = starts[(g + 1) % starts.length];
      const stopsOf = [];
      for (let k = i; ; k = (k + 1) % V.length) {
        stopsOf.push(k);
        if ((k + 1) % V.length === j) break;
      }
      const dest = V[j];
      const from = V[i].s, to = j === i ? from + drive.length : dest.s + (dest.s <= from ? drive.length : 0);
      // a loop ends where it began: its buses go round the ring, clockwise or counter-clockwise
      const loop = j === i;
      const destination = loop ? ringName(line.turns) : dest.name;
      for (const k of stopsOf) {
        V[k].destination = destination;
        V[k].loop = loop;
        // buses only arrive here (they leave from the other side of the street)
        V[k].terminus = !V[k].start && dest.name === V[k].name;
      }
      line.directions.push({
        dir: V[i].dir, from: V[i].name, destination, loop,
        stops: [...stopsOf, j].map((k) => ({ objectId: V[k].objectId, areaId: V[k].areaId, dockId: V[k].dockId, name: V[k].name, s: V[k].s })),
        route: this._slice(line.circuit, from, to),
      });
    });
    line.signature = `${V.map((v) => v.dockId).join(",")}|${Math.round(drive.length)}`;
    // departures from each start; timers carry over when the line did not change there
    const rng = createRng(hash(`${this.world.seed}:${obj.id}`));
    line.starts = starts.map((i) => {
      const kept = old?.starts?.find((st) => old.visits[st.index]?.dockId === V[i].dockId);
      return { index: i, timer: kept ? kept.timer : line.headway * rng.uniform(0.1, 0.6), pending: 0 };
    });
    line.ok = true;
    return line;
  }

  /** The names of the streets at a point (a junction: both), for the problems of a line. */
  _streetsAt(p, net) {
    const names = [];
    for (const e of net.edges) {
      if (!e.road || !e.points?.length) continue;
      const pr = polylineProject(e.points, p, e.lengths);
      const name = this.world.getObject(e.road)?.name;
      if (name && pr.distance <= this.mm(25) && !names.includes(name)) names.push(name);
    }
    return names.length ? names.join(" / ") : `${Math.round(p[0])}, ${Math.round(p[1])}`;
  }

  /** Part of a circuit between two arc lengths (to may exceed the length: it wraps). */
  _slice(c, from, to) {
    const pts = [polylineAt(c.points, from, c.lengths).point];
    const L = c.length;
    for (let lap = 0; lap < 2; lap++) {
      for (let i = 0; i < c.points.length; i++) {
        const s = c.lengths[i] + lap * L;
        if (s > from && s < to) pts.push(c.points[i]);
      }
    }
    pts.push(polylineAt(c.points, to % L || (to > from ? L : 0), c.lengths).point);
    let len = 0;
    const lengths = [0];
    for (let i = 1; i < pts.length; i++) lengths.push((len += dist2(pts[i - 1], pts[i])));
    return { points: pts, lengths, length: len };
  }

  /** Forward distance (mm) along a circuit from a to b. */
  _ahead(line, a, b) {
    const L = line.circuit.length;
    return (((b - a) % L) + L) % L;
  }

  /** Index of the first visit at or after arc length s. */
  _nextVisit(line, s) {
    let best = 0, bd = Infinity;
    for (const v of line.visits) {
      const d = this._ahead(line, s, v.s);
      if (d < bd) {
        bd = d;
        best = v.index;
      }
    }
    return best;
  }

  /** Put buses along a new line as if it had been running for a while. */
  _populate(line) {
    const tod = this.world.clock.demand("bus");
    if (!(tod > 0)) return;
    const L = line.circuit.length;
    const n = Math.min(12, Math.floor(this._cycle(line) / (line.headway / tod)));
    const rng = createRng(hash(`${this.world.seed}:${line.id}:populate`));
    const offset = rng.uniform(0.2, 0.8), placed = [];
    for (let k = 0; k < n; k++) {
      let s = ((k + offset) * L) / n;
      // not across the end of a stub track: beyond it, with the other end leading
      for (const r of line.reversals || []) if (this._ahead(line, r.s0, s) < r.s1 - r.s0 + this.mm(line.length)) s = (r.s1 + this.mm(line.length)) % L;
      const next = this._nextVisit(line, s);
      if (this._ahead(line, s, line.visits[next].s) < this.mm(20)) continue;
      // not on a single track that a tram put there before uses the other way
      const on = (line.single || []).filter((iv) => this._ahead(line, iv.s0, s) <= iv.s1 - iv.s0 + this.mm(line.length));
      if (on.some((iv) => placed.some((o) => o.key === iv.key && (iv.dir === 0 || o.dir === 0 || o.dir === -iv.dir)))) continue;
      placed.push(...on);
      const bus = new LineBus(line, s, next);
      bus.seq = ++this._seq;
      this._setDirection(bus, line, next);
      bus.v = line.speed * 0.6;
      this.buses.push(bus);
    }
  }

  /** Expected time (simulated s) for one round of a line, with the stops. */
  _cycle(line) {
    const dwell = line.visits.reduce((s, v) => s + Math.max(MIN_DWELL_S, v.dock.dwell), 0);
    return this.meters(line.circuit.length) / (0.7 * line.speed) + dwell;
  }

  /**
   * Buses a line needs now: one per departure during a round, and one to spare; none at night.
   * More buses than that (after the rush hour) go to the depot at the end of their trip.
   */
  _needed(line) {
    const tod = this.world.clock.demand("bus");
    if (!(tod > 0)) return 0;
    return Math.ceil(this._cycle(line) / (line.headway / tod)) + 1;
  }

  /** Direction and destination of a bus on its way to visit `next`. */
  _setDirection(bus, line, next) {
    const V = line.visits;
    // the visit it last passed decides (a start visit begins a new direction)
    const prev = V[(next - 1 + V.length) % V.length];
    bus.direction = prev.dir;
    bus.destination = prev.destination || V[next].destination || "";
  }

  /** The line changed: put the bus on the new circuit near where it was. */
  _reattach(bus, line, before) {
    let front = null;
    if (before?.circuit) front = polylineAt(before.circuit.points, bus.s, before.circuit.lengths).point;
    const atStop = bus.phase === "dwelling" || (bus.phase === "departing" && bus.doorsLeft > 0) ? bus.dock : null;
    const visit = atStop ? line.visits.find((v) => v.dockId === atStop.id) : null;
    bus.kind = line.vehicle;
    if (visit) {
      bus.s = visit.s;
      bus.next = visit.index;
      bus.dock = visit.dock;
      return;
    }
    // (closing the doors, it has said vehicle.departing already)
    if (atStop && bus.phase === "dwelling") this._emit("vehicle.departing", bus, atStop);
    if (bus._leaving || atStop) this._emit("vehicle.departed", bus, bus._leaving?.dock || atStop);
    bus._leaving = null;
    bus.s = front ? polylineProject(line.circuit.points, front, line.circuit.lengths).s : 0;
    bus.next = this._nextVisit(line, bus.s);
    bus.phase = "driving";
    bus.waiting = false;
    bus._arrivingSent = false;
    this._setDirection(bus, line, bus.next);
  }

  /** Take a bus out of service (it goes to the depot). */
  _drop(bus) {
    // its last events say so: it leaves for the depot, not in service
    bus.outOfService = true;
    if (bus.phase === "dwelling" || (bus.phase === "departing" && bus.doorsLeft > 0)) {
      if (bus.phase === "dwelling") this._emit("vehicle.departing", bus, bus.dock);
      this._emit("vehicle.departed", bus, bus.dock);
    } else if (bus._leaving) this._emit("vehicle.departed", bus, bus._leaving.dock);
    bus.riders.length = 0;
    bus.phase = "gone";
  }

  _emit(name, vehicle, dock) {
    if (dock) this.world.events.emit(name, { vehicle, dock, area: dock.area });
  }

  /* ---------------------------------------------------------------- queries */

  /** The line bus standing at (or arriving at) a dock, or null. */
  vehicleAt(dockId) {
    let arriving = null;
    for (const bus of this.buses) {
      if (bus.outOfService) continue;
      if ((bus.phase === "dwelling" || (bus.phase === "departing" && bus.doorsLeft > 0)) && bus.dock?.id === dockId) return bus;
      if (bus.phase === "arriving" && this.lines.get(bus.lineId)?.visits[bus.next]?.dockId === dockId) arriving = bus;
    }
    return arriving;
  }

  /**
   * Bus connections from one stop area to another: the lines and directions that serve both, in
   * this order (without passing a terminus where buses lay over).
   * @returns {Array<{lineId: string, dir: number, fromDockId: string, toDockId: string, stops: number, rideMM: number}>}
   */
  connections(fromAreaId, toAreaId) {
    this.sync();
    const out = [];
    for (const line of this.lines.values()) {
      if (!line.ok) continue;
      const V = line.visits, n = V.length;
      for (const from of V) {
        if (from.areaId !== fromAreaId) continue;
        for (let k = 1; k < n; k++) {
          const to = V[(from.index + k) % n];
          if (to.areaId === toAreaId) {
            out.push({ lineId: line.id, dir: from.dir, fromDockId: from.dockId, toDockId: to.dockId, stops: k, rideMM: this._ahead(line, from.s, to.s) });
            break;
          }
          if (to.start) break;
        }
      }
    }
    return out.sort((a, b) => a.rideMM - b.rideMM);
  }

  /** Expected time (simulated s) until a bus of a line is at a visit. */
  _eta(line, visit) {
    const tod = this.world.clock.demand("bus");
    const avg = 0.7 * line.speed, V = line.visits;
    const travel = (from, to) => {
      // driving time and stops between two arc lengths
      const d = this._ahead(line, from, to);
      let stops = 0;
      for (const v of V) {
        const x = this._ahead(line, from, v.s);
        if (x > 1 && x < d - 1) stops++;
      }
      return { time: this.meters(d) / avg + stops * Math.max(MIN_DWELL_S, visit.dock.dwell), passesStart: V.some((v) => v.start && v !== visit && this._ahead(line, from, v.s) < d - 1) };
    };
    let best = Infinity;
    for (const bus of this.buses) {
      if (bus.lineId !== line.id || bus.outOfService) continue;
      const t = travel(bus.s, visit.s);
      if (!t.passesStart) best = Math.min(best, t.time + (bus.phase === "dwelling" ? Math.min(bus.dwellRemaining, line.headway) : 0));
    }
    // the next departure from the terminus before this stop
    let start = null;
    for (const st of line.starts) {
      const v = V[st.index], d = this._ahead(line, v.s, visit.s);
      if (!start || d < start.d) start = { st, d, v };
    }
    if (start && tod >= 0.05) best = Math.min(best, Math.max(0, start.st.timer) / tod + travel(start.v.s, visit.s).time);
    return best;
  }

  /**
   * Status text for a stop dock served by bus lines: the next bus, e.g. "Bus 62 to Station in 3 min",
   * "Bus 85 Ring ↻ boarding" (a loop line, clockwise), "Bus 62 arrives in 2 min (terminus)" or
   * "Bus 62: no buses at night".
   */
  statusFor(dockId) {
    this.sync();
    // hardly any service: as good as none (the first buses of the morning are not announced)
    const tod = this.world.clock.demand("bus") >= 0.05 ? this.world.clock.demand("bus") : 0;
    let best = null;
    for (const line of this.lines.values()) {
      const visit = line.visits.find((v) => v.dockId === dockId);
      if (!visit) continue;
      const name = `${line.noun} ${line.label}`, to = visit.destination && !visit.terminus ? ` ${towards(visit.destination, visit.loop)}` : "";
      const bus = this.vehicleAt(dockId);
      if (bus && bus.lineId === line.id) {
        if (visit.terminus) return `${name} ${bus.phase === "arriving" ? "arriving" : "arrived"} (terminus)`;
        const what = bus.phase === "arriving" ? "arriving" : bus.waiting ? "waiting" : bus.phase === "dwelling" ? "boarding" : "departing";
        return `${name}${to} ${what}`;
      }
      if (!line.ok) continue;
      const eta = this._eta(line, visit);
      // in clock minutes (the time people see)
      const min = Math.max(1, Math.ceil((eta * this.world.clock.factor) / 60));
      const text = !Number.isFinite(eta)
        ? tod > 0 ? `${name}${to}` : `${name}: ${line.vehicle === "tram" ? "no trams at night" : "no buses at night"}`
        : visit.terminus ? `${name} arrives in ${min} min (terminus)` : `${name}${to} in ${min} min`;
      if (!best || eta < best.eta) best = { eta, text };
    }
    return best?.text ?? "";
  }

  /** Buses (and the vehicles of simulations with `roadUsers()`) on the road: front, rear, direction. */
  roadUsers() {
    return this._users;
  }

  /* ---------------------------------------------------------------- simulation */

  _pose(bus, line) {
    const c = line.circuit, L = c.length;
    const front = polylineAt(c.points, ((bus.s % L) + L) % L, c.lengths).point;
    const rear = polylineAt(c.points, (((bus.s - this.mm(line.length)) % L) + L) % L, c.lengths).point;
    const d = sub2(front, rear);
    const j = this._nextJunction(bus, line);
    const approach = j && j.d > j.r && j.d < this.mm(APPROACH_M) ? { key: j.key, d: j.d, prio: approachPrio(j, this.world.time) } : null;
    const pose = { vehicle: bus, front, rear, dir: Math.hypot(d[0], d[1]) > 1e-6 ? unit2(d) : [1, 0], speed: bus.v, approach };
    bus._pose = pose;
    return pose;
  }

  /** The next junction on the circuit that the bus has not left yet, with the distance `d` (mm) of its centre. */
  _nextJunction(bus, line) {
    let best = null, bd = Infinity;
    for (const j of line.junctions || []) {
      const x = this._ahead(line, bus.s, j.s + j.r);
      if (x < bd) {
        bd = x;
        best = j;
      }
    }
    return best ? { ...best, d: bd - best.r } : null;
  }

  step(dt) {
    this.sync();
    if (!this.lines.size && !this.buses.length) {
      this._users = [];
      return;
    }
    const demand = this.world.simulations?.find((s) => s.enabled && typeof s.serviceInterval === "function");
    for (const line of this.lines.values()) {
      if (!line.ok) continue;
      if (line.auto) this._autoHeadway(line, demand);
      this._dispatch(line, dt);
    }
    this._users = this.buses.map((b) => this._pose(b, this.lines.get(b.lineId)));
    this._users.push(...this._blockers());
    const all = this._users.slice();
    for (const s of this.world.simulations || []) if (typeof s.roadUsers === "function") all.push(...s.roadUsers());
    // the lights at the stops: red while a tram comes and people cross; the vehicles stop at them
    this.signals.step(dt, { buses: this.buses, meters: (mm) => this.meters(mm), ahead: (bus) => this._nextDock(bus) }, all);
    const lights = this.signals.blockers();
    this._users.push(...lights);
    all.push(...lights);
    const users = new RoadUsers(all, this.mm(25));
    this._occupied = this._singleOccupancy();
    for (const bus of this.buses) {
      this._drive(bus, this.lines.get(bus.lineId), dt, users);
      this._occupy(bus);
    }
    this.buses = this.buses.filter((b) => b.phase !== "gone");
  }

  /** A line without an interval of its own: as often as the town needs, else the default. */
  _autoHeadway(line, demand) {
    const iv = demand?.serviceInterval({ kind: line.vehicle, line });
    line.headway = iv ? iv.headway_s : line.vehicle === "tram" ? 300 : 240;
    line.minutes = iv ? iv.minutes : null;
  }

  _dispatch(line, dt) {
    const tod = this.world.clock.demand("bus");
    const fxOf = (v) => this.world.disruptions.effectsFor(v.area);
    for (const st of line.starts) {
      const v = line.visits[st.index], fx = fxOf(v);
      // no service (the night): a bus still waiting for room to come in stays in the depot
      if (!(tod > 0)) st.pending = 0;
      if (st.pending > 0) this._spawn(line, st);
      st.timer -= dt * tod * Math.max(0, fx.frequency ?? 1);
      if (st.timer > 0) continue;
      st.timer = Math.max(st.timer + line.headway, line.headway * 0.25);
      if (fx.cancel) {
        this.world.events.emit("vehicle.cancelled", { vehicle: { kind: "bus", source: "line", line: line.label, lineId: line.id, dock: v.dock }, dock: v.dock, area: v.area });
        continue;
      }
      // a bus laying over here takes the departure, else one on its way here, else a new one
      const here = this.buses.filter((b) => b.lineId === line.id && b.next === st.index && b.phase !== "gone");
      const waiting = here.filter((b) => b.waiting).sort((a, b) => b.waited - a.waited)[0];
      if (waiting) {
        waiting.waiting = false;
        waiting.dwellLeft = Math.max(MIN_DWELL_S, Math.min(waiting.dwellLeft, v.dock.dwell));
        continue;
      }
      const coming = here.filter((b) => !b.due && b.phase !== "dwelling").sort((a, b) => this._ahead(line, a.s, v.s) - this._ahead(line, b.s, v.s))[0];
      if (coming && this.meters(this._ahead(line, coming.s, v.s)) < 4 * ARRIVING_M) {
        coming.due = true;
        continue;
      }
      // a line running late does not get ever more vehicles (they would only jam): the departure waits for one
      if (this.buses.filter((b) => b.lineId === line.id && b.phase !== "gone" && !b.outOfService).length >= this._needed(line) + 1) continue;
      st.pending = 1; // as soon as there is room
      this._spawn(line, st);
    }
  }

  /**
   * Cars wait beside a tram at a stop without an island while its doors are open: people cross the
   * lane to and from it (StVO § 20). One road user in that lane per tram, as long as the tram. Where
   * the stop has traffic lights, they hold the cars at their stop line instead (core/stop-signals.js).
   */
  _blockers() {
    const out = [];
    for (const bus of this.buses) {
      if (bus.kind !== "tram" || bus.phase !== "dwelling" || bus.waiting || !bus._pose) continue;
      const owner = bus.dock?.area?.owner;
      if (typeof owner?.blocksCars !== "function" || !owner.blocksCars() || this.signals.forDock(bus.dock.id)) continue;
      const shift = owner.carLaneShift?.(bus.dock) ?? 0;
      const { front, rear, dir } = bus._pose, r = [dir[1], -dir[0]];
      const at = (p) => [p[0] + r[0] * shift, p[1] + r[1] * shift];
      out.push({ vehicle: { id: `block:${bus.id}`, phase: "block", v: 0, owner: bus }, front: at(front), rear: at(rear), dir, speed: 0, approach: null });
    }
    return out;
  }

  /** The dock a bus or tram drives to next and how far it is (mm), or null. */
  _nextDock(bus) {
    const line = this.lines.get(bus.lineId), v = line?.ok ? line.visits[bus.next] : null;
    return v?.dock ? { dockId: v.dock.id, d: this._ahead(line, bus.s, v.s) } : null;
  }

  /** Which trams are on which single-track stretch now: key → [{bus, dir}] (see singleTrack). */
  _singleOccupancy() {
    const map = new Map();
    for (const bus of this.buses) {
      const line = this.lines.get(bus.lineId);
      if (bus.kind !== "tram" || !line?.single?.length) continue;
      const len = this.mm(line.length);
      for (const iv of line.single) {
        if (this._ahead(line, iv.s0, bus.s) <= iv.s1 - iv.s0 + len) {
          if (!map.has(iv.key)) map.set(iv.key, []);
          map.get(iv.key).push({ bus, dir: iv.dir });
        }
      }
    }
    return map;
  }

  /**
   * A tram that has just moved onto a single-track stretch is on it at once for the trams after it
   * in this step (two trams at the two ends in the same step would both find it free).
   */
  _occupy(bus) {
    const line = this.lines.get(bus.lineId);
    if (bus.kind !== "tram" || !line?.single?.length || !this._occupied) return;
    const len = this.mm(line.length);
    for (const iv of line.single) {
      if (this._ahead(line, iv.s0, bus.s) > iv.s1 - iv.s0 + len) continue;
      const on = this._occupied.get(iv.key) || [];
      if (!on.some((o) => o.bus === bus && o.dir === iv.dir)) on.push({ bus, dir: iv.dir });
      this._occupied.set(iv.key, on);
    }
  }

  /** May a tram enter a single-track stretch? Not while a tram comes the other way on it, or any tram where they turn. */
  _singleFree(bus, iv, occupied) {
    for (const o of occupied.get(iv.key) || []) {
      if (o.bus === bus) continue;
      if (iv.dir === 0 || o.dir === 0 || o.dir === -iv.dir) return false;
    }
    return true;
  }

  /** Is a vehicle's place on its line free with its front at s (no other road user on it)? */
  _clearAt(bus, line, s, users) {
    const c = line.circuit, L = c.length;
    const front = polylineAt(c.points, ((s % L) + L) % L, c.lengths).point, rear = polylineAt(c.points, (((s - this.mm(line.length)) % L) + L) % L, c.lengths).point;
    const room = this.mm(line.width / 2 + 0.5), mid = [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2];
    for (const u of around(users, mid, this.mm(line.length) / 2 + room)) {
      if (u.vehicle === bus) continue;
      if (pointSegment(u.front, rear, front).distance < room || pointSegment(u.rear, rear, front).distance < room) return false;
    }
    return true;
  }

  /** A new bus comes in before a start visit (when there is room). */
  _spawn(line, st) {
    const v = line.visits[st.index], L = line.circuit.length;
    const back = Math.min(this.mm(SPAWN_M + line.length - 12), this._ahead(line, line.visits[(st.index - 1 + line.visits.length) % line.visits.length].s, v.s) * 0.8);
    const s = (((v.s - back) % L) + L) % L;
    const front = polylineAt(line.circuit.points, s, line.circuit.lengths).point;
    const clear = this.mm(line.length + 4);
    const users = this._users.slice();
    for (const sim of this.world.simulations || []) if (typeof sim.roadUsers === "function") users.push(...sim.roadUsers());
    for (const u of users) if (dist2(u.front, front) < clear || dist2(u.rear, front) < clear) return;
    const bus = new LineBus(line, s, st.index);
    bus.seq = ++this._seq;
    bus.due = true;
    bus.v = Math.min(line.speed, 6);
    this._setDirection(bus, line, st.index);
    this.buses.push(bus);
    this._users.push(this._pose(bus, line));
    st.pending--;
  }

  _drive(bus, line, dt, users) {
    if (!line?.ok) return;
    const V = line.visits, c = line.circuit, L = c.length;
    const fx = (v) => this.world.disruptions.effectsFor(v.area);
    if (bus.phase === "dwelling") {
      const v = V[bus.next];
      if (bus.waiting) {
        bus.waited += dt;
        const tod = this.world.clock.demand("bus");
        // no departure for a long time (or the night): to the depot
        if (bus.waited > Math.max(3 * line.headway, 600) || (!(tod > 0) && bus.waited > 60)) this._drop(bus);
        else if (this._queuedBehind(bus, users)) {
          // a vehicle waits behind: leave now with the next departure, or (no departures because of
          // a disruption) make room and go to the depot
          const e = fx(v);
          if ((e.frequency ?? 1) <= 0 || e.cancel) {
            this._drop(bus);
            return;
          }
          bus.waiting = false;
          bus.dwellLeft = Math.min(bus.dwellLeft, 4);
          const st = line.starts.find((x) => x.index === bus.next);
          if (st) st.timer = line.headway;
        }
        return;
      }
      if (fx(v).hold) {
        bus.delayMin += dt / 60;
        return;
      }
      // the doors open once people may cross to the tram (the lights hold the vehicles beside it)
      if (this.signals.holdsDoors(bus.dock?.id)) return;
      bus.dwellLeft -= dt;
      if (bus.dwellLeft <= 0 && bus.outOfService) this._drop(bus);
      else if (bus.dwellLeft <= 0) {
        bus.phase = "departing";
        bus.doorsLeft = DOORS_S;
        this._emit("vehicle.departing", bus, bus.dock);
      }
      return;
    }
    if (bus.phase === "departing" && bus.doorsLeft > 0) {
      bus.doorsLeft -= dt;
      if (bus.doorsLeft > 0) return;
      // off to the next stop
      bus._leaving = { dock: bus.dock, s: bus.s };
      bus.next = (bus.next + 1) % V.length;
      bus._arrivingSent = false;
      bus.delayMin = 0;
    }
    let target = V[bus.next];
    // a closed stop is passed without stopping
    if (fx(target).closed && this.meters(this._ahead(line, bus.s, target.s)) < 25) {
      bus.next = (bus.next + 1) % V.length;
      target = V[bus.next];
      // the next stop is announced (vehicle.arriving) when the bus gets near it
      bus._arrivingSent = false;
      if (bus.phase === "arriving") bus.phase = "driving";
    }
    const d = this._ahead(line, bus.s, target.s), dM = this.meters(d);
    const seg = Math.min(c.speeds.length - 1, Math.max(0, segmentIndex(c.lengths, bus.s)));
    let vT = Math.min(line.speed, c.speeds[seg] ?? line.speed, Math.sqrt(2 * BRAKE * dM));
    // slow enough at the next curves of a tram (in time to brake for them)
    for (const cu of line.curves || []) {
      const ahead = this.meters(this._ahead(line, bus.s, cu.s0));
      if (ahead < 60) vT = Math.min(vT, Math.sqrt(cu.v * cu.v + 2 * BRAKE * ahead));
    }
    const me = bus._pose || this._pose(bus, line);
    const look = this.mm(bus.v * bus.v / (2 * BRAKE) + GAP_M + 15);
    const lead = squeezing(bus) ? { gap: Infinity, user: null } : leaderAhead(bus, me.front, me.dir, users, look, this.mm(1.5));
    const gap = lead.gap;
    waitFor(bus, lead.user, dt);
    if (gap < Infinity) vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(gap) - GAP_M)));
    // where it has to stand: before a junction, a zebra crossing with people on it, a closed level
    // crossing, a single track with a tram coming the other way
    let stopAt = Infinity;
    const hold = (mm) => {
      vT = Math.min(vT, Math.sqrt(2 * BRAKE * Math.max(0, this.meters(mm))));
      stopAt = Math.min(stopAt, Math.max(0, mm));
    };
    const j = this._nextJunction(bus, line), now = this.world.time;
    if (j) {
      const line0 = j.d - j.r - this.mm(1), dStop = this.meters(line0);
      const light = lightAt(j, now), prio = approachPrio(j, now);
      if (dStop < -1) {
        bus.junctionWait = 0;
        bus.stopped = null;
      } else if (light === "red" || light === "red-amber" || (light === "amber" && dStop > (bus.v * bus.v) / (2 * BRAKE))) hold(line0);
      else if (j.rule?.stop && bus.stopped !== j.key) {
        // Stop: stand at the line once, then give way
        hold(line0);
        if (bus.v < 0.2 && dStop < 2) bus.stopped = j.key;
      } else if (dStop < (bus.v * bus.v) / (2 * BRAKE) + 3 && (bus.junctionWait || 0) < junctionPatience(prio) && mustYield(bus, j, j.d, users, prio)) {
        hold(line0);
        if (bus.v < 0.3) bus.junctionWait = (bus.junctionWait || 0) + dt;
      }
      // keep the junction clear: not into it while the way out is blocked
      if (dStop >= 0 && dStop < (bus.v * bus.v) / (2 * BRAKE) + 3) {
        const out = polylineAt(c.points, (bus.s + j.d + j.r) % L, c.lengths);
        if (!roomAfter(bus, out.point, out.dir, users, this.mm(line.length + GAP_M), this.mm(1.5))) hold(line0);
      }
    }
    for (const x of line.crossings) {
      const e = this._ahead(line, bus.s, x.s - x.half - this.mm(1));
      if (e > look + this.mm(10)) continue;
      if (x.kind === "zebra" ? x.obj.busy() : x.obj.closed(now)) hold(e - this.mm(x.kind === "rail" ? 3 : 0.5));
    }
    if (line.single.length && this._occupied) {
      const len = this.mm(line.length);
      for (const iv of line.single) {
        if (this._ahead(line, iv.s0, bus.s) <= iv.s1 - iv.s0 + len) continue; // on it already
        const e = this._ahead(line, bus.s, iv.s0);
        if (e < look + this.mm(10) && !this._singleFree(bus, iv, this._occupied)) hold(e - this.mm(2));
      }
    }
    // the end of a stub track: the tram stops there, the driver changes ends, and the other end
    // leads back (the tram stands where it stood, now on the line beyond the turn)
    for (const r of line.reversals || []) {
      const e = this._ahead(line, bus.s, r.s0);
      if (e > look + this.mm(10)) continue;
      if (this.meters(e) < 0.3 && bus.v < 0.3) {
        bus.reversing = (bus.reversing || 0) + dt;
        const after = (r.s1 + Math.min(this.mm(line.length), this._ahead(line, r.s1, target.s))) % L;
        // once the track beyond the turn is free (a tram ahead may still stand there)
        if (bus.reversing >= REVERSE_S && this._clearAt(bus, line, after, users)) {
          bus.reversing = 0;
          bus.s = after;
          bus.v = 0;
          bus._pose = null;
          return;
        }
      }
      hold(e);
    }
    bus.v = vT > bus.v ? Math.min(vT, bus.v + ACCEL * dt) : Math.max(vT, bus.v - HARD * dt, 0);
    let move = Math.min(this.mm(bus.v * dt), d, stopAt);
    // never into the vehicle ahead
    if (gap < Infinity && move > gap - this.mm(0.3)) {
      move = Math.max(0, gap - this.mm(0.3));
      bus.v = Math.min(bus.v, this.meters(move) / Math.max(dt, 1e-6));
    }
    bus.s = (bus.s + move) % L;
    if (bus._leaving && this.meters(this._ahead(line, bus._leaving.s, bus.s)) > DEPARTED_M && this.meters(this._ahead(line, bus._leaving.s, bus.s)) < this.meters(L) / 2) {
      const dock = bus._leaving.dock;
      bus._leaving = null;
      this._emit("vehicle.departed", bus, dock);
    }
    if (bus.phase === "departing" && !bus._leaving) bus.phase = "driving";
    const left = d - move;
    // (a closed stop is passed: not announced, and nobody sees the bus arriving there)
    if (!bus._arrivingSent && this.meters(left) < ARRIVING_M && !fx(target).closed) {
      bus._arrivingSent = true;
      if (!bus._leaving) bus.phase = "arriving";
      this._emit("vehicle.arriving", bus, target.dock);
    } else if (bus._arrivingSent && !bus._leaving && bus.phase === "driving") bus.phase = "arriving";
    if (this.meters(left) < 0.25 && bus.v < 0.6) this._arrive(bus, line, target);
  }

  /**
   * Is a vehicle waiting close behind a bus that lays over? Another bus for the same stop, or any
   * vehicle stuck behind it in its lane: a bus of another line on its way to the next bay of a
   * terminal, the cars behind a bus that lays over at a stop on the street.
   */
  _queuedBehind(bus, users = this._users) {
    const me = bus._pose;
    if (!me) return false;
    const behind = this.mm(GAP_M + 20), lane = this.mm(2.5);
    for (const u of around(users, me.rear, behind + lane)) {
      const o = u.vehicle;
      if (o === bus || o.phase === "dwelling" || o.v > 1) continue;
      if (o.lineId && this.lines.get(o.lineId)?.visits[o.next]?.dockId === bus.dock?.id) {
        if (dist2(u.front, me.rear) < behind) return true;
        continue;
      }
      // in the lane behind (it may still be turning into it)
      const d = sub2(me.rear, u.front), along = dot2(d, me.dir);
      if (along < -this.mm(1) || along > behind || Math.abs(cross2(me.dir, d)) > lane || dot2(u.dir, me.dir) < 0) continue;
      return true;
    }
    return false;
  }

  _arrive(bus, line, v) {
    if (bus._leaving) {
      this._emit("vehicle.departed", bus, bus._leaving.dock);
      bus._leaving = null;
    }
    bus.s = v.s;
    bus.v = 0;
    bus.phase = "dwelling";
    bus.dock = v.dock;
    bus.area = v.area;
    // boarding takes longer where it is not step-free (a step to climb, a ramp to unfold)
    bus.dwellLeft = Math.max(MIN_DWELL_S, v.dock.dwell) * (v.area?.owner?.dwellFactor?.() ?? 1);
    bus.direction = v.dir;
    if (v.destination) bus.destination = v.destination;
    if (v.start) {
      if (bus.due) bus.dwellLeft = Math.max(bus.dwellLeft, 15);
      else if (this.buses.filter((b) => b.lineId === line.id && b.phase !== "gone" && !b.outOfService).length > this._needed(line)) {
        // one bus too many (after the rush hour, at night): people get off, then to the depot
        bus.outOfService = true;
      } else {
        bus.waiting = true;
        bus.waited = 0;
      }
      bus.due = false;
    }
    if (!bus._arrivingSent) this._emit("vehicle.arriving", bus, v.dock);
    bus._arrivingSent = false;
    this._emit("vehicle.arrived", bus, v.dock);
  }

  /* ---------------------------------------------------------------- pointing at buses */

  /** The buses and trams on the road as pickables (core/pick.js). */
  pickables(view) {
    const out = [];
    for (const bus of this.buses) {
      const line = this.lines.get(bus.lineId);
      if (!line?.ok) continue;
      const { front, rear } = this._pose(bus, line);
      out.push({ key: `${line.vehicle}:${bus.id}`, kind: line.vehicle, label: `${line.noun} ${bus.line}`, outline: rectBetween(rear, front, this.mm(line.width)), z0: this.mm(0.3), z1: this.mm(line.vehicle === "tram" ? 3.4 : 3.1), owner: this, ref: bus });
    }
    return out;
  }

  /** The card of a line bus: where it goes, its next stop, the people on board, its delay. */
  card(hit) {
    const bus = hit.ref, line = this.lines.get(bus.lineId);
    const next = line?.visits[bus.next];
    const atStop = bus.phase === "dwelling" || bus.phase === "arriving";
    const doing = bus.outOfService ? "Not in service"
      : bus.waiting ? `Waiting at ${next?.name ?? "the terminus"}`
        : atStop ? `${bus.phase === "arriving" ? "Arriving at" : "At"} ${next?.name ?? "a stop"}`
          : next ? `Next stop: ${next.name}` : "Driving";
    const delay = Math.round(bus.delayMin || 0);
    const noun = line?.noun ?? "Bus";
    return {
      title: `${noun} ${bus.line}`,
      subtitle: `${noun === "Tram" ? "Tram" : "Line bus"}${bus.destination && !bus.outOfService ? ` · ${towards(bus.destination, line?.mode === "loop")}` : ""}`,
      status: doing,
      tone: delay >= 5 ? "bad" : delay >= 1 ? "warn" : "ok",
      rows: [
        ["Line", line?.name || bus.line],
        ["People on board", bus.riders.length],
        ["Speed", `${Math.round(bus.v * 3.6)} km/h`],
        ["Delay", delay >= 1 ? `+${delay} min` : "on time"],
      ],
      sections: line ? [{ title: "Stops", lines: line.visits.map((v) => v.name).filter((n, i, a) => a.indexOf(n) === i) }] : [],
      related: line ? [line.id] : [],
    };
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    this.sync();
    for (const bus of this.buses) {
      const line = this.lines.get(bus.lineId);
      if (line?.ok) {
        if (line.vehicle === "tram") this._drawTram(view, bus, line);
        else this._drawBus(view, bus, line);
      }
    }
  }

  /** A tram: five sections with joints, windows, its line's colour along the side, a pantograph; lights at night. */
  _drawTram(view, bus, line) {
    const { front, rear } = this._pose(bus, line);
    if (!view.inImage(front[0], front[1], 0, 160) && !view.inImage(rear[0], rear[1], 0, 160)) return;
    const m = (x) => view.m(x);
    const lit = view.darkness > 0.35;
    const body = PALETTE.tram, sections = 5;
    const colours = { side: body, top: shade(body, 1.35), end: shade(body, 0.9), alpha: 1 };
    const z0 = m(0.3), z1 = m(3.4), len = this.meters(dist2(front, rear));
    const doors = bus.doorsOpen ? [len - 2.5, len - 10.5, len - 18.5, len - 26.5].filter((x) => x > 1) : [];
    const doorSide = (bus.dock?.side ?? 1) < 0 ? "left" : "right";
    // the sections along the driving line, so that the tram bends round curves
    const c = line.circuit, L = c.length, step = this.mm(len / sections);
    for (let k = 0; k < sections; k++) {
      const sF = bus.s - k * step, sR = bus.s - (k + 1) * step + this.mm(0.25);
      const f = polylineAt(c.points, ((sF % L) + L) % L, c.lengths).point, r = polylineAt(c.points, ((sR % L) + L) % L, c.lengths).point;
      const a0 = len - (k + 1) * (len / sections), a1 = len - k * (len / sections);
      const faces = boxFaces(r, f, m(2.65), z0, z1, colours, (face, P, Ls, hw) => {
        const out = [];
        const a = (x) => ((x - a0) / Math.max(1e-6, a1 - a0)) * Ls;
        if (face.side === "left" || face.side === "right") {
          const t = face.side === "left" ? hw : -hw;
          out.push({ pts: [P(a(a0 + 0.4), t, m(1.15)), P(a(a1 - 0.4), t, m(1.15)), P(a(a1 - 0.4), t, m(2.6)), P(a(a0 + 0.4), t, m(2.6))], color: lit ? PALETTE.litWindow : PALETTE.busWindow, emissive: lit });
          out.push({ pts: [P(0, t, m(0.7)), P(Ls, t, m(0.7)), P(Ls, t, m(0.95)), P(0, t, m(0.95))], color: line.color });
          if (face.side === doorSide) for (const d of doors) if (d - 0.65 > a0 && d + 0.65 < a1) out.push({ pts: [P(a(d - 0.65), t, z0), P(a(d + 0.65), t, z0), P(a(d + 0.65), t, m(2.7)), P(a(d - 0.65), t, m(2.7))], color: grey(0.16) });
        } else if (face.side === "front" && k === 0) {
          out.push({ pts: [P(Ls, hw - m(0.2), m(1.0)), P(Ls, -hw + m(0.2), m(1.0)), P(Ls, -hw + m(0.2), m(2.7)), P(Ls, hw - m(0.2), m(2.7))], color: PALETTE.busWindow });
        }
        return out;
      });
      const mid = [(f[0] + r[0]) / 2, (f[1] + r[1]) / 2];
      view.faces(faces, [mid[0], mid[1], m(1.7)]);
      if (k === 2) {
        // the pantograph on the middle section
        const p = [mid[0], mid[1]], u = unit2(sub2(f, r));
        const a = [p[0] - u[0] * m(1), p[1] - u[1] * m(1), z1], b = [p[0] + u[0] * m(0.4), p[1] + u[1] * m(0.4), z1 + m(1.1)];
        view.faces([{ pts: [a, b, [b[0], b[1], b[2] + m(0.08)], [a[0], a[1], a[2] + m(0.08)]], color: grey(0.3), twoSided: true }], [p[0], p[1], z1]);
      }
    }
    if (view.darkness > 0.05) {
      const u = unit2(sub2(front, rear)), n = [-u[1], u[0]];
      for (const k of [-1, 1]) view.glow([front[0] + n[0] * k * m(0.9), front[1] + n[1] * k * m(0.9), m(0.9)], m(0.9), "#fff3d6", 0.9);
      view.lightPool([front[0] + u[0] * m(6), front[1] + u[1] * m(6)], m(4.5), "#fff1c9", 0.35);
    }
    const a = view.project(front[0], front[1], 0), b = view.project(rear[0], rear[1], 0);
    const big = a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) / (view.px || 1) >= 24;
    if (bus.phase === "dwelling" && big && this.world.settings.labels !== false) {
      const at = [front[0] - (front[0] - rear[0]) * 0.06, front[1] - (front[1] - rear[1]) * 0.06];
      const short = bus.line.length <= 3;
      const dest = bus.outOfService ? "Not in service" : bus.destination;
      view.label([at[0], at[1], m(4.6)], short ? dest || "Tram" : `${bus.line}${dest ? ` ${dest}` : ""}`, { size: 11, badge: short ? bus.line : undefined, badgeColor: mix(line.color, "#000000", 0.15), order: 2, optional: true });
    }
  }

  _drawBus(view, bus, line) {
    const { front, rear } = this._pose(bus, line);
    if (!view.inImage(front[0], front[1], 0, 120) && !view.inImage(rear[0], rear[1], 0, 120)) return;
    const m = (x) => view.m(x);
    const lit = view.darkness > 0.35;
    const body = PALETTE.bus;
    const colours = { side: body, top: shade(body, 1.4), end: shade(body, 0.9), alpha: 1 };
    const z0 = m(0.3), z1 = m(3.1), len = this.meters(dist2(front, rear));
    const doors = bus.doorsOpen ? [len - 1.6, len - 6.4] : [];
    // the doors open towards the stop: on the right at a bus stop, on the left in the bays of a
    // terminal (its waiting area is on the left of the bus lane)
    const doorSide = (bus.dock?.side ?? 1) < 0 ? "left" : "right";
    const faces = boxFaces(rear, front, m(2.55), z0, z1, colours, (f, P, L, hw) => {
      const out = [];
      if (f.side === "left" || f.side === "right") {
        const t = f.side === "left" ? hw : -hw;
        const a = (x) => (x / Math.max(len, 1e-6)) * L;
        out.push({ pts: [P(a(0.6), t, m(1.3)), P(a(len - 1.6), t, m(1.3)), P(a(len - 1.6), t, m(2.7)), P(a(0.6), t, m(2.7))], color: lit ? PALETTE.litWindow : PALETTE.busWindow, emissive: lit });
        out.push({ pts: [P(a(0.3), t, m(0.75)), P(a(len - 0.3), t, m(0.75)), P(a(len - 0.3), t, m(0.95)), P(a(0.3), t, m(0.95))], color: line.color });
        if (f.side === doorSide) {
          for (const d of doors) out.push({ pts: [P(a(d - 0.6), t, z0), P(a(d + 0.6), t, z0), P(a(d + 0.6), t, m(2.8)), P(a(d - 0.6), t, m(2.8))], color: grey(0.16) });
        }
      } else if (f.side === "front") {
        out.push({ pts: [P(L, hw - m(0.2), m(1.1)), P(L, -hw + m(0.2), m(1.1)), P(L, -hw + m(0.2), m(2.6)), P(L, hw - m(0.2), m(2.6))], color: PALETTE.busWindow });
        out.push({ pts: [P(L, hw - m(0.3), m(2.7)), P(L, -hw + m(0.3), m(2.7)), P(L, -hw + m(0.3), m(3.0)), P(L, hw - m(0.3), m(3.0))], color: lit ? "#ffb347" : grey(0.2), emissive: lit });
      }
      return out;
    });
    const mid = [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2];
    view.faces(faces, [mid[0], mid[1], m(1.6)]);
    if (view.darkness > 0.05) {
      const u = unit2(sub2(front, rear)), n = [-u[1], u[0]];
      for (const k of [-1, 1]) {
        view.glow([front[0] + n[0] * k * m(0.95), front[1] + n[1] * k * m(0.95), m(0.8)], m(0.9), "#fff3d6", 0.9);
        view.glow([rear[0] + n[0] * k * m(0.95), rear[1] + n[1] * k * m(0.95), m(0.9)], m(0.45), CD.rot, 0.8);
      }
      view.lightPool([front[0] + u[0] * m(5), front[1] + u[1] * m(5)], m(4), "#fff1c9", 0.35);
    }
    // the destination sign while it stands at a stop (not when the bus is tiny on the screen)
    const a = view.project(front[0], front[1], 0), b = view.project(rear[0], rear[1], 0);
    const big = a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) / (view.px || 1) >= 24;
    if (bus.phase === "dwelling" && big && this.world.settings.labels !== false) {
      // line number on the line's colour, then the destination
      const at = [front[0] - (front[0] - rear[0]) * 0.1, front[1] - (front[1] - rear[1]) * 0.1];
      const short = bus.line.length <= 3;
      const dest = bus.outOfService ? "Not in service" : bus.destination;
      const text = short ? dest || "Bus" : `${bus.line}${dest ? ` ${dest}` : ""}`;
      view.label([at[0], at[1], m(4.4)], text, { size: 11, badge: short ? bus.line : undefined, badgeColor: mix(line.color, "#000000", 0.15), order: 2, optional: true });
    }
  }
}

/** Do two road users ({front, rear, dir}) going the same way overlap (one's front within `tol` mm of the other's centre line)? */
function onTop(a, b, tol) {
  return dot2(a.dir, b.dir) > 0.5 && (pointSegment(a.front, b.rear, b.front).distance < tol || pointSegment(b.front, a.rear, a.front).distance < tol);
}

/** Index of the polyline segment containing arc length s. */
function segmentIndex(lengths, s) {
  let lo = 0, hi = lengths.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lengths[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return clamp(lo, 0, Math.max(0, lengths.length - 2));
}

/**
 * Where a tram line's driving line turns back (the end of a stub track, or where the route turns
 * round): [{s0, s1}], arc lengths on the driving line where the turn begins and ends (the same
 * point on one track; the loop over to the other track where there are two).
 * @param {import("./network.js").Path} path
 * @param {{lengths: number[], centre: number[]}} drive its driving line
 */
export function reversals(path, drive) {
  const P = path.points, out = [];
  for (let j = 1; j < P.length - 1; j++) {
    const a = unit2(sub2(P[j], P[j - 1])), b = unit2(sub2(P[j + 1], P[j]));
    if (dot2(a, b) >= -0.95) continue;
    const at = path.lengths[j];
    let s0 = null, s1 = null;
    drive.centre.forEach((c, i) => {
      if (Math.abs(c - at) > 1e-6) return;
      if (s0 == null) s0 = drive.lengths[i];
      s1 = drive.lengths[i];
    });
    if (s0 != null) out.push({ s0, s1 });
  }
  return out;
}

/**
 * The stretches of a tram line's circuit on a single track used in both directions (edges with
 * `singleTrack`): [{key, s0, s1, dir}] on the driving line. `key` names the stretch (its edges),
 * `dir` is +1 or -1 by the direction it is passed (seen along its first edge), 0 where the trams
 * turn on it (a stub at a terminus: one tram at a time).
 * @param {import("./network.js").Path} path
 * @param {{lengths: number[], centre: number[], length: number}} drive
 */
export function singleTrack(path, drive) {
  const runs = [];
  let cur = null;
  for (const x of path.edges || []) {
    if (!x.edge.singleTrack) {
      cur = null;
      continue;
    }
    if (!cur) runs.push((cur = { edges: [], s0: x.s0, s1: x.s1 }));
    cur.edges.push(x);
    cur.s1 = x.s1;
  }
  // a stretch over the end of the circuit (where it begins) is one stretch
  if (runs.length > 1) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.s0 < 1e-6 && Math.abs(last.s1 - path.length) < 1e-6) {
      last.edges.push(...first.edges);
      last.s1 = path.length + first.s1;
      runs.shift();
    }
  }
  const L = drive.length;
  return runs.map((r) => {
    const ids = [...new Set(r.edges.map((x) => x.edge.id))].sort((a, b) => a - b);
    const ref = ids[0], dirs = new Set(r.edges.filter((x) => x.edge.id === ref).map((x) => (x.forward ? 1 : -1)));
    const s0 = driveS(drive, r.s0), s1 = r.s1 > path.length ? L + driveS(drive, r.s1 - path.length) : driveS(drive, r.s1);
    return { key: ids.join(","), s0, s1, dir: dirs.size > 1 ? 0 : [...dirs][0] };
  });
}
