/**
 * Traffic signs, traffic lights and zebra crossings: objects put up at a street that set the rules
 * of its traffic (core/network.js reads them with `trafficRule()` and `crossingInfo()`).
 *
 * - **Traffic sign** (`traffic-sign`): put next to a street; it applies to the traffic that passes
 *   it on its side (right-hand traffic: a sign on the right of the drawing direction applies to
 *   vehicles driving in the drawing direction). Stop (206) and give way (205) at the next junction
 *   ahead, priority road (306: the other streets at its junctions give way), one-way street (220:
 *   the street between the junctions around the sign, in the direction of its side), mandatory
 *   directions (209–214) and lane arrows (297) at the next junction, no stopping (283) and
 *   restricted stopping (286) on its side, bikes or e-scooters allowed on the sidewalk (239 with
 *   "Radverkehr frei" or "E-Scooter frei"), and the bike path and parking signs as information.
 * - **Traffic light** (`traffic-light`): at a junction; the approaches along one axis and those
 *   across it get green in turn (amber, all red in between). Vehicles stop at red and amber.
 * - **Zebra crossing** (`zebra-crossing`, Fußgängerüberweg, 293 with the signs 350): people on foot
 *   cross the street there, vehicles give way to them (StVO § 26); nobody parks on it or 5 m before.
 * @module arail/objects/traffic-signs
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { clamp, dist2, polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { OVERLAY, rgba } from "../core/colors.js";
import { rectFootprint } from "../core/view.js";
import { drawSign, drawTrafficLight } from "./signs.js";

/** How far from the outer edge of a street a sign may be put (m). */
const NEAR_M = 10;

/** The kinds of traffic signs: label, the sign drawn, what it does. */
export const SIGN_TYPES = {
  stop: { label: "Stop (206)", draw: "stop" },
  "give-way": { label: "Give way (205)", draw: "give-way" },
  priority: { label: "Priority road (306)", draw: "priority" },
  "one-way": { label: "One-way street (220)", draw: "one-way" },
  turn: { label: "Mandatory direction (209–214)", draw: null },
  "lane-arrows": { label: "Lane arrows (297)", draw: null },
  "no-stopping": { label: "No stopping (283)", draw: "no-stopping" },
  "restricted-stopping": { label: "Restricted stopping (286)", draw: "restricted-stopping" },
  "bikes-allowed": { label: "Footpath, bikes allowed (239 + Radverkehr frei)", draw: "footpath", plate: "bikes" },
  "scooters-allowed": { label: "Footpath, e-scooters allowed (239 + E-Scooter frei)", draw: "footpath", plate: "scooters" },
  "bike-path": { label: "Bike path (237)", draw: "bike-path" },
  "shared-path": { label: "Shared foot and bike path (240)", draw: "shared-path" },
  "separate-paths": { label: "Separate foot and bike paths (241)", draw: "separate-paths" },
  parking: { label: "Parking (314)", draw: "parking" },
};

/** The directions allowed by a mandatory direction sign: right, left, straight on, or two of them. */
export const TURNS = {
  right: { label: "turn right", moves: ["right"], sign: "turn-right" },
  left: { label: "turn left", moves: ["left"], sign: "turn-left" },
  straight: { label: "straight on", moves: ["straight"], sign: "turn-straight" },
  "straight-right": { label: "straight on or right", moves: ["straight", "right"], sign: "turn-straight-right" },
  "straight-left": { label: "straight on or left", moves: ["straight", "left"], sign: "turn-straight-left" },
  "left-right": { label: "left or right", moves: ["left", "right"], sign: "turn-left-right" },
};

/** The lanes of lane arrows: "left | straight right" → [["left"], ["straight", "right"]] (from the left lane). */
export function parseArrows(text) {
  return String(text ?? "").split("|").map((lane) => lane.toLowerCase().split(/[\s,+]+/).filter((w) => ["left", "straight", "right"].includes(w))).filter((l) => l.length);
}

/**
 * The street a point is next to: {o, info, s, at, side (-1 right, +1 left of the drawing direction),
 * distance}, or null. `roadId` chooses the street; `car`: streets for cars only.
 */
