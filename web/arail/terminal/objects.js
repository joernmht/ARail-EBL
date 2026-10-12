/**
 * Container terminal infrastructure, placed in Build (palette group "Terminal"): yard blocks,
 * rail-mounted gantry cranes, truck lanes, quays and reach stackers. Loading tracks are ordinary
 * `track` objects. The terminal simulation (operations.js) reads these objects; runtime state
 * (containers, vehicles) never enters their specs.
 *
 * Positions may be marker-relative like those of every other object; the geometry is recomputed
 * when the spec, the marker map or the scale changes (see `LayoutObject.geometry`).
 * @module arail/terminal/objects
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, resolvePoints } from "../core/anchors.js";
import { rectFootprint } from "../core/view.js";
import { clamp, dist2, polygonArea, polylineLengths, sub2, toRad, unit2, wrapAngle } from "../core/math.js";
import { offsetPolyline } from "../objects/road.js";
import { BAY_M, CARRIER_TYPES, ROW_M, yardType } from "./model.js";
import { drawCraneRails, drawQuay, drawTruckLane, drawYardGround } from "./draw.js";

const NAME = { key: "name", label: "Name", type: "text", default: "" };
const ROTATION = { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 };
const SPEED = { key: "speed", label: "Speed factor", type: "number", unit: "×", min: 0.25, max: 5, step: 0.25, default: 1 };
const SIDES = [["left", "left"], ["right", "right"]];

/** Half the length of a crane's portal (m): the trolley stays this far inside the runway ends. */
const PORTAL_HALF_M = 8;
/** Width of a truck lane and of its passing lane (m). */
const LANE_M = 3.5;
/** Spacing of the truck positions (m) and their distance from the lane ends at least. */
const TRUCK_PITCH_M = 19, TRUCK_END_M = 10;
/**
 * Largest bend (degrees) of a truck lane within one truck length where trucks stand and pass: trucks
 * pass standing ones in a passing lane only 3.5 m over, so on sharper bends their outlines overlap.
 */
const TRUCK_BEND_DEG = 10;
/** Distance of the quay wall from the fairway centre line (m): half the beam of a barge plus 0.5 m. */
const QUAY_OFFSET_M = 5.25;
/** Width of the quay wall (m). */
const WALL_M = 3;
/** Footprint of a reach stacker (m). */
const STACKER_LENGTH_M = 8, STACKER_WIDTH_M = 4;

/**
 * Bays and rows of a yard block of this size: as many 6.9 m bays and 2.9 m rows as fit (a 5 %
 * tolerance absorbs rounding), at least one of each.
 * @param {number} width_mm along the bays (model mm)
 * @param {number} depth_mm across the rows (model mm)
 * @param {number} scale e.g. 87 for H0
 * @returns {{bays: number, rows: number}}
 */
export function yardGrid(width_mm, depth_mm, scale) {
  const mm = (m) => (m * 1000) / scale;
  return {
    bays: Math.max(1, Math.floor(width_mm / mm(BAY_M) + 0.05)),
    rows: Math.max(1, Math.floor(depth_mm / mm(ROW_M) + 0.05)),
  };
}

/* ---------------------------------------------------------------- polyline helpers */

/** Drop repeated points. */
function dedupe(points) {
  const out = [];
  for (const p of points) if (!out.length || dist2(p, out[out.length - 1]) > 1e-6) out.push(p);
  return out;
}

/** Points of a polyline spec in layout mm (marker-relative points resolved, repeats dropped); null with fewer than 2. */
function linePoints(world, spec) {
  const raw = resolvePoints(world.map, spec);
  const points = raw ? dedupe(raw) : [];
  return points.length >= 2 ? points : null;
}

/**
 * Point and unit direction at arc length `s` along a polyline, moved sideways by `offset`
 * (+ = left); beyond the ends the first and last segments are extended in a straight line.
 */
function pathAt(points, lengths, s, offset = 0) {
  const n = points.length, total = lengths[n - 1];
  let i = 1;
  while (i < n - 1 && lengths[i] < s) i++;
  const dir = unit2(sub2(points[i], points[i - 1]));
  const [base, d] = s <= 0 ? [points[0], s] : s >= total ? [points[n - 1], s - total] : [points[i - 1], s - lengths[i - 1]];
  return { point: [base[0] + dir[0] * d - dir[1] * offset, base[1] + dir[1] * d + dir[0] * offset], dir };
}

