/**
 * Tram stops and tram lines. Trams run on the tracks of streets (objects/road.js: in the car lanes,
 * in lanes of their own, on a track bed in the middle) and on tracks of their own; core/transit.js
 * runs the lines like bus lines.
 *
 * A **tram stop** (`tram-stop`) is one of four kinds (VDV, BOStrab § 31):
 * - **on the road** (Fahrbahnhaltestelle): people wait on the sidewalk and step down onto the road
 *   and up into the tram; cars wait while the doors are open (StVO § 20). Not step-free.
 * - **raised road** (Zeitinsel, dynamische Haltestelle): the lane beside the track is raised to the
 *   height of the tram floor; cars are held while the tram stands. Step-free.
 * - **island** (Haltestelleninsel): a platform between the track and the car lane, reached over a
 *   zebra crossing or at the lights; cars drive past. Step-free when there is a safe way over.
 * - **curb extension** (Haltestellenkap): the sidewalk is extended to the track, like a bus stop
 *   in the lane; cars wait behind the tram. Step-free.
 * Step-free (barrierefrei) means the platform is at most 5 cm below the tram floor and the gap at
 * most 5 cm; tactile paving guides blind people (DIN 32984). Where it is not, boarding takes longer.
 *
 * A **tram line** (`tram-line`) is placed like a bus line, by tapping its tram stops in order.
 * @module arail/objects/tram
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { StopArea } from "../core/stops.js";
import { clamp, dist2, polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { OVERLAY, PALETTE, grey, rgba } from "../core/colors.js";
import { rectFootprint } from "../core/view.js";
import { linesServing } from "../core/transit.js";
import { TRAM } from "../core/vehicles.js";
import { drawStopSign } from "./signs.js";
import { BusLine } from "./bus-line.js";
import { NORMS } from "./street-profile.js";
import { offsetPolyline } from "./road.js";

/** How far from the outer edge of a street a stop may be placed (m). */
const NEAR_M = 15;
/** Step-free: platform at most this much below the tram floor, the gap at most this wide (m). */
export const STEP_FREE_M = 0.05;

/** The kinds of tram stops: label, platform height by default (m), cars wait while the doors are open. */
export const TRAM_STOP_TYPES = {
  road: { label: "on the road (no platform)", height: 0, blocks: true },
  raised: { label: "raised road (Zeitinsel)", height: 0.25, blocks: true },
  island: { label: "island between track and car lane", height: 0.25, blocks: false },
  cape: { label: "curb extension (Haltestellenkap)", height: 0.25, blocks: true },
};

const COLOURS = { area: grey(0.8), raised: grey(0.74), curb: grey(0.96), tactile: grey(0.93), roof: grey(0.55) };
/** The car lane beside an island stop (m): the island narrows the street there (RASt 06: 3.00 m at least). */
const ISLAND_LANE_M = 3.0;

