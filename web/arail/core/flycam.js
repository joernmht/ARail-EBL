/**
 * Virtual camera for the flyover: an orbit camera around a point on the layout plane.
 *
 * The camera looks at `target` (layout mm, on the plane z = 0) from `distance` mm away. `yaw` is
 * the direction it looks in, seen from above (radians, counter-clockwise from the layout's +x
 * axis); `pitch` is how steeply it looks down (radians, 90° = straight down: the plan view).
 * There is no roll: the horizon stays level.
 *
 * Its image is described like a real camera's: a homography layout (mm, z = 0) -> image (px),
 *   H = K [r1 r2 t],
 * with the intrinsics K of a pinhole camera of focal length `focal` (principal point at the image
 * centre) and the rotation R = [r1 r2 r3] and translation t of the camera. A `View` built with a
 * `Camera` of that focal length and this H draws exactly like the real camera. `homography()`
 * also returns the pose itself: the View can then skip recovering it from H, which assumes that
 * the layout origin is in front of the camera (in the flyover it may be behind).
 * @module arail/core/flycam
 */
import { clamp, inv3, toDeg, toRad, wrapAngle } from "./math.js";

/** Lowest and highest pitch: the camera never looks along the table nor beyond the vertical. */
export const PITCH_MIN = toRad(8);
export const PITCH_MAX = toRad(90);

