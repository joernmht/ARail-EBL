/**
 * Visits of the container terminal: trains on a loading track, barges along a quay and trucks in a
 * truck lane. Each vehicle is moved by a deterministic `PathMover` along its path (the track, quay
 * or lane polyline) and owns the carriers its containers stand on.
 *
 * Internal to the terminal: the simulation (operations.js) creates the visits, checks requests
 * (moves still running, the track being taken) and emits the events; the visits move and set the
 * poses and flags (`present`, `available`) of their carriers. `host` is the simulation: `mm(m)`,
 * `world.scale` and `_visitEvent(name, visit)`.
 * @module arail/terminal/visits
 */
import { clamp, unit2 } from "../core/math.js";
import { Carrier, bargeType } from "./model.js";
import { PathMover } from "./movers.js";
import { TERMINAL_EVENTS } from "./types.js";

/** Length (m) of a train's locomotive. */
export const LOCO_M = 19;

/** Trains, barges and trucks: speeds (m/s), accelerations (m/s²) and lane distances (m). */
export const MOTION = Object.freeze({
  train: { vmax: 25 / 3.6, accel: 0.3, brake: 0.4 },
  barge: { vmax: 2.5, accel: 0.08, brake: 0.15, astern: 1.5 },
  truck: { vmax: 20 / 3.6, accel: 1.5, brake: 2.0 },
});

/**
 * Trucks: length (m, rear to front), front ahead of the loading centre (m), how far before the
 * stop they turn in and after leaving they turn out (m), clear entry (m), gap to the truck ahead
 * (m), the window in the passing lane a truck needs to pull out (m behind its rear, m ahead of its
 * front), and the sideways distance (m) at which two trucks pass each other (width + margin).
 */
export const TRUCK = Object.freeze({ length_m: 16.5, front_m: 9.7, turn_m: 20, entry_m: 30, gap_m: 3, behind_m: 30, ahead_m: 5, clear_m: 2.75, ramp_m: 2 });

/** A vehicle moving along a polyline: a train or a barge. */
class PathVisit {
  constructor({ id, kind, name, where, runtime }) {
    this.id = id;
    this.kind = kind;
    this.name = name || id;
    /** "away" | "approaching" | "positioned" | "departing" */
    this.state = "away";
    /** @type {Carrier[]} */
    this.carriers = [];
    /** Id of the track or quay. */
    this.where = where;
    this.purpose = null;
    /** Created at run time (not in the layout file's start state). */
    this.runtime = !!runtime;
    /** @type {PathMover | null} */
    this.mover = null;
    /** Does its track or quay exist (with geometry)? */
    this.pathOk = false;
  }

  /** The path (layout mm) changed or vanished; keeps the position on it. */
  setPath(points, host) {
    this.pathOk = !!(points && points.length >= 2);
    if (!this.pathOk) {
      this.flags();
      return;
    }
    const m = MOTION[this.kind], mm = (v) => host.mm(v);
    if (!this.mover) this.mover = new PathMover({ points, vmax: mm(m.vmax), accel: mm(m.accel), brake: mm(m.brake), scale: host.world.scale });
    else this.mover.setPath(points);
    this.update(host);
  }

  /** Arc length (mm) of the front where it stops. */
  stopS(host) {
    return this.mover ? this.mover.total : 0;
  }

  /** Stand at the stop (a positioned start state). */
  position(host) {
    if (!this.mover) return;
    this.state = "positioned";
    this.mover.s = this.stopS(host);
    this.mover.v = 0;
    this.mover.setTarget(this.mover.s);
    this.update(host);
  }

  /** `present`: here (drawn, a possible target); `available`: handlers may work on it. */
  flags() {
    const present = this.pathOk && this.state !== "away";
    for (const c of this.carriers) {
      c.present = present;
      c.available = present && this.state === "positioned";
    }
  }

  /** Is the whole vehicle on its path (it is drawn only then)? */
  visible(host) {
    if (!this.pathOk || this.state === "away" || !this.mover) return false;
    const s = this.mover.s;
    return s - host.mm(this.length_m) >= -1e-6 && s <= this.mover.total + 1e-6;
  }

