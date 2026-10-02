/**
 * Handlers of the container terminal: rail-mounted gantry cranes and reach stackers. Each moves
 * one container at a time through a fixed cycle of phases; the duration of every phase is computed
 * when it starts (trapezoid profiles in prototype units) and each axis eases from its start to its
 * end value with smoothstep.
 *
 * Internal to the terminal: the simulation (operations.js) creates the handlers, gives them moves
 * and answers their questions through a small host interface:
 * - `mm(m)`: prototype metres to layout mm;
 * - `_slotBox(ref, container)`: the box (layout mm) a container has, or would have, at a slot;
 * - `_available(carrierId)`: may a handler lift from or set down on that carrier now?
 * - `_carrierLabel(carrierId)`;
 * - `_maxTop(crane)`: the highest box or vehicle top (mm) under a crane;
 * - `_detach(handler)`, `_attach(handler)`: take the container off its slot, set it down (reason on failure);
 * - `_finish(handler)`, `_fail(handler, reason)`: the move is done or failed.
 * @module arail/terminal/handlers
 */
import { clamp, dist2, lerp, smoothstep, wrapAngle } from "../core/math.js";
import { CONTAINER_SIZES } from "./model.js";
import { trapezoid } from "./movers.js";

/** Gantry cranes (prototype units: m, m/s, m/s², s). */
export const CRANE = Object.freeze({
  gantry_v: 1.5, gantry_a: 0.3, trolley_v: 1.2, trolley_a: 0.4, hoist_v: 0.8,
  hoist_v_loaded: 0.5, hoist_a: 0.5, lock_s: 3, clearance_m: 1.0, portal_half_m: 8,
});

/** Reach stackers (prototype units: m, m/s, m/s², s). */
export const REACH_STACKER = Object.freeze({ v: 3.0, a: 0.6, boom_s: 2.5, hoist_v: 0.4, lock_s: 3, approach_m: 7, park_after_s: 20 });

/**
 * Height (m) of a reach stacker's empty spreader while driving, of a carried box's bottom, and of
 * the spreader above the box it is going to take or set down when it arrives there.
 */
const STACKER_CARRY_M = 3.0, STACKER_LOAD_M = 1.5, STACKER_ABOVE_M = 0.3;

/** Phases before the container is locked: the move can still be cancelled, the crane waits for the source. */
const BEFORE_LOCK = new Set(["raise", "travel", "drive", "lower", "lock"]);

/**
 * How far (m) a handler may be from where its container is, or goes, when it lowers, locks or
 * sets down; further away (a model wagon was pushed, an object was moved) it goes back and aims again.
 */
const ON_TARGET_M = 0.25;

/** Eased values that are angles (they turn the shorter way round). */
const ANGLES = new Set(["heading", "loadHeading"]);

/** Angle from `a` to `b` by the shorter way round, at fraction `f`. */
const lerpAngle = (a, b, f) => wrapAngle(a + wrapAngle(b - a) * f);

/**
 * What crane and reach stacker share: the move, the phase and its timing, easing of named numbers.
 * The public fields are those of a `Handler` (types.js): `id`, `kind`, `name`, `phase`, `move`.
 */
class HandlerBase {
  /** @param {import("../core/object.js").LayoutObject} object */
  constructor(object) {
    this.id = object.id;
    this.object = object;
    /** One of the keys of PHASE_LABELS. */
    this.phase = "idle";
    /** @type {string | null} id of the active move */
    this.move = null;
    /** @type {import("./model.js").Container | null} the container on the spreader (or about to be) */
    this.load = null;
    /** Heading (rad) of the carried container. */
    this.loadHeading = 0;
    /** Length (m) of the spreader (eases to the container's length). */
    this.spreader_m = CONTAINER_SIZES["20"].length_m;
    /** @type {import("./types.js").Move | null} */
    this._move = null;
    this._from = {};
    this._to = {};
    this._T = 0;
    this._tau = 0;
    this._stalled = false;
    /** Simulated seconds without a move (reach stackers park after a while). */
    this.idle_s = 0;
  }

  get name() {
    return this.object.name;
  }

