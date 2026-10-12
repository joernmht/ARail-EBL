/**
 * Building kit: the base class of all buildings and the helpers to model them.
 *
 * Buildings look like a white architectural model: neutral greys from mid grey up to white,
 * no hue at all (white walls, light-to-mid grey roofs, darker grey windows and joints). The
 * only colour is the light in the windows at night.
 *
 * A building type extends {@link BuildingBase} and builds its geometry with a
 * {@link BuildingModel} in `computeGeometry()` (cached). The model works in a local frame in
 * **prototype metres**: x along the building, y across, z up; the front (street side) is the
 * local −y side, so at rotation 0 a building faces −y.
 *
 *   computeGeometry() {
 *     const m = this.model();                       // frame at `position`, turned by `rotation_deg`
 *     if (!m) return null;
 *     const body = m.box(-10, -6, 10, 6, 0, 9, { wall: m.wallTone(), top: grey(TONES.flatRoof) });
 *     for (const [s, z] of [[3, 1], [7, 1]]) m.window(body.walls[0], s, s + 1.3, z, z + 1.4);
 *     m.part(body.faces);
 *     m.shadow(m.rect(-10, -6, 10, 6), 9);
 *     m.entrance(0, -6);
 *     return m.finish({ footprint: m.rect(-10, -6, 10, 6), height: 9, capacity: { residents: 20 } });
 *   }
 *
 * `BuildingBase.draw` draws the parts far to near with level of detail (no windows when they
 * would be smaller than about 1.5 px), the windows lit at night by occupancy and a soft shadow
 * by day. The town simulation uses `use()`, `capacity()`, `entrances()` and `occupancy()`.
 * @module arail/objects/building-kit
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { clamp, createRng, toRad } from "../core/math.js";
import { PALETTE, grey, parseColor } from "../core/colors.js";
import { profileAt } from "../core/clock.js";

/** What a building is used for (the town simulation sends people there). */
export const USE_OPTIONS = [["residential", "residential"], ["work", "work (offices, workshops)"], ["school", "school"], ["shop", "shop"], ["other", "other"]];

/**
 * Tones (0 = black ... 1 = white) of the white-model look. Ranges are picked per building or
 * per parcel with the building's seeded random numbers. Nothing is darker than about 0.45.
 */
export const TONES = {
  wall: [0.88, 0.97],
  roof: [0.6, 0.74],
  flatRoof: 0.76,
  roofSurface: 0.68,
  window: 0.47,
  glass: 0.53,
  door: 0.5,
  opening: 0.5,
  joint: 0.72,
  plinth: 0.78,
  paving: 0.84,
  asphalt: 0.62,
  marking: 0.95,
  plot: 0.66,
};

/** Detail tiers of decals: always drawn, drawn with windows, drawn only close up. */
export const TIER = { coarse: 0, window: 1, fine: 2 };

/** Share of people present by use over the day ([hour, value]), when no town simulation runs. */
export const OCCUPANCY = {
  residential: [[0, 0.95], [6, 0.95], [8.5, 0.4], [16, 0.4], [19, 0.9], [24, 0.95]],
  work: [[0, 0.03], [6, 0.05], [8, 0.9], [16, 0.9], [18.5, 0.15], [20, 0.05], [24, 0.03]],
  school: [[0, 0], [7, 0.02], [7.75, 0.95], [14, 0.95], [16, 0.15], [17, 0.02], [24, 0]],
  shop: [[0, 0.02], [7.5, 0.05], [8, 0.85], [20, 0.85], [20.5, 0.1], [24, 0.02]],
  other: [[0, 0.1], [8, 0.5], [18, 0.5], [22, 0.1], [24, 0.1]],
};

/** Share of the people present who have the lights on when it is dark ([hour, value]). */
export const LIGHTS_ON = {
  residential: [[0, 0.45], [1, 0.35], [5, 0.35], [6.5, 0.8], [8, 0.6], [16, 0.6], [18, 0.9], [22.5, 0.9], [24, 0.45]],
  other: [[0, 0.9], [24, 0.9]],
};

/** Occupancy 0..1 of a building of this use at a time of day (minutes after midnight). */
export function defaultOccupancy(use, minutes) {
  return profileAt(OCCUPANCY[use] || OCCUPANCY.other, minutes);
}

/** Share of occupied rooms with the lights on at a time of day (0.35 .. 0.9). */
export function lightsOn(use, minutes) {
  return profileAt(LIGHTS_ON[use] || LIGHTS_ON.other, minutes);
}

/**
 * Typical capacity of a building of this use with the given gross floor area (m²):
 * about 2 residents per 60 m², a job per 25 m² of offices, a pupil per 10 m², a shopper per 12 m².
 */