  /** Come in: from the start of the path to the stop. */
  call(host) {
    this.state = "approaching";
    this.mover.s = 0;
    this.mover.v = 0;
    this.mover.vmax = host.mm(MOTION[this.kind].vmax);
    this.mover.setTarget(this.stopS(host));
    this.update(host);
    host._visitEvent(TERMINAL_EVENTS.visitArriving, this);
  }

  /** Leave (the caller has checked that no move is running). */
  depart(host) {
    this.state = "departing";
    this.mover.setTarget(this.mover.total + host.mm(this.length_m) + host.mm(5));
    this.update(host);
    host._visitEvent(TERMINAL_EVENTS.visitDeparting, this);
  }

  /** Advance by `dt` simulated seconds. */
  step(dt, host) {
    if (!this.pathOk || !this.mover || (this.state !== "approaching" && this.state !== "departing")) return;
    const done = this.mover.step(dt);
    if (done && this.state === "approaching") {
      this.state = "positioned";
      this.update(host);
      host._visitEvent(TERMINAL_EVENTS.visitArrived, this);
    } else if (done) {
      this.state = "away";
      this.mover.s = 0;
      this.mover.v = 0;
      this.update(host);
      host._visitEvent(TERMINAL_EVENTS.visitDeparted, this);
    } else {
      this.update(host);
    }
  }

  /** Poses and flags of the carriers. */
  update(host) {
    this.flags();
  }
}

/**
 * A train: a locomotive and container wagons on a loading track. The front of the locomotive is
 * at arc length `mover.s` of the track (reversed for `direction` −1).
 */
export class TrainVisit extends PathVisit {
  /**
   * @param {{id: string, name?: string, track: string, direction?: number, stop_mm?: number|null,
   *   wagons: string[], runtime?: boolean}} options wagons: carrier type keys, from the head
   */
  constructor({ id, name, track, direction = 1, stop_mm = null, wagons, runtime = false }) {
    super({ id, kind: "train", name, where: track, runtime });
    this.direction = Number(direction) === -1 ? -1 : 1;
    this.stop_mm = Number.isFinite(stop_mm) ? stop_mm : null;
    this.wagons = wagons.slice();
    this.carriers = wagons.map((type, k) => new Carrier({ id: `${id}/${k + 1}`, type, label: `${this.name} · wagon ${k + 1}`, owner: id }));
    /** Pose of the locomotive (layout mm), null while away. */
    this.loco = null;
  }

  /** Length (m) of the locomotive and the wagons. */
  get length_m() {
    return LOCO_M + this.carriers.reduce((s, c) => s + (c.type?.length_m ?? 0), 0);
  }

  /** Track polyline (layout mm) in its driving direction (the track may have moved: the stop poses are computed again). */
  setPath(points, host) {
    this._home = null;
    super.setPath(points && this.direction === -1 ? points.slice().reverse() : points, host);
  }

  /** `stop_mm`, or with the middle of the wagons at the middle of the track. */
  stopS(host) {
    if (this.stop_mm != null) return this.stop_mm;
    const total = this.mover ? this.mover.total : 0;
    return total / 2 + host.mm(LOCO_M) + host.mm(this.length_m - LOCO_M) / 2;
  }

  /** Pose of something of length `length` (mm) whose centre is at arc length `c`: chord over ±0.35·length. */
  _pose(c, length) {
    const m = this.mover, p = m.at(c).point, a = m.at(c - 0.35 * length).point, b = m.at(c + 0.35 * length).point;
    const d = unit2([b[0] - a[0], b[1] - a[1]]);
    return { center: p, heading: Math.atan2(d[1], d[0]) };
  }

  /** Poses of the locomotive and of each wagon with the front at arc length `s`. */
  _posesAt(s, host) {
    const loco = host.mm(LOCO_M), out = { loco: this._pose(s - loco / 2, loco), wagons: [] };
    let a = s - loco;
    for (const c of this.carriers) {
      const L = host.mm(c.type.length_m);
      out.wagons.push(this._pose(a - L / 2, L));
      a -= L;
    }
    return out;
  }

