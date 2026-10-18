/**
 * Table module: a rectangular base plate. Its top lies at its level (`level_mm`): the height above
 * the track level, the top of the real table (z = 0). Houses, streets and the rest are built on
 * table modules and stand at their level (core/elevation.js); streets climb from one level to
 * another on ramps, and between two raised modules they span what lies lower as a bridge (a street
 * over the tracks needs the clearance and its deck: 77 mm in H0). The module's edges reach down
 * 18 mm below its top, or to the module it stands on, so that it reads as a piece of furniture.
 *
 * Two kinds:
 * - `extension`: a virtual table module beside the real table (or on it, raised). It is drawn in the
 *   camera view too (opaque enough to cover the floor beyond the real table) and in the flyover;
 *   virtual objects can be placed on it.
 * - `physical`: the outline of a real table in the lab. In the camera view the real table is
 *   in the image, so it is only drawn in the flyover (`view.virtual`). Without any physical
 *   table and without an orthophoto (which shows the real table, blank around it) the flyover
 *   draws a default one around the markers and objects ({@link defaultTableBounds}).
 * @module arail/objects/tabletop
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, round1 } from "../core/anchors.js";
import { rectFootprint } from "../core/view.js";
import { orthoOf } from "../core/layout.js";
import { parseColor, rgba } from "../core/colors.js";
import { pointInPolygon, toRad } from "../core/math.js";

/** Surfaces of table modules: colour of the top and of the edge. */
export const TABLE_SURFACES = {
  grey: { label: "light grey", top: "#dcdedc", edge: "#a2a7aa" },
  white: { label: "white", top: "#f6f6f4", edge: "#c2c5c7" },
  green: { label: "model grass", top: "#8aa86a", edge: "#77736a" },
};

/** Thickness of the base plate (mm): the visible front edge. */
export const TABLE_THICKNESS_MM = 18;

/**
 * Ground-layer orders: all edges first, then all tops (a top in front hides the edge of the module
 * behind it), level by level from the lowest (a raised module stands on what is lower). Real
 * tables lie below the orthophoto of the table (order -90, drawn by the flyover), virtual extensions
 * above it: a module placed over the photo hides it, as it would on the table. `step`: from one
 * level to the next; `levels`: as many levels as get orders of their own (the rest share the last).
 */
const ORDER = { physical: { edge: -110, top: -109.4, step: 1.2, levels: 9 }, extension: { edge: -88, top: -87.4, step: 1.2, levels: 5 } };

/** The levels of table modules to choose from (mm), by default: the track level and those of bridges over the tracks in H0. */
const LEVELS_MM = [0, 40, 80];

