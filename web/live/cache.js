/**
 * The town as a picture of its own (testable in Node): drawn once for a camera pose, then fitted to
 * the poses that follow instead of being drawn again.
 *
 * The picture is larger than the image by a margin on every side, so the camera may turn a little
 * before its edge shows. For each new pose, the picture is warped by the homography of a plane
 * parallel to the table, from the pose it was drawn with to the new one: exact for everything at
 * that height. The height is the one whose warp moves sample points of the town (the corners of
 * footprints on the ground and on the roofs) closest to where the new pose sees them (the largest
 * error is the smallest; a ternary search between the ground and the highest roof). For a camera that
 * only turns, every plane gives the same warp, and the fit is exact; a camera that moves sees the
 * roofs shift against the ground (parallax), and the fit leaves an error. The picture is drawn again
 * when that error exceeds a few pixels, the image leaves the picture, the picture would be magnified
 * or shrunk too much, the town changed, or after a while (traffic lights).
 *
 * Above the horizon there is nothing to draw (a camera above the roofs sees all of the town below
 * it): only the part of the image below the horizon must lie in the picture.
 *
 * The browser applies the warp: a CSS `matrix3d` on the picture's canvas is a projective transform
 * done by the compositor, so a frame without a new drawing of the town costs nearly nothing.
 * @module live/cache
 */
import { toCamera } from "../arail/core/geometry.js";
import { applyH, inv3, mul3 } from "../arail/core/math.js";

/**
 * margin: share of the image added on each side of the picture; maxError: largest error of the fit
 * (image px) before the town is drawn again; maxZoom: largest magnification (or shrinking) of the
 * picture; refresh: seconds after which it is drawn again anyway (traffic lights change); samples:
 * most sample points of the town.
 */
export const CACHE_DEFAULTS = { margin: 0.2, maxError: 2, maxZoom: 1.3, refresh: 10, samples: 600 };

/**
 * Image point (px) of a layout point for a camera pose and pinhole intrinsics, or null behind the camera.
 * @param {{a1: number[], a2: number[], a3: number[], n: number[]}} pose see `poseFromHomography`
 * @param {{fx: number, fy: number, cx: number, cy: number}} K
 * @param {number[]} p [x, y, z] layout mm
 */
export function projectPoint(pose, K, p) {
  const c = toCamera(pose, p[0], p[1], p[2] || 0);
  if (!(c[2] > 1)) return null;
  return [K.fx * (c[0] / c[2]) + K.cx, K.fy * (c[1] / c[2]) + K.cy];
}

/**
 * Homography of the plane at height z above the layout (x, y in mm) to the image (px) for a pose
 * and intrinsics: K [a1 a2 a3 + z n].
 */
export function planeHomographyOf(pose, K, z = 0) {
  const { a1, a2, a3, n } = pose;
  const t = [a3[0] + z * n[0], a3[1] + z * n[1], a3[2] + z * n[2]];
  const row = (f, c, i) => [f * a1[i] + c * a1[2], f * a2[i] + c * a2[2], f * t[i] + c * t[2]];
  return [...row(K.fx, K.cx, 0), ...row(K.fy, K.cy, 1), a1[2], a2[2], t[2]];
}

/**
 * Sample points of the town for fitting the picture: the corners of every footprint on the ground
 * and, for tall objects (`pickHeight`), on their tops, lifted to the heights of raised table modules
 * and bridges; evenly thinned to at most `max`.
 * @param {import("../arail/core/world.js").World} world
 * @param {number} [max]
 * @returns {number[][]} [x, y, z] layout mm
 */
export function citySamples(world, max = CACHE_DEFAULTS.samples) {
  const lift = world.elevation.sync().streetLift;
  const pts = [];
  for (const o of world.objects) {
    if (!o.geometry || typeof o.footprint !== "function") continue;
    const fp = o.footprint();
    if (!fp?.length) continue;
    const top = o.pickHeight() || 0;
    for (const q of fp) {
      const z = lift ? lift(q[0], q[1]) : 0;
      pts.push([q[0], q[1], z]);
      if (top > 0) pts.push([q[0], q[1], z + top]);
    }
  }
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  return Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)]);
}