  /** Pose of a wagon where the train stops (handlers are assigned for it while the train comes in). */
  homePose(carrier, host) {
    if (!this.mover || !this.pathOk) return carrier.pose;
    if (this.state === "positioned") return carrier.pose;
    const key = `${this.mover.total}:${this.stopS(host)}`;
    if (this._home?.key !== key) this._home = { key, poses: this._posesAt(this.stopS(host), host) };
    return this._home.poses.wagons[this.carriers.indexOf(carrier)] ?? carrier.pose;
  }

  update(host) {
    super.update(host);
    if (!this.mover || !this.pathOk || this.state === "away") {
      this.loco = null;
      for (const c of this.carriers) c.pose = null;
      return;
    }
    const poses = this._posesAt(this.mover.s, host);
    this.loco = poses.loco;
    this.carriers.forEach((c, k) => (c.pose = poses.wagons[k]));
  }
}

/**
 * An inland barge along a quay: it comes from the first point of the fairway and berths with its
 * bow at the last point; it leaves astern. The bow is at arc length `mover.s`.
 */
export class BargeVisit extends PathVisit {
  /** @param {{id: string, name?: string, quay: string, length_m?: number, tiers?: number, runtime?: boolean}} options */
  constructor({ id, name, quay, length_m = 55, tiers = 2, runtime = false }) {
    super({ id, kind: "barge", name, where: quay, runtime });
    this.length_m = clamp(Number(length_m) || 55, 25, 110);
    this.tiers = clamp(Math.round(Number(tiers) || 2), 1, 3);
    this.carriers = [new Carrier({ id, type: bargeType({ length_m: this.length_m, tiers: this.tiers }), label: this.name, owner: id })];
  }

  /** The bow stops at the end of the fairway. */
  stopS() {
    return this.mover ? this.mover.total : 0;
  }

  /** Back out astern, slowly, until it is off the fairway. */
  depart(host) {
    this.state = "departing";
    this.mover.vmax = host.mm(MOTION.barge.astern);
    this.mover.setTarget(-host.mm(this.length_m) - host.mm(5));
    this.update(host);
    host._visitEvent(TERMINAL_EVENTS.visitDeparting, this);
  }

  /** Pose with the bow at arc length `s`. */
  _poseAt(s, host) {
    const { point, dir } = this.mover.at(s - host.mm(this.length_m) / 2);
    return { center: point, heading: Math.atan2(dir[1], dir[0]) };
  }

  /** Pose at the berth. */
  homePose(carrier, host) {
    return this.mover && this.pathOk && this.state !== "positioned" ? this._poseAt(this.stopS(), host) : carrier.pose;
  }

  update(host) {
    super.update(host);
    const c = this.carriers[0];
    c.pose = this.mover && this.pathOk && this.state !== "away" ? this._poseAt(this.mover.s, host) : null;
  }
}

/**
 * A truck with a 40 ft chassis. It waits at the gate until a truck position is free and the entry
 * is clear, drives in the passing lane, turns in to its position, and turns out again when it
 * leaves; at the end of the lane it is gone. `s` is the arc length of its front, `a` how far it is
 * in the passing lane (mm, 0 at a truck position).
 */
export class TruckVisit {
  /** @param {{id: string, lane: string, purpose: "pickup"|"delivery"}} options */
  constructor({ id, lane, purpose }) {
    this.id = id;
    this.kind = "truck";
    this.name = `Truck ${id}`;
    /** "waiting" (at the gate) | "approaching" | "positioned" | "departing" */
    this.state = "waiting";
    this.carriers = [new Carrier({ id, type: "chassis40", label: this.name, owner: id })];
    this.where = lane;
    this.purpose = purpose === "delivery" ? "delivery" : "pickup";
    this.runtime = true;
    /** @type {PathMover | null} */
    this.mover = null;
    /** Index of its truck position, -1 while it has none. */
    this.position = -1;
    this.a = 0;
    /** Arc length where it started to leave (null until it moves off). */
    this._leftAt = null;
    /** The position it stands at while it waits to pull out (-1 if it had none). */
    this._from = -1;
    /** Simulated seconds it has been ready to leave on its own. */
    this.ready_s = 0;
  }

  get s() {
    return this.mover ? this.mover.s : 0;
  }

  /** On the lane (not at the gate)? */
  get onLane() {
    return this.state === "approaching" || this.state === "positioned" || this.state === "departing";
  }