/** The part of a polyline between arc lengths `from` and `to` (clamped to the line). */
function subPolyline(points, lengths, from, to) {
  const total = lengths[lengths.length - 1];
  const a = clamp(from, 0, total), b = clamp(to, 0, total);
  if (!(b > a)) return null;
  const out = [pathAt(points, lengths, a).point];
  for (let i = 1; i < points.length - 1; i++) if (lengths[i] > a && lengths[i] < b) out.push(points[i]);
  out.push(pathAt(points, lengths, b).point);
  return out;
}

/** Outline (counter-clockwise) of the band between the sideways offsets `a` and `b` (mm, + = left) of a polyline. */
function ribbon(points, a, b) {
  const poly = offsetPolyline(points, a).concat(offsetPolyline(points, b).reverse());
  return polygonArea(poly) < 0 ? poly.reverse() : poly;
}

/** Cranes of the world that are placed. */
function cranesOf(world) {
  return world.objects.filter((o) => o instanceof GantryCrane && o.geometry);
}

/** Does some crane reach one of these layout points? */
function craneReaches(world, points) {
  return cranesOf(world).some((c) => points.some((p) => c.reaches(p)));
}

/* ---------------------------------------------------------------- objects */

/**
 * A block of container stacks. Geometry: `{center, angle, width, depth, footprint, bays, rows, tiers}`;
 * the bays run along the width (the direction `angle`), the grid is centred on the block.
 */
export class ContainerYard extends LayoutObject {
  static type = "container-yard";
  static label = "Container yard block";
  static category = "Terminal";
  static placement = "rect";
  static description = "Container stacks: bays of 6.9 m along the rectangle, rows of 2.9 m across.";
  static params = [
    NAME,
    { key: "width_mm", label: "Length (bays)", type: "number", unit: "mm", min: 50, max: 5000, step: 5, default: 476, help: "Along the bays, 6.9 m each." },
    { key: "depth_mm", label: "Depth (rows)", type: "number", unit: "mm", min: 30, max: 2000, step: 5, default: 134, help: "Across the rows, 2.9 m each." },
    ROTATION,
    { key: "tiers", label: "Stack height", type: "number", min: 1, max: 5, step: 1, default: 3, help: "Containers per stack at most." },
  ];