export function capacityFor(use, floorArea) {
  const a = Math.max(0, floorArea);
  switch (use) {
    case "residential": return { residents: Math.round(a / 30), jobs: 0, pupils: 0, visitors: 0 };
    case "work": return { residents: 0, jobs: Math.round(a / 25), pupils: 0, visitors: 0 };
    case "school": return { residents: 0, jobs: Math.round(a / 120), pupils: Math.round(a / 10), visitors: 0 };
    case "shop": return { residents: 0, jobs: Math.max(1, Math.round(a / 90)), pupils: 0, visitors: Math.round(a / 12) };
    default: return { residents: 0, jobs: Math.round(a / 100), pupils: 0, visitors: Math.round(a / 50) };
  }
}

/** Deterministic 32-bit hash of a string (FNV-1a). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [0, 1) for a seed and an index (e.g. the windows of a building). */
export function hash01(seed, i) {
  let h = (seed ^ Math.imul(i + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Local frame of a building: prototype metres (x, y, z) -> layout millimetres. */
export class Frame {
  /**
   * @param {number[]} center origin on the layout (mm)
   * @param {number} angle rotation (radians) of the local x axis
   * @param {number} k model millimetres per prototype metre (1000 / scale)
   */
  constructor(center, angle, k) {
    this.center = center;
    this.angle = angle;
    this.k = k;
    this.cs = Math.cos(angle);
    this.sn = Math.sin(angle);
  }

  /** Layout point [x, y, z] (mm) of a local point (m). */
  at(x, y, z = 0) {
    const k = this.k;
    return [this.center[0] + (this.cs * x - this.sn * y) * k, this.center[1] + (this.sn * x + this.cs * y) * k, z * k];
  }

  /** Layout point [x, y] (mm) of a local point (m). */
  xy(x, y) {
    const k = this.k;
    return [this.center[0] + (this.cs * x - this.sn * y) * k, this.center[1] + (this.sn * x + this.cs * y) * k];
  }

  /** Layout direction of a local direction (no scaling). */
  dir(x, y) {
    return [this.cs * x - this.sn * y, this.sn * x + this.cs * y];
  }

  /** A frame inside this one: origin at local (x, y), turned by `angle` (radians) more. */
  child(x, y, angle = 0) {
    return new Frame(this.xy(x, y), this.angle + angle, this.k);
  }
}

/** Outward unit normal of a planar polygon (counter-clockwise seen from outside), Newell's method. */
export function polygonNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const pz = p[2] || 0, qz = q[2] || 0;
    nx += (p[1] - q[1]) * (pz + qz);
    ny += (pz - qz) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Convex hull (counter-clockwise) of 2D points, monotone chain. */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Direction the light comes from (layout frame), the same as the View's light. */
const SUN = (() => {
  const l = [-0.45, 0.55, 0.7], n = Math.hypot(...l);
  return l.map((v) => v / n);
})();
/** Direction the sun shadows fall in (layout frame, per unit of height), matching the View's light. */
const SHADOW = [-SUN[0] / SUN[2], -SUN[1] / SUN[2]];
/** Shadows are shortened (a high summer sun reads better on a model). */
const SHADOW_LENGTH = 0.45;

/**
 * Shading of the white model: brightness = ambient + direct × (light on the face). Softer than
 * the View's shading of other solids (0.62 .. 1), so that walls in the shade stay light grey and
 * the windows and roofs stay in the greys from about mid grey up to white.
 */
export const MODEL_LIGHT = { ambient: 0.75, direct: 0.25 };

/** Brightness factor of a face of a building with this (layout frame) normal. */
export function modelLight(normal) {
  const d = normal[0] * SUN[0] + normal[1] * SUN[1] + normal[2] * SUN[2];
  return MODEL_LIGHT.ambient + MODEL_LIGHT.direct * Math.max(0, d);
}

/** A colour (CSS or [r, g, b]) times a brightness factor, as [r, g, b]. */
function shadeRgb(colour, k) {
  const c = parseColor(colour);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * Collects the faces, decals, lit windows, shadows and ground drawings of a building.
 * Coordinates are local prototype metres (see {@link Frame}); everything is converted to
 * layout millimetres when added, so drawing needs no further conversion.
 */
export class BuildingModel {
  /**
   * @param {Frame} frame
   * @param {{seed?: number}} [options] `seed`: random numbers for variation and lit windows
   */
  constructor(frame, { seed = 1 } = {}) {
    this.frame = frame;
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed || 1);
    this.parts = [];
    this.windows = [];
    this.shadows = [];
    this.ground = [];
    this.entrances = [];
    this._faces = [];
    /** Level-of-detail anchor of the parts added next (one per house in an estate). */
    this.anchor = null;
    this.setAnchor(0, 0, 3, 30);
  }

  get k() {
    return this.frame.k;
  }

  /** A wall tone picked with the model's random numbers. */
  wallTone(range = TONES.wall) {
    return grey(this.rng.uniform(range[0], range[1]));
  }

  /**
   * Parts added from now on choose their level of detail and visibility at this local point.
   * @param {number} radius size of the group (m), for skipping it when it is off screen
   */
  setAnchor(x, y, z, radius) {
    this.anchor = { p: this.frame.at(x, y, z), r: radius * this.k, view: null, level: 2, visible: true };
    return this.anchor;
  }

  /** Rectangle (counter-clockwise, local metres). */
  rect(x0, y0, x1, y1) {
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  /**
   * A planar face from local points [x, y, z] (counter-clockwise seen from outside).
   * Decals are placed in the face's own coordinates: `s` along the edge from point `map[0]`
   * to `map[1]`, `t` perpendicular to it within the face (up for walls), in metres.
   * @param {number[][]} points
   * @param {string} colour
   * @param {{map?: number[]}} [options]
   */
  face(points, colour, { map = [0, 1] } = {}) {
    const pts = points.map((p) => this.frame.at(p[0], p[1], p[2] || 0));
    const normal = polygonNormal(pts);
    const o = pts[map[0]], e = pts[map[1]];
    const ul = Math.hypot(e[0] - o[0], e[1] - o[1], e[2] - o[2]) || 1;
    const U = [(e[0] - o[0]) / ul, (e[1] - o[1]) / ul, (e[2] - o[2]) / ul];
    const V = [normal[1] * U[2] - normal[2] * U[1], normal[2] * U[0] - normal[0] * U[2], normal[0] * U[1] - normal[1] * U[0]];
    const f = { pts, normal, color: colour, map: { o, U, V }, tiers: [[], [], []], lod: null, length: ul / this.k };
    this._faces.push(f);
    return f;
  }

  /** Vertical wall over the ground segment a -> b (local [x, y]) from z0 to z1; outside is on the right. */
  wall(a, b, z0, z1, colour) {
    return this.face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], colour);
  }

  /**
   * Box over a local rectangle. `walls[i]` are the sides front (−y), right (+x), back (+y),
   * left (−x); their decal coordinate `s` runs counter-clockwise (front: with x, back: against x).
   * @param {{wall: string, top?: string | null, skip?: number[]}} colours `skip`: sides to leave out
   */
  box(x0, y0, x1, y1, z0, z1, { wall, top = null, skip = [] }) {
    const c = this.rect(x0, y0, x1, y1);
    const walls = [], faces = [];
    for (let i = 0; i < 4; i++) {
      if (skip.includes(i)) {
        walls.push(null);
        continue;
      }
      const f = this.wall(c[i], c[(i + 1) % 4], z0, z1, wall);
      walls.push(f);
      faces.push(f);
    }
    let topFace = null;
    if (top) {
      topFace = this.face(c.map(([x, y]) => [x, y, z1]), top);
      faces.push(topFace);
    }
    return { faces, walls, top: topFace };
  }

  /** Point of a face at decal coordinates (s, t), layout mm. */
  facePoint(face, s, t) {
    const { o, U, V } = face.map, k = this.k;
    return [o[0] + (U[0] * s + V[0] * t) * k, o[1] + (U[1] * s + V[1] * t) * k, o[2] + (U[2] * s + V[2] * t) * k];
  }

  /**
   * Coplanar detail on a face (a band, a door, a joint): the rectangle s0..s1 × t0..t1 (m).
   * @param {number} [tier] TIER.coarse (always), TIER.window or TIER.fine (only close up)
   */
  decal(face, s0, s1, t0, t1, colour, tier = TIER.coarse) {
    const d = { pts: [this.facePoint(face, s0, t0), this.facePoint(face, s1, t0), this.facePoint(face, s1, t1), this.facePoint(face, s0, t1)], color: colour };
    face.tiers[tier].push(d);
    return d;
  }

  /**
   * A window that lights up at night. `group` "main" follows the building's occupancy,
   * "shop" the opening hours of shops.
   */
  window(face, s0, s1, t0, t1, { group = "main", colour = grey(TONES.window), tier = TIER.window } = {}) {
    const d = this.decal(face, s0, s1, t0, t1, colour, tier);
    const i = this.windows.length;
    this.windows.push({ d, h: hash01(this.seed, i), a: 0.72 + 0.28 * hash01(this.seed ^ 0x5bd1e995, i), group, base: colour });
    return d;
  }

  /** Horizontal band over the whole width of a wall (plinth, cornice). */
  band(face, t0, t1, colour, tier = TIER.coarse) {
    return this.decal(face, 0, face.length, t0, t1, colour, tier);
  }

  /**
   * A group of faces drawn as one solid (sorted far to near within itself).
   * @param {object[]} faces
   * @param {{after?: boolean, facing?: object, ref?: number[]}} [options]
   *   `after`: drawn right after the part added before it (things on top of or in front of it:
   *   chimneys, balconies, canopies), so it is never hidden by that part;
   *   `facing`: a face; the part is only drawn while that face is turned towards the camera
   *   (balconies on a wall); `ref`: local [x, y] for sorting against other solids (default:
   *   the middle of the faces). The sorting point is always on the ground: pieces of a building
   *   standing side by side are then drawn by their distance on the ground, which stays right
   *   when the camera looks steeply down on pieces of different height.
   */
  part(faces, { after = false, facing = null, ref = null } = {}) {
    let r;
    if (after && this.parts.length) r = this.parts[this.parts.length - 1].ref;
    else if (ref) r = this.frame.at(ref[0], ref[1], 0);
    else {
      let x = 0, y = 0, n = 0;
      for (const f of faces) {
        for (const p of f.pts) {
          x += p[0];
          y += p[1];
          n++;
        }
      }
      r = [x / n, y / n, 0];
    }
    const part = { faces, ref: r, anchor: this.anchor, after, facing: facing ? { p: facing.pts[0], n: facing.normal } : null };
    this.parts.push(part);
    return part;
  }

  /** Soft shadow on the ground of a footprint (local [x, y]) of the given height (m). */
  shadow(footprint, height) {
    const k = this.k, dx = SHADOW[0] * height * SHADOW_LENGTH * k, dy = SHADOW[1] * height * SHADOW_LENGTH * k;
    const pts = footprint.map(([x, y]) => this.frame.xy(x, y));
    this.shadows.push(convexHull(pts.concat(pts.map((p) => [p[0] + dx, p[1] + dy]))));
  }

  /** Flat polygon on the ground (paving, driveways, parking). `style` as for `view.polygon`. */
  plate(points, style) {
    this.ground.push({ kind: "polygon", pts: points.map(([x, y]) => this.frame.xy(x, y)), style });
  }

  /** Line on the ground (plot boundaries, parking bays). `style` as for `view.line`. */
  line(points, style) {
    this.ground.push({ kind: "line", pts: points.map(([x, y]) => this.frame.xy(x, y)), style });
  }

  /** Entrance at a local point with the outward direction (default: the front, −y). */
  entrance(x, y, nx = 0, ny = -1) {
    const d = this.frame.dir(nx, ny), l = Math.hypot(d[0], d[1]) || 1;
    this.entrances.push({ pos: this.frame.xy(x, y), dir: [d[0] / l, d[1] / l] });
  }

  /**
   * The geometry for {@link BuildingBase}: parts, windows, shadows, ground drawings, entrances
   * plus `extra` (at least the outline: `footprint` in local metres or `layoutFootprint` in
   * layout mm, `height` in metres and `capacity`).
   * @param {{footprint?: number[][], layoutFootprint?: number[][], height: number, capacity?: object,
   *   detail?: {window?: number, fine?: number}}} extra
   *   `detail`: size (m) of the windows and of the finest details (the width of panel joints, lintels,
   *   slats), for the level of detail: windows are left out below about 1.5 px, the finest details below
   *   about 0.8 px on screen
   */
  finish({ footprint = null, layoutFootprint = null, height, capacity = {}, detail = {}, ...extra }) {
    for (const f of this._faces) {
      const [a, b, c] = f.tiers;
      // shaded once here (the light is fixed on the layout): the View neither shades these
      // faces nor parses their colours every frame
      const k = modelLight(f.normal);
      f.color = shadeRgb(f.color, k);
      f.flat = true;
      for (const tier of f.tiers) for (const d of tier) d.color = shadeRgb(d.color, k);
      f.lod = a.length || b.length || c.length ? [a, a.concat(b), a.concat(b, c)] : null;
      f.decals = f.lod ? f.lod[2] : undefined;
      delete f.tiers;
    }
    for (const w of this.windows) w.base = w.d.color;
    this._faces = [];
    const k = this.k;
    return {
      center: this.frame.center,
      angle: this.frame.angle,
      frame: this.frame,
      ...extra,
      footprint: layoutFootprint || footprint.map(([x, y]) => this.frame.xy(x, y)),
      height: height * k,
      capacity: { residents: 0, jobs: 0, pupils: 0, visitors: 0, ...capacity },
      parts: this.parts,
      windows: this.windows,
      shadows: this.shadows,
      ground: this.ground,
      entrances: this.entrances,
      detail: { window: (detail.window ?? 1.2) * k, fine: (detail.fine ?? 0.15) * k },
      lit: null,
    };
  }
}

/** Is a face (given by a point and its normal, layout frame) turned towards the camera? */
export function facesCamera(view, p, n) {
  const c = view.cam(p[0], p[1], p[2] || 0), nc = view.normalToCamera(n);
  return nc[0] * c[0] + nc[1] * c[1] + nc[2] * c[2] < 0;
}

/** Level of detail and visibility of an anchor, worked out once per view. */
function anchorLevel(view, a, detail) {
  if (a.view === view) return a.visible ? a.level : -1;
  a.view = view;
  const s = view.pxPerMM(a.p[0], a.p[1], a.p[2]);
  if (!(s > 0)) {
    // (partly) behind the camera: full detail, the view culls what cannot be seen
    a.level = 2;
    a.visible = true;
    return 2;
  }
  const q = view.project(a.p[0], a.p[1], a.p[2]);
  const m = a.r * s + 40 * view.px;
  a.visible = !!q && q[0] > -m && q[1] > -m && q[0] < view.camera.width + m && q[1] < view.camera.height + m;
  a.level = s * detail.window < 1.5 * view.px ? 0 : s * detail.fine < 0.8 * view.px ? 1 : 2;
  return a.visible ? a.level : -1;
}

/** Edge colour of the white model (darkened at night by the view). */
export const OUTLINE = "rgba(70,70,70,0.38)";

/**
 * Queue a building geometry made with {@link BuildingModel} on the view: shadows and ground
 * drawings, then the parts with level of detail.
 */
export function drawModel(view, g, { outline = OUTLINE } = {}) {
  const shade = 0.16 * (1 - view.darkness);
  if (shade > 0.02 && g.shadows.length) {
    const imgs = [];
    for (const h of g.shadows) {
      const img = view.projectAll(h);
      if (img) imgs.push(img);
    }
    if (imgs.length) {
      view.ground(5, (ctx) => {
        ctx.beginPath();
        for (const img of imgs) {
          img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
        }
        ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
        ctx.fill("nonzero");
      });
    }
  }
  for (const it of g.ground) {
    if (it.kind === "line") view.line(it.pts, it.style);
    else view.polygon(it.pts, it.style);
  }
  const style = { outline };
  for (const part of g.parts) {
    const level = anchorLevel(view, part.anchor, g.detail);
    if (level < 0) continue;
    if (part.facing && !facesCamera(view, part.facing.p, part.facing.n)) continue;
    for (const f of part.faces) if (f.lod) f.decals = f.lod[level];
    view.faces(part.faces, part.ref, style);
  }
}

/**
 * Switch the windows of a geometry on or off (mutates the cached decals; cheap when nothing changed).
 * @param {object} g geometry from {@link BuildingModel#finish}
 * @param {{main: number, shop: number}} lit share of lit windows per group (0 = all dark)
 */
export function lightWindows(g, lit) {
  const key = Math.round(lit.main * 500) * 1000 + Math.round(lit.shop * 500);
  if (g.lit === key) return;
  g.lit = key;
  const light = parseColor(PALETTE.litWindow);
  for (const w of g.windows) {
    const on = w.h < (w.group === "shop" ? lit.shop : lit.main);
    w.d.color = on ? light : w.base;
    w.d.emissive = on;
    w.d.alpha = on ? w.a : undefined;
  }
}

/* ------------------------------------------------------------------ roofs */

/**
 * Gable roof (Satteldach) over a box whose walls end at height z. The ridge runs along x
 * (`ridge: "x"`) or y. With `split` (local x, ridge along x) the slopes are split there into
 * two faces with `roof` and `roof2` (the two halves of a semi-detached house). Returns the
 * faces plus `slopes` (for roof windows), `gables` and the ridge height `ridgeZ`.
 * @param {BuildingModel} m
 * @param {{x0: number, y0: number, x1: number, y1: number, z: number, pitch?: number, overhang?: number,
 *   ridge?: "x" | "y", roof: string, wall: string, split?: number | null, roof2?: string}} o pitch in degrees
 */
export function gableRoof(m, { x0, y0, x1, y1, z, pitch = 40, overhang = 0.4, ridge = "x", roof, wall, split = null, roof2 = roof }) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const alongX = ridge === "x";
  const A = alongX ? (x1 - x0) / 2 : (y1 - y0) / 2, B = alongX ? (y1 - y0) / 2 : (x1 - x0) / 2;
  const t = Math.tan(toRad(pitch)), o = overhang, rise = B * t, ze = z - o * t, zr = z + rise;
  // (u along the ridge, v across) -> local; for a ridge along y this is a quarter turn (keeps orientation)
  const L = (u, v, h) => (alongX ? [cx + u, cy + v, h] : [cx - v, cy + u, h]);
  const slopes = [];
  if (split != null && alongX) {
    const us = split - cx;
    slopes.push(
      m.face([L(-A - o, -B - o, ze), L(us, -B - o, ze), L(us, 0, zr), L(-A - o, 0, zr)], roof),
      m.face([L(us, -B - o, ze), L(A + o, -B - o, ze), L(A + o, 0, zr), L(us, 0, zr)], roof2),
      m.face([L(A + o, B + o, ze), L(us, B + o, ze), L(us, 0, zr), L(A + o, 0, zr)], roof2),
      m.face([L(us, B + o, ze), L(-A - o, B + o, ze), L(-A - o, 0, zr), L(us, 0, zr)], roof),
    );
  } else {
    slopes.push(
      m.face([L(-A - o, -B - o, ze), L(A + o, -B - o, ze), L(A + o, 0, zr), L(-A - o, 0, zr)], roof),
      m.face([L(A + o, B + o, ze), L(-A - o, B + o, ze), L(-A - o, 0, zr), L(A + o, 0, zr)], roof),
    );
  }
  const gables = [m.face([L(A, -B, z), L(A, B, z), L(A, 0, zr)], wall), m.face([L(-A, B, z), L(-A, -B, z), L(-A, 0, zr)], wall)];
  return { faces: slopes.concat(gables), slopes, gables, ridgeZ: zr, slopeLength: (B + o) / Math.cos(toRad(pitch)) };
}

/**
 * Hip roof (Walmdach): four slopes, ridge along the longer side (a pyramid on a square).
 * @param {BuildingModel} m
 */
export function hipRoof(m, { x0, y0, x1, y1, z, pitch = 25, overhang = 0.6, roof }) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const alongX = x1 - x0 >= y1 - y0;
  const A = (alongX ? x1 - x0 : y1 - y0) / 2 + overhang, B = (alongX ? y1 - y0 : x1 - x0) / 2 + overhang;
  const t = Math.tan(toRad(pitch)), ze = z - overhang * t, zr = ze + B * t, r = Math.max(0, A - B);
  const L = (u, v, h) => (alongX ? [cx + u, cy + v, h] : [cx - v, cy + u, h]);
  const faces = [
    m.face([L(-A, -B, ze), L(A, -B, ze), L(r, 0, zr), L(-r, 0, zr)], roof),
    m.face([L(A, B, ze), L(-A, B, ze), L(-r, 0, zr), L(r, 0, zr)], roof),
    m.face(r > 0 ? [L(A, -B, ze), L(A, B, ze), L(r, 0, zr)] : [L(A, -B, ze), L(A, B, ze), L(0, 0, zr)], roof),
    m.face(r > 0 ? [L(-A, B, ze), L(-A, -B, ze), L(-r, 0, zr)] : [L(-A, B, ze), L(-A, -B, ze), L(0, 0, zr)], roof),
  ];
  return { faces, slopes: faces, ridgeZ: zr };
}