  flags(laneOk = true) {
    const c = this.carriers[0];
    c.present = laneOk && this.onLane;
    c.available = c.present && this.state === "positioned";
  }

  /** Is the whole truck on the lane? */
  visible(host) {
    if (!this.onLane || !this.mover) return false;
    return this.s - host.mm(TRUCK.length_m) >= -1e-6 && this.s <= this.mover.total + 1e-6;
  }

  /** Pose of the chassis (its loading centre) with the front at `s`, `off` mm to the left. */
  _poseAt(s, off, host) {
    const m = this.mover, L = host.mm(TRUCK.length_m);
    const front = m.at(s, off).point, rear = m.at(s - L, off).point;
    const d = unit2([front[0] - rear[0], front[1] - rear[1]]);
    return { center: m.at(s - host.mm(TRUCK.front_m), off).point, heading: Math.atan2(d[1], d[0]) };
  }

  /** Pose at its truck position (handlers are assigned for it while it comes in). */
  homePose(carrier, host) {
    return this.state === "approaching" && this.mover?.target != null ? this._poseAt(this.mover.target, 0, host) : carrier.pose;
  }

  /** Pose from `s` and `a`, on the passing side `side` (±1). */
  update(host, side = 1) {
    const c = this.carriers[0];
    c.pose = this.onLane && this.mover ? this._poseAt(this.s, side * this.a, host) : null;
  }
}

/** Corners (layout mm) of a truck's chassis at a pose. */
function outline(t, pose, host) {
  const type = t.carriers[0].type, k = host.mm(1), c = Math.cos(pose.heading), s = Math.sin(pose.heading), half = type.width_m / 2;
  return [[type.rear_m, -half], [type.front_m, -half], [type.front_m, half], [type.rear_m, half]]
    .map(([x, y]) => [pose.center[0] + k * (x * c - y * s), pose.center[1] + k * (x * s + y * c)]);
}