/**
 * The horizon of the layout plane (and of every plane parallel to it) in the image: [a, b, c] with
 * a² + b² = 1, so that a·u + b·v + c is the distance (px) of the image point (u, v) from it; what
 * lies lower than the camera is seen where it is negative.
 */
export function horizon(pose, K) {
  const n = pose.n;
  const l = [n[0] / K.fx, n[1] / K.fy, n[2] - (n[0] * K.cx) / K.fx - (n[1] * K.cy) / K.fy];
  const s = Math.hypot(l[0], l[1]) || 1;
  return l.map((v) => v / s);
}

/**
 * The size of the picture for an image of `width` × `height` px: the margin on each side (image
 * px) and its size in canvas px at `res` canvas px per image px.
 */
export function pictureSize(width, height, res = 1, margin = CACHE_DEFAULTS.margin) {
  const mx = Math.round(margin * width), my = Math.round(margin * height);
  return { mx, my, res, width: Math.round(res * (width + 2 * mx)), height: Math.round(res * (height + 2 * my)) };
}

/** Clip a polygon (image px) to where a·u + b·v + c ≤ d (Sutherland–Hodgman). */
function clipBelow(poly, [a, b, c], d) {
  const out = [], f = (p) => a * p[0] + b * p[1] + c - d;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp <= 0) out.push(p);
    if ((fp <= 0) !== (fq <= 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Local magnification of a homography at an image point: the square root of its area ratio. */
function zoomAt(M, p) {
  const a = applyH(M, p), b = applyH(M, [p[0] + 1, p[1]]), c = applyH(M, [p[0], p[1] + 1]);
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.sqrt(Math.abs(det));
}

export class CityCache {
  /** @param {Partial<typeof CACHE_DEFAULTS>} [options] */
  constructor(options = {}) {
    this.options = { ...CACHE_DEFAULTS, ...options };
    /**
     * What the picture was drawn with: {pose, K, width, height, size (see pictureSize), time,
     * version, points (the samples' image points, null where not seen)}; null before the first drawing.
     */
    this.ref = null;
    /** Sample points of the town (layout mm), see {@link citySamples}. */
    this.samples = [];
  }

  /** Forget the picture: the next fit asks for a new one. */
  reset() {
    this.ref = null;
  }

  /**
   * The size of a new picture (see {@link pictureSize}) with the margin of the options.
   * @param {number} width image px
   * @param {number} height image px
   * @param {number} [res] canvas px per image px
   */
  picture(width, height, res = 1) {
    return pictureSize(width, height, res, this.options.margin);
  }

  /**
   * Remember the pose the town was just drawn with.
   * @param {{pose: object, K: object, width: number, height: number, size: ReturnType<typeof pictureSize>,
   *   time: number, version?: string}} drawn width, height: the image (px); time: seconds; version: of the town
   */
  drawn({ pose, K, width, height, size, time, version = "" }) {
    this.ref = { pose, K, width, height, size, time, version, points: this.samples.map((p) => projectPoint(pose, K, p)) };
  }

  /**
   * Fit the picture to a pose: the warp from picture px to image px, how well it fits, and why the
   * town must be drawn again ("" when the warp will do).
   * @param {object} pose
   * @param {{fx: number, fy: number, cx: number, cy: number}} K
   * @param {number} width image px
   * @param {number} height image px
   * @param {number} time seconds
   * @param {string} [version] of the town (a change asks for a new drawing)
   * @returns {{M: number[] | null, error: number, zoom: number, points: number, redraw: string}}
   */
  fit(pose, K, width, height, time, version = "") {
    const ref = this.ref, o = this.options;
    const out = (redraw, M = null, error = 0, zoom = 1, points = 0) => ({ M, error, zoom, points, redraw });
    if (!ref) return out("first");
    if (ref.width !== width || ref.height !== height) return out("size");
    if (ref.version !== version) return out("changed");
    if (time - ref.time > o.refresh) return out("refresh");
    const { mx, my, res } = ref.size;
    // pairs of sample points seen in the picture and near the image now
    const src = [], dst = [], mw = 0.1 * width, mh = 0.1 * height;
    let top = 0;
    ref.points.forEach((r, i) => {
      if (!r || r[0] < -mx || r[1] < -my || r[0] > width + mx || r[1] > height + my) return;
      const c = projectPoint(pose, K, this.samples[i]);
      if (!c || c[0] < -mw || c[1] < -mh || c[0] > width + mw || c[1] > height + mh) return;
      src.push(r);
      dst.push(c);
      top = Math.max(top, this.samples[i][2] || 0);
    });
    // the warp of the plane at height z: image px of the reference -> image px now; its largest error
    const warp = (z) => {
      const A = inv3(planeHomographyOf(ref.pose, ref.K, z));
      const Wz = A && mul3(planeHomographyOf(pose, K, z), A);
      let e = 0;
      for (let i = 0; Wz && i < src.length; i++) {
        const q = applyH(Wz, src[i]);
        e = Math.max(e, Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]));
      }
      return { W: Wz, error: Wz && Number.isFinite(e) ? e : Infinity };
    };
    let best = warp(0);
    if (top > 0 && src.length) {
      let a = 0, b = top;
      for (let k = 0; k < 12; k++) {
        const z1 = a + (b - a) / 3, z2 = b - (b - a) / 3;
        if (warp(z1).error < warp(z2).error) b = z2;
        else a = z1;
      }
      const mid = warp((a + b) / 2);
      if (mid.error < best.error) best = mid;
    }
    const { W, error } = best;
    if (!W || !W.every(Number.isFinite)) return out("fit");
    const Winv = inv3(W);
    const zoom = Winv ? zoomAt(W, applyH(Winv, [width / 2, height / 2])) : 1;
    // picture px -> image px of the reference -> image px now, with w > 0 in the picture's middle
    const pw = ref.size.width, ph = ref.size.height;
    let M = mul3(W, [1 / res, 0, -mx, 0, 1 / res, -my, 0, 0, 1]);
    const w = (x, y) => M[6] * x + M[7] * y + M[8];
    if (w(pw / 2, ph / 2) < 0) M = M.map((v) => -v);
    // the warp must keep the whole picture in front (w > 0 at its corners) and cover the image below
    // the horizon (4 px below it: what is seen right at the horizon is endlessly far away)
    const front = [[0, 0], [pw, 0], [pw, ph], [0, ph]].every(([x, y]) => w(x, y) > 0);
    const Minv = inv3(M);
    const seen = clipBelow([[0, 0], [width, 0], [width, height], [0, height]], horizon(pose, K), -4);
    const covered = !!Minv && seen.every((c) => {
      const p = applyH(Minv, c);
      return w(p[0], p[1]) > 0 && p[0] >= -1 && p[1] >= -1 && p[0] <= pw + 1 && p[1] <= ph + 1;
    });
    const redraw = !front ? "behind" : !covered ? "edge" : error > o.maxError ? "error" : zoom > o.maxZoom || zoom < 1 / o.maxZoom ? "zoom" : "";
    return out(redraw, M, error, zoom, src.length);
  }
}

/**
 * The CSS transform of the picture's canvas for a warp M (picture px -> image px): the canvas is
 * laid out at its size in CSS px with its origin at the stage's top left, and `k` is CSS px per
 * image px of the stage. The homography [a b c; d e f; g h i] is the matrix3d of the plane z = 0.
 * @param {number[]} M 3x3 row-major
 * @param {number} k
 */
export function cssMatrix(M, k = 1) {
  const T = mul3([k, 0, 0, 0, k, 0, 0, 0, 1], M);
  const s = T[8] || 1;
  const v = T.map((x) => x / s);
  const n = (x) => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(9));
  return `matrix3d(${[v[0], v[3], 0, v[6], v[1], v[4], 0, v[7], 0, 0, 1, 0, v[2], v[5], 0, v[8]].map(n).join(",")})`;
}