/**
 * Flat roof with a parapet (Attika): the walls are drawn up to the parapet height `z`; this adds
 * the top face with the recessed roof surface as a decal.
 */
export function parapetRoof(m, { x0, y0, x1, y1, z, parapet = 0.3, roof = grey(TONES.flatRoof), surface = grey(TONES.roofSurface) }) {
  const top = m.face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], roof);
  const w = Math.min(parapet, (x1 - x0) / 4, (y1 - y0) / 4);
  m.decal(top, w, x1 - x0 - w, w, y1 - y0 - w, surface, TIER.coarse);
  return top;
}

/**
 * Roof over a rectangular piece of a perimeter block whose neighbours join on some sides:
 * a mansard (steep lower slopes up to a flat top) or, with `inset` = half the depth, a pitched
 * roof. Sides (front, right, back, left) with `slope[i]` true get a slope; joined sides get a
 * vertical end face (wall plus roof profile: a fire wall where the neighbour is lower); where
 * two joined sides meet (the inner corner of a courtyard) the roof forms a valley.
 * Returns `{faces, walls, slopes}`: walls[i] (the wall face of a sloped side, or the end
 * face of a joined side) and slopes[i] (the roof slope of side i, or null).
 * @param {BuildingModel} m
 * @param {{x0: number, y0: number, x1: number, y1: number, h: number, slope: boolean[], inset: number,
 *   rise: number, wall: string, roof: string, top?: string}} o h = eaves height (m)
 */
