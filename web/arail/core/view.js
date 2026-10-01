/**
 * Rendering of virtual objects over the camera image (Canvas 2D).
 *
 * Coordinates are layout millimetres: x, y on the layout plane, z up. A `View` projects
 * them with the current camera pose and collects drawing operations in a display list:
 * - ground layer: flat things on the layout (areas, roads, platform markings), in order,
 * - solid layer: 3D things (buildings, trees, vehicles, people), far to near,
 * - overlay layer: labels and signs, always on top.
 * `render()` sorts and draws the list. Objects never draw directly in `draw(view)`.
 *
 * Day and night: `night` (0 = day ... 1 = night) darkens the background (the camera image)
 * and every ground and solid item; colours marked `emissive` (lit windows, lamps, headlights)
 * keep their brightness. Objects that draw with their own canvas code use `view.dim(colour)`.
 * Overlays (labels, the editor's selection) are never darkened.
 * @module arail/core/view
 */
import { poseFromHomography } from "./geometry.js";
import { FONT, OVERLAY, parseColor, parseRgba, rgba } from "./colors.js";

const LIGHT = (() => {
  const l = [-0.45, 0.55, 0.7];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

export const LAYER = { ground: 0, solid: 1, overlay: 2 };

/** Flat things closer to the camera than this (mm) are cut off. */
const NEAR_MM = 2;

/** Colour the night fades towards (Dunkelblau, corporate design) and how far. */
const NIGHT_TINT = [0, 20, 80];

export class View {
  /**
   * @param {object} options
   * @param {CanvasRenderingContext2D} options.ctx canvas in image pixel coordinates
   * @param {import("./camera.js").Camera} options.camera
   * @param {number[]} options.H homography layout (mm) -> image (px)
   * @param {number} options.scale model scale denominator (87 for H0)
   * @param {number} [options.px=1] canvas pixels per CSS pixel (line widths and fonts)
   * @param {number} [options.opacity=1] global opacity of virtual objects
   * @param {number} [options.time=0] simulation time in seconds (for animations)
   * @param {number} [options.labelScale=1] size factor for labels (smaller on small screens)
   * @param {number | null} [options.night] darkness 0 (day) .. 1 (night); null = set by `World.draw` from the clock
   * @param {boolean} [options.virtual=false] true for a virtual camera (flyover): there is no camera
   *   image, so objects also draw what is real in the lab (platform surfaces, tracks, the table)
   * @param {boolean} [options.darken=true] darken the background (camera image) at night
   * @param {{a1: number[], a2: number[], a3: number[], n: number[]}} [options.pose] the camera pose when it is
   *   known (virtual camera, see core/flycam.js); otherwise it is recovered from H, assuming that the
   *   layout origin is in front of the camera
   */
  constructor({ ctx, camera, H, scale, px = 1, opacity = 1, time = 0, labelScale = 1, night = null, virtual = false, darken = true, pose = null }) {
    this.ctx = ctx;
    this.camera = camera;
    this.H = H;
    this.scale = scale;
    this.px = px;
    this.opacity = opacity;
    this.time = time;
    this.labelScale = labelScale;
    this.night = night;
    this.virtual = virtual;
    this.darken = darken;
    /**
     * [xmin, ymin, xmax, ymax] (mm) of a photo of the real table drawn under everything else (the
     * flyover's orthophoto): there the real lab is visible as in the camera view, see `showsReal`.
     */
    this.groundPhoto = null;
    /** Rectangles of labels drawn so far (labels avoid overlapping each other). */
    this.placed = [];
    this.pose = pose || poseFromHomography(H, camera.intrinsics);
    const { a1, a2, n } = this.pose;
    const l1 = Math.hypot(...a1), l2 = Math.hypot(...a2);
    this.ex = a1.map((v) => v / l1);
    this.ey = a2.map((v) => v / l2);
    this.ez = n;
    this.items = [];
    this.seq = 0;
  }

  /* ---------------------------------------------------------------- units and projection */

  /** Prototype metres -> model millimetres. */
  m(meters) {
    return (meters * 1000) / this.scale;
  }

  /** Camera coordinates (mm) of a layout point. */
  cam(x, y, z = 0) {
    const { a1, a2, a3, n } = this.pose;
    return [
      x * a1[0] + y * a2[0] + a3[0] + z * n[0],
      x * a1[1] + y * a2[1] + a3[1] + z * n[1],
      x * a1[2] + y * a2[2] + a3[2] + z * n[2],
    ];
  }

  /** Distance of a layout point from the camera along the viewing direction (mm). */
  depth(x, y, z = 0) {
    const { a1, a2, a3, n } = this.pose;
    return x * a1[2] + y * a2[2] + a3[2] + z * n[2];
  }

  /** Image position (px) of a layout point, or null if it is behind the camera. */
  project(x, y, z = 0) {
    return this.camera.project(this.cam(x, y, z));
  }

  /** Project a list of [x, y, z] (or [x, y]) points; null if any is behind the camera. */
  projectAll(points) {
    const out = [];
    for (const p of points) {
      const q = this.project(p[0], p[1], p[2] || 0);
      if (!q) return null;
      out.push(q);
    }
    return out;
  }

  /** Approximate image scale at a layout point, in pixels per mm (max of vertical and ground scale). */
  pxPerMM(x, y, z = 0) {
    const d = this.m(1);
    const p = this.project(x, y, z), up = this.project(x, y, z + d), side = this.project(x + d, y, z), fwd = this.project(x, y + d, z);
    if (!p || !up || !side || !fwd) return 0;
    const vertical = Math.hypot(up[0] - p[0], up[1] - p[1]) / d;
    const ground = Math.max(Math.hypot(side[0] - p[0], side[1] - p[1]), Math.hypot(fwd[0] - p[0], fwd[1] - p[1])) / d;
    return Math.max(vertical, 0.5 * ground);
  }

  /**
   * Is the real lab visible at these layout points (mm)? Then objects need not draw what is real
   * there (platform surfaces, tracks). True over the camera image; for a virtual camera only
   * where the photo of the table (`groundPhoto`) covers all of them.
   */
  showsReal(points) {
    if (!this.virtual) return true;
    const b = this.groundPhoto;
    return !!b && points.every((p) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);
  }

  /** Is the layout point inside the image (with a margin in px)? */
  inImage(x, y, z = 0, margin = 50) {
    const p = this.project(x, y, z);
    return !!p && p[0] > -margin && p[1] > -margin && p[0] < this.camera.width + margin && p[1] < this.camera.height + margin;
  }

  /** Brightness factor for a surface with the given layout-frame normal. */
  light(normal) {
    const d = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
    return 0.62 + 0.38 * Math.max(0, d);
  }

  /* ---------------------------------------------------------------- day and night */

  /** Darkness 0 .. 1 (0 while unset). */
  get darkness() {
    return Math.min(1, Math.max(0, this.night || 0));
  }

  /**
   * A colour as it looks at the current time of day (alpha is kept). `amount` scales the
   * effect (0.5 = half as dark, e.g. for things under station lights).
   * @param {string} colour CSS colour (#hex, rgb(), rgba())
   */
  dim(colour, amount = 1) {
    const n = this.darkness * amount;
    if (!n || !colour) return colour;
    const c = parseRgba(colour);
    if (!c) return colour;
    return rgba(dimRgb(c, n), c[3]);
  }

  /** Normal (layout frame) -> camera frame. */
  normalToCamera(nrm) {
    const { ex, ey, ez } = this;
    return [0, 1, 2].map((i) => nrm[0] * ex[i] + nrm[1] * ey[i] + nrm[2] * ez[i]);
  }

  /* ---------------------------------------------------------------- display list */

  /**
   * Queue a drawing operation.
   * @param {number} layer LAYER.ground, LAYER.solid or LAYER.overlay
   * @param {number} key ground: order (low first); solid: depth (far first); overlay: order
   * @param {(ctx: CanvasRenderingContext2D, view: View) => void} draw
   */
  add(layer, key, draw) {
    this.items.push({ layer, key, seq: this.seq++, draw });
  }

  ground(order, draw) {
    this.add(LAYER.ground, order, draw);
  }

  solid(depth, draw) {
    this.add(LAYER.solid, depth, draw);
  }

  overlay(draw, order = 0) {
    this.add(LAYER.overlay, order, draw);
  }

  /** Draw all queued operations and clear the list. */
  render() {
    const items = this.items;
    items.sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      if (a.layer === LAYER.solid) return b.key - a.key || a.seq - b.seq;
      return a.key - b.key || a.seq - b.seq;
    });
    const ctx = this.ctx;
    const n = this.darkness;
    if (n > 0.01 && this.darken) {
      // the real world (camera image or flyover background) gets darker, too
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(0,12,48,${(0.58 * n).toFixed(3)})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
    for (const it of items) {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      try {
        it.draw(ctx, this);
      } catch (err) {
        console.error("draw error", err);
      }
      ctx.restore();
    }
    this.items = [];
    this.placed = [];
  }

  /* ---------------------------------------------------------------- primitives */

  /**
   * Flat polygon on the layout (or at height z). Coordinates in mm.
   * @param {number[][]} points
   * @param {{z?: number, fill?: string, stroke?: string, width?: number, alpha?: number,
   *   dash?: number[], order?: number, layer?: "ground" | "overlay", emissive?: boolean}} [style]
   *   `emissive`: not darkened at night (lights); overlays are never darkened
   */
  polygon(points, style = {}) {
    const pts = this._projectClipped(points, style.z || 0, true)[0];
    if (!pts) return;
    const draw = (ctx) => this._path(ctx, pts, true, style);
    if (style.layer === "overlay") this.overlay(draw, style.order ?? 0);
    else this.ground(style.order ?? 0, draw);
  }

  /** Polyline on the layout (ground layer). Width in CSS px, or `widthMM` in model mm. */
  line(points, style = {}) {
    for (const pts of this._projectClipped(points, style.z || 0, false)) {
      this.ground(style.order ?? 1, (ctx) => this._path(ctx, pts, false, style));
    }
  }

  /**
   * Project a flat polygon or polyline at height z, cut off where it passes behind the camera
   * (a virtual camera can be close to the layout and look along it).
   * @returns {number[][][]} image polygons/polylines (one polygon; a polyline may fall into pieces)
   */
  _projectClipped(points, z, closed) {
    const n = points.length;
    const depth = points.map((p) => this.depth(p[0], p[1], z));
    if (depth.every((d) => d >= NEAR_MM)) {
      const out = this.projectAll(points.map((p) => [p[0], p[1], z]));
      return out ? [out] : [];
    }
    const cut = (a, b, da, db) => {
      const t = (NEAR_MM - da) / (db - da);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const pieces = [];
    let cur = [];
    if (closed) {
      // Sutherland-Hodgman against the near plane
      for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n], da = depth[i], db = depth[(i + 1) % n];
        if (da >= NEAR_MM) cur.push(a);
        if ((da >= NEAR_MM) !== (db >= NEAR_MM)) cur.push(cut(a, b, da, db));
      }
      if (cur.length >= 3) pieces.push(cur);
    } else {
      for (let i = 0; i < n - 1; i++) {
        const a = points[i], b = points[i + 1], da = depth[i], db = depth[i + 1];
        if (da >= NEAR_MM) {
          if (!cur.length) cur.push(a);
          if (db >= NEAR_MM) cur.push(b);
          else {
            cur.push(cut(a, b, da, db));
            pieces.push(cur);
            cur = [];
          }
        } else if (db >= NEAR_MM) cur = [cut(a, b, da, db), b];
      }
      if (cur.length >= 2) pieces.push(cur);
    }
    return pieces.map((pc) => this.projectAll(pc.map((p) => [p[0], p[1], z]))).filter(Boolean);
  }

  /**
   * Ribbon of constant width along a polyline on the ground (roads, platform edges).
   * @param {number[][]} points centre line (mm)
   * @param {number} widthMM
   */
  ribbon(points, widthMM, style = {}) {
    if (points.length < 2) return;
    const left = [], right = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const h = widthMM / 2;
      left.push([points[i][0] - dy * h, points[i][1] + dx * h]);
      right.push([points[i][0] + dy * h, points[i][1] - dx * h]);
    }
    this.polygon(left.concat(right.reverse()), style);
  }

  _path(ctx, pts, closed, style) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (closed) ctx.closePath();
    if (style.alpha != null) ctx.globalAlpha *= style.alpha;
    const lit = style.emissive || style.layer === "overlay";
    if (style.fill && closed) {
      ctx.fillStyle = lit ? style.fill : this.dim(style.fill);
      ctx.fill();
    }
    if (style.stroke) {
      ctx.lineWidth = (style.width || 1) * this.px;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (style.dash) ctx.setLineDash(style.dash.map((d) => d * this.px));
      ctx.strokeStyle = lit ? style.stroke : this.dim(style.stroke);
      ctx.stroke();
    }
  }

  /**
   * Draw a set of 3D faces as one solid item: back faces are culled, the rest is shaded
   * and drawn far to near.
   * @param {{pts: number[][], normal?: number[], color: string, alpha?: number, emissive?: boolean,
   *   stroke?: string, twoSided?: boolean, flat?: boolean,
   *   decals?: {pts: number[][], color: string, alpha?: number, emissive?: boolean}[]}[]} faces
   *   points [x, y, z] in mm; `normal` in the layout frame (needed for culling and shading);
   *   `decals` are coplanar details (windows, doors) drawn right after their face;
   *   `emissive` faces and decals (lit windows, lamps) are neither shaded nor darkened at night
   * @param {number[]} ref reference point [x, y, z] for sorting against other solids
   * @param {{outline?: string}} [style]
   */
  faces(faces, ref, style = {}) {
    const drawn = [];
    for (const f of faces) {
      const camPts = f.pts.map((p) => this.cam(p[0], p[1], p[2] || 0));
      if (camPts.some((c) => !(c[2] > 1))) continue;
      const centre = [0, 1, 2].map((i) => camPts.reduce((s, c) => s + c[i], 0) / camPts.length);
      if (f.normal && !f.twoSided) {
        const nc = this.normalToCamera(f.normal);
        if (nc[0] * centre[0] + nc[1] * centre[1] + nc[2] * centre[2] >= 0) continue;
      }
      const img = camPts.map((c) => this.camera.project(c));
      if (img.some((p) => !p)) continue;
      const k = f.normal && !f.flat ? this.light(f.normal) : 1;
      const decals = [];
      for (const d of f.decals || []) {
        const di = this.projectAll(d.pts);
        if (!di) continue;
        decals.push({ img: di, rgb: parseColor(d.color), k: d.emissive ? 1 : k, emissive: !!d.emissive, alpha: d.alpha ?? f.alpha ?? 1 });
      }
      drawn.push({ img, depth: Math.hypot(...centre), rgb: parseColor(f.color), k: f.emissive ? 1 : k, emissive: !!f.emissive, alpha: f.alpha ?? 1, stroke: f.stroke, decals });
    }
    if (!drawn.length) return;
    drawn.sort((a, b) => b.depth - a.depth);
    const outline = style.outline;
    this.solid(this.depth(ref[0], ref[1], ref[2] || 0), (ctx) => {
      // colours are worked out when drawing, so that `night` may be set after queueing
      const n = this.darkness;
      const fill = (it) => {
        const c = [it.rgb[0] * it.k, it.rgb[1] * it.k, it.rgb[2] * it.k];
        return rgba(it.emissive || !n ? c : dimRgb(c, n), it.alpha);
      };
      ctx.lineJoin = "round";
      for (const f of drawn) {
        ctx.beginPath();
        f.img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fillStyle = fill(f);
        ctx.fill();
        const s = f.stroke || outline;
        if (s) {
          ctx.lineWidth = 0.8 * this.px;
          ctx.strokeStyle = this.dim(s);
          ctx.stroke();
        }
        for (const d of f.decals) {
          ctx.beginPath();
          d.img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fillStyle = fill(d);
          ctx.fill();
        }
      }
    });
  }

  /**
   * Vertical prism over a footprint polygon (counter-clockwise, mm) from z0 to z1 (mm).
   * @param {{side: string, top?: string, alpha?: number, outline?: string}} colors
   */
  prism(footprint, z0, z1, colors) {
    const faces = prismFaces(footprint, z0, z1, colors);
    const c = centroid(footprint);
    this.faces(faces, [c[0], c[1], (z0 + z1) / 2], { outline: colors.outline });
  }

  /**
   * A light seen as a soft glow (street lamps, headlights, lit signs); drawn only at night.
   * @param {number[]} at [x, y, z] in mm
   * @param {number} radiusMM size of the glow (model mm)
   * @param {string} [colour] colour of the light
   * @param {number} [strength=1] 0..1
   */
  glow(at, radiusMM, colour = "#ffe2a0", strength = 1) {
    const a = this.darkness * strength;
    if (a < 0.03) return;
    const p = this.project(at[0], at[1], at[2] || 0);
    if (!p) return;
    const r = Math.max(1.5 * this.px, this.pxPerMM(at[0], at[1], at[2] || 0) * radiusMM);
    const [cr, cg, cb] = parseColor(colour);
    // slightly in front of what the light is attached to
    this.solid(this.depth(at[0], at[1], at[2] || 0) - 1, (ctx) => {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.25, `rgba(${cr},${cg},${cb},${0.85 * a})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  /**
   * Light falling on the ground (pool of light under a street lamp); drawn only at night.
   * @param {number[]} center [x, y] in mm
   * @param {number} radiusMM radius on the ground (model mm)
   */
  lightPool(center, radiusMM, colour = "#ffd98a", strength = 1, order = 0.8) {
    const a = this.darkness * strength;
    if (a < 0.03) return;
    const ring = [];
    for (let k = 0; k < 16; k++) {
      const t = (k * Math.PI) / 8;
      ring.push([center[0] + radiusMM * Math.cos(t), center[1] + radiusMM * Math.sin(t), 0]);
    }
    const img = this.projectAll(ring), c = this.project(center[0], center[1], 0);
    if (!img || !c) return;
    const r = Math.max(...img.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
    const [cr, cg, cb] = parseColor(colour);
    this.ground(order, (ctx) => {
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * a})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.beginPath();
      img.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
      ctx.fill();
    });
  }

  /**
   * Text label anchored at a layout point (overlay layer).
   * @param {number[]} at [x, y, z] in mm
   * @param {string | string[]} text one or more lines
   * @param {{size?: number, color?: string, background?: string, anchor?: "center" | "bottom" | "left",
   *   padding?: number, bold?: boolean, badge?: string, badgeColor?: string, bar?: number, barColor?: string}} [style]
   */
  label(at, text, style = {}) {
    const p = this.project(at[0], at[1], at[2] || 0);
    if (!p) return;
    // labels of things just outside the picture are pulled in at its edge; far away ones (e.g. the
    // stops of a town on table extensions beyond the photo) would only pile up there
    const W = this.camera.width, H = this.camera.height;
    if (p[0] < -0.25 * W || p[0] > 1.25 * W || p[1] < -0.25 * H || p[1] > 1.25 * H) return;
    const lines = Array.isArray(text) ? text : [text];
    this.overlay((ctx) => drawLabel(ctx, p, lines, style, this.px * this.labelScale, this.camera.width, this.camera.height, this.placed), style.order ?? 0);
  }
}

/* ---------------------------------------------------------------- helpers */

/** Darken an [r, g, b] colour for the night (n = 0 .. 1) towards the night tint. */
function dimRgb(c, n) {
  const k = 1 - 0.62 * n, t = 0.3 * n;
  return [0, 1, 2].map((i) => c[i] * k + NIGHT_TINT[i] * t);
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Faces of a vertical prism (footprint counter-clockwise when seen from above). */
export function prismFaces(footprint, z0, z1, { side, top, alpha, bottom = false }) {
  const faces = [];
  const n = footprint.length;
  const ccw = signedArea(footprint) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    faces.push({
      pts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
      normal: [(ccw * dy) / l, (-ccw * dx) / l, 0],
      color: side,
      alpha,
    });
  }
  if (top) faces.push({ pts: footprint.map((p) => [p[0], p[1], z1]), normal: [0, 0, 1], color: top, alpha });
  if (bottom) faces.push({ pts: footprint.map((p) => [p[0], p[1], z0]), normal: [0, 0, -1], color: side, alpha });
  return faces;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Rectangle footprint (counter-clockwise) centred at c, size [w along the direction, d across]. */
export function rectFootprint(c, w, d, angle = 0) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [c[0] + cs * x - sn * y, c[1] + sn * x + cs * y]);
}

function drawLabel(ctx, p, lines, style, px, W, H, placed = []) {
  const size = (style.size || 13) * px;
  const pad = (style.padding ?? 6) * px;
  ctx.font = `${style.bold === false ? 500 : 700} ${size}px ${FONT}`;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const badgeW = style.badge ? size * 1.7 : 0;
  const lineH = size * 1.25;
  const barH = style.bar != null ? 5 * px : 0;
  const w = Math.max(Math.max(...widths) + 2 * pad, style.bar != null ? 110 * px : 0) + badgeW;
  const h = lines.length * lineH + 2 * pad - (lineH - size) + (barH ? barH + pad * 0.6 : 0);
  let x = p[0] - w / 2, y = p[1] - h / 2;
  if (style.anchor === "bottom") y = p[1] - h - 4 * px;
  else if (style.anchor === "left") x = p[0] + 6 * px;
  else if (style.anchor === "right") x = p[0] - w - 6 * px;
  x = Math.max(2, Math.min(W - w - 2, x));
  y = Math.max(2, Math.min(H - h - 2, y));
  // avoid labels drawn before: move up (or down at the top edge) until free
  const hits = (yy) => placed.find((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && yy < r.y + r.h + 2 && yy + h + 2 > r.y);
  for (let i = 0, r = hits(y); r && i < 8; i++, r = hits(y)) {
    const up = r.y - h - 3;
    y = up >= 2 ? up : r.y + r.h + 3;
  }
  y = Math.max(2, Math.min(H - h - 2, y));
  placed.push({ x, y, w, h });
  if (style.background !== "none") {
    ctx.fillStyle = style.background || OVERLAY.label;
    roundRect(ctx, x, y, w, h, 4 * px);
    ctx.fill();
  }
  if (style.badge) {
    ctx.fillStyle = style.badgeColor || OVERLAY.sign;
    roundRect(ctx, x, y, badgeW, h, 4 * px);
    ctx.fill();
    ctx.fillStyle = OVERLAY.labelText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.badge, x + badgeW / 2, y + h / 2);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    ctx.fillStyle = (style.colors && style.colors[i]) || style.color || OVERLAY.labelText;
    ctx.fillText(l, x + badgeW + pad, y + pad + i * lineH);
  });
  if (barH) {
    const bx = x + badgeW + pad, bw = w - badgeW - 2 * pad, by = y + h - pad - barH;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(bx, by, bw, barH);
    ctx.fillStyle = style.barColor || "#fff";
    ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, style.bar)), barH);
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
