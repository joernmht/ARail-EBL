/**
 * Bus stop (`bus-stop`): a waiting area on the sidewalk of a street where the buses of bus lines
 * stop (see objects/bus-line.js and core/transit.js).
 *
 * Tap on or next to a street: the stop is placed at the nearest point of the street (or of the
 * street chosen in `road`), on its right side, its left side or on both sides, seen in the
 * street's drawing direction. With right-hand traffic the right side serves the buses that drive
 * in the drawing direction, the left side the buses in the other direction; a line that runs
 * back and forth needs stops on both sides.
 *
 * Each side is a stop area (kind "bus") with one dock along the curb (`<id>:right` or
 * `<id>:left`). The docks are `managed` by the bus lines, so the timetable does not send buses.
 * @module arail/objects/bus-stop
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { StopArea } from "../core/stops.js";
import { clamp, polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { OVERLAY, PALETTE, grey, rgba } from "../core/colors.js";
import { rectFootprint } from "../core/view.js";
import { drawStopSign } from "./signs.js";

/** How far from the outer edge of the sidewalk a stop may be placed (m). */
const NEAR_M = 15;

const COLOURS = { area: grey(0.8), curb: grey(0.96), marking: "#ffffff", roof: grey(0.55) };

export class BusStop extends LayoutObject {
  static type = "bus-stop";
  static label = "Bus stop";
  static category = "Transport";
  static placement = "point";
  static description = "A bus stop on the sidewalk of a street. Tap on or next to a street; bus lines stop here.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the nearest street." },
    {
      key: "side", label: "Side", type: "select", default: "right",
      options: [["right", "right side"], ["left", "left side"], ["both", "both sides"]],
      help: "Seen in the direction the street was drawn. A line that runs back and forth needs stops on both sides.",
    },
    { key: "length_m", label: "Length", type: "number", unit: "m", min: 8, max: 60, step: 1, default: 18 },
    { key: "width_m", label: "Waiting area width", type: "number", unit: "m", min: 1, max: 6, step: 0.5, default: 2.5 },
    { key: "shelter", label: "Shelter", type: "boolean", default: true },
  ];

  /** The stop follows its street: the geometry is also recomputed when other objects change. */
  get geometry() {
    const v = this.world.objectsVersion;
    if (v !== this._objectsVersion) {
      this._objectsVersion = v;
      this._cacheKey = null;
    }
    return super.geometry;
  }

  /** The street the stop is on: {o, info, s, at: {point, dir}}, or null. */
  _street(p) {
    const chosen = this.spec.road ? this.world.getObject(this.spec.road) : null;
    const candidates = chosen ? [chosen] : this.world.objects;
    let best = null;
    for (const o of candidates) {
      if (typeof o.roadInfo !== "function" || !o.geometry) continue;
      const info = o.roadInfo();
      if (!info?.car) continue; // buses drive on streets, not on footpaths
      const pr = polylineProject(info.points, p);
      const reach = info.width / 2 + Math.max(info.sidewalk, this.mm(2.5)) + this.mm(NEAR_M);
      if (!chosen && pr.distance > reach) continue;
      if (!best || pr.distance < best.distance) best = { o, info, s: pr.s, distance: pr.distance };
    }
    if (!best) return null;
    const lengths = polylineLengths(best.info.points), total = lengths[lengths.length - 1];
    const half = this.mm(+this.spec.length_m || 18) / 2;
    best.s = total > 2 * half ? clamp(best.s, half, total - half) : total / 2;
    best.at = polylineAt(best.info.points, best.s, lengths);
    return best;
  }

  computeGeometry() {
    const p = resolvePoint(this.world.map, this.spec.position);
    if (!p) return null;
    const L = this.mm(+this.spec.length_m || 18), W = this.mm(+this.spec.width_m || 2.5);
    const street = this._street(p);
    if (!street) return { ok: false, center: p, L, W, sides: [], footprint: rectFootprint(p, L, W) };
    const { info, at } = street;
    const u = at.dir, n = [-u[1], u[0]], half = info.width / 2;
    const names = this.spec.side === "both" ? ["right", "left"] : [this.spec.side === "left" ? "left" : "right"];
    const sides = names.map((side) => {
      const sign = side === "right" ? -1 : 1;
      // buses on the right side drive in the street's direction, on the left side against it
      const dir = side === "right" ? u : [-u[0], -u[1]];
      const c = [at.point[0] + n[0] * sign * (half + W / 2), at.point[1] + n[1] * sign * (half + W / 2)];
      const origin = [c[0] - (dir[0] * L) / 2, c[1] - (dir[1] * L) / 2];
      return { side, dir, normal: [-dir[1], dir[0]], center: c, origin, outline: rectFootprint(c, L, W, Math.atan2(dir[1], dir[0])) };
    });
    const angle = Math.atan2(u[1], u[0]);
    let footprint;
    if (sides.length === 2) footprint = rectFootprint(at.point, L, 2 * (half + W), angle);
    else {
      const sign = names[0] === "right" ? -1 : 1, off = (half + W) / 2;
      footprint = rectFootprint([at.point[0] + n[0] * sign * off, at.point[1] + n[1] * sign * off], L, half + W, angle);
    }
    return { ok: true, road: street.o.id, center: at.point, u, n, half, L, W, sides, footprint };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** What is wrong with the stop (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g || g.ok) return [];
    if (!this.spec.road) return ["Not next to a street: move the stop onto the sidewalk of a street."];
    const road = this.world.getObject(this.spec.road);
    const info = road?.geometry && typeof road.roadInfo === "function" ? road.roadInfo() : null;
    if (info && !info.car) return [`${road.name} is a footpath: buses cannot drive there. Choose a street.`];
    return ["The chosen street is not placed."];
  }

  stopAreas() {
    const g = this.geometry;
    if (!g?.ok) return [];
    const svc = this.world.layout.services;
    const Lm = +this.spec.length_m || 18, Wm = +this.spec.width_m || 2.5;
    const one = g.sides.length === 1;
    return g.sides.map((sd) => new StopArea({
      id: one ? this.id : `${this.id}:${sd.side}`, owner: this, kind: "bus",
      origin: sd.origin, dir: sd.dir, lengthMM: g.L, widthMM: g.W, scale: this.world.scale,
      docks: [{
        id: `${this.id}:${sd.side}`, side: 1, s0: 0, s1: Lm, kind: "bus", label: one ? "Stop" : sd.side === "right" ? "Stop A" : "Stop B",
        managed: "line", headway: null, dwell: svc.bus_dwell_s,
      }],
      // people come along the sidewalk (both ends) and from the houses (outer side)
      access: [
        { s: 0.3, t: 0, weight: 0.25 }, { s: Lm - 0.3, t: 0, weight: 0.25 },
        { s: Lm * 0.3, t: -Wm / 2 + 0.2, weight: 0.25 }, { s: Lm * 0.7, t: -Wm / 2 + 0.2, weight: 0.25 },
      ],
    }));
  }

  draw(view) {
    const g = this.geometry;
    if (!g.ok) {
      view.polygon(g.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      drawStopSign(view, g.center);
      view.label([g.center[0], g.center[1], view.m(4)], "No street here", { size: 11, background: OVERLAY.dangerLabel });
      return;
    }
    const m = (x) => view.m(x);
    for (const sd of g.sides) {
      const P = (s, t) => [sd.origin[0] + sd.dir[0] * s + sd.normal[0] * t, sd.origin[1] + sd.dir[1] * s + sd.normal[1] * t];
      const h = g.W / 2;
      // waiting area with the raised curb (Kasseler Bord) on the street side
      view.polygon(sd.outline, { fill: COLOURS.area, alpha: 0.92, order: 3 });
      view.polygon([P(0, h - m(0.35)), P(g.L, h - m(0.35)), P(g.L, h), P(0, h)], { fill: COLOURS.curb, alpha: 0.95, order: 3.1 });
      // zig-zag line on the street along the stop (Zeichen 299)
      const zig = [];
      const n = Math.max(2, Math.round(g.L / m(1.5)));
      for (let i = 0; i <= n; i++) zig.push(P((g.L * i) / n, h + m(i % 2 ? 1.1 : 0.3)));
      view.line(zig, { stroke: COLOURS.marking, width: 1.4, alpha: 0.8, order: 1.25 });
      if (this.spec.shelter !== false) {
        const s = g.L * 0.42, t = -h + m(0.85), w = m(4), d = m(1.4);
        const fp = [P(s - w / 2, t - d / 2), P(s + w / 2, t - d / 2), P(s + w / 2, t + d / 2), P(s - w / 2, t + d / 2)];
        view.prism(fp, 0, m(2.5), { side: PALETTE.glass, top: COLOURS.roof, alpha: 0.5 });
        const c = P(s, t - d / 2);
        view.glow([c[0], c[1], m(1.6)], m(1.6), "#eaf4ff", 0.7); // lit poster at night
      }
      drawStopSign(view, P(g.L - m(1), h - m(0.5)), { letter: g.sides.length > 1 ? (sd.side === "right" ? "A" : "B") : "" });
    }
  }
}
