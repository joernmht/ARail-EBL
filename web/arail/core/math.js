/**
 * Small, dependency-free math helpers.
 *
 * Conventions used throughout ARail:
 * - 2D points/vectors are arrays `[x, y]`, 3D ones `[x, y, z]`.
 * - 3x3 matrices (homographies) are row-major arrays of length 9.
 * - Angles are radians unless a name ends in `Deg`.
 * @module arail/core/math
 */

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Smooth 0..1 ramp (cubic Hermite). */
export const smoothstep = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a %= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  else if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Weighted circular mean of angles. */
export function meanAngle(angles, weights) {
  let s = 0, c = 0;
  angles.forEach((a, i) => {
    const w = weights ? weights[i] : 1;
    s += w * Math.sin(a);
    c += w * Math.cos(a);
  });
  return Math.atan2(s, c);
}

export function median(values) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/* ------------------------------------------------------------------ 2D vectors */

export const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a, s) => [a[0] * s, a[1] * s];
export const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len2 = (a) => Math.hypot(a[0], a[1]);
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit2 = (a) => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
/** Rotate by +90 degrees (counter-clockwise when seen from above). */
export const perpLeft = (u) => [-u[1], u[0]];
export const rotate2 = (v, theta) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
};
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/* ------------------------------------------------------------------ 3D vectors */

export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/* ------------------------------------------------------------------ 2D poses */

/**
 * A 2D pose on the layout plane: position in mm and rotation in radians.
 * @typedef {{x: number, y: number, theta: number}} Pose2D
 */

/** Map a point given in the local frame of `pose` to the parent frame. */
export function poseApply(pose, p) {
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  return [pose.x + c * p[0] - s * p[1], pose.y + s * p[0] + c * p[1]];
}

/** Map a point given in the parent frame into the local frame of `pose`. */
export function poseInverseApply(pose, p) {
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  const dx = p[0] - pose.x, dy = p[1] - pose.y;
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** Compose poses: `b` is expressed in the frame of `a`. */
export function poseCompose(a, b) {
  const [x, y] = poseApply(a, [b.x, b.y]);
  return { x, y, theta: wrapAngle(a.theta + b.theta) };
}

export function poseInverse(a) {
  const c = Math.cos(a.theta), s = Math.sin(a.theta);
  return { x: -(c * a.x + s * a.y), y: -(-s * a.x + c * a.y), theta: wrapAngle(-a.theta) };
}

/* ------------------------------------------------------------------ linear systems */

/**
 * Solve the n x n system `A x = b` by Gaussian elimination with partial pivoting.
 * @param {number[][]} A rows of the matrix (not modified)
 * @param {number[]} b right-hand side (not modified)
 * @returns {number[] | null} solution, or null if the matrix is (nearly) singular
 */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
  }
  return C;
}

export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/* ------------------------------------------------------------------ homographies */

/** Apply homography `H` to the 2D point `p`. */
export function applyH(H, p) {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

/** Exact homography from four point pairs (`src[i]` maps to `dst[i]`). */
export function homography4(src, dst) {
  const A = [], b = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k], [u, v] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? h.concat([1]) : null;
}

