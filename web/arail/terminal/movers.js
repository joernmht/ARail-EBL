/**
 * Motion of terminal vehicles and handlers: trapezoid travel times and a deterministic 1-D mover
 * along a polyline (trains, trucks and barges of the container terminal).
 *
 * `trapezoid` is final; `PathMover` is a placeholder with the final interface until the
 * terminal operations are implemented.
 * @module arail/terminal/movers
 */
import { polylineLengths } from "../core/math.js";

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

/**
 * Moves a point along a polyline towards a target arc length, with acceleration and braking.
 * Units: mm, mm/s, mm/s².
 */
export class PathMover {
  /**
   * @param {{points: number[][], vmax: number, accel: number, brake: number, s?: number}} options
   */
  constructor({ points, vmax, accel, brake, s = 0 }) {
    this.vmax = vmax;
    this.accel = accel;
    this.brake = brake;
    /** Arc length (mm) of the moving point. */
    this.s = s;
    /** Speed (mm/s). */
    this.v = 0;
    /** @type {number | null} target arc length (mm) */
    this.target = null;
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

  /**
   * Advance by `dt` seconds, never passing arc length `limit`.
   * @returns {boolean} true when the target is reached (the mover stands there)
   */
  step(dt, { limit = Infinity } = {}) {
    return false;
  }

  /**
   * Point and direction at arc length `s`; `offset` + = left; linear extrapolation beyond the ends.
   * @returns {{point: number[], dir: number[]} | null}
   */
  at(s, offset = 0) {
    return null;
  }
}