export function blockPiece(m, { x0, y0, x1, y1, h, slope, inset, rise, wall, roof, top = grey(TONES.flatRoof) }) {
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // inward unit vector along each side direction and inward normals
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const inw = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  const zt = h + rise;
  const ins = (i) => (slope[i] ? inset : 0);
  // plateau corner at vertex v (between side v-1 and side v): moved in from the sloped sides
  const plateau = (v) => {
    const a = (v + 3) % 4, b = v;
    return [c[v][0] + inw[a][0] * ins(a) + inw[b][0] * ins(b), c[v][1] + inw[a][1] * ins(a) + inw[b][1] * ins(b)];
  };
  const valley = (v) => !slope[(v + 3) % 4] && !slope[v];
  const faces = [], walls = [], slopes = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], u = dirs[i];
    if (slope[i]) {
      const w = m.wall(a, b, 0, h, wall);
      const pa = plateau(i), pb = plateau((i + 1) % 4);
      const s = m.face([[a[0], a[1], h], [b[0], b[1], h], [pb[0], pb[1], zt], [pa[0], pa[1], zt]], roof);
      faces.push(w, s);
      walls.push(w);
      slopes.push(s);
    } else {
      // end face: wall plus the roof profile of the neighbours' slopes
      const ia = slope[(i + 3) % 4] || valley(i) ? inset : 0, ib = slope[(i + 1) % 4] || valley((i + 1) % 4) ? inset : 0;
      const pts = [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], h]];
      if (ib > 0) pts.push([b[0] - u[0] * ib, b[1] - u[1] * ib, zt]);
      else pts.push([b[0], b[1], zt]);
      if (ia > 0) pts.push([a[0] + u[0] * ia, a[1] + u[1] * ia, zt]);
      else pts.push([a[0], a[1], zt]);
      pts.push([a[0], a[1], h]);
      const w = m.face(pts, wall);
      faces.push(w);
      walls.push(w);
      slopes.push(null);
    }
  }
  // flat top (mansard) with notches at valleys, and the valley triangles
  const ring = [];
  for (let v = 0; v < 4; v++) {
    if (valley(v)) {
      const a = (v + 3) % 4, p = c[v];
      const ua = dirs[a], ub = dirs[v];
      // corner p: coming along side a (direction ua), leaving along side v (direction ub)
      const pin = [p[0] - ua[0] * inset + ub[0] * inset, p[1] - ua[1] * inset + ub[1] * inset];
      const before = [p[0] - ua[0] * inset, p[1] - ua[1] * inset], after = [p[0] + ub[0] * inset, p[1] + ub[1] * inset];
      ring.push(before, pin, after);
      faces.push(m.face([[p[0], p[1], h], [after[0], after[1], zt], [pin[0], pin[1], zt]], roof));
      faces.push(m.face([[p[0], p[1], h], [pin[0], pin[1], zt], [before[0], before[1], zt]], roof));
    } else ring.push(plateau(v));
  }
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (area > 0.05) faces.push(m.face(ring.map(([x, y]) => [x, y, zt]), top));
  return { faces, walls, slopes, top: zt };
}