  /** Speed factor of the object (0.25-5): speeds × k, accelerations × k², waiting times ÷ k, so every duration ÷ k. */
  get speed() {
    const k = Number(this.object.spec.speed);
    return Number.isFinite(k) && k > 0 ? clamp(k, 0.25, 5) : 1;
  }

  /** Is the handler working on a move? */
  get busy() {
    return this._move != null;
  }

  /** May its move still be cancelled (the container is not locked yet)? */
  get cancellable() {
    return this._move != null && this._beforeLock();
  }

  /** Is the container still on its slot (the phases up to the end of the lock)? */
  _beforeLock() {
    return BEFORE_LOCK.has(this.phase) && !(this.phase === "drive" && this._leg === "target");
  }

  /**
   * Start a move (the host has checked that both carriers are available).
   * @param {import("./types.js").Move} move
   * @param {import("./model.js").Container} container
   */
  begin(move, container, host) {
    this._move = move;
    this.move = move.id;
    this.load = container;
    this.idle_s = 0;
    this._stalled = false;
    this._plan(this._first, host);
  }

  /** Stop working on the move (cancelled before the lock, or failed); the handler stays where it is. */
  abort() {
    this._move = null;
    this.move = null;
    this.load = null;
    this.phase = "idle";
    this._T = this._tau = 0;
    this.idle_s = 0;
  }

  /**
   * Advance by `dt` simulated seconds. The handler holds still (and the move says what it waits
   * for) while the source is not available before the lock, or the target before setting down.
   */
  step(dt, host) {
    if (!this._move) {
      this._idle(dt, host);
      return;
    }
    let left = dt;
    for (let guard = 0; guard < 16 && this._move; guard++) {
      const wait = this._waitingFor(host);
      if (wait) {
        this._move.waiting = `waiting for ${host._carrierLabel(wait)}`;
        this._stalled = true;
        return;
      }
      if (this._stalled) {
        // the carrier may have moved meanwhile (a model wagon): plan the phase again from here (a
        // handler that is no longer over its container goes back, see `_plan`)
        this._stalled = false;
        this._move.waiting = null;
        this._plan(this.phase, host);
      }
      const use = Math.min(left, Math.max(0, this._T - this._tau));
      this._tau += use;
      left -= use;
      this._apply(this._T > 0 ? smoothstep(this._tau / this._T) : 1);
      if (this._tau < this._T - 1e-9) return;
      this._next(host);
      if (!(left > 0)) return;
    }
  }

  /** The carrier (id) the handler has to wait for in its phase, or null. */
  _waitingFor(host) {
    const m = this._move;
    if (this._beforeLock()) {
      return host._available(m.from.carrier) ? null : m.from.carrier;
    }
    if (this.phase === "set-down") return host._available(m.to.carrier) ? null : m.to.carrier;
    return null;
  }

  /** Begin a phase: ease from the current values to `to` over `T` seconds. */
  _set(phase, to, T) {
    this.phase = phase;
    this._from = {};
    for (const k of Object.keys(to)) this._from[k] = this[k];
    this._to = to;
    this._T = Number.isFinite(T) && T > 0 ? T : 0;
    this._tau = 0;
  }

  /** Values at fraction `f` (eased) of the phase; headings go the shorter way round. */
  _apply(f) {
    for (const k in this._to) this[k] = ANGLES.has(k) ? lerpAngle(this._from[k], this._to[k], f) : lerp(this._from[k], this._to[k], f);
  }

  /** The container was locked: take it off its slot (or fail the move). */
  _lock(host) {
    const reason = host._detach(this);
    if (reason) {
      host._fail(this, reason);
      return false;
    }
    return true;
  }

  /** The container was set down: put it on its slot, then release it (or fail the move). */
  _setDown(host) {
    const reason = host._attach(this);
    if (reason) host._fail(this, reason);
    else this._plan("release", host);
  }

  _idle(dt, host) {
    this.idle_s += dt;
  }
}

/**
 * A rail-mounted gantry crane. State in crane-local coordinates (layout mm): `s` along the rails,
 * `t` across them, `z` the bottom of the spreader above the layout plane.
 *
 * Cycle: raise (empty, to the travel height) → travel (above the source) → lower → lock →
 * lift (loaded) → carry (above the target) → set-down → release.
 */
