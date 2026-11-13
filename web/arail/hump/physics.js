/**
 * The physics of a cut on the hump: the forces along its route (gravity over its whole length,
 * rolling, curve and switch resistance, air resistance with the wind, the retarders on its axles)
 * and its run without retarders, integrated over distance forwards (where does it stop, how fast
 * does it arrive) and backwards (how fast must it be here to arrive there at a given speed), and
 * over time (where is it when).
 *
 * Forces in kN, masses in t (so kN / t = m/s²); positions m along the route, speeds m/s.
 * @module arail/hump/physics
 */
import { AIR, AIR_DENSITY, G, SWITCHES, curveResistance } from "./params.js";

/**
 * A cut's body: its wagons from its front, with where each one and its axles are in it.
 * @param {import("./cuts.js").Wagon[]} wagons
 * @returns {{wagons: object[], parts: {off: number, len: number, m: number, w: number, cwA: number, axles: number[], axle_t: number}[],
 *   length_m: number, mass_t: number, eff_t: number, w: number}}
 *   off: from the cut's front to the wagon's front (m); axles: from the cut's front (m); eff_t: mass with the rotating
 *   wheelsets; w: the rolling resistance of the whole cut, by weight (N/kN)
 */
export function cutBody(wagons) {
  let off = 0, mass = 0, eff = 0, wsum = 0;
  const parts = wagons.map((w, i) => {
    const p = { off, len: w.length_m, m: w.mass_t, w: w.w, cwA: w.cwA * (i ? AIR.FOLLOWING : 1), axles: w.axles.map((a) => off + a), axle_t: w.mass_t / w.axles.length };
    off += w.length_m;
    mass += w.mass_t;
    eff += w.mass_t + w.rot_t;
    wsum += w.mass_t * w.w;
    return p;
  });
  return { wagons, parts, length_m: off, mass_t: mass, eff_t: eff, w: mass > 0 ? wsum / mass : 0 };
}

/**
 * The forces on a cut whose front is at s.
 * @param {import("./yard.js").HumpYard} yard
 * @param {string[]} route its route (segment ids from the root)
 * @param {ReturnType<typeof cutBody>} body
 * @param {number} s front (m along the route)
 * @param {number} v speed (m/s)
 * @param {{wind_mps?: number, w?: number, level?: (r: object) => number}} [options]
 *   wind_mps: head wind; w: a rolling resistance for all wagons instead of their own (the control's estimate);
 *   level: how far each retarder is closed (0…1); without it, no retarder brakes (not even speed-holding units)
 * @returns {{drive: number, resist: number, retard: number, eff_t: number}} drive: gravity and air along the route
 *   (kN, + forwards); resist: rolling, curve and switch resistance (kN, against the motion); retard: the retarders (kN)
 */
export function cutForces(yard, route, body, s, v, options = {}) {
  let drive = 0, resist = 0, retard = 0, cwA = 0;
  const wOverride = options.w;
  for (const p of body.parts) {
    const front = s - p.off, rear = front - p.len, mid = front - p.len / 2;
    const sf = yard.segmentOn(route, front), sr = rear < sf.s0 ? yard.segmentOn(route, rear) : sf;
    drive -= (p.m * G * (yard.heightAt(sf, front) - yard.heightAt(sr, rear))) / p.len;
    const sm = mid < sf.s0 ? yard.segmentOn(route, mid) : sf;
    let w = wOverride ?? p.w;
    const r = yard.radiusAt(sm, mid);
    if (r > 0) w += curveResistance(r);
    if (sm.turnout && mid >= sm.turnout.s0 && mid < sm.turnout.s1) w += (1000 * SWITCHES.loss_m) / (sm.turnout.s1 - sm.turnout.s0);
    resist += (p.m * G * w) / 1000;
    cwA += p.cwA;
  }
  const u = v + (options.wind_mps || 0);
  drive -= (0.5 * AIR_DENSITY * cwA * u * Math.abs(u)) / 1000;
  if (options.level) {
    for (const id of route) {
      for (const r of yard.segments.get(id).retarders) {
        // speed-holding units brake by themselves whatever is faster than their speed
        const lvl = r.hold_mps != null ? (v > r.hold_mps ? 1 : 0) : options.level(r);
        if (!(lvl > 0) || s - body.length_m >= r.s1 || s < r.s0) continue;
        for (const p of body.parts) {
          for (const a of p.axles) {
            const x = s - a;
            if (x >= r.s0 && x < r.s1) retard += (lvl * r.w_max * p.axle_t * G) / 1000;
          }
        }
      }
    }
  }
  return { drive, resist, retard, eff_t: body.eff_t };
}

/** Distance step (m) of the runs integrated over distance. */
const STEP_M = 1;

/**
 * A free run without retarders and without other cuts, integrated over distance: where it stops, or
 * how fast it is at `to`.
 * @param {import("./yard.js").HumpYard} yard
 * @param {string[]} route
 * @param {ReturnType<typeof cutBody>} body
 * @param {number} from front at the start (m)
 * @param {number} v0 speed there (m/s)
 * @param {number} to front at the end (m)
 * @param {{wind_mps?: number, w?: number}} [options]
 * @returns {{reached: boolean, v: number, stop_m: number|null}} v: the speed at `to` (0 if it stops before)
 */
