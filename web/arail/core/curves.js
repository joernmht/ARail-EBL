/**
 * Curves of trams: the corners of a driving line rounded to the radius tram tracks need.
 *
 * Trams cannot turn on the spot: their tracks bend in arcs. `roundCorners` takes a tram's driving
 * line (core/network.js, `drivingLine`) and replaces each corner, where the line turns faster than
 * the radius allows, by an arc tangent to the straight pieces before and after it. A run of vertices
 * turning the same way close together is one corner (the line already bends there, only too
 * tightly); a turn of more than 150° is cut into two corners. Where the straight pieces are too short
 * for the radius, the arc is as large as fits, and the curve is reported as tight. Turning back at
 * the end of a stub track (where trams change ends) stays as it is. Positions along the line (the
 * stops, the positions on the centre line of the streets) are carried over to the new line, and the
 * trams slow down in the curves.
 * @module arail/core/curves
 */
import { polylineLengths } from "./math.js";

/**
 * Curve radii of tram tracks (prototype m): 40 m as a rule, at least 25 m (the alignment guidelines
 * under BOStrab § 15, TRStrab, as planning documents cite them); tighter only in exceptions (Graz
 * 17.5 m, Vienna 18 m). In a curve a tram keeps the lateral acceleration below 0.8 m/s²: about
 * 16 km/h at 25 m.
 */
export const TRAM_CURVES = { standard_m: 40, min_m: 25, lateral: 0.8 };

/**
 * Turns smaller than BENT (radians) are no corner, and a corner turning less than SMALL is not
 * rounded on its own: it goes with its neighbour (a kink of the road network's line beside a curve);
 * more than BACK is turning back.
 */
const BENT = (0.5 * Math.PI) / 180, SMALL = (3 * Math.PI) / 180, BACK = (150 * Math.PI) / 180;

/**
 * Round the corners of a driving line.
 * @param {{points: number[][], lengths: number[], length: number, speeds: number[], marks: number[], centre: number[]}} drive
 * @param {number} radius the radius of the curves (mm)
 * @param {{metre?: number, lateral?: number}} [options] metre: mm per prototype metre (for the speed
 *   in curves); lateral: the lateral acceleration allowed (m/s²)
 * @returns {object} the driving line with round corners (the same fields), and `curves`: [{s0, s1 (on
 *   the new line, mm), radius (mm), points (the arc)}] and `tight`: [{pos, radius}] (curves that
 *   could not get the radius)
 */
export function roundCorners(drive, radius, options = {}) {
  const none = { ...drive, curves: [], tight: [] };
  if (drive.points.length < 3 || !(radius > 0)) return none;
  const clean = unfold(drive);
  const out = round(clean, radius, options);
  if (!out) return none;
  // the marks (on the old line) through the cleaned line onto the new one
  out.marks = (drive.marks || []).map((s) => interpolatePairs(out.map, interpolate(clean.from, clean.lengths, s)));
  delete out.map;
  return out;
}

/**
 * The driving line without the points where it folds back on itself for a moment (a corner point
 * of the road network's line behind samples that have turned already, a point a fraction of a mm
 * back): left out, they would read as corners turning back. A stub end, where the line turns back on
 * the same centre line position, stays. `from`: the old arc length of each point kept.
 */
function unfold(drive) {
  const P = drive.points, L = drive.lengths, c = drive.centre, n = P.length;
  const keep = [0];
  for (let i = 1; i < n; i++) {
    const a = P[keep[keep.length - 1]], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < 0.5 && i < n - 1) continue;
    if (keep.length >= 2 && l > 0) {
      const z = P[keep[keep.length - 2]], ex = a[0] - z[0], ey = a[1] - z[1], m = Math.hypot(ex, ey) || 1;
      const stub = c && Math.abs(c[i] - c[keep[keep.length - 1]]) < 1e-6;
      if (!stub && (ex * dx + ey * dy) / (m * l) < -0.2 && i < n - 1) continue;
    }
    keep.push(i);
  }
  const points = keep.map((i) => P[i]), lengths = polylineLengths(points);
  return {
    points, lengths, length: lengths[lengths.length - 1], from: keep.map((i) => L[i]),
    speeds: keep.slice(0, -1).map((i) => drive.speeds[Math.min(drive.speeds.length - 1, i)]),
    centre: c ? keep.map((i) => c[i]) : lengths.slice(),
  };
}