export class CraneHandler extends HandlerBase {
  /** @param {import("./objects.js").GantryCrane} object */
  constructor(object, host) {
    super(object);
    this.kind = "crane";
    this._first = "raise";
    this.s = 0;
    this.t = 0;
    this.z = object.geometry?.lift ?? host.mm(Number(object.spec.lift_m) || 15);
  }

  /** The object changed (moved, resized): keep the state, inside the new ranges. */
  sync(object) {
    this.object = object;
    const s = object.sRange(), t = object.tRange();
    if (s) this.s = clamp(this.s, s[0], s[1]);
    if (t) this.t = clamp(this.t, t[0], t[1]);
    const lift = object.geometry?.lift;
    if (lift != null && this.z > lift) this.z = lift;
  }

  /** Layout point (mm) of the trolley. */
  point() {
    return this.object.fromLocal(this.s, this.t);
  }

  /** Is the trolley away from above the container's place at `ref` (that it reaches)? */
  _off(host, ref) {
    const box = host._slotBox(ref, this.load);
    return !!box && this.object.reaches(box.center) && dist2(box.center, this.point()) > host.mm(ON_TARGET_M);
  }

  /** Crane-local [s, t] of a layout point, inside the ranges the trolley reaches. */
  _local(p) {
    const l = this.object.toLocal(p) || [this.s, this.t];
    const s = this.object.sRange() || [l[0], l[0]], t = this.object.tRange() || [l[1], l[1]];
    return [clamp(l[0], s[0], s[1]), clamp(l[1], t[0], t[1])];
  }

  /** Spreader height (mm) for travelling: clear of everything under the crane, at most the lifting height. */
  _travelZ(host, loaded) {
    const lift = this.object.geometry?.lift ?? host.mm(15);
    const top = host._maxTop(this) + host.mm(CRANE.clearance_m) + (loaded && this.load ? host.mm(this.load.height_m) : 0);
    return Math.min(lift, top);
  }

  /** Time (s) to move the trolley and the gantry from here to (s, t). */
  _travelTime(host, s, t) {
    const k = this.speed, m1 = host.mm(1);
    return Math.max(
      trapezoid((s - this.s) / m1, CRANE.gantry_v * k, CRANE.gantry_a * k * k),
      trapezoid((t - this.t) / m1, CRANE.trolley_v * k, CRANE.trolley_a * k * k),
    );
  }

  /** Time (s) to hoist the spreader from here to z. */
  _hoistTime(host, z, loaded) {
    const k = this.speed;
    return trapezoid((z - this.z) / host.mm(1), (loaded ? CRANE.hoist_v_loaded : CRANE.hoist_v) * k, CRANE.hoist_a * k * k);
  }

  _plan(phase, host) {
    const m = this._move, c = this.load;
    switch (phase) {
      case "raise": {
        const z = this._travelZ(host, false);
        this._set("raise", { z }, this._hoistTime(host, z, false));
        break;
      }
      case "travel": {
        const box = host._slotBox(m.from, c);
        const [s, t] = box ? this._local(box.center) : [this.s, this.t];
        if (box) this.loadHeading = box.heading;
        this._set("travel", { s, t, spreader_m: c.length_m }, this._travelTime(host, s, t));
        break;
      }
      case "lower": {
        if (this._off(host, m.from)) return this._plan("raise", host);
        const box = host._slotBox(m.from, c);
        const z = box ? box.z0 + box.height : this.z;
        this._set("lower", { z }, this._hoistTime(host, z, false));
        break;
      }
      case "lock":
        if (this._off(host, m.from)) return this._plan("raise", host);
        this._set("lock", {}, CRANE.lock_s / this.speed);
        break;
      case "lift": {
        const z = Math.max(this.z, this._travelZ(host, true));
        this._set("lift", { z }, this._hoistTime(host, z, true));
        break;
      }
      case "carry": {
        const box = host._slotBox(m.to, c);
        const [s, t] = box ? this._local(box.center) : [this.s, this.t];
        this._set("carry", { s, t, loadHeading: box ? box.heading : this.loadHeading }, this._travelTime(host, s, t));
        break;
      }
      case "set-down": {
        if (this._off(host, m.to)) return this._plan("lift", host);
        const box = host._slotBox(m.to, c);
        const z = box ? box.z0 + box.height : this.z;
        this._set("set-down", { z }, this._hoistTime(host, z, true));
        break;
      }
      case "release":
        this._set("release", {}, CRANE.lock_s / this.speed);
        break;
    }
  }