/**
 * Sawtooth (shed) roof over a hall whose long walls end at height z: teeth across y, each with
 * a sloped roof and a vertical glazing facing +y. Returns the roof faces and the two end walls
 * (x0 and x1 sides, from the ground up, with the sawtooth profile); leave those sides out of
 * the hall's box.
 */
export function sawtoothRoof(m, { x0, y0, x1, y1, z, teeth, rise, roof, glass, wall }) {
  const faces = [], step = (y1 - y0) / teeth;
  // profile of the roof along y: up the slope, down the glazing
  const profile = [[y0, z]];
  for (let i = 0; i < teeth; i++) {
    const ya = y0 + i * step, yb = ya + step;
    faces.push(m.face([[x0, ya, z], [x1, ya, z], [x1, yb, z + rise], [x0, yb, z + rise]], roof));
    faces.push(m.face([[x1, yb, z], [x0, yb, z], [x0, yb, z + rise], [x1, yb, z + rise]], glass));
    profile.push([yb, z + rise], [yb, z]);
  }
  const right = [[x1, y0, 0], [x1, y1, 0], ...profile.slice().reverse().map(([y, h]) => [x1, y, h])];
  const left = [[x0, y1, 0], [x0, y0, 0], ...profile.map(([y, h]) => [x0, y, h])];
  const ends = [m.face(dedupe(right), wall), m.face(dedupe(left), wall)];
  return { faces: faces.concat(ends), ends, glazing: faces.filter((_, i) => i % 2 === 1) };
}

