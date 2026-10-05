/**
 * The simple view: the whole layout in plain shapes, for running operations quickly.
 *
 * `SimpleView` is a `View` that draws with little detail:
 * - objects (buildings, roads, platforms, tracks, trees, ...) are flat: their footprint in one
 *   colour per kind of object ({@link drawFlat}); an object can draw its own simple form with
 *   `drawSimple(view)` (bus lines draw their route, labels their sign),
 * - everything that moves (trains, buses, cars, people, cranes, containers, vans, ...) is a plain
 *   block: what a simulation draws in 3D (`faces`, `prism`) becomes the outline of each part,
 *   extruded from its lowest to its highest point, without windows, doors or wheels,
 * - no lights, glows or night: the view is always drawn by day.
 * Seen from straight above (the flyover's plan view) it is a map; tilted, the moving things stand
 * up from the flat layout (2.5D). Picking and the editor work as in the full view.
 * @module arail/core/simple
 */
import { View } from "./view.js";
import { PALETTE, shade } from "./colors.js";

/** Outline of the blocks (moving things) and of flat objects. */
const BLOCK_OUTLINE = "rgba(0,20,80,0.45)";
const FLAT_OUTLINE = "rgba(0,20,80,0.28)";

/**
 * How kinds of objects are drawn flat: fill, outline only (`stroke`), drawing order (ground layer).
 * Types not listed go by their category ({@link CATEGORY_STYLES}), else {@link DEFAULT_STYLE}.
 */
export const SIMPLE_STYLES = {
  tabletop: { fill: "#e4e1da", order: -95 },
  area: { fill: null, order: 0 }, // the area's own kind (grass, water, ...)
  quay: { fill: "#a7adb3", order: 0.5 },
  "container-yard": { fill: "#cfcabf", order: 1 },
  road: { fill: PALETTE.asphalt, order: 1 },
  "truck-lane": { fill: PALETTE.asphalt, order: 1 },
  underpass: { fill: "#7d838a", order: 1.5 },
  platform: { fill: PALETTE.platform, order: 2 },
  "bus-stop": { fill: PALETTE.platform, order: 2 },
  "bus-terminal": { fill: PALETTE.platform, order: 2 },
  track: { fill: "#6b5a4c", order: 3 },
  "gantry-crane": { fill: null, stroke: PALETTE.steel, order: 3.5 }, // its runway; the crane moves
  "reach-stacker": null, // drawn by the terminal where it is
  tree: { fill: PALETTE.leaves, order: 4.5, round: true },
  forest: { fill: PALETTE.forest, order: 4.5 },
};

export const CATEGORY_STYLES = {
  Buildings: { fill: "#d3cdc2", order: 4 },
  Infrastructure: { fill: PALETTE.steel, order: 3.8 },
  Terminal: { fill: "#b9bec4", order: 3.8 },
};

export const DEFAULT_STYLE = { fill: "#c3c8ce", order: 4 };

/** Colours of the area kinds (as the area draws them). */
const AREA_FILL = { grass: PALETTE.grass, field: PALETTE.field, water: PALETTE.water, sand: PALETTE.sand, parking: PALETTE.parking, plaza: PALETTE.plaza, forest: PALETTE.forest };

/** The flat style of an object (null: not drawn). */
export function simpleStyle(obj) {
  if (Object.hasOwn(SIMPLE_STYLES, obj.type)) return SIMPLE_STYLES[obj.type];
  return CATEGORY_STYLES[obj.constructor.category] || DEFAULT_STYLE;
}

/**
 * Draw an object flat on the layout: its footprint in the colour of its kind.
 * @param {View} view
 * @param {import("./object.js").LayoutObject} obj
 */
export function drawFlat(view, obj) {
  const style = simpleStyle(obj);
  if (!style) return;
  let fp = obj.footprint();
  if (!fp || fp.length < 3) return;
  if (style.round) fp = circleAround(fp);
  const fill = obj.type === "area" ? AREA_FILL[obj.spec.kind] || PALETTE.grass : style.fill;
  view.polygon(fp, {
    fill: fill || undefined,
    stroke: style.stroke || FLAT_OUTLINE,
    width: style.stroke ? 2 : 1,
    order: style.order,
  });
}

/** A circle (12 corners) inside the bounding box of a footprint. */
function circleAround(fp) {
  const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = Math.min(Math.max(...xs) - cx, Math.max(...ys) - cy);
  return Array.from({ length: 12 }, (_, k) => [cx + r * Math.cos((k * Math.PI) / 6), cy + r * Math.sin((k * Math.PI) / 6)]);
}

/**
 * Convex hull of 2D points (monotone chain), counter-clockwise.
 * @param {number[][]} points
 * @returns {number[][]}
 */
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The main colour of a set of faces: the first side (vertical) face's, else the first face's. */
function mainColour(faces) {
  const side = faces.find((f) => f.normal && Math.abs(f.normal[2]) < 0.5);
  return (side || faces[0]).color || DEFAULT_STYLE.fill;
}

export class SimpleView extends View {
  /** @param {ConstructorParameters<typeof View>[0]} options as for `View`; it is always day */
  constructor(options) {
    super({ ...options, night: 0 });
    this.simple = true;
    /**
     * True while static things are drawn (the table, objects): 3D shapes are drawn flat then.
     * `World.draw` switches it off for what moves (vehicles, people, simulations).
     */
    this.flat = true;
    this._raw = false;
  }

  /** Any 3D shape: one block over the outline of all its faces. */
  faces(faces, ref, style = {}) {
    if (this._raw) return super.faces(faces, ref, style);
    if (!faces.length) return;
    const pts = [];
    let z0 = Infinity, z1 = -Infinity;
    for (const f of faces) {
      for (const p of f.pts) {
        pts.push(p);
        const z = p[2] || 0;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    const hull = convexHull(pts);
    if (hull.length >= 3) this.block(hull, z0, z1, mainColour(faces));
  }

  prism(footprint, z0, z1, colors) {
    this.block(footprint, z0, z1, colors.side || colors.top || DEFAULT_STYLE.fill);
  }

  /**
   * A plain block: the footprint (mm) extruded from z0 to z1 (mm); flat while `flat` is set.
   * @param {number[][]} footprint
   * @param {number} z0
   * @param {number} z1
   * @param {string} colour
   */
  block(footprint, z0, z1, colour) {
    if (this.flat || !(z1 - z0 > 1e-6)) {
      this.polygon(footprint, { fill: colour, stroke: FLAT_OUTLINE, width: 1, order: 6 });
      return;
    }
    this._raw = true;
    try {
      super.prism(footprint, z0, z1, { side: colour, top: shade(colour, 1.25), outline: BLOCK_OUTLINE });
    } finally {
      this._raw = false;
    }
  }

  glow() {}

  lightPool() {}
}