  _next(host) {
    switch (this.phase) {
      case "raise": return this._plan("travel", host);
      case "travel": return this._plan("lower", host);
      case "lower": return this._plan("lock", host);
      case "lock": if (this._lock(host)) this._plan("lift", host); return;
      case "lift": return this._plan("carry", host);
      case "carry": return this._plan("set-down", host);
      case "set-down": return this._setDown(host);
      case "release": return host._finish(this);
    }
  }
}

/**
 * A reach stacker. State in layout mm: `x`, `y` (centre), `heading`, `boom` (0 in … 1 out),
 * `lift` (bottom of the spreader above the layout plane).
 *
 * Cycle: drive (to the source) → lower → lock → lift → drive (to the target) → set-down →
 * release; after `park_after_s` without a move it drives back to its parking place (park).
 */
export class StackerHandler extends HandlerBase {
  /** @param {import("./objects.js").ReachStacker} object */
  constructor(object, host) {
    super(object);
    this.kind = "reach-stacker";
    this._first = "drive";
    /** Which drive: to the "source" or the "target". */
    this._leg = "source";
    const g = object.geometry;
    this.x = g?.center[0] ?? 0;
    this.y = g?.center[1] ?? 0;
    this.heading = g?.angle ?? 0;
    this.boom = 0;
    this.lift = host.mm(STACKER_CARRY_M);
    this._parked = true;
  }

  get center() {
    return [this.x, this.y];
  }

  /** Highest tier (0-based, exclusive) it stacks to. */
  get tiers() {
    return clamp(Math.round(Number(this.object.spec.tiers) || 3), 1, 4);
  }

  /** The object changed: a stacker standing at its parking place moves with it. */
  sync(object) {
    this.object = object;
    const g = object.geometry;
    if (g && this._parked && !this._move) {
      this.x = g.center[0];
      this.y = g.center[1];
      this.heading = g.angle;
    }
  }

  begin(move, container, host) {
    this._leg = "source";
    this._parked = false;
    super.begin(move, container, host);
  }

  /**
   * Where it stands to handle a box: `approach_m` from the box centre, perpendicular to the box,
   * on the side it comes from; and the heading facing the box.
   */
  _stand(host, box) {
    const n = [-Math.sin(box.heading), Math.cos(box.heading)];
    const side = (this.x - box.center[0]) * n[0] + (this.y - box.center[1]) * n[1] < 0 ? -1 : 1;
    const d = host.mm(REACH_STACKER.approach_m) * side;
    return { x: box.center[0] + n[0] * d, y: box.center[1] + n[1] * d, heading: Math.atan2(-n[1] * side, -n[0] * side) };
  }

  /** Is it away from where it stands to handle the container's place at `ref`? */
  _off(host, ref) {
    const box = host._slotBox(ref, this.load);
    if (!box) return false;
    const to = this._stand(host, box);
    return dist2([to.x, to.y], [this.x, this.y]) > host.mm(ON_TARGET_M);
  }

  /** Time (s) to drive in a straight line to (x, y). */
  _driveTime(host, x, y) {
    const k = this.speed;
    return trapezoid(dist2([x, y], [this.x, this.y]) / host.mm(1), REACH_STACKER.v * k, REACH_STACKER.a * k * k);
  }

  /** Time (s) to move the boom and the spreader height. */
  _hoistTime(host, boom, lift) {
    const k = this.speed;
    return Math.max((Math.abs(boom - this.boom) * REACH_STACKER.boom_s) / k, Math.abs(lift - this.lift) / host.mm(1) / (REACH_STACKER.hoist_v * k));
  }

  /** Spreader height (mm) while driving. */
  _carryLift(host) {
    return this._move && this.load && this.load.handler === this.id ? host.mm(STACKER_LOAD_M + this.load.height_m) : host.mm(STACKER_CARRY_M);
  }

