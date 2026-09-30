/**
 * Rendering of virtual objects over the camera image (Canvas 2D).
 *
 * Coordinates are layout millimetres: x, y on the layout plane, z up. A `View` projects
 * them with the current camera pose and collects drawing operations in a display list:
 * - ground layer: flat things on the layout (areas, roads, platform markings), in order,
 * - solid layer: 3D things (buildings, trees, vehicles, people), far to near,
 * - overlay layer: labels and signs, always on top.
 * `render()` sorts and draws the list. Objects never draw directly in `draw(view)`.
 * @module arail/core/view
 */
import { poseFromHomography } from "./geometry.js";
import { parseColor, rgba } from "./colors.js";

const LIGHT = (() => {
  const l = [-0.45, 0.55, 0.7];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

export const LAYER = { ground: 0, solid: 1, overlay: 2 };

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
   */
  constructor({ ctx, camera, H, scale, px = 1, opacity = 1, time = 0, labelScale = 1 }) {
    this.ctx = ctx;
    this.camera = camera;
    this.H = H;
    this.scale = scale;
    this.px = px;
    this.opacity = opacity;
    this.time = time;
    this.labelScale = labelScale;
    /** Rectangles of labels drawn so far (labels avoid overlapping each other). */
    this.placed = [];
    this.pose = poseFromHomography(H, camera.intrinsics);
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
   *   dash?: number[], order?: number, layer?: "ground" | "overlay"}} [style]
   */
  polygon(points, style = {}) {
    const z = style.z || 0;
    const pts = this.projectAll(points.map((p) => [p[0], p[1], z]));
    if (!pts) return;
    const draw = (ctx) => this._path(ctx, pts, true, style);
    if (style.layer === "overlay") this.overlay(draw, style.order ?? 0);
    else this.ground(style.order ?? 0, draw);
  }

  /** Polyline on the layout (ground layer). Width in CSS px, or `widthMM` in model mm. */
  line(points, style = {}) {
    const z = style.z || 0;
    const pts = this.projectAll(points.map((p) => [p[0], p[1], z]));
    if (!pts) return;
    this.ground(style.order ?? 1, (ctx) => this._path(ctx, pts, false, style));
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
    if (style.fill && closed) {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    if (style.stroke) {
      ctx.lineWidth = (style.width || 1) * this.px;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (style.dash) ctx.setLineDash(style.dash.map((d) => d * this.px));
      ctx.strokeStyle = style.stroke;
      ctx.stroke();
    }
  }

  /**
   * Draw a set of 3D faces as one solid item: back faces are culled, the rest is shaded
   * and drawn far to near.
   * @param {{pts: number[][], normal?: number[], color: string, alpha?: number,
   *   stroke?: string, twoSided?: boolean, flat?: boolean, decals?: {pts: number[][], color: string}[]}[]} faces
   *   points [x, y, z] in mm; `normal` in the layout frame (needed for culling and shading);
   *   `decals` are coplanar details (windows, doors) drawn right after their face
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
      const [r, g, b] = parseColor(f.color);
      const decals = [];
      for (const d of f.decals || []) {
        const di = this.projectAll(d.pts);
        if (!di) continue;
        const [dr, dg, db] = parseColor(d.color);
        decals.push({ img: di, fill: rgba([dr * k, dg * k, db * k], d.alpha ?? f.alpha ?? 1) });
      }
      drawn.push({ img, depth: Math.hypot(...centre), fill: rgba([r * k, g * k, b * k], f.alpha ?? 1), stroke: f.stroke, decals });
    }
    if (!drawn.length) return;
    drawn.sort((a, b) => b.depth - a.depth);
    const outline = style.outline;
    this.solid(this.depth(ref[0], ref[1], ref[2] || 0), (ctx) => {
      ctx.lineJoin = "round";
      for (const f of drawn) {
        ctx.beginPath();
        f.img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fillStyle = f.fill;
        ctx.fill();
        const s = f.stroke || outline;
        if (s) {
          ctx.lineWidth = 0.8 * this.px;
          ctx.strokeStyle = s;
          ctx.stroke();
        }
        for (const d of f.decals) {
          ctx.beginPath();
          d.img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fillStyle = d.fill;
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
   * Text label anchored at a layout point (overlay layer).
   * @param {number[]} at [x, y, z] in mm
   * @param {string | string[]} text one or more lines
   * @param {{size?: number, color?: string, background?: string, anchor?: "center" | "bottom" | "left",
   *   padding?: number, bold?: boolean, badge?: string, badgeColor?: string, bar?: number, barColor?: string}} [style]
   */
  label(at, text, style = {}) {
    const p = this.project(at[0], at[1], at[2] || 0);
    if (!p) return;
    const lines = Array.isArray(text) ? text : [text];
    this.overlay((ctx) => drawLabel(ctx, p, lines, style, this.px * this.labelScale, this.camera.width, this.camera.height, this.placed), style.order ?? 0);
  }
}

/* ---------------------------------------------------------------- helpers */

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
  ctx.font = `${style.bold === false ? 500 : 700} ${size}px "Archivo", system-ui, sans-serif`;
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
    ctx.fillStyle = style.background || "rgba(15,26,43,0.86)";
    roundRect(ctx, x, y, w, h, 4 * px);
    ctx.fill();
  }
  if (style.badge) {
    ctx.fillStyle = style.badgeColor || "#1d4f9c";
    roundRect(ctx, x, y, badgeW, h, 4 * px);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.badge, x + badgeW / 2, y + h / 2);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    ctx.fillStyle = (style.colors && style.colors[i]) || style.color || "#fff";
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