/** Drop consecutive duplicate points (keeps polygons valid for Newell's normal). */
function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-9) out.push(p);
  }
  return out;
}

/**
 * Positions (centres, m) of n evenly spaced window axes along a wall of length `len`, about
 * `spacing` apart, keeping `margin` free at both ends.
 */
export function axes(len, spacing, margin = 0) {
  const free = len - 2 * margin;
  const n = Math.max(0, Math.round(free / spacing));
  const out = [];
  for (let i = 0; i < n; i++) out.push(margin + ((i + 0.5) * free) / n);
  return out;
}

/* ------------------------------------------------------------------ base class */

/** What the uses of buildings mean, for info cards. */
const USE_WORDS = { residential: "homes", work: "workplaces", school: "school", shop: "shops", other: "" };

/**
 * Base class of all buildings. Subclasses build their geometry with {@link BuildingModel} and
 * return it from `computeGeometry()`; drawing, lit windows, selection and the interface for
 * the town simulation come from here.
 */
export class BuildingBase extends LayoutObject {
  static category = "Buildings";
  static placement = "point";
  /** What the building is used for: "residential" | "work" | "school" | "shop" | "other". */
  static use = "residential";

  /** The use: the `use` parameter if the type has one, else the type's use. */
  use() {
    const cls = /** @type {typeof BuildingBase} */ (this.constructor);
    if (cls.params.some((p) => p.key === "use") && this.spec.use) return this.spec.use;
    return cls.use;
  }