export function streetNear(world, p, { roadId = null, car = true, nearM = NEAR_M } = {}) {
  const chosen = roadId ? world.getObject(roadId) : null;
  let best = null;
  for (const o of chosen ? [chosen] : world.objects) {
    if (typeof o.roadInfo !== "function" || !o.geometry) continue;
    const info = o.roadInfo();
    if (!info || (car && !info.car) || info.hidden) continue;
    const lengths = polylineLengths(info.points), pr = polylineProject(info.points, p, lengths);
    const reach = (info.half ?? info.width / 2 + info.sidewalk) + (nearM * 1000) / world.scale;
    if (!chosen && pr.distance > reach) continue;
    if (!best || pr.distance < best.distance) {
      const at = polylineAt(info.points, pr.s, lengths);
      const n = [-at.dir[1], at.dir[0]], d = [p[0] - at.point[0], p[1] - at.point[1]];
      best = { o, info, s: pr.s, at, lengths, length: lengths[lengths.length - 1], side: d[0] * n[0] + d[1] * n[1] >= 0 ? 1 : -1, distance: pr.distance };
    }
  }
  return best;
}

/** The point at lateral offset t (mm, + = left) of a street's centre line at arc length s. */
function beside(street, s, t) {
  const at = polylineAt(street.info.points, s, street.lengths), n = [-at.dir[1], at.dir[0]];
  return [at.point[0] + n[0] * t, at.point[1] + n[1] * t];
}