/** Do two convex polygons overlap (more than touching)? Separating axes along the edges of both. */
function overlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], n = [p[1] - q[1], q[0] - p[0]];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) {
        const d = v[0] * n[0] + v[1] * n[1];
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const v of B) {
        const d = v[0] * n[0] + v[1] * n[1];
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

/**
 * Drive the trucks of a lane for `dt` seconds: let the first truck at the gate in when a position is
 * free and the entry is clear, move the others, keep them apart. Trucks on the move (coming in, or
 * leaving once they started to pull out) keep their order: none gets closer than a gap to the rear
 * of a moving truck ahead. A truck pulls out only when no moving truck is beside it or close behind
 * or ahead; a moving truck keeps sideways clear of the standing trucks beside it (further out on a
 * bend, as far as the passing lane goes), so the outlines never overlap on a lane that bends by at
 * most 10° near its truck positions (`TruckLane.problems` warns about sharper bends).
 * @param {TruckVisit[]} trucks in arrival order
 * @param {import("./objects.js").TruckLane | null} lane
 * @param {number} dt
 * @param {object} host the terminal: `mm`, `world.scale`, `_visitEvent`, `_truckGone(truck)`
 */
export function stepTrucks(trucks, lane, dt, host) {
  const g = lane?.geometry;
  for (const t of trucks) t.flags(!!g);
  if (!g) return;
  const mm = (m) => host.mm(m), L = mm(TRUCK.length_m), P = Math.abs(g.passingOffset), side = Math.sign(g.passingOffset) || 1;
  const W = Math.min(P, mm(TRUCK.clear_m));
  // on the move: coming in, or leaving and pulled out (or sent away while it came in); the others
  // stand at a position
  const moves = (t) => t.state === "approaching" || (t.state === "departing" && (t._leftAt != null || t.a > 0));
  const on = trucks.filter((t) => t.onLane);
  for (const t of on) if (t.mover.points !== g.points) t.mover.setPath(g.points);

  // the gate: the first waiting truck comes in when a position is free (a truck that has not pulled
  // out yet still holds its own) and nobody is near the entry
  const next = trucks.find((t) => t.state === "waiting");
  if (next) {
    const positions = lane.positions(), taken = new Set();
    for (const t of on) if (t.state !== "departing") taken.add(t.position);
    else if (t._leftAt == null) taken.add(t._from);
    let free = -1;
    for (let i = positions.length - 1; i >= 0 && free < 0; i--) if (!taken.has(i)) free = i;
    const clear = !on.some((t) => t.state !== "positioned" && t.s - L < mm(TRUCK.entry_m));
    if (free >= 0 && clear) {
      const m = MOTION.truck;
      next.mover = new PathMover({ points: g.points, vmax: mm(m.vmax), accel: mm(m.accel), brake: mm(m.brake), scale: host.world.scale });
      next.mover.setTarget(positions[free] + mm(TRUCK.front_m));
      next.position = free;
      next.state = "approaching";
      next.a = P;
      next.flags(true);
      next.update(host, side);
      on.push(next);
      host._visitEvent(TERMINAL_EVENTS.visitArriving, next);
    }
  }

  // leaders first, so that followers see where they are now
  const moving = on.filter((t) => t.state !== "positioned").sort((p, q) => q.s - p.s);
  for (const t of moving) {
    if (t.state === "departing" && t._leftAt == null) {
      // pull out only when no truck on the move is beside it, closer than behind_m behind its rear
      // or ahead_m ahead of its front (a truck sent away while it was still coming in is out there
      // already)
      const lo = t.s - L - mm(TRUCK.behind_m), hi = t.s + mm(TRUCK.ahead_m);
      if (!(t.a > 0) && on.some((o) => o !== t && moves(o) && o.s >= lo && o.s - L <= hi)) continue;
      t._leftAt = t.s - mm(TRUCK.turn_m) * (t.a / P);
    }
    let limit = Infinity;
    for (const o of on) if (o !== t && o.s > t.s && moves(o)) limit = Math.min(limit, o.s - L - mm(TRUCK.gap_m));
    const arrived = t.mover.step(dt, { limit });
    // sideways: the passing lane while driving, turning in over the last turn_m, out over the first;
    // clear of the standing trucks beside it (ramped over ramp_m before it comes alongside)
    const turn = mm(TRUCK.turn_m);
    let a = t.state === "approaching" ? P * clamp((t.mover.target - t.s) / turn, 0, 1) : P * clamp((t.s - t._leftAt) / turn, 0, 1);
    for (const o of on) {
      if (o === t || moves(o)) continue;
      const gap = Math.max(o.s - L - t.s, t.s - L - o.s);
      const ramp = clamp(1 - gap / mm(TRUCK.ramp_m), 0, 1);
      if (ramp > 0) a = Math.max(a, Math.min(P, o.a + W) * ramp);
    }
    a = Math.min(P, a);
    // on a bend the sideways distance alone does not keep them apart (each truck is a chord of the
    // lane): further out while the outlines overlap, as far as the passing lane goes
    const near = on.filter((o) => o !== t && !moves(o) && o.carriers[0].pose && Math.abs(o.s - t.s) < L + mm(TRUCK.ramp_m));
    if (near.length) {
      const others = near.map((o) => outline(o, o.carriers[0].pose, host));
      const hits = (x) => {
        const mine = outline(t, t._poseAt(t.s, side * x, host), host);
        return others.some((o) => overlap(mine, o));
      };
      while (a < P && hits(a)) a = Math.min(P, a + mm(0.1));
    }
    t.a = a;
    if (t.state === "approaching" && arrived) {
      t.state = "positioned";
      t.a = 0;
      t.ready_s = 0;
      t.flags(true);
      t.update(host, side);
      host._visitEvent(TERMINAL_EVENTS.visitArrived, t);
      continue;
    }
    t.update(host, side);
    if (t.state === "departing" && t.s - L > t.mover.total) host._truckGone(t);
  }
}

/**
 * Start a truck's departure (the caller has checked its moves): it frees its position and drives
 * off the end of the lane once the passing lane is clear.
 */
export function departTruck(t, host) {
  t._from = t.state === "positioned" ? t.position : -1;
  t.state = "departing";
  t.position = -1;
  t._leftAt = null;
  if (t.mover) t.mover.setTarget(t.mover.total + host.mm(TRUCK.length_m) + host.mm(5));
  t.flags(true);
  host._visitEvent(TERMINAL_EVENTS.visitDeparting, t);
}