  /** People the building holds: {residents, jobs, pupils, visitors} (real people, from size and floors). */
  capacity() {
    return this.geometry?.capacity ?? { residents: 0, jobs: 0, pupils: 0, visitors: 0 };
  }

  /** Doors on the street front: [{pos: [x, y] layout mm, dir: [ux, uy] outward unit normal}]. */
  entrances() {
    return this.geometry?.entrances ?? [];
  }

  /** Number of floors (an attic counts as a floor), within the range of the `floors` parameter. */
  floorsCount() {
    const cls = /** @type {typeof BuildingBase} */ (this.constructor);
    const p = cls.params.find((q) => q.key === "floors");
    return Math.ceil(clamp(+this.spec.floors || p?.default || 1, p?.min ?? 1, p?.max ?? 100));
  }

  /** Overall height (top of the roof, layout mm). */
  heightMM() {
    return this.geometry?.height ?? 0;
  }

  /** Picked on its walls and roof. */
  pickHeight() {
    return this.heightMM();
  }

  /** The card: what it is used for, its floors, the people it holds and how many are inside now. */
  card() {
    const card = super.card();
    const c = this.capacity(), use = this.use();
    const word = USE_WORDS[use];
    if (word && !card.subtitle.toLowerCase().includes(word.replace(/s$/, ""))) card.subtitle = `${card.subtitle} · ${word}`;
    card.rows.push(["Floors", this.floorsCount()]);
    const holds = [[c.residents, "residents"], [c.jobs, "jobs"], [c.pupils, "pupils"], [c.visitors, "visitors"]].filter(([n]) => n > 0).map(([n, w]) => `${Math.round(n)} ${w}`);
    if (holds.length) card.rows.push(["Holds", holds.join(" · ")]);
    const inside = this.world.occupancy?.get?.(this.id);
    if (inside != null) card.rows.push(["Inside now", `${Math.round(inside)} ${Math.round(inside) === 1 ? "person" : "people"}`]);
    card.rows.push(["Occupancy", `${Math.round(this.occupancy() * 100)} %${inside == null ? " (typical for the time of day)" : ""}`]);
    return card;
  }