export class Tabletop extends LayoutObject {
  static type = "tabletop";
  static label = "Table module";
  static category = "Table";
  static placement = "rect";
  /** Picked at its edges (or anywhere once selected): dragging over a table pans the flyover. */
  static background = true;
  static description = "A table module: a virtual extension beside the real table, or the outline of a real table (drawn only in the flyover).";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    {
      key: "kind", label: "Kind", type: "select", default: "extension",
      options: [["extension", "virtual extension"], ["physical", "real table (only drawn in the flyover)"]],
      help: "Extensions also cover the camera image.",
    },
    { key: "width_mm", label: "Width", type: "number", unit: "mm", min: 20, max: 20000, step: 5, default: 1000 },
    { key: "depth_mm", label: "Depth", type: "number", unit: "mm", min: 20, max: 20000, step: 5, default: 600 },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "surface", label: "Surface", type: "select", default: "grey", options: Object.entries(TABLE_SURFACES).map(([k, v]) => [k, v.label]) },
    {
      key: "level_mm", label: "Level", type: "number", unit: "mm", min: -500, max: 500, step: 1, default: 0, presets: LEVELS_MM,
      help: "Height of the top above the track level (the top of the real table). Streets climb from one level to another at 8 % at most (6 % with tram tracks). A street over a railway needs 6.7 m: 77 mm in H0.",
    },
  ];

  /** It draws its heights itself (core/elevation.js). */
  static elevation = "none";

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const w = Math.max(1, +this.spec.width_mm || 1000), d = Math.max(1, +this.spec.depth_mm || 600);
    const angle = toRad(+this.spec.rotation_deg || 0);
    return { center: c, width: w, depth: d, angle, footprint: rectFootprint(c, w, d, angle) };
  }

  /** The card: real table or virtual extension, its size and its level. */
  card() {
    const card = super.card();
    const g = this.geometry;
    card.rows.push(["Kind", this.physical ? "real table" : "virtual extension"]);
    if (g) card.rows.push(["Size", `${Math.round(g.width)} × ${Math.round(g.depth)} mm`]);
    const level = this.groundLevel();
    card.rows.push(["Level", level ? `${Math.abs(level)} mm ${level > 0 ? "above" : "below"} the track level` : "the track level"]);
    return card;
  }

  /** Height of its top above the track level (mm): what stands on it stands there (core/elevation.js). */
  groundLevel() {
    return Number(this.spec.level_mm) || 0;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  /** The corner that snaps to the grid when the module is dragged (its edges stay on grid lines). */
  snapPoint() {
    return this.geometry?.footprint[0] || null;
  }

  /** Where a copy goes (editor: Duplicate): right next to this module, so that modules line up. */
  duplicateOffset() {
    const g = this.geometry;
    return g ? [g.width * Math.cos(g.angle), g.width * Math.sin(g.angle)] : [0, 0];
  }

  get physical() {
    return this.spec.kind === "physical";
  }

  draw(view) {
    if (this.physical && !view.virtual) return; // the real table is in the camera image
    const g = this.geometry, level = this.groundLevel(), el = this.world.elevation.sync();
    // the levels of the modules from the lowest: the order this one is drawn in
    const levels = [...new Set(el.modules.map((m) => m.level))].sort((a, b) => a - b);
    // each edge reaches down to a lower module beside or under it (it stands on that), else the
    // plate's thickness below the track level or its top, whichever is lower
    const out = this.mm(0.1);
    const base = (a, b) => {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      let z = -Infinity;
      for (const side of [1, -1]) {
        const x = mx + (side * dy * out) / l, y = my - (side * dx * out) / l;
        for (const m of el.modules) {
          if (m.obj === this || m.level >= level - 1e-6 || !pointInPolygon([x, y], m.fp)) continue;
          z = Math.max(z, m.level);
          break;
        }
      }
      return z > -Infinity ? z : Math.min(level, 0) - TABLE_THICKNESS_MM;
    };
    drawTable(view, g.footprint, {
      surface: this.spec.surface, alpha: view.virtual ? 1 : 0.94, kind: this.physical ? "physical" : "extension", level, base, rank: levels.indexOf(level),
    });
  }
}

/**
 * Draw a table: its top as a plate at its level and the edges that face the camera down to the
 * plate's thickness below it, or to `base` (the module beside an edge, when that is lower).
 * Everything goes into the ground layer, edges before tops, lower levels first (`rank`). Heights
 * are drawn as given (no lift).
 * @param {import("../core/view.js").View} view
 * @param {number[][]} footprint corners of the top (layout mm)
 * @param {{surface?: string, alpha?: number, thickness?: number, kind?: "physical" | "extension", level?: number,
 *   base?: ((a: number[], b: number[]) => number) | null, rank?: number}} [options] level: height of the top (mm);
 *   base: the height an edge from a to b reaches down to; rank: the place of the level among the levels of the layout (0 = the lowest)
 */