  _plan(phase, host) {
    const m = this._move, c = this.load;
    switch (phase) {
      case "drive":
      case "park": {
        let to, lift = this._carryLift(host);
        if (phase === "park") {
          const g = this.object.geometry;
          if (!g) return this._set("idle", {}, 0);
          to = { x: g.center[0], y: g.center[1], heading: g.angle };
        } else {
          const box = host._slotBox(this._leg === "source" ? m.from : m.to, c);
          if (!box) return this._set(phase, {}, 0);
          if (this._leg === "source") this.loadHeading = box.heading;
          to = this._stand(host, box);
          // arrive with the spreader just above the box there, so that the boom reaches out over the stack
          lift = Math.max(lift, box.z0 + box.height + host.mm(STACKER_ABOVE_M));
        }
        this._driveHeading = Math.hypot(to.x - this.x, to.y - this.y) > host.mm(0.5) ? Math.atan2(to.y - this.y, to.x - this.x) : this.heading;
        this._endHeading = to.heading;
        const T = Math.max(this._driveTime(host, to.x, to.y), this._hoistTime(host, 0, lift));
        this._set(phase, { x: to.x, y: to.y, boom: 0, lift, spreader_m: c ? c.length_m : this.spreader_m }, T);
        this._h0 = this.heading;
        break;
      }
      case "lower":
      case "set-down": {
        if (this._off(host, phase === "lower" ? m.from : m.to)) return this._plan("drive", host);
        const box = host._slotBox(phase === "lower" ? m.from : m.to, c);
        const lift = box ? box.z0 + box.height : this.lift;
        const facing = box ? this._stand(host, box).heading : this.heading;
        this._set(phase, { heading: facing, boom: 1, lift }, this._hoistTime(host, 1, lift));
        break;
      }
      case "lock":
        if (this._off(host, m.from)) return this._plan("drive", host);
        this._set("lock", {}, REACH_STACKER.lock_s / this.speed);
        break;
      case "lift": {
        // pull the box back over the vehicle at the height it was taken (it is lowered while driving)
        const lift = Math.max(this.lift, host.mm(STACKER_LOAD_M + c.height_m));
        this._set("lift", { boom: 0, lift }, this._hoistTime(host, 0, lift));
        break;
      }
      case "release":
        this._set("release", {}, REACH_STACKER.lock_s / this.speed);
        break;
    }
  }

  /** Driving: the heading turns into the direction of travel at the start (and to the parking heading at the end of a park). */
  _apply(f) {
    super._apply(f);
    if (this.phase === "drive" || this.phase === "park") {
      const raw = this._T > 0 ? this._tau / this._T : 1;
      this.heading = lerpAngle(this._h0, this._driveHeading, smoothstep(Math.min(1, raw * 4)));
      if (this.phase === "park") this.heading = lerpAngle(this.heading, this._endHeading, smoothstep((raw - 0.75) * 4));
    }
  }

  _next(host) {
    switch (this.phase) {
      case "drive": return this._plan(this._leg === "source" ? "lower" : "set-down", host);
      case "lower": return this._plan("lock", host);
      case "lock":
        if (this._lock(host)) {
          this._leg = "target";
          this._plan("lift", host);
        }
        return;
      case "lift": return this._plan("drive", host);
      case "set-down": return this._setDown(host);
      case "release": return host._finish(this);
    }
  }

  abort() {
    super.abort();
    this._leg = "source";
  }

  /** Without a move: after `park_after_s` it drives back to its parking place. */
  _idle(dt, host) {
    if (this.phase === "park") {
      this._tau = Math.min(this._T, this._tau + dt);
      this._apply(this._T > 0 ? smoothstep(this._tau / this._T) : 1);
      if (this._tau >= this._T - 1e-9) {
        this.phase = "idle";
        this._parked = true;
      }
      return;
    }
    this.idle_s += dt;
    if (!this._parked && this.idle_s >= REACH_STACKER.park_after_s / this.speed) {
      this._h0 = this.heading;
      this._plan("park", host);
      if (this.phase !== "park") this._parked = true;
    }
  }
}