/** Similarity normalisation (Hartley): centroid to the origin, mean distance sqrt(2). */
function normalisation(P) {
  let mx = 0, my = 0;
  for (const p of P) {
    mx += p[0];
    my += p[1];
  }
  mx /= P.length;
  my /= P.length;
  let d = 0;
  for (const p of P) d += Math.hypot(p[0] - mx, p[1] - my);
  const s = Math.SQRT2 / Math.max(d / P.length, 1e-9);
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

/**
 * Least-squares homography from four or more point pairs (normalised DLT).
 * @returns {number[] | null}
 */
export function homographyLS(src, dst) {
  if (src.length < 4) return null;
  if (src.length === 4) return homography4(src, dst);
  const T1 = normalisation(src), T2 = normalisation(dst);
  const a = src.map((p) => applyH(T1, p)), b = dst.map((p) => applyH(T2, p));
  const N = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const r = new Array(8).fill(0);
  const addRow = (z, w) => {
    for (let i = 0; i < 8; i++) {
      r[i] += z[i] * w;
      for (let j = 0; j < 8; j++) N[i][j] += z[i] * z[j];
    }
  };
  for (let k = 0; k < a.length; k++) {
    const [x, y] = a[k], [u, v] = b[k];
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(N, r);
  if (!h) return null;
  const T2i = inv3(T2);
  return T2i ? mul3(mul3(T2i, h.concat([1])), T1) : null;
}

/**
 * Least-squares similarity transform (translation, rotation, uniform scale) that maps
 * `src` onto `dst`; returns a function that applies it to a point.
 */
export function similarity(src, dst) {
  const n = src.length;
  let mvx = 0, mvy = 0, mnx = 0, mny = 0;
  for (let i = 0; i < n; i++) {
    mvx += src[i][0];
    mvy += src[i][1];
    mnx += dst[i][0];
    mny += dst[i][1];
  }
  mvx /= n; mvy /= n; mnx /= n; mny /= n;
  let re = 0, im = 0, nn = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - mvx, ay = src[i][1] - mvy, bx = dst[i][0] - mnx, by = dst[i][1] - mny;
    re += ax * bx + ay * by;
    im += ax * by - ay * bx;
    nn += ax * ax + ay * ay;
  }
  re /= nn || 1;
  im /= nn || 1;
  return (p) => {
    const x = p[0] - mvx, y = p[1] - mvy;
    return [x * re - y * im + mnx, x * im + y * re + mny];
  };
}

/* ------------------------------------------------------------------ polygons */

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross2(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

export function polygonCentroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], c = cross2(p, q);
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** True if the (closed) quadrilateral/polygon is strictly convex. */
export function isConvex(poly) {
  let sign = 0;
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n], c = poly[(k + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) return false;
    if (!sign) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

/** Distance from point `p` to segment `a`-`b`, plus the segment parameter t in [0, 1]. */
export function pointSegment(p, a, b) {
  const ab = sub2(b, a), l2 = dot2(ab, ab);
  const t = l2 > 0 ? clamp(dot2(sub2(p, a), ab) / l2, 0, 1) : 0;
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { distance: dist2(p, q), t, point: q };
}

/* ------------------------------------------------------------------ polylines */

/** Cumulative lengths of a polyline, starting with 0. */
export function polylineLengths(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist2(pts[i - 1], pts[i]));
  return out;
}

/**
 * Point and unit direction at arc length `s` along a polyline (clamped to its ends).
 * @param {number[][]} pts polyline points
 * @param {number} s arc length from the first point
 * @param {number[]} [cum] cached result of {@link polylineLengths}
 */
export function polylineAt(pts, s, cum = polylineLengths(pts)) {
  const total = cum[cum.length - 1];
  if (pts.length < 2) return { point: pts[0] || [0, 0], dir: [1, 0] };
  s = clamp(s, 0, total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  return { point: lerp2(pts[i - 1], pts[i], t), dir: unit2(sub2(pts[i], pts[i - 1])) };
}

/** Closest point on a polyline: arc length, lateral distance and signed side (+1 = left). */
export function polylineProject(pts, p, cum = polylineLengths(pts)) {
  let best = { s: 0, distance: Infinity, side: 0 };
  for (let i = 1; i < pts.length; i++) {
    const r = pointSegment(p, pts[i - 1], pts[i]);
    if (r.distance < best.distance) {
      const side = Math.sign(cross2(sub2(pts[i], pts[i - 1]), sub2(p, pts[i - 1]))) || 1;
      best = { s: cum[i - 1] + r.t * (cum[i] - cum[i - 1]), distance: r.distance, side };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ random numbers */

/** FNV-1a hash of the parts joined by "|" (a seed for `createRng` from what a stream decides). */
export function hashKey(...parts) {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Small, fast, seedable random number generator (xorshift32) with helpers.
 * Simulations use it so that runs are reproducible for a given seed.
 */
export function createRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const rng = {
    next,
    uniform: (a = 0, b = 1) => a + (b - a) * next(),
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: (mean = 0, sd = 1) => mean + sd * Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next()),
    poisson: (lambda) => {
      if (!(lambda > 0)) return 0;
      if (lambda > 30) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    /** Pick an index with probability proportional to `weights`. */
    weighted: (weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) return i;
        r -= weights[i];
      }
      return weights.length - 1;
    },
  };
  return rng;
}