/** Round the corners of a cleaned driving line (see roundCorners); `map`: [old, new] arc lengths. */
function round(drive, radius, { metre = 1000 / 87, lateral = TRAM_CURVES.lateral } = {}) {
  const P = drive.points, L = drive.lengths, n = P.length;
  const none = null;
  if (n < 3) return none;
  // the directions of the segments (a segment of no length takes its neighbour's)
  const dir = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy);
    dir.push(l > 1e-9 ? [dx / l, dy / l] : null);
  }
  for (let i = 1; i < dir.length; i++) if (!dir[i]) dir[i] = dir[i - 1];
  for (let i = dir.length - 2; i >= 0; i--) if (!dir[i]) dir[i] = dir[i + 1];
  if (!dir[0]) return none;
  const turn = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = dir[i - 1], b = dir[i];
    turn[i] = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
  }
  // the corners: runs of vertices turning the same way; a stub end (the line turns back on the same
  // centre line position) stays as it is
  const c = drive.centre;
  const stubAt = (i) => !!c && Math.abs(turn[i]) > 0.15 && (Math.abs(c[i] - c[i - 1]) < 1e-6 || Math.abs(c[i] - c[i + 1]) < 1e-6);
  // a vertex of a curve drawn with points that bends gently enough already (its turn over the
  // length it shares with the neighbours turning the same way: the radius there) stays
  const bent = (i) => i > 0 && i < n - 1 && Math.abs(turn[i]) >= BENT;
  const gentle = (i) => {
    const own = (bent(i - 1) && Math.sign(turn[i - 1]) === Math.sign(turn[i]) ? (L[i] - L[i - 1]) / 2 : 0)
      + (bent(i + 1) && Math.sign(turn[i + 1]) === Math.sign(turn[i]) ? (L[i + 1] - L[i]) / 2 : 0);
    return own / Math.abs(turn[i]) >= radius * 0.98;
  };
  let groups = [];
  for (let i = 1; i < n - 1; i++) {
    if (Math.abs(turn[i]) < BENT || (Math.abs(turn[i]) < BACK && gentle(i))) continue;
    const g = { a: i, b: i, stub: stubAt(i) || Math.abs(turn[i]) > BACK };
    const last = groups[groups.length - 1];
    if (g.stub && last?.stub && last.b === i - 1) last.b = i;
    else groups.push(g);
  }
  const corner = (g) => fit(P, dir, turn, g, radius);
  // merge neighbours turning the same way whose arcs would overlap; split corners turning back
  for (let changed = true; changed; ) {
    changed = false;
    groups = groups.flatMap((g) => (g.stub ? [g] : split(g, turn)));
    for (let k = 0; k + 1 < groups.length; k++) {
      const g1 = groups[k], g2 = groups[k + 1];
      if (g1.stub || g2.stub) continue;
      const c1 = corner(g1), c2 = corner(g2);
      const small = Math.min(Math.abs(c1.theta), Math.abs(c2.theta)) < SMALL;
      if (Math.sign(c1.theta) !== Math.sign(c2.theta) && !small) continue;
      const room = L[g2.a] - L[g1.b];
      if (c1.needOut + c2.needIn <= room + 1e-6) continue;
      const merged = { a: g1.a, b: g2.b };
      if (Math.abs(corner(merged).theta) > BACK) continue;
      groups.splice(k, 2, merged);
      changed = true;
      break;
    }
  }
  // the arcs, as large as the straight pieces between the corners allow
  const fits = groups.map((g) => (g.stub ? null : corner(g)));
  const tight = [];
  // a kink on its own is left as it is
  fits.forEach((c) => {
    if (c && Math.abs(c.theta) < SMALL) c.keep = true;
  });
  fits.forEach((c, k) => {
    if (!c || c.keep) return;
    const g = groups[k], gp = groups[k - 1], gn = groups[k + 1], cp = fits[k - 1], cn = fits[k + 1];
    const before = L[g.a] - (gp ? L[gp.b] : 0), after = (gn ? L[gn.a] : L[n - 1]) - L[g.b];
    // a straight piece between two curves is shared by what both need
    const pNeed = cp && !cp.keep ? cp.needOut : 0, nNeed = cn && !cn.keep ? cn.needIn : 0;
    const inRoom = c.needIn + pNeed > before ? (before * c.needIn) / Math.max(1e-9, c.needIn + pNeed) : c.needIn;
    const outRoom = c.needOut + nNeed > after ? (after * c.needOut) / Math.max(1e-9, c.needOut + nNeed) : c.needOut;
    c.T = Math.max(Math.min(c.T, c.u + inRoom, c.w + outRoom), c.u, c.w);
    c.radius = c.T / Math.tan(Math.abs(c.theta) / 2);
    if (c.radius < radius * 0.99) tight.push({ pos: c.V, radius: c.radius });
  });
  // the new line: the old points up to each arc, the arc, on from its end
  const centreAt = (s) => interpolate(L, drive.centre || L, s);
  const out = [], centre = [], map = [[0, 0]], curves = [];
  let length = 0;
  const push = (p, c) => {
    const last = out[out.length - 1];
    if (last) {
      const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      if (d < 1e-6) return;
      length += d;
    }
    out.push(p);
    centre.push(c);
  };
  let i = 0;
  fits.forEach((c, k) => {
    if (!c || c.keep) return;
    const g = groups[k], s0 = L[g.a] - (c.T - c.u), s1 = L[g.b] + (c.T - c.w);
    while (i < n && L[i] < s0 - 1e-9) push(P[i], centreAt(L[i++]));
    const Ti = [c.V[0] - c.dIn[0] * c.T, c.V[1] - c.dIn[1] * c.T];
    push(Ti, centreAt(s0));
    const new0 = length;
    map.push([s0, new0]);
    // the arc around its centre, in steps of at most 5°
    const sign = Math.sign(c.theta), r = c.radius, nrm = [-c.dIn[1] * sign, c.dIn[0] * sign];
    const C = [Ti[0] + nrm[0] * r, Ti[1] + nrm[1] * r], a0 = Math.atan2(Ti[1] - C[1], Ti[0] - C[0]);
    const steps = Math.max(2, Math.ceil(Math.abs(c.theta) / ((5 * Math.PI) / 180)));
    const arc = [Ti];
    for (let j = 1; j <= steps; j++) {
      const a = a0 + (c.theta * j) / steps, q = [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r];
      arc.push(q);
      push(q, centreAt(s0 + ((s1 - s0) * j) / steps));
    }
    map.push([s1, length]);
    curves.push({ s0: new0, s1: length, radius: r, points: arc });
    while (i < n && L[i] <= s1 + 1e-9) i++;
  });
  while (i < n) push(P[i], centreAt(L[i++]));
  if (out.length < 2) return none;
  map.push([L[n - 1], length]);
  const lengths = polylineLengths(out);
  // speeds: as on the old line, in a curve at most what the lateral acceleration allows
  const back = map.map(([a, b]) => [b, a]);
  const speeds = [];
  for (let k = 1; k < out.length; k++) {
    const mid = (lengths[k - 1] + lengths[k]) / 2, old = interpolatePairs(back, mid);
    let v = drive.speeds[Math.min(drive.speeds.length - 1, Math.max(0, segmentAt(L, old)))] ?? Infinity;
    const cv = curves.find((cu) => mid > cu.s0 - 1e-9 && mid < cu.s1 + 1e-9);
    if (cv) v = Math.min(v, Math.sqrt(lateral * (cv.radius / metre)));
    speeds.push(v);
  }
  return { points: out, lengths, length: lengths[lengths.length - 1], speeds, centre, curves, tight, map };
}