export class TrafficSign extends LayoutObject {
  static type = "traffic-sign";
  static label = "Traffic sign";
  static category = "Transport";
  static placement = "point";
  static description = "A road sign next to a street: Stop, give way, priority road, one-way street, mandatory directions and lane arrows at the next junction, no stopping, bikes or e-scooters allowed on the sidewalk. It applies to the traffic on its side of the street.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "sign", label: "Sign", type: "select", options: Object.entries(SIGN_TYPES).map(([k, v]) => [k, v.label]), default: "stop" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the nearest street." },
    { key: "turn", label: "Allowed", type: "select", options: Object.entries(TURNS).map(([k, v]) => [k, v.label]), default: "right", when: (v) => v.sign === "turn" },
    { key: "arrows", label: "Lanes", type: "text", default: "left | straight right", when: (v) => v.sign === "lane-arrows", help: "The arrows of each lane from the left, lanes separated by |: left, straight, right." },
    { key: "zone_m", label: "Zone", type: "number", unit: "m", min: 5, max: 500, step: 5, when: (v) => v.sign === "no-stopping" || v.sign === "restricted-stopping", help: "From the sign on, in the direction of traffic on its side. Empty = to the next junction." },
  ];

  /** The sign follows its street: the geometry is also recomputed when other objects change. */
  get geometry() {
    const v = this.world.objectsVersion;
    if (v !== this._objectsVersion) {
      this._objectsVersion = v;
      this._cacheKey = null;
    }
    return super.geometry;
  }

  computeGeometry() {
    const p = resolvePoint(this.world.map, this.spec.position);
    if (!p) return null;
    const car = !["bikes-allowed", "scooters-allowed"].includes(this.spec.sign);
    const street = streetNear(this.world, p, { roadId: this.spec.road || null, car });
    const r = this.mm(0.8);
    if (!street) return { ok: false, center: p, foot: p, footprint: rectFootprint(p, 2 * r, 2 * r) };
    const reach = street.info.width / 2 + this.mm(0.5);
    const foot = beside(street, street.s, street.side * reach);
    return {
      ok: true, center: foot, foot, road: street.o.id, s: street.s, side: street.side, dir: street.side < 0 ? 1 : -1, length: street.length,
      footprint: rectFootprint(foot, 2 * r, 2 * r),
    };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** What is wrong with the sign (shown in the editor). */
  problems() {
    const g = this.geometry;
    if (!g || g.ok) return [];
    return ["Not next to a street: move the sign to the side of a street."];
  }

  /**
   * The rule for core/network.js: {sign, road, s (mm along the street), dir (+1: traffic in the
   * drawing direction, -1: against it), moves (turn, lane arrows), zone ([s0, s1] mm, no stopping),
   * lanes (lane arrows)}, or null.
   */
  trafficRule() {
    const g = this.geometry;
    if (!g?.ok) return null;
    const sign = SIGN_TYPES[this.spec.sign] ? this.spec.sign : "stop";
    const rule = { id: this.id, sign, road: g.road, s: g.s, dir: g.dir, side: g.side };
    if (sign === "turn") rule.moves = TURNS[this.spec.turn]?.moves ?? TURNS.right.moves;
    if (sign === "lane-arrows") {
      rule.lanes = parseArrows(this.spec.arrows);
      rule.moves = [...new Set(rule.lanes.flat())];
    }
    if (sign === "no-stopping" || sign === "restricted-stopping") {
      const len = Number(this.spec.zone_m) > 0 ? this.mm(+this.spec.zone_m) : null;
      rule.zone = len == null ? null : g.dir > 0 ? [g.s, g.s + len] : [g.s - len, g.s];
    }
    return rule;
  }

  /** No parking in the zone of a no-stopping sign, on its side (core/parking.js asks every object). */
  noParking(road, side) {
    const r = this.trafficRule();
    if (!r || r.road !== road.id || (r.sign !== "no-stopping" && r.sign !== "restricted-stopping") || (side === "right" ? -1 : 1) !== r.side) return null;
    if (r.zone) return [r.zone];
    // to the next junction: the street's network knows where that is
    const net = this.world.network?.();
    const end = net?.nextJunctionOnRoad?.(road.id, r.s, r.dir);
    return [r.dir > 0 ? [r.s, end ?? Infinity] : [end ?? -Infinity, r.s]];
  }

  /** The card: what the sign means. */
  card() {
    const card = super.card();
    const T = SIGN_TYPES[this.spec.sign];
    card.rows.push(["Sign", T?.label ?? this.spec.sign]);
    const g = this.geometry;
    if (g?.ok) card.rows.push(["Street", this.world.getObject(g.road)?.name ?? g.road], ["Applies to", g.dir > 0 ? "traffic in the direction the street was drawn" : "traffic against the direction the street was drawn"]);
    if (this.spec.sign === "turn") card.rows.push(["Allowed", TURNS[this.spec.turn]?.label ?? this.spec.turn]);
    if (this.spec.sign === "lane-arrows") card.rows.push(["Lanes", parseArrows(this.spec.arrows).map((l) => l.join(" ")).join(" | ")]);
    return card;
  }

  draw(view) {
    const g = this.geometry;
    if (!g.ok) {
      view.polygon(g.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      return;
    }
    const T = SIGN_TYPES[this.spec.sign] || SIGN_TYPES.stop;
    const key = this.spec.sign === "turn" ? TURNS[this.spec.turn]?.sign ?? "turn-right" : this.spec.sign === "lane-arrows" ? "turn-straight" : T.draw;
    drawSign(view, g.foot, key, { plate: T.plate ?? "" });
    if (this.spec.sign === "lane-arrows") this._drawArrows(view, g);
  }

  /** Lane arrows painted on the lanes before the junction (Zeichen 297). */
  _drawArrows(view, g) {
    const road = this.world.getObject(g.road), info = road?.roadInfo?.();
    if (!info) return;
    const lanes = parseArrows(this.spec.arrows);
    const n = lanes.length, lane = (info.laneOffset > 0 ? info.laneOffset * 2 : info.width / 2) / Math.max(1, n);
    const lengths = polylineLengths(info.points), s = clamp(g.s + g.dir * this.mm(6), 0, lengths[lengths.length - 1]);
    const at = polylineAt(info.points, s, lengths), u = g.dir > 0 ? at.dir : [-at.dir[0], -at.dir[1]], right = [u[1], -u[0]];
    lanes.forEach((moves, i) => {
      // lane i from the left of the traffic's half of the street
      const t = (n - i - 0.5) * lane;
      const base = [at.point[0] + right[0] * t, at.point[1] + right[1] * t];
      const len = this.mm(4), tip = [base[0] + u[0] * len, base[1] + u[1] * len];
      const style = { stroke: "#ffffff", width: 1.6, order: 1.25, alpha: 0.9 };
      view.line([base, tip], style);
      for (const m of moves) {
        if (m === "straight") continue;
        const k = m === "left" ? -1 : 1;
        view.line([[base[0] + u[0] * len * 0.6, base[1] + u[1] * len * 0.6], [base[0] + u[0] * len * 0.6 + right[0] * k * this.mm(1.2), base[1] + u[1] * len * 0.6 + right[1] * k * this.mm(1.2)]], style);
      }
    });
  }
}

export class TrafficLight extends LayoutObject {
  static type = "traffic-light";
  static label = "Traffic lights";
  static category = "Transport";
  static placement = "point";
  static description = "Traffic lights at a junction (Lichtzeichenanlage): the approaches along one street and those across it get green in turn, with amber and all red in between. Put it on the junction.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "cycle_s", label: "Cycle", type: "number", unit: "s (simulated)", min: 20, max: 180, step: 5, default: 60, help: "Green, amber and red for both directions." },
    { key: "split", label: "Green for the main street", type: "number", unit: "%", min: 20, max: 80, step: 5, default: 50, help: "Share of the cycle the main street (the first street at the junction, or the one chosen) has green." },
    { key: "main", label: "Main street", type: "object", objectType: "road", help: "Empty = the first street at the junction." },
    { key: "offset_s", label: "Offset", type: "number", unit: "s", min: 0, max: 180, step: 1, default: 0, help: "Shifts the cycle, to coordinate lights along a street (green wave)." },
  ];

  computeGeometry() {
    const p = resolvePoint(this.world.map, this.spec.position);
    if (!p) return null;
    const r = this.mm(3);
    return { center: p, footprint: rectFootprint(p, 2 * r, 2 * r) };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** The rule for core/network.js: lights at the junction nearest to `pos`. */
  trafficRule() {
    const g = this.geometry;
    return g ? { id: this.id, sign: "light", pos: g.center, main: this.spec.main || null } : null;
  }

  /**
   * The light of an approach group (0: the main street's axis, 1: across it) at simulated time t:
   * "green", "amber", "red" or "red-amber".
   */
  state(group, t = this.world.time) {
    const C = clamp(+this.spec.cycle_s || 60, 20, 180), split = clamp((+this.spec.split || 50) / 100, 0.2, 0.8);
    const x = (((t + (+this.spec.offset_s || 0)) % C) + C) % C;
    // main: green, amber 3 s, all red 2 s, then the cross street: red-amber 1 s, green, amber 3 s, all red 2 s
    const gA = C * split, AMBER = 3, ALL = 2;
    const phase = group === 0 ? x : (x - gA + C) % C;
    const len = group === 0 ? gA : C - gA;
    if (phase < len - AMBER - ALL) return group === 1 && phase < 1 ? "red-amber" : "green";
    if (phase < len - ALL) return "amber";
    return group === 0 && x >= C - 1 ? "red-amber" : "red";
  }

  problems() {
    const net = this.world.network?.();
    if (net && !net.signalOf?.(this.id)) return ["Not on a junction: move the traffic lights onto a junction of three or more streets."];
    return [];
  }

  card() {
    const card = super.card();
    const C = clamp(+this.spec.cycle_s || 60, 20, 180);
    card.rows.push(["Cycle", `${C} s`], ["Green for the main street", `${Math.round(clamp(+this.spec.split || 50, 20, 80))} %`]);
    const sig = this.world.network?.()?.signalOf?.(this.id);
    if (sig) card.rows.push(["Main street now", this.state(0)], ["Cross street now", this.state(1)]);
    return card;
  }

  draw(view) {
    const net = this.world.network?.();
    const sig = net?.signalOf?.(this.id);
    if (!sig) {
      view.polygon(this.geometry.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      drawTrafficLight(view, this.geometry.center, "off");
      return;
    }
    // a light head at the right of each approach, at the stop line
    for (const a of sig.approaches) drawTrafficLight(view, a.head, this.state(a.group));
  }
}

export class ZebraCrossing extends LayoutObject {
  static type = "zebra-crossing";
  static label = "Zebra crossing";
  static category = "Transport";
  static placement = "point";
  static description = "A zebra crossing (Fußgängerüberweg, Zeichen 293 and 350) across a street: people on foot cross there, and vehicles give way to them. Nobody parks on it or 5 m before it.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the nearest street." },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 3, max: 8, step: 0.5, default: 4, help: "Along the street (at least 3 m, better 4 m)." },
    { key: "signs", label: "Signs (350)", type: "boolean", default: true },
  ];

  /** The crossing follows its street. */
  get geometry() {
    const v = this.world.objectsVersion;
    if (v !== this._objectsVersion) {
      this._objectsVersion = v;
      this._cacheKey = null;
    }
    return super.geometry;
  }

  computeGeometry() {
    const p = resolvePoint(this.world.map, this.spec.position);
    if (!p) return null;
    const street = streetNear(this.world, p, { roadId: this.spec.road || null });
    const W = this.mm(clamp(+this.spec.width_m || 4, 3, 8));
    if (!street) return { ok: false, center: p, footprint: rectFootprint(p, W, W) };
    const s = clamp(street.s, W, Math.max(W, street.length - W));
    const at = polylineAt(street.info.points, s, street.lengths), u = at.dir, n = [-u[1], u[0]];
    const h = street.info.width / 2, half = street.info.half ?? h + street.info.sidewalk;
    const bars = [];
    for (let t = -h + this.mm(0.75); t <= h - this.mm(0.4); t += this.mm(1)) {
      const c = [at.point[0] + n[0] * t, at.point[1] + n[1] * t];
      bars.push(rectFootprint(c, W, this.mm(0.5), Math.atan2(u[1], u[0])));
    }
    const signs = [-1, 1].map((k) => [at.point[0] + n[0] * k * (h + this.mm(0.5)) - u[0] * k * (W / 2 + this.mm(0.3)), at.point[1] + n[1] * k * (h + this.mm(0.5)) - u[1] * k * (W / 2 + this.mm(0.3))]);
    return {
      ok: true, center: at.point, road: street.o.id, s, W, u, n, h, half, bars, signs,
      area: rectFootprint(at.point, W, 2 * h, Math.atan2(u[1], u[0])),
      footprint: rectFootprint(at.point, W, 2 * half, Math.atan2(u[1], u[0])),
    };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  problems() {
    const g = this.geometry;
    return g && !g.ok ? ["Not on a street: move the zebra crossing onto a street."] : [];
  }

  /** For core/network.js: people on foot cross the street here. */
  crossingInfo() {
    const g = this.geometry;
    return g?.ok ? { id: this.id, kind: "zebra", road: g.road, s: g.s, width: g.W, pos: g.center, obj: this } : null;
  }

  /** No parking on the crossing and 5 m before it (StVO § 12), on both sides. */
  noParking(road) {
    const g = this.geometry;
    if (!g?.ok || g.road !== road.id) return null;
    return [[g.s - g.W / 2 - this.mm(5), g.s + g.W / 2 + this.mm(5)]];
  }

  /**
   * Is somebody on the crossing, or about to step onto it? Asks the simulations with people on foot
   * (`pedestrians()`: [{pos}]); cached for the simulated time.
   */
  busy() {
    const g = this.geometry, t = this.world.time;
    if (!g?.ok) return false;
    if (this._busy && this._busy.t === t) return this._busy.v;
    const reach = g.half + this.mm(1), w = g.W / 2 + this.mm(0.8);
    let v = false;
    for (const sim of this.world.simulations || []) {
      if (sim.enabled === false || typeof sim.pedestrians !== "function") continue;
      for (const p of sim.pedestrians()) {
        const d = [p.pos[0] - g.center[0], p.pos[1] - g.center[1]];
        const along = Math.abs(d[0] * g.u[0] + d[1] * g.u[1]), across = Math.abs(d[0] * g.n[0] + d[1] * g.n[1]);
        if (along <= w && across <= reach) {
          v = true;
          break;
        }
      }
      if (v) break;
    }
    this._busy = { t, v };
    return v;
  }

  card() {
    const card = super.card();
    const g = this.geometry;
    if (g?.ok) card.rows.push(["Street", this.world.getObject(g.road)?.name ?? g.road], ["Now", this.busy() ? "people are crossing: vehicles wait" : "free"]);
    return card;
  }

  draw(view) {
    const g = this.geometry;
    if (!g.ok) {
      view.polygon(g.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      return;
    }
    for (const b of g.bars) view.polygon(b, { fill: "#ffffff", alpha: 0.9, order: 1.21 });
    if (this.spec.signs !== false) for (const p of g.signs) drawSign(view, p, "pedestrian-crossing");
  }
}

/** Distance between two points (mm), for the network's mapping of rules to nodes. */
export function nearestNodeTo(nodes, p, maxMM) {
  let best = null, bd = maxMM;
  for (const n of nodes) {
    const d = dist2(n.pos, p);
    if (d <= bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
