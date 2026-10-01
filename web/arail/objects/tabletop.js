/**
 * Table module: a rectangular base plate whose top is the layout plane (z = 0), with an edge
 * 18 mm deep, so that it reads as a real piece of furniture.
 *
 * Two kinds:
 * - `extension`: a virtual table module beside the real table. It is drawn in the camera view
 *   too (opaque enough to cover the floor beyond the real table) and in the flyover; virtual
 *   objects can be placed on it.
 * - `physical`: the outline of a real table in the lab. In the camera view the real table is
 *   in the image, so it is only drawn in the flyover (`view.virtual`). Without any physical
 *   table the flyover draws a default one around the markers and objects ({@link defaultTableBounds}).
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

/** Ground-layer orders: all edges first, then all tops (a top in front hides the edge of the module behind it). */
const ORDER_EDGE = -110, ORDER_TOP = -100;

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
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const w = Math.max(1, +this.spec.width_mm || 1000), d = Math.max(1, +this.spec.depth_mm || 600);
    const angle = toRad(+this.spec.rotation_deg || 0);
    return { center: c, width: w, depth: d, angle, footprint: rectFootprint(c, w, d, angle) };
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
    drawTable(view, this.geometry.footprint, { surface: this.spec.surface, alpha: view.virtual ? 1 : 0.94 });
  }
}

/**
 * Draw a table: its top as a plate at z = 0 and the edges that face the camera down to
 * z = −thickness. Everything goes into the ground layer, edges before tops.
 * @param {import("../core/view.js").View} view
 * @param {number[][]} footprint corners of the top (layout mm)
 * @param {{surface?: string, alpha?: number, thickness?: number}} [options]
 */
export function drawTable(view, footprint, { surface = "grey", alpha = 1, thickness = TABLE_THICKNESS_MM } = {}) {
  const s = TABLE_SURFACES[surface] || TABLE_SURFACES.grey;
  const n = footprint.length;
  const ccw = signedArea(footprint) > 0 ? 1 : -1;
  const edge = parseColor(s.edge);
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (!(l > 0)) continue;
    const normal = [(ccw * dy) / l, (-ccw * dx) / l, 0];
    const centre = view.cam((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -thickness / 2);
    const nc = view.normalToCamera(normal);
    if (nc[0] * centre[0] + nc[1] * centre[1] + nc[2] * centre[2] >= 0) continue; // faces away
    const img = projectFace(view, [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], -thickness], [a[0], a[1], -thickness]]);
    if (!img) continue;
    const k = view.light(normal) * 0.92;
    view.ground(ORDER_EDGE, (ctx) => {
      ctx.globalAlpha *= alpha;
      ctx.beginPath();
      img.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = view.dim(rgba(edge.map((v) => v * k)));
      ctx.fill();
    });
  }
  view.polygon(footprint, { fill: s.top, alpha, stroke: s.edge, width: 1, order: ORDER_TOP });
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
 * The real table as far as the layout knows it, for the flyover when no physical table module
 * is drawn: the bounding box of the markers, the objects and the orthophoto, plus a margin.
 * Table modules and objects standing on a virtual extension are left out (they are beside the
 * real table).
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