/** Defaults of a new flyover camera (looking along +y at a 50° angle, like standing in front of the table). */
export const FLYCAM_DEFAULTS = { target: [0, 0], distance: 1500, yaw: Math.PI / 2, pitch: toRad(50), fovY: toRad(45) };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class FlyCamera {
  /**
   * @param {object} [options]
   * @param {number[]} [options.target] point looked at, [x, y] layout mm
   * @param {number} [options.distance] distance of the camera from the target (mm)
   * @param {number} [options.yaw] viewing direction seen from above (radians, 0 = along +x)
   * @param {number} [options.pitch] downward tilt (radians, PITCH_MIN .. PITCH_MAX; 90° = plan view)
   * @param {number} [options.fovY] vertical field of view (radians)
   * @param {number} [options.minDistance=25] closest approach (mm)
   * @param {number} [options.maxDistance=60000] farthest distance (mm)
   */
  constructor({ target, distance, yaw, pitch, fovY, minDistance = 25, maxDistance = 60000 } = {}) {
    const d = FLYCAM_DEFAULTS;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.target = [...(target || d.target)];
    this.distance = d.distance;
    this.yaw = d.yaw;
    this.pitch = d.pitch;
    this.fovY = d.fovY;
    this.set({ distance, yaw, pitch, fovY });
  }

  /** Change the camera; values are kept within their limits (undefined keeps a value). */
  set({ target, distance, yaw, pitch, fovY } = {}) {
    if (target && Number.isFinite(+target[0]) && Number.isFinite(+target[1])) this.target = [+target[0], +target[1]];
    if (Number.isFinite(distance)) this.distance = clamp(distance, this.minDistance, this.maxDistance);
    if (Number.isFinite(yaw)) this.yaw = wrapAngle(yaw);
    if (Number.isFinite(pitch)) this.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (Number.isFinite(fovY)) this.fovY = clamp(fovY, toRad(10), toRad(100));
    return this;
  }

  clone() {
    return new FlyCamera({ ...this.state(), minDistance: this.minDistance, maxDistance: this.maxDistance });
  }

  /** Plain copy of the camera state (for animations). */
  state() {
    return { target: [...this.target], distance: this.distance, yaw: this.yaw, pitch: this.pitch, fovY: this.fovY };
  }

  /** True when looking (almost) straight down. */
  get isPlan() {
    return this.pitch > PITCH_MAX - toRad(0.5);
  }

  /* ---------------------------------------------------------------- geometry */

  /**
   * Camera axes in the layout frame and the eye position (mm): `right` (image x), `down`
   * (image y), `fwd` (viewing direction); a right-handed camera frame (right × down = fwd).
   */
  basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = [cp * cy, cp * sy, -sp];
    const right = [sy, -cy, 0];
    const down = [-sp * cy, -sp * sy, -cp];
    const d = this.distance;
    const eye = [this.target[0] - d * fwd[0], this.target[1] - d * fwd[1], -d * fwd[2]];
    return { right, down, fwd, eye };
  }

  /** Focal length (px) for an image of the given height. */
  focal(height) {
    return height / 2 / Math.tan(this.fovY / 2);
  }

  /**
   * The camera pose as `poseFromHomography` describes it: a layout point (x, y, z) has the
   * camera coordinates x·a1 + y·a2 + a3 + z·n (mm, z forward).
   */
  pose() {
    const { right, down, fwd, eye } = this.basis();
    const col = (i) => [right[i], down[i], fwd[i]];
    const dot = (r) => r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2];
    return { a1: col(0), a2: col(1), a3: [-dot(right), -dot(down), -dot(fwd)], n: col(2) };
  }

  /**
   * Homography layout (mm, z = 0) -> image (px) for an image of width × height pixels.
   * The third row of H is the depth (mm) of a layout point, so H[6]·x + H[7]·y + H[8] > 0
   * exactly for points in front of the camera.
   * @returns {{H: number[], Hinv: number[], focal: number, pose: {a1: number[], a2: number[], a3: number[], n: number[]}}}
   */
  homography(width, height) {
    const f = this.focal(height), cx = width / 2, cy = height / 2;
    const pose = this.pose();
    const { a1, a2, a3 } = pose;
    const K = (c) => [f * c[0] + cx * c[2], f * c[1] + cy * c[2], c[2]];
    const c1 = K(a1), c2 = K(a2), c3 = K(a3);
    const H = [c1[0], c2[0], c3[0], c1[1], c2[1], c3[1], c1[2], c2[2], c3[2]];
    return { H, Hinv: inv3(H), focal: f, pose };
  }

  /** Image position (px) of a layout point, or null if it is behind the camera. */
  project(p, width, height) {
    const { right, down, fwd, eye } = this.basis();
    const v = [p[0] - eye[0], p[1] - eye[1], (p[2] || 0) - eye[2]];
    const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
    if (!(z > 1e-6)) return null;
    const f = this.focal(height);
    return [width / 2 + (f * (v[0] * right[0] + v[1] * right[1] + v[2] * right[2])) / z, height / 2 + (f * (v[0] * down[0] + v[1] * down[1] + v[2] * down[2])) / z];
  }

  /**
   * The layout point (z = 0) seen at image pixel (u, v), or null above the horizon.
   * @param {number} [maxRange] ignore points farther than this from the eye (mm)
   */
  groundPoint(u, v, width, height, maxRange = Infinity) {
    const { right, down, fwd, eye } = this.basis();
    const f = this.focal(height);
    const x = (u - width / 2) / f, y = (v - height / 2) / f;
    const dir = [0, 1, 2].map((i) => x * right[i] + y * down[i] + fwd[i]);
    if (!(dir[2] < -1e-9)) return null;
    const s = -eye[2] / dir[2];
    if (s * Math.hypot(...dir) > maxRange) return null;
    return [eye[0] + s * dir[0], eye[1] + s * dir[1]];
  }

  /** Ground scale at the target: image pixels per layout mm. */
  pxPerMM(height) {
    return this.focal(height) / this.distance;
  }

  /* ---------------------------------------------------------------- navigation */

  /** Turn around the target (radians; positive yaw = counter-clockwise seen from above). */
  orbit(dYaw, dPitch = 0) {
    return this.set({ yaw: this.yaw + dYaw, pitch: this.pitch + dPitch });
  }

  /**
   * Turn the view about the vertical through the ground point under the pixel (px, py) (or the
   * target): that point stays where it is in the image (a two-finger twist).
   */
  turnAt(dYaw, px, py, width, height) {
    const g = px == null ? null : this.groundPoint(px, py, width, height, 40 * this.distance);
    if (g) {
      const c = Math.cos(dYaw), s = Math.sin(dYaw), dx = this.target[0] - g[0], dy = this.target[1] - g[1];
      this.target = [g[0] + c * dx - s * dy, g[1] + s * dx + c * dy];
    }
    this.yaw = wrapAngle(this.yaw + dYaw);
    return this;
  }

  /**
   * Slide over the layout: the ground point under the pointer at `at` (px) moves along with the
   * pointer by (dx, dy) px. Near the horizon (or above it) the shift is limited.
   * @param {number[]} [at] pointer position before the move (default: image centre)
   */
  pan(dx, dy, width, height, at = [width / 2, height / 2]) {
    const range = 40 * this.distance;
    const g0 = this.groundPoint(at[0], at[1], width, height, range);
    const g1 = this.groundPoint(at[0] + dx, at[1] + dy, width, height, range);
    let shift;
    if (g0 && g1) shift = [g0[0] - g1[0], g0[1] - g1[1]];
    else {
      // above the horizon: move like a map at the scale of the target
      const k = 1 / this.pxPerMM(height), { right } = this.basis();
      const fw = [Math.cos(this.yaw), Math.sin(this.yaw)];
      shift = [-k * (dx * right[0] - dy * fw[0]), -k * (dx * right[1] - dy * fw[1])];
    }
    const max = 4 * this.distance; // never jump far in one step
    const l = Math.hypot(shift[0], shift[1]);
    if (l > max) shift = [(shift[0] * max) / l, (shift[1] * max) / l];
    this.target = [this.target[0] + shift[0], this.target[1] + shift[1]];
    return this;
  }

  /**
   * Zoom by `factor` (> 1 = closer) towards the ground point under the pixel (px, py): that
   * point stays where it is in the image. Above the horizon it zooms towards the target.
   */
  zoomAt(factor, px, py, width, height) {
    if (!(factor > 0)) return this;
    const d1 = clamp(this.distance / factor, this.minDistance, this.maxDistance);
    const k = d1 / this.distance;
    const g = px == null ? null : this.groundPoint(px, py, width, height, 40 * this.distance);
    if (g) {
      // a homothety around g: the ray from the eye through g keeps its direction
      this.target = [g[0] + (this.target[0] - g[0]) * k, g[1] + (this.target[1] - g[1]) * k];
    }
    this.distance = d1;
    return this;
  }

  /** Look straight down (the yaw is kept, so the map does not turn). */
  planView() {
    return this.set({ pitch: PITCH_MAX });
  }

  /**
   * Show a rectangle of the layout: look at its centre from the current direction and move as
   * close as possible with all of it in the image (with a margin).
   * @param {number[]} bounds [xmin, ymin, xmax, ymax] layout mm
   * @param {number} aspect image width / height
   * @param {number} [margin=0.06] free border, as a share of the image size
   */
  fit(bounds, aspect = 16 / 9, margin = 0.06) {
    const [x0, y0, x1, y1] = bounds;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 < x0 || y1 < y0) return this;
    const H = 1000, W = H * Math.max(0.1, aspect);
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    this.target = [(x0 + x1) / 2, (y0 + y1) / 2];
    for (let iter = 0; iter < 3; iter++) {
      // closest distance at which all corners are inside the image
      const fits = (d) => {
        this.distance = d;
        return corners.every((c) => {
          const p = this.project(c, W, H);
          return p && p[0] >= margin * W && p[0] <= (1 - margin) * W && p[1] >= margin * H && p[1] <= (1 - margin) * H;
        });
      };
      let lo = this.minDistance, hi = this.maxDistance;
      if (fits(lo)) hi = lo;
      else if (!fits(hi)) lo = hi;
      for (let i = 0; i < 40 && hi - lo > 0.5; i++) {
        const mid = Math.sqrt(lo * hi);
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      this.distance = hi;
      // centre the projected rectangle (perspective makes the near side larger)
      const pts = corners.map((c) => this.project(c, W, H)).filter(Boolean);
      if (pts.length < 4) break;
      const mx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
      const my = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
      if (Math.hypot(mx - W / 2, my - H / 2) < 1) break;
      this.pan(W / 2 - mx, H / 2 - my, W, H, [mx, my]);
    }
    return this;
  }

  /* ---------------------------------------------------------------- animation and files */

  /**
   * Camera state between two states `a` and `b` (t = 0 .. 1, eased): the target moves along a
   * line, the distance changes geometrically and the yaw turns the shorter way round.
   */
  static between(a, b, t) {
    const e = easeInOut(clamp(t, 0, 1));
    const dYaw = wrapAngle(b.yaw - a.yaw);
    return {
      target: [a.target[0] + (b.target[0] - a.target[0]) * e, a.target[1] + (b.target[1] - a.target[1]) * e],
      distance: a.distance * (b.distance / a.distance) ** e,
      yaw: a.yaw + dYaw * e,
      pitch: a.pitch + (b.pitch - a.pitch) * e,
      fovY: a.fovY + (b.fovY - a.fovY) * e,
    };
  }

  /** For storing: `{target: [x, y], distance_mm, yaw_deg, pitch_deg, fov_deg}`. */
  toJSON() {
    const r = (v, k = 10) => Math.round(v * k) / k;
    return { target: [r(this.target[0]), r(this.target[1])], distance_mm: r(this.distance), yaw_deg: r(toDeg(this.yaw), 100), pitch_deg: r(toDeg(this.pitch), 100), fov_deg: r(toDeg(this.fovY), 100) };
  }

  /** A camera from `toJSON()` output; missing or invalid values take the defaults. */
  static fromJSON(json = {}) {
    const num = (v) => (v == null || v === "" ? undefined : Number(v));
    const deg = (v) => (Number.isFinite(num(v)) ? toRad(num(v)) : undefined);
    const t = Array.isArray(json?.target) && json.target.length >= 2 && json.target.every((v) => Number.isFinite(+v)) ? json.target.map(Number) : undefined;
    return new FlyCamera({ target: t, distance: num(json?.distance_mm), yaw: deg(json?.yaw_deg), pitch: deg(json?.pitch_deg), fovY: deg(json?.fov_deg) });
  }
}