  computeGeometry() {
    const center = resolvePoint(this.world.map, this.spec.position);
    if (!center) return null;
    const width = Math.max(1, +this.spec.width_mm || 476), depth = Math.max(1, +this.spec.depth_mm || 134);
    const angle = toRad(+this.spec.rotation_deg || 0);
    const tiers = clamp(Math.round(+this.spec.tiers || 3), 1, 5);
    const { bays, rows } = yardGrid(width, depth, this.world.scale);
    return { center, angle, width, depth, footprint: rectFootprint(center, width, depth, angle), bays, rows, tiers };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  /** The corner that snaps to the grid when the block is dragged. */
  snapPoint() {
    return this.geometry?.footprint?.[0] || null;
  }

  /** Where a copy goes (editor: Duplicate): right behind this block, so that blocks line up. */
  duplicateOffset() {
    const g = this.geometry;
    return g ? [g.width * Math.cos(g.angle), g.width * Math.sin(g.angle)] : [0, 0];
  }

  /** Carrier type of this block ({@link yardType}), or null while it is not placed. */
  carrierType() {
    const g = this.geometry;
    return g ? yardType({ bays: g.bays, rows: g.rows, tiers: g.tiers }) : null;
  }

  /** Layout points (mm) of the stack centres, bay by bay. */
  _stackCentres() {
    const g = this.geometry, t = this.carrierType();
    if (!g) return [];
    const u = [Math.cos(g.angle), Math.sin(g.angle)], out = [];
    for (const a of t.bays_m) for (const r of t.rows_m) out.push([g.center[0] + u[0] * this.mm(a) - u[1] * this.mm(r), g.center[1] + u[1] * this.mm(a) + u[0] * this.mm(r)]);
    return out;
  }

  /** What is wrong with the block (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g) return [];
    const out = [];
    if (g.width < 0.95 * this.mm(BAY_M)) out.push(`Too short for a bay of ${BAY_M} m: make it at least ${Math.ceil(this.mm(BAY_M))} mm long.`);
    if (g.depth < 0.95 * this.mm(ROW_M)) out.push(`Too narrow for a row of ${ROW_M} m: make it at least ${Math.ceil(this.mm(ROW_M))} mm deep.`);
    if (!this.world.objects.some((o) => o instanceof ReachStacker) && !craneReaches(this.world, this._stackCentres())) {
      out.push("No gantry crane reaches it and there is no reach stacker: containers cannot be moved here.");
    }
    return out;
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawYardGround(view, g, { name: this.spec.name || "" });
  }
}

/**
 * A rail-mounted gantry crane over the area between its rails. Geometry:
 * `{center, angle, u, n, length, span, outreach, lift, footprint, coverage, railA: [p, q], railB: [p, q]}`;
 * crane-local `s` runs along the rails (u), `t` across (n), both from the centre (mm); rail A is at
 * t = −span/2, rail B at t = +span/2. `footprint` is the area between the rails, `coverage` the
 * area the trolley reaches.
 */
export class GantryCrane extends LayoutObject {
  static type = "gantry-crane";
  static label = "Gantry crane";
  static category = "Terminal";
  static placement = "rect";
  /** Picked at its edges (or anywhere once selected): the yard and tracks under it stay selectable. */
  static background = true;
  static description = "Rail-mounted gantry crane. Drag over the area between its rails: the rails run along the rectangle's width; it reaches its outreach beyond each rail.";
  static params = [
    NAME,
    { key: "width_mm", label: "Runway length", type: "number", unit: "mm", min: 100, max: 5000, step: 5, default: 1150, help: "Along the rails." },
    { key: "depth_mm", label: "Span", type: "number", unit: "mm", min: 100, max: 1500, step: 5, default: 345, help: "Between the rails." },
    ROTATION,
    { key: "outreach_m", label: "Outreach", type: "number", unit: "m", min: 0, max: 20, step: 0.5, default: 8, help: "How far it reaches beyond each rail." },
    { key: "lift_m", label: "Lifting height", type: "number", unit: "m", min: 8, max: 25, step: 0.5, default: 15 },
    SPEED,
  ];

  computeGeometry() {
    const center = resolvePoint(this.world.map, this.spec.position);
    if (!center) return null;
    const length = Math.max(1, +this.spec.width_mm || 1150), span = Math.max(1, +this.spec.depth_mm || 345);
    const angle = toRad(+this.spec.rotation_deg || 0);
    const u = [Math.cos(angle), Math.sin(angle)], n = [-u[1], u[0]];
    const outreach = this.mm(Math.max(0, Number(this.spec.outreach_m) || 0)), lift = this.mm(Number(this.spec.lift_m) || 15);
    const at = (s, t) => [center[0] + u[0] * s + n[0] * t, center[1] + u[1] * s + n[1] * t];
    const half = Math.max(0, length / 2 - this.mm(PORTAL_HALF_M)), reach = span / 2 + outreach;
    return {
      center, angle, u, n, length, span, outreach, lift,
      footprint: rectFootprint(center, length, span, angle),
      coverage: [at(-half, -reach), at(half, -reach), at(half, reach), at(-half, reach)],
      railA: [at(-length / 2, -span / 2), at(length / 2, -span / 2)],
      railB: [at(-length / 2, span / 2), at(length / 2, span / 2)],
    };
  }

  /**
   * Crane-local coordinates (mm) of a layout point.
   * @returns {number[] | null} [s, t]
   */
  toLocal(p) {
    const g = this.geometry;
    if (!g || !p) return null;
    const d = sub2(p, g.center);
    return [d[0] * g.u[0] + d[1] * g.u[1], d[0] * g.n[0] + d[1] * g.n[1]];
  }

  /**
   * Layout point (mm) of crane-local coordinates.
   * @returns {number[] | null} [x, y]
   */
  fromLocal(s, t) {
    const g = this.geometry;
    return g ? [g.center[0] + g.u[0] * s + g.n[0] * t, g.center[1] + g.u[1] * s + g.n[1] * t] : null;
  }

  /** Range of `s` the trolley can reach (the portal is 16 m long; [0, 0] on a shorter runway). */
  sRange() {
    const g = this.geometry;
    if (!g) return null;
    const half = g.length / 2 - this.mm(PORTAL_HALF_M);
    return half > 0 ? [-half, half] : [0, 0];
  }

  /** Range of `t` the trolley can reach (span plus outreach on both sides). */
  tRange() {
    const g = this.geometry;
    return g ? [-g.span / 2 - g.outreach, g.span / 2 + g.outreach] : null;
  }

  /** Can the crane reach this layout point (inside both ranges)? */
  reaches(p) {
    const l = this.toLocal(p);
    if (!l) return false;
    const s = this.sRange(), t = this.tRange(), eps = 1e-6;
    return l[0] >= s[0] - eps && l[0] <= s[1] + eps && l[1] >= t[0] - eps && l[1] <= t[1] + eps;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  snapPoint() {
    return this.geometry?.footprint?.[0] || null;
  }

  /** Where a copy goes (editor: Duplicate): the next runway section, in line with this one. */
  duplicateOffset() {
    const g = this.geometry;
    return g ? [g.length * g.u[0], g.length * g.u[1]] : [0, 0];
  }

  /** What is wrong with the crane (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g || g.length >= 2 * this.mm(PORTAL_HALF_M)) return [];
    return [`The runway is shorter than the crane (${2 * PORTAL_HALF_M} m): make it at least ${Math.ceil(2 * this.mm(PORTAL_HALF_M))} mm long.`];
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawCraneRails(view, g);
  }
}

/**
 * A lane for trucks under a crane, with a passing lane beside it. Geometry:
 * `{points, lengths, total, side (+1 left, −1 right), passingOffset, footprint}`; the footprint is
 * the asphalt from the outer edge of the loading lane to the outer edge of the passing lane.
 */
export class TruckLane extends LayoutObject {
  static type = "truck-lane";
  static label = "Truck lane";
  static category = "Terminal";
  static placement = "polyline";
  static description = "Lane for trucks under the crane, in driving direction (the first point is the entry). Trucks stop at evenly spaced positions around its middle; a passing lane runs beside it.";
  static params = [
    NAME,
    { key: "positions", label: "Truck positions", type: "number", min: 1, max: 6, step: 1, default: 3 },
    { key: "passing_side", label: "Passing lane", type: "select", default: "left", options: SIDES, help: "Seen in the driving direction." },
  ];

  computeGeometry() {
    const points = linePoints(this.world, this.spec.points);
    if (!points) return null;
    const lengths = polylineLengths(points), total = lengths[lengths.length - 1];
    const side = this.spec.passing_side === "right" ? -1 : 1, lane = this.mm(LANE_M);
    return {
      points, lengths, total, side, passingOffset: side * lane,
      footprint: ribbon(points, -side * (lane / 2), side * (lane * 1.5)),
    };
  }

  /**
   * Point and driving direction at arc length `s` (mm); `offset` + = left of the driving direction.
   * Beyond the ends the lane goes on in a straight line.
   * @returns {{point: number[], dir: number[]} | null}
   */
  at(s, offset = 0) {
    const g = this.geometry;
    return g ? pathAt(g.points, g.lengths, s, offset) : null;
  }

  /** Number of truck positions (1-6). */
  _count() {
    return clamp(Math.round(+this.spec.positions || 3), 1, 6);
  }

  /**
   * Arc lengths (mm) of the loading centres of the truck positions, ascending: 19 m apart around
   * the middle of the lane, at least 10 m from its ends.
   * @returns {number[]}
   */
  positions() {
    const g = this.geometry;
    if (!g) return [];
    const n = this._count(), pitch = this.mm(TRUCK_PITCH_M), lo = this.mm(TRUCK_END_M), hi = g.total - lo;
    return Array.from({ length: n }, (_, i) => clamp(g.total / 2 + (i - (n - 1) / 2) * pitch, lo, hi));
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    const g = this.geometry;
    return g ? pathAt(g.points, g.lengths, g.total / 2).point : null;
  }

  /** What is wrong with the lane (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g) return [];
    const out = [], n = this._count();
    const need = this.mm((n - 1) * TRUCK_PITCH_M + 2 * TRUCK_END_M);
    if (g.total < need - 1e-6) {
      out.push(`Too short for ${n} truck position${n === 1 ? "" : "s"}: make it at least ${Math.ceil(need)} mm long, or use fewer positions.`);
    }
    if (!this.world.objects.some((o) => o instanceof ReachStacker) && !craneReaches(this.world, this.positions().map((s) => this.at(s).point))) {
      out.push("No gantry crane reaches its truck positions and there is no reach stacker: trucks cannot be loaded.");
    }
    const bend = this._bendDeg();
    if (bend > TRUCK_BEND_DEG + 1e-6) {
      out.push(`Bends by ${Math.round(bend)}° near its truck positions: trucks passing or turning in there may overlap. Keep it straighter there (at most ${TRUCK_BEND_DEG}°).`);
    }
    return out;
  }

  /**
   * Largest change of direction (degrees) between two segments at most one truck length apart, from
   * one truck length before the rear of the first truck position to one after the front of the last.
   */
  _bendDeg() {
    const g = this.geometry, ps = this.positions(), truck = CARRIER_TYPES.chassis40, L = this.mm(truck.length_m);
    if (!g || !ps.length) return 0;
    const from = ps[0] + this.mm(truck.rear_m) - L, to = ps[ps.length - 1] + this.mm(truck.front_m) + L;
    const segs = [];
    for (let k = 1; k < g.points.length; k++) {
      if (g.lengths[k] <= from || g.lengths[k - 1] >= to || !(g.lengths[k] > g.lengths[k - 1])) continue;
      const d = sub2(g.points[k], g.points[k - 1]);
      segs.push({ start: g.lengths[k - 1], end: g.lengths[k], heading: Math.atan2(d[1], d[0]) });
    }
    let worst = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length && segs[j].start - segs[i].end <= L; j++) worst = Math.max(worst, Math.abs(wrapAngle(segs[j].heading - segs[i].heading)));
    }
    return (worst * 180) / Math.PI;
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawTruckLane(view, g, { positions: this.positions() });
  }
}

/**
 * The fairway of the barges along a quay wall. Geometry:
 * `{points, lengths, total, side (+1 left, −1 right), quayOffset, water, wall, berth: [from, to], footprint}`;
 * `water` and `wall` are polygons (the wall only along the berth), `berth` the arc lengths of the
 * berth (it ends at the last point), the footprint is the water.
 */
export class Quay extends LayoutObject {
  static type = "quay";
  static label = "Quay and fairway";
  static category = "Terminal";
  static placement = "polyline";
  /** Picked at its edges (or anywhere once selected): what lies on it stays selectable. */
  static background = true;
  static description = "Fairway of the barges (the first point is where they come from). They berth with the bow at the last point, along the quay wall.";
  static params = [
    NAME,
    { key: "berth_m", label: "Berth length", type: "number", unit: "m", min: 20, max: 200, step: 5, default: 60 },
    { key: "water_m", label: "Fairway width", type: "number", unit: "m", min: 10, max: 60, step: 1, default: 16 },
    { key: "quay_side", label: "Quay wall side", type: "select", default: "right", options: SIDES, help: "Seen in the sailing direction." },
  ];

  computeGeometry() {
    const points = linePoints(this.world, this.spec.points);
    if (!points) return null;
    const lengths = polylineLengths(points), total = lengths[lengths.length - 1];
    const side = this.spec.quay_side === "left" ? 1 : -1, quayOffset = side * this.mm(QUAY_OFFSET_M);
    const berth = [total - this.mm(Number(this.spec.berth_m) || 60), total];
    const water = ribbon(points, quayOffset, quayOffset - side * this.mm(Number(this.spec.water_m) || 16));
    const along = subPolyline(points, lengths, berth[0], berth[1]);
    const wall = along ? ribbon(along, quayOffset, quayOffset + side * this.mm(WALL_M)) : null;
    return { points, lengths, total, side, quayOffset, water, wall, berth, footprint: water };
  }

  /**
   * Point and sailing direction at arc length `s` (mm); `offset` + = left. Beyond the ends the
   * fairway goes on in a straight line.
   * @returns {{point: number[], dir: number[]} | null}
   */
  at(s, offset = 0) {
    const g = this.geometry;
    return g ? pathAt(g.points, g.lengths, s, offset) : null;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    const g = this.geometry;
    return g ? pathAt(g.points, g.lengths, g.total / 2).point : null;
  }

  /** What is wrong with the quay (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g) return [];
    const out = [];
    if (g.berth[0] < 0) out.push(`Shorter than its berth: make it at least ${Math.ceil(g.berth[1] - g.berth[0])} mm long, or shorten the berth.`);
    const berth = [0.25, 0.5, 0.75].map((f) => this.at(g.berth[0] + (g.berth[1] - g.berth[0]) * f).point);
    if (!craneReaches(this.world, berth)) out.push("No gantry crane reaches the berth: barges are only loaded and unloaded by cranes.");
    return out;
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawQuay(view, g);
  }
}

/**
 * A reach stacker: moves containers where no crane reaches. Its parking place is the object;
 * the vehicle itself is drawn by the terminal simulation. Geometry: `{center, angle, footprint}`
 * (8 m × 4 m, the length along `angle`).
 */
export class ReachStacker extends LayoutObject {
  static type = "reach-stacker";
  static label = "Reach stacker";
  static category = "Terminal";
  static placement = "point";
  static description = "Moves containers where no crane reaches: wagons, trucks and yard blocks, not barges. Parks here.";
  static params = [
    NAME,
    ROTATION,
    { key: "tiers", label: "Stacks up to", type: "number", min: 1, max: 4, step: 1, default: 3 },
    SPEED,
  ];

  computeGeometry() {
    const center = resolvePoint(this.world.map, this.spec.position);
    if (!center) return null;
    const angle = toRad(+this.spec.rotation_deg || 0);
    return { center, angle, footprint: rectFootprint(center, this.mm(STACKER_LENGTH_M), this.mm(STACKER_WIDTH_M), angle) };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  draw(view) {}
}
