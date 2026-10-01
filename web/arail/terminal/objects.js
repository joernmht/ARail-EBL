/**
 * Container terminal infrastructure, placed in Build (palette group "Terminal"): yard blocks,
 * rail-mounted gantry cranes, truck lanes, quays and reach stackers. Loading tracks are ordinary
 * `track` objects. The terminal simulation (operations.js) reads these objects; runtime state
 * (containers, vehicles) never enters their specs.
 *
 * The static metadata (type, label, placement, parameters) and `yardGrid` are final; the geometry
 * is a placeholder (not placed) until the terminal objects are implemented.
 * @module arail/terminal/objects
 */
import { LayoutObject } from "../core/object.js";
import { BAY_M, ROW_M, yardType } from "./model.js";
import { drawCraneRails, drawQuay, drawTruckLane, drawYardGround } from "./draw.js";

const NAME = { key: "name", label: "Name", type: "text", default: "" };
const ROTATION = { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 };
const SPEED = { key: "speed", label: "Speed factor", type: "number", unit: "×", min: 0.25, max: 5, step: 0.25, default: 1 };
const SIDES = [["left", "left"], ["right", "right"]];

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

/**
 * A block of container stacks. Geometry: `{center, angle, width, depth, footprint, bays, rows, tiers}`.
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
    return null;
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

  /** Where a copy goes (editor: Duplicate). */
  duplicateOffset() {
    return [0, 0];
  }

  /** Carrier type of this block ({@link yardType}), or null while it is not placed. */
  carrierType() {
    const g = this.geometry;
    return g ? yardType({ bays: g.bays, rows: g.rows, tiers: g.tiers }) : null;
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
 * t = −span/2, rail B at t = +span/2.
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
    return null;
  }

  /**
   * Crane-local coordinates (mm) of a layout point.
   * @returns {number[] | null} [s, t]
   */
  toLocal(p) {
    return null;
  }

  /**
   * Layout point (mm) of crane-local coordinates.
   * @returns {number[] | null} [x, y]
   */
  fromLocal(s, t) {
    return null;
  }

  /** Range of `s` the trolley can reach (the portal is 16 m long). */
  sRange() {
    return null;
  }

  /** Range of `t` the trolley can reach (span plus outreach on both sides). */
  tRange() {
    return null;
  }

  /** Can the crane reach this layout point? */
  reaches(p) {
    return false;
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

  duplicateOffset() {
    return [0, 0];
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawCraneRails(view, g);
  }
}

/**
 * A lane for trucks under a crane, with a passing lane beside it. Geometry:
 * `{points, lengths, total, side (+1 left, −1 right), passingOffset, footprint}`.
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
    return null;
  }

  /**
   * Point and driving direction at arc length `s` (mm); `offset` + = left of the driving direction.
   * @returns {{point: number[], dir: number[]} | null}
   */
  at(s, offset = 0) {
    return null;
  }

  /**
   * Arc lengths (mm) of the loading centres of the truck positions, ascending.
   * @returns {number[]}
   */
  positions() {
    return [];
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawTruckLane(view, g, { positions: this.positions() });
  }
}

/**
 * The fairway of the barges along a quay wall. Geometry:
 * `{points, lengths, total, side (+1 left, −1 right), quayOffset, water, wall, berth: [from, to], footprint}`.
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
    return null;
  }

  /**
   * Point and sailing direction at arc length `s` (mm); `offset` + = left.
   * @returns {{point: number[], dir: number[]} | null}
   */
  at(s, offset = 0) {
    return null;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  draw(view) {
    const g = this.geometry;
    if (g) drawQuay(view, g);
  }
}

/**
 * A reach stacker: moves containers where no crane reaches. Its parking place is the object;
 * the vehicle itself is drawn by the terminal simulation. Geometry: `{center, angle, footprint}`.
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
    return null;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  draw(view) {}
}
