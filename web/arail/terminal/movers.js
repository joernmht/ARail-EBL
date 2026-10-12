/**
 * Motion of terminal vehicles and handlers: trapezoid travel times and a deterministic 1-D mover
 * along a polyline (trains, trucks and barges of the container terminal).
 * @module arail/terminal/movers
 */
import { clamp, polylineLengths, sub2, unit2 } from "../core/math.js";

/**
 * Time to travel a distance with a trapezoid speed profile (accelerate, cruise, brake), starting
 * and ending at rest. Any consistent units.
 * @param {number} d distance (its sign is ignored)
 * @param {number} v top speed
 * @param {number} a acceleration and deceleration
 * @returns {number} time
 */
export function trapezoid(d, v, a) {
  const s = Math.abs(d);
  return s <= (v * v) / a ? 2 * Math.sqrt(s / a) : s / v + v / a;
}

/** Arrival tolerances (prototype m and m/s): closer and slower than this counts as there. */
const ARRIVE_M = 0.25, ARRIVE_M_S = 0.6;

/**
 * Moves a point along a polyline towards a target arc length, with acceleration and braking.
 * Units: mm, mm/s, mm/s². Deterministic: the same steps give the same positions.
 */
export class PathMover {
  /**
   * @param {{points: number[][], vmax: number, accel: number, brake: number, s?: number, scale?: number}} options
   *   scale: model scale of the arrival tolerances (0.25 m and 0.6 m/s; default 87, H0)
   */
  constructor({ points, vmax, accel, brake, s = 0, scale = 87 }) {
    this.vmax = vmax;
    this.accel = accel;
    this.brake = brake;
    /** Arc length (mm) of the moving point. */
    this.s = s;
    /** Speed (mm/s), negative while backing up. */
    this.v = 0;
    /** @type {number | null} target arc length (mm) */
    this.target = null;
    this._eps = (ARRIVE_M * 1000) / scale;
    this._vEps = (ARRIVE_M_S * 1000) / scale;
    this.setPath(points);
  }

  /** Change the path; keeps `s`. */
  setPath(points) {
    this.points = Array.isArray(points) ? points : [];
    this.lengths = this.points.length ? polylineLengths(this.points) : [0];
    this.total = this.lengths[this.lengths.length - 1];
  }

  /** Drive to arc length `s` (any number: also back, or beyond the end). */
  setTarget(s) {
    this.target = s;
  }

  /** Is the point at its target (within the arrival tolerances)? */
  arrived() {
    return this.target != null && Math.abs(this.target - this.s) < this._eps && Math.abs(this.v) < this._vEps;
  }

  /**
   * Advance by `dt` seconds: the speed aims at min(vmax, √(2·brake·distance left)), changing by at
   * most `accel` (speeding up) or `brake` (slowing down) per second. The point never passes the
   * target (reaching it ends the move), nor `limit` in its direction of travel (it brakes for it
   * like for the target).
   * @param {number} dt seconds
   * @param {{limit?: number}} [options] limit: arc length (mm) not to pass, e.g. behind the vehicle ahead
   * @returns {boolean} true when the target is reached (the mover then stands exactly there)
   */
  step(dt, { limit = Infinity } = {}) {
    if (this.target == null) {
      this.v = 0;
      return true;
    }
    if (this.arrived()) return this._snap();
    const d = this.target - this.s, dir = Math.sign(d);
    // room to brake: up to the target, or the limit if it comes first
    let room = Math.abs(d);
    const bound = dir > 0 ? (Number.isFinite(limit) ? limit : Infinity) : Number.isFinite(limit) && limit < this.s ? limit : -Infinity;
    if (Number.isFinite(bound)) room = Math.min(room, Math.max(0, dir * (bound - this.s)));
    const want = dir * Math.min(this.vmax, Math.sqrt(2 * this.brake * room));
    const dv = want - this.v;
    const rate = this.v === 0 || this.v * dv > 0 ? this.accel : this.brake;
    this.v += clamp(dv, -rate * dt, rate * dt);
    const next0 = this.s + this.v * dt;
    // never overshoot the target: reaching it ends the move (the speed is low there by then)
    if (dir === 0 || (this.target - this.s) * (this.target - next0) <= 0) return this._snap();
    let next = next0;
    if (Number.isFinite(bound) && dir * (next - bound) > 0) {
      next = dir > 0 ? Math.max(this.s, bound) : Math.min(this.s, bound);
      this.v = 0;
    }
    this.s = next;
    return this.arrived() ? this._snap() : false;
  }

  /** Stand exactly at the target. */
  _snap() {
    this.s = this.target;
    this.v = 0;
    return true;
  }

  /**
   * Point and direction at arc length `s`; `offset` + = left; linear extrapolation beyond the ends.
   * @param {number} s arc length (mm)
   * @param {number} [offset] sideways (mm, + = left)
   * @returns {{point: number[], dir: number[]}}
   */
  at(s, offset = 0) {
    const pts = this.points, n = pts.length, cum = this.lengths, total = this.total;
    if (n < 2) {
      const p = pts[0] || [0, 0];
      return { point: [p[0], p[1] + offset], dir: [1, 0] };
    }
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const dir = unit2(sub2(pts[i], pts[i - 1]));
    const [base, d] = s <= 0 ? [pts[0], s] : s >= total ? [pts[n - 1], s - total] : [pts[i - 1], s - cum[i - 1]];
    return { point: [base[0] + dir[0] * d - dir[1] * offset, base[1] + dir[1] * d + dir[0] * offset], dir };
  }
}