/**
 * A corner (vertices a..b): the lines in and out, where they meet (V), the turn (theta), how far the
 * corner's first and last vertex lie from V (u, w), the tangent length the radius needs (T, at least
 * u and w: an arc never cuts into what bends already) and how much of the straight pieces it needs
 * beyond them (needIn, needOut). `keep`: it bends gently enough already.
 */
function fit(P, dir, turn, g, radius) {
  const dIn = dir[g.a - 1], dOut = dir[g.b];
  let theta = 0;
  for (let i = g.a; i <= g.b; i++) theta += turn[i];
  let V = P[g.a];
  if (g.b > g.a) {
    const den = dIn[0] * dOut[1] - dIn[1] * dOut[0];
    if (Math.abs(den) > 1e-9) {
      const q = [P[g.b][0] - P[g.a][0], P[g.b][1] - P[g.a][1]];
      const u = (q[0] * dOut[1] - q[1] * dOut[0]) / den;
      V = [P[g.a][0] + dIn[0] * u, P[g.a][1] + dIn[1] * u];
    }
  }
  const u = Math.max(0, (V[0] - P[g.a][0]) * dIn[0] + (V[1] - P[g.a][1]) * dIn[1]);
  const w = Math.max(0, (P[g.b][0] - V[0]) * dOut[0] + (P[g.b][1] - V[1]) * dOut[1]);
  const t = Math.tan(Math.min(Math.abs(theta), BACK) / 2);
  const T = Math.max(radius * t, u, w);
  // the run of vertices bends gently enough: its own tangent points lie further out than the arc's
  const keep = g.b > g.a && radius * t <= Math.min(u, w) * 1.02;
  return { dIn, dOut, theta, V, u, w, T, needIn: T - u, needOut: T - w, keep };
}

/** A corner turning more than 150°: cut into two where it has turned half of it. */
function split(g, turn) {
  let total = 0;
  for (let i = g.a; i <= g.b; i++) total += turn[i];
  if (Math.abs(total) <= BACK || g.b === g.a) return [g];
  let sum = 0;
  for (let i = g.a; i < g.b; i++) {
    sum += turn[i];
    if (Math.abs(sum) >= Math.abs(total) / 2) return [{ a: g.a, b: i }, { a: i + 1, b: g.b }];
  }
  return [g];
}

/** The index of the segment of a polyline (by its cumulative lengths) that arc length s is on. */
function segmentAt(L, s) {
  let lo = 0, hi = L.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Y over ascending X at v, linear, clamped at the ends. */
function interpolate(X, Y, v) {
  const n = X.length;
  if (v <= X[0]) return Y[0];
  if (v >= X[n - 1]) return Y[n - 1];
  const k = segmentAt(X, v), t = (v - X[k]) / (X[k + 1] - X[k] || 1);
  return Y[k] + (Y[k + 1] - Y[k]) * t;
}

/** The same over [[x, y], ...] pairs. */
function interpolatePairs(pairs, v) {
  return interpolate(pairs.map((p) => p[0]), pairs.map((p) => p[1]), v);
}