/**
 * Lines of a grid on the layout plane within `bounds`: every `size` mm, every `major`-th line
 * marked as major; the axes (x = 0, y = 0) are reported separately.
 * @param {number[]} bounds [xmin, ymin, xmax, ymax]
 * @param {number} size grid spacing (mm)
 * @param {{major?: number, maxLines?: number}} [options] at most `maxLines` lines per direction
 *   (coarser levels are used when there would be more)
 * @returns {{minor: number[][][], major: number[][][], axes: {x: number[][] | null, y: number[][] | null}, step: number}}
 *   line segments [[x0, y0], [x1, y1]]; `step` is the spacing actually used
 */
export function gridLines(bounds, size, { major = 10, maxLines = 400 } = {}) {
  const [x0, y0, x1, y1] = bounds;
  const out = { minor: [], major: [], axes: { x: null, y: null }, step: size };
  if (!(size > 0) || ![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return out;
  let step = size;
  while (Math.max(x1 - x0, y1 - y0) / step > maxLines) step *= major;
  out.step = step;
  const majorStep = size * major;
  const isMajor = (v) => Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
  for (let i = Math.ceil(x0 / step); i * step <= x1; i++) {
    const x = i * step;
    if (Math.abs(x) < 1e-9) out.axes.y = [[0, y0], [0, y1]];
    else (isMajor(x) ? out.major : out.minor).push([[x, y0], [x, y1]]);
  }
  for (let i = Math.ceil(y0 / step); i * step <= y1; i++) {
    const y = i * step;
    if (Math.abs(y) < 1e-9) out.axes.x = [[x0, 0], [x1, 0]];
    else (isMajor(y) ? out.major : out.minor).push([[x0, y], [x1, y]]);
  }
  return out;
}

/** Snap a layout point to the grid (mm). */
export function snapToGrid(p, size) {
  if (!(size > 0)) return [p[0], p[1]];
  const r = (v) => Math.round(Math.round(v / size) * size * 1000) / 1000;
  return [r(p[0]), r(p[1])];
}