export function coast(yard, route, body, from, v0, to, options = {}) {
  let e = (v0 * v0) / 2, s = from;
  while (s < to - 1e-9) {
    const ds = Math.min(STEP_M, to - s);
    const v = Math.sqrt(2 * e);
    const f = cutForces(yard, route, body, s + ds / 2, v, options);
    const de = (ds * (f.drive - f.resist)) / f.eff_t;
    if (e + de <= 0) return { reached: false, v: 0, stop_m: s + (de < 0 ? (ds * e) / -de : ds) };
    e += de;
    s += ds;
  }
  return { reached: true, v: Math.sqrt(2 * e), stop_m: null };
}

/**
 * The speed a cut needs at each position between `from` and `to` to arrive at `to` with `v_to`,
 * running free (no retarders), by integrating its energy backwards from `to`. Where any speed would
 * do (it would arrive too fast even from a standstill), it needs 0.
 * @param {import("./yard.js").HumpYard} yard
 * @param {string[]} route
 * @param {ReturnType<typeof cutBody>} body
 * @param {number} from
 * @param {number} to
 * @param {number} v_to
 * @param {{wind_mps?: number, w?: number}} [options]
 * @returns {{from: number, to: number, step: number, v: Float64Array, at: (s: number) => number}} v[k]: needed at from + k·step
 */
export function requiredSpeeds(yard, route, body, from, to, v_to, options = {}) {
  const n = Math.max(1, Math.ceil((to - from) / STEP_M));
  const step = (to - from) / n;
  const v = new Float64Array(n + 1);
  let e = (v_to * v_to) / 2;
  v[n] = v_to;
  for (let k = n; k > 0; k--) {
    const s = from + (k - 0.5) * step;
    const f = cutForces(yard, route, body, s, Math.sqrt(2 * e), options);
    e = Math.max(0, e - (step * (f.drive - f.resist)) / f.eff_t);
    v[k - 1] = Math.sqrt(2 * e);
  }
  const at = (s) => {
    if (s <= from) return v[0];
    if (s >= to) return v[n];
    const x = (s - from) / step, k = Math.floor(x);
    return v[k] + (v[k + 1] - v[k]) * (x - k);
  };
  return { from, to, step, v, at };
}

/**
 * A run without other cuts, integrated over time: where the cut is every `dt` until it stops or
 * reaches `to`, where it stays. Retarders brake only if `options.level` says so (speed-holding units
 * then by themselves).
 * @param {import("./yard.js").HumpYard} yard
 * @param {string[]} route
 * @param {ReturnType<typeof cutBody>} body
 * @param {number} from front at the start (m)
 * @param {number} v0 speed there (m/s)
 * @param {number} to the end of the run (m)
 * @param {{wind_mps?: number, w?: number, level?: (r: object) => number, dt?: number, max_s?: number}} [options] dt: the step (s, 0.25)
 * @returns {{dt: number, s: Float64Array, v: Float64Array, at: (t: number) => {s: number, v: number}}}
 */
export function timeRun(yard, route, body, from, v0, to, options = {}) {
  const dt = options.dt ?? 0.25, n = Math.ceil((options.max_s ?? 1800) / dt);
  const ss = [from], vs = [v0];
  let s = from, v = v0;
  for (let k = 0; k < n && v > 0 && s < to; k++) {
    const f = cutForces(yard, route, body, s, v, options);
    const a = (f.drive - f.resist - f.retard) / f.eff_t, v1 = v + a * dt;
    if (v1 <= 0) {
      s += a < 0 ? (v * v) / (-2 * a) : 0;
      v = 0;
    } else {
      s += ((v + v1) / 2) * dt;
      v = v1;
    }
    if (s >= to) [s, v] = [to, 0];
    ss.push(s);
    vs.push(v);
  }
  const S = Float64Array.from(ss), V = Float64Array.from(vs);
  const at = (t) => {
    const x = t / dt, k = Math.floor(x);
    if (k < 0) return { s: S[0], v: V[0] };
    if (k >= S.length - 1) return { s: S[S.length - 1], v: V[V.length - 1] };
    return { s: S[k] + (S[k + 1] - S[k]) * (x - k), v: V[k] + (V[k + 1] - V[k]) * (x - k) };
  };
  return { dt, s: S, v: V, at };
}

/**
 * The energy height of a cut (m): the height of its centre of mass above a datum plus its speed
 * height, v²/(2g) scaled by the rotating masses (the energy line of hump design).
 * @param {import("./yard.js").HumpYard} yard
 * @param {string[]} route
 * @param {ReturnType<typeof cutBody>} body
 * @param {number} s front
 * @param {number} v
 */
export function energyHeight(yard, route, body, s, v) {
  let h = 0;
  for (const p of body.parts) h += p.m * yard.height(route, s - p.off - p.len / 2);
  return h / body.mass_t + (body.eff_t / body.mass_t) * ((v * v) / (2 * G));
}