  /**
   * Share 0..1 of the capacity present: from the town simulation (`world.occupancy`, a Map
   * building id -> people inside) when it runs, else a typical value for the time of day.
   */
  occupancy() {
    const inside = this.world.occupancy?.get?.(this.id) ?? null;
    if (inside != null) {
      const c = this.capacity();
      const total = c.residents + c.jobs + c.pupils + c.visitors;
      return total > 0 ? clamp(inside / total, 0, 1) : 0;
    }
    return defaultOccupancy(this.use(), this.world.clock?.minutes ?? 720);
  }

  /**
   * Share of windows with the lights on (per window group) for a darkness 0..1: none by day,
   * occupancy × (0.35 .. 0.9 by time of day) when it is dark.
   */
  litShare(darkness) {
    const on = clamp((darkness - 0.15) / 0.2, 0, 1);
    if (on <= 0) return { main: 0, shop: 0 };
    const minutes = this.world.clock?.minutes ?? 720;
    return {
      main: on * this.occupancy() * lightsOn(this.use(), minutes),
      shop: on * defaultOccupancy("shop", minutes) * 0.95,
    };
  }

  /**
   * Seed for the variation of this building and for which of its windows are lit: from the id
   * (neighbours differ) and the `seed` parameter if the type has one (another seed, another variant).
   */
  seed() {
    const cls = /** @type {typeof BuildingBase} */ (this.constructor);
    const own = cls.params.some((p) => p.key === "seed") ? `:${this.spec.seed ?? ""}` : "";
    return hashString(`${this.type}:${this.id ?? ""}${own}`);
  }

  /**
   * A model whose frame is at the object's position, turned by `rotation_deg`; null while
   * the position cannot be resolved (e.g. its marker is unknown).
   */
  model() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    return new BuildingModel(new Frame(c, toRad(+this.spec.rotation_deg || 0), this.mm(1)), { seed: this.seed() });
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  draw(view) {
    const g = this.geometry;
    lightWindows(g, this.litShare(view.darkness));
    drawModel(view, g);
  }
}