export class TramStop extends LayoutObject {
  static type = "tram-stop";
  static label = "Tram stop";
  static category = "Transport";
  static placement = "point";
  static description = "A tram stop at a street with tram tracks (or on a tram track of its own): on the road, at a raised road (Zeitinsel), on an island or at a curb extension. Tap on or next to the tracks; tram lines stop here.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the nearest street with tram tracks." },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(TRAM_STOP_TYPES).map(([k, v]) => [k, v.label]), default: "cape" },
    {
      key: "side", label: "Side", type: "select", default: "both",
      options: [["right", "right side"], ["left", "left side"], ["both", "both sides"]],
      help: "Seen in the direction the street was drawn. Two tracks need stops on both sides; one track one side.",
    },
    { key: "length_m", label: "Length", type: "number", unit: "m", min: 20, max: 80, step: 1, default: 40, help: "At least the tram (30 m) and some room." },
    { key: "width_m", label: "Platform width", type: "number", unit: "m", min: 1.5, max: 6, step: 0.1, default: 2.5, help: "At least 2.0 m (BOStrab § 31)." },
    { key: "height_m", label: "Platform height", type: "number", unit: "m", min: 0, max: 0.4, step: 0.01, help: "Empty = by kind: 0 on the road, 0.25 m otherwise. Low-floor trams have their floor at about 0.30 m." },
    { key: "tactile", label: "Tactile paving", type: "boolean", default: true, help: "Guidance strips and warning fields for blind people (DIN 32984)." },
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

  /** The street with tram tracks the stop is at: {o, info, s, at, lengths}, or null. */
  _street(p) {
    const chosen = this.spec.road ? this.world.getObject(this.spec.road) : null;
    let best = null;
    for (const o of chosen ? [chosen] : this.world.objects) {
      if (typeof o.roadInfo !== "function" || !o.geometry) continue;
      const info = o.roadInfo();
      if (!info?.tram || info.tram === "none") continue;
      const lengths = polylineLengths(info.points), pr = polylineProject(info.points, p, lengths);
      const reach = (info.half ?? info.width / 2) + this.mm(NEAR_M);
      if (!chosen && pr.distance > reach) continue;
      if (!best || pr.distance < best.distance) best = { o, info, s: pr.s, distance: pr.distance, lengths };
    }
    if (!best) return null;
    const total = best.lengths[best.lengths.length - 1], half = this.mm(+this.spec.length_m || 40) / 2;
    best.s = total > 2 * half ? clamp(best.s, half, total - half) : total / 2;
    best.at = polylineAt(best.info.points, best.s, best.lengths);
    return best;
  }

  /** The kind of the stop (one of TRAM_STOP_TYPES). */
  kind() {
    return TRAM_STOP_TYPES[this.spec.kind] ? this.spec.kind : "cape";
  }

  computeGeometry() {
    const p = resolvePoint(this.world.map, this.spec.position);
    if (!p) return null;
    const L = this.mm(clamp(+this.spec.length_m || 40, 20, 80)), W = this.mm(clamp(+this.spec.width_m || 2.5, 1.5, 6));
    const street = this._street(p);
    if (!street) return { ok: false, center: p, L, W, sides: [], footprint: rectFootprint(p, L, W) };
    const { info, at } = street, kind = this.kind();
    const u = at.dir, n = [-u[1], u[0]];
    // on one track both directions use the one platform side: "both" means the right side then
    const single = info.tramTracks !== "double";
    const names = this.spec.side === "both" && !single ? ["right", "left"] : [this.spec.side === "left" ? "left" : "right"];
    const tramHalf = this.mm(TRAM.width_m / 2 + TRAM.gap_m);
    const sides = names.map((side) => {
      const sign = side === "right" ? -1 : 1;
      const dir = side === "right" ? u : [-u[0], -u[1]];
      // the track of this side (two tracks: the right one of each direction), and the platform beside it
      const track = single ? 0 : info.tramOffset;
      let t;
      if (kind === "island" || kind === "cape") t = track + tramHalf + W / 2;
      else t = info.width / 2 + W / 2;
      const c = [at.point[0] + n[0] * sign * t, at.point[1] + n[1] * sign * t];
      const origin = [c[0] - (dir[0] * L) / 2, c[1] - (dir[1] * L) / 2];
      // the raised road (Zeitinsel) or the curb extension (Kap) between the curb and the track
      const inner = track + tramHalf, outer = info.width / 2;
      const band = outer > inner ? rectFootprint([at.point[0] + n[0] * sign * ((inner + outer) / 2), at.point[1] + n[1] * sign * ((inner + outer) / 2)], L, outer - inner, Math.atan2(u[1], u[0])) : null;
      return { side, sign, dir, normal: [-dir[1], dir[0]], center: c, origin, t, outline: rectFootprint(c, L, W, Math.atan2(dir[1], dir[0])), band, track };
    });
    const reach = Math.max(...sides.map((sd) => sd.t + W / 2));
    const footprint = rectFootprint(at.point, L, 2 * reach, Math.atan2(u[1], u[0]));
    // an island in a street needs a car lane beside it (3.00 m, RASt 06); beside a track of its own it stands free
    const lane = this.mm(ISLAND_LANE_M), short = info.car ? reach + lane - info.width / 2 : 0;
    return { ok: true, road: street.o.id, s: street.s, center: at.point, u, n, L, W, sides, footprint, single, island: kind === "island" && short > this.mm(0.05) ? short : 0 };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** Platform height (m): as set, else by kind. */
  platformHeight() {
    const h = Number(this.spec.height_m);
    return this.spec.height_m !== undefined && this.spec.height_m !== "" && Number.isFinite(h) ? clamp(h, 0, 0.4) : TRAM_STOP_TYPES[this.kind()].height;
  }

  /**
   * Is the stop step-free (barrierefrei)? {stepFree, step (m from the platform up to the tram
   * floor), gap (m), reasons: what is in the way}.
   */
  accessibility() {
    const kind = this.kind(), reasons = [];
    const step = Math.max(0, TRAM.floor_m - this.platformHeight());
    // on the road people step down from the curb and cross the lane to the door
    const gap = kind === "road" ? 0.6 : TRAM.gap_m;
    if (step > STEP_FREE_M + 1e-9) reasons.push(`a step of ${Math.round(step * 100)} cm up into the tram`);
    if (gap > STEP_FREE_M + 1e-9) reasons.push("a gap between the curb and the tram");
    if (this.spec.tactile === false) reasons.push("no tactile paving for blind people");
    if (kind === "island" && this._carsBeside() && !this._safeWayOver()) reasons.push("no zebra crossing or traffic lights to get onto the island");
    if (+this.spec.width_m > 0 && +this.spec.width_m < NORMS.tram.platform) reasons.push(`the platform is narrower than ${NORMS.tram.platform} m`);
    return { stepFree: !reasons.length, step, gap, reasons };
  }

  /** Do cars drive beside the stop (a street, not a track of its own)? */
  _carsBeside() {
    const g = this.geometry, road = g?.ok ? this.world.getObject(g.road) : null;
    return !!road?.roadInfo?.()?.car;
  }

  /** A zebra crossing or traffic lights within 30 m of an island, so people get onto it safely. */
  _safeWayOver() {
    const g = this.geometry;
    if (!g?.ok) return false;
    const reach = this.mm(30) + g.L / 2;
    return this.world.objects.some((o) => (o.type === "zebra-crossing" || o.type === "traffic-light") && o.geometry && dist2(o.geometry.center, g.center) <= reach);
  }

  /** Boarding takes longer where it is not step-free: a step to climb, a ramp to unfold (core/transit.js). */
  dwellFactor() {
    return this.accessibility().stepFree ? 1 : 1.3;
  }

  /** Do cars in the lane beside the tram wait while its doors are open? Not at an island. */
  blocksCars() {
    return TRAM_STOP_TYPES[this.kind()].blocks;
  }

  /** How far (mm, to the right of the tram) the car lane is from the track at a dock of the stop. */
  carLaneShift(dock) {
    const g = this.geometry, road = g?.road ? this.world.getObject(g.road) : null, info = road?.roadInfo?.();
    if (!info) return 0;
    const sd = g.sides.find((x) => dock?.id === `${this.id}:${x.side}`) ?? g.sides[0];
    return (info.laneOffset || 0) - (sd?.track ?? 0);
  }

  /** No parking at the stop and 15 m before and after it (StVO § 12), on its sides. */
  noParking(road, side) {
    const g = this.geometry;
    if (!g?.ok || g.road !== road.id || !g.sides.some((x) => x.side === side)) return null;
    return [[g.s - g.L / 2 - this.mm(15), g.s + g.L / 2 + this.mm(15)]];
  }

  /** What is wrong with the stop (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g) return [];
    if (!g.ok) return [this.spec.road ? "The chosen street has no tram tracks." : "Not at a tram track: move the stop to a street with tram tracks."];
    const out = [];
    if (g.island > 0) out.push(`No room for the island and a car lane beside it: the street is ${Math.round(this.meters(g.island) * 10) / 10} m too narrow there (make the car lanes wider, or choose a raised road or a curb extension).`);
    return out;
  }

  card() {
    const card = super.card();
    const g = this.geometry;
    card.rows.push(["Kind", TRAM_STOP_TYPES[this.kind()].label]);
    if (g?.ok) card.rows.push(["Street", this.world.getObject(g.road)?.name ?? g.road]);
    const a = this.accessibility();
    card.rows.push(["Platform", `${Math.round(this.platformHeight() * 100)} cm high`]);
    card.rows.push(["Step-free", a.stepFree ? "yes" : `no: ${a.reasons.join(", ")}`]);
    card.rows.push(["Cars", this.blocksCars() ? "wait while the doors are open" : "drive past"]);
    const lines = linesServing(this.world, this.id).map((id) => this.world.getObject(id)).filter(Boolean);
    card.rows.push(["Tram lines", lines.length ? lines.map((o) => o.lineLabel?.() ?? o.name).join(", ") : "none"]);
    card.related = lines.map((o) => o.id);
    return card;
  }

  stopAreas() {
    const g = this.geometry;
    if (!g?.ok) return [];
    const svc = this.world.layout.services;
    const Lm = this.meters(g.L), Wm = this.meters(g.W);
    const one = g.sides.length === 1;
    return g.sides.map((sd) => new StopArea({
      id: one ? this.id : `${this.id}:${sd.side}`, owner: this, kind: "tram",
      origin: sd.origin, dir: sd.dir, lengthMM: g.L, widthMM: g.W, scale: this.world.scale,
      docks: [{
        id: `${this.id}:${sd.side}`, side: 1, s0: 0, s1: Lm, kind: "tram", label: one ? "Stop" : sd.side === "right" ? "Stop A" : "Stop B",
        managed: "line", headway: null, dwell: svc.bus_dwell_s,
      }],
      access: [
        { s: 0.3, t: 0, weight: 0.3 }, { s: Lm - 0.3, t: 0, weight: 0.3 },
        { s: Lm * 0.5, t: -Wm / 2 + 0.2, weight: 0.4 },
      ],
    }));
  }

  draw(view) {
    const g = this.geometry;
    if (!g.ok) {
      view.polygon(g.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      drawStopSign(view, g.center);
      view.label([g.center[0], g.center[1], view.m(4)], "No tram track here", { size: 11, background: OVERLAY.dangerLabel });
      return;
    }
    const m = (x) => view.m(x), kind = this.kind();
    for (const sd of g.sides) {
      const P = (s, t) => [sd.origin[0] + sd.dir[0] * s + sd.normal[0] * t, sd.origin[1] + sd.dir[1] * s + sd.normal[1] * t];
      const h = g.W / 2;
      if (sd.band && kind !== "island") view.polygon(sd.band, { fill: kind === "road" ? grey(0.42) : COLOURS.raised, alpha: kind === "road" ? 0.25 : 0.9, order: 1.13 });
      if (kind !== "road") view.polygon(sd.outline, { fill: COLOURS.area, alpha: 0.95, order: 3 });
      // the platform edge, and the tactile strip along it
      view.polygon([P(0, h - m(0.3)), P(g.L, h - m(0.3)), P(g.L, h), P(0, h)], { fill: COLOURS.curb, alpha: 0.95, order: 3.1 });
      if (this.spec.tactile !== false && kind !== "road") view.polygon([P(m(1), h - m(0.95)), P(g.L - m(1), h - m(0.95)), P(g.L - m(1), h - m(0.35)), P(m(1), h - m(0.35))], { fill: COLOURS.tactile, alpha: 0.9, order: 3.15 });
      if (this.spec.shelter !== false) {
        const s = g.L * 0.45, t = -h + m(0.8), w = m(5), d = m(1.4);
        const fp = [P(s - w / 2, t - d / 2), P(s + w / 2, t - d / 2), P(s + w / 2, t + d / 2), P(s - w / 2, t + d / 2)];
        view.prism(fp, 0, m(2.5), { side: PALETTE.glass, top: COLOURS.roof, alpha: 0.5 });
        const c = P(s, t - d / 2);
        view.glow([c[0], c[1], m(1.6)], m(1.6), "#eaf4ff", 0.7);
      }
      drawStopSign(view, P(g.L - m(1), -h + m(0.4)), { letter: g.sides.length > 1 ? (sd.side === "right" ? "A" : "B") : "" });
    }
  }
}

export class TramLine extends BusLine {
  static type = "tram-line";
  static label = "Tram line";
  static category = "Transport";
  static placement = "stops";
  /** Object types the editor offers as stops. */
  static stopTypes = ["tram-stop"];
  static description = "Trams that run along the tracks from stop to stop. Tap the tram stops in order, then press Finish. Trams never cross a railway at street level.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "number", label: "Line number", type: "text", default: "", help: "Shown on the trams and signs, e.g. \"1\"." },
    { key: "color", label: "Colour", type: "color", default: "#00008C" },
    { key: "headway_s", label: "A tram every", type: "number", unit: "s (simulated)", min: 30, max: 3600, step: 10, default: 300, help: "Outside the rush hours; more often in the morning and evening, no trams at night." },
    { key: "mode", label: "Route", type: "select", options: [["back-and-forth", "back and forth"], ["loop", "loop (round trip)"]], default: "back-and-forth" },
    { key: "speed_kmh", label: "Top speed", type: "number", unit: "km/h", min: 10, max: 80, step: 5, default: 50 },
    { key: "length_m", label: "Tram length", type: "number", unit: "m", min: 15, max: 60, step: 1, default: 30 },
    { key: "show_route", label: "Show the route", type: "boolean", default: true },
  ];

  /** The rails along the route, also where it turns from one street into another (curves, turning loops), then the route. */
  draw(view) {
    const line = this.info();
    if (line?.circuit) {
      if (this._rails?.c !== line.circuit) this._rails = { c: line.circuit, list: [-1, 1].map((k) => offsetPolyline(line.circuit.points, (k * this.mm(1.435)) / 2)) };
      const p = line.circuit.points[0], k = view.pxPerMM(p[0], p[1], 0) * this.mm(1.435);
      if (k >= 1.2 * view.px) for (const r of this._rails.list) view.line(r, { stroke: PALETTE.rail, width: Math.max(0.6, Math.min(1.6, k / 6)), order: 1.15 });
    }
    super.draw(view);
  }
}