export function drawTable(view, footprint, { surface = "grey", alpha = 1, thickness = TABLE_THICKNESS_MM, kind = "physical", level = 0, base = null, rank = 0 } = {}) {
  const O = ORDER[kind] || ORDER.physical, up = O.step * Math.max(0, Math.min(O.levels - 1, rank));
  const s = TABLE_SURFACES[surface] || TABLE_SURFACES.grey;
  const n = footprint.length;
  const ccw = signedArea(footprint) > 0 ? 1 : -1;
  const edge = parseColor(s.edge);
  view.withLift(null, () => {
    for (let i = 0; i < n; i++) {
      const a = footprint[i], b = footprint[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (!(l > 0)) continue;
      const z0 = base ? base(a, b) : level - thickness;
      if (!(z0 < level)) continue;
      const normal = [(ccw * dy) / l, (-ccw * dx) / l, 0];
      const centre = view.cam((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (level + z0) / 2);
      const nc = view.normalToCamera(normal);
      if (nc[0] * centre[0] + nc[1] * centre[1] + nc[2] * centre[2] >= 0) continue; // faces away
      const img = projectFace(view, [[a[0], a[1], level], [b[0], b[1], level], [b[0], b[1], z0], [a[0], a[1], z0]]);
      if (!img) continue;
      const k = view.light(normal) * 0.92;
      view.ground(O.edge + up, (ctx) => {
        ctx.globalAlpha *= alpha;
        ctx.beginPath();
        img.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fillStyle = view.dim(rgba(edge.map((v) => v * k)));
        ctx.fill();
      });
    }
    view.polygon(footprint, { z: level, fill: s.top, alpha, stroke: s.edge, width: 1, order: O.top + up });
  });
}

/** Project a 3D polygon, cut off where it passes behind the camera; null if nothing is left. */
function projectFace(view, pts) {
  const NEAR = 2;
  const depth = pts.map((p) => view.depth(p[0], p[1], p[2]));
  let poly = pts;
  if (depth.some((d) => d < NEAR)) {
    poly = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, a = pts[i], b = pts[j], da = depth[i], db = depth[j];
      if (da >= NEAR) poly.push(a);
      if ((da >= NEAR) !== (db >= NEAR)) {
        const t = (NEAR - da) / (db - da);
        poly.push([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t));
      }
    }
    if (poly.length < 3) return null;
  }
  return view.projectAll(poly);
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** True if the layout has the outline of a real table (then the flyover draws no default table). */
export function hasPhysicalTable(world) {
  return world.objects.some((o) => o instanceof Tabletop && o.physical && o.geometry);
}

/**
 * The real table as far as the layout knows it, for the flyover when neither a physical table
 * module nor an orthophoto shows it (and for the extent of the scene): the bounding box of the
 * markers, the objects and the orthophoto, plus a margin. Table modules and objects standing on
 * a virtual extension are left out (they are beside the real table).
 * @param {import("../core/world.js").World} world
 * @param {number} [margin=100] mm
 * @returns {number[] | null} [xmin, ymin, xmax, ymax] or null if there is nothing on the layout
 */
export function defaultTableBounds(world, margin = 100) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  };
  const map = world.map;
  for (const id of map.ids()) for (const c of map.cornersInLayout(id)) add(c[0], c[1]);
  const extensions = world.objects.filter((o) => o instanceof Tabletop && !o.physical && o.geometry).map((o) => o.geometry.footprint);
  for (const o of world.objects) {
    if (o instanceof Tabletop || !o.geometry) continue;
    const fp = o.footprint();
    if (!fp) continue;
    const a = o.anchorPoint();
    if (a && extensions.some((e) => pointInPolygon(a, e))) continue;
    for (const p of fp) add(p[0], p[1]);
  }
  const ortho = orthoOf(world.layout);
  if (ortho) {
    add(ortho.bounds_mm[0], ortho.bounds_mm[1]);
    add(ortho.bounds_mm[2], ortho.bounds_mm[3]);
  }
  if (!(b[2] >= b[0])) return null;
  return [round1(b[0] - margin), round1(b[1] - margin), round1(b[2] + margin), round1(b[3] + margin)];
}
