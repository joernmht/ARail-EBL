/**
 * Railway crossings (`rail-crossing`): where a street crosses a railway track. The crossing is one
 * object; its type is a class of its own (`CrossingType` and its subclasses), chosen with `kind` and
 * changed at any time:
 * - **over the track** (`OverTrack`, Straßenüberführung): the street on a bridge;
 * - **under the track** (`UnderTrack`, Eisenbahnüberführung): the street through an underpass;
 * - **at street level** (`AtGrade`, Bahnübergang, EBO § 11), by its protection: St Andrew's cross
 *   only (`CrossbuckOnly`), light signals (`FlashingLights`), light signals with half barriers
 *   (`HalfBarriers`) or with full barriers (`FullBarriers`). Vehicles stop while it is closed.
 *
 * A bridge needs height: the street rises (or the track is lowered, or both) by the clearance plus
 * the deck, at most at the gradient a street (or a railway) allows; the ramps take up length on both
 * sides. The type works this out (`constraints()`) and says when the ramps do not fit before the
 * next junction or the end of the track (the costs come later). Where the terrain makes up the
 * height (`terrain`: the track in a cutting, the street on a slope) no ramps are needed. Trams never cross a railway at
 * street level (BOStrab § 15), and new crossings of streets and railways are built over or under
 * the track (EKrG § 2): a level crossing on a street with tram tracks is an error.
 * @module arail/objects/crossings
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { dist2, dot2, polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { CD, OVERLAY, PALETTE, grey, rgba } from "../core/colors.js";
import { rectFootprint } from "../core/view.js";
import { segmentIntersection } from "../core/network.js";
import { drawSign, drawTrafficLight } from "./signs.js";
import { GAUGE_M, stripColour } from "./road.js";

/**
 * Heights and gradients (m, shares). Clearances: a street under a railway 4.50 m, new bridges 4.70 m
 * (RE-ING); an electrified railway under a road bridge 5.70 m above the rails; a railway without
 * overhead line about 4.90 m (the EBO's clearance gauge and some room). Decks: about 1.0 m for a
 * road bridge, 1.5 m for a railway bridge (usual, not from a rule). Gradients: built-up streets 8 %
 * (12 % in exceptions, RASt 06), streets with trams about 6 % (usual), main-line railways 12.5 ‰
 * (EBO § 7).
 */
export const CROSSING_NORMS = {
  roadClearance: 4.7,
  railClearance: 5.7,
  railClearanceUnelectrified: 4.9,
  roadDeck: 1.0,
  railDeck: 1.5,
  streetGradient: 0.08,
  tramGradient: 0.06,
  railGradient: 0.0125,
};

/** How a bridge gets its height: the street goes up or down, the track does, or both half each. */
export const LIFTS = { street: "the street", track: "the track", both: "both, half each" };

/**
 * A type of railway crossing. Subclasses say whether it is at street level, what it needs and how
 * it looks; `crossing` is the RailCrossing it belongs to.
 */
export class CrossingType {
  static key = "type";
  static label = "Railway crossing";
  /** At street level (vehicles and people cross the rails)? */
  static level = false;

  /** @param {RailCrossing} crossing */
  constructor(crossing) {
    this.crossing = crossing;
  }

  get level() {
    return /** @type {typeof CrossingType} */ (this.constructor).level;
  }

  /** Is it closed for road traffic at simulated time t? Only level crossings with barriers or lights close. */
  closed(t) {
    return false;
  }

  /**
   * What it takes to build: {rise (m the street or track must climb or sink), street (m of ramp on each
   * side of the street), track (m of ramp on each side of the track), room ({before, after}: m of street
   * on each side up to the next junction or end), trackRoom, terrain (the terrain makes up the height:
   * no ramps)}, or null at street level.
   */
  constraints() {
    return null;
  }

  /** Problems: what does not work or makes no sense (texts). */
  problems() {
    const c = this.constraints(), g = this.crossing.geometry, out = [];
    if (!c || !g?.ok) return out;
    const short = (have, need) => Number.isFinite(have) && have + 1e-6 < need;
    if (c.street > 0 && (short(c.room.before, c.street) || short(c.room.after, c.street))) {
      out.push(`${this.crossing.name}: the street needs ${Math.round(c.street)} m of ramp on each side (${Math.round(c.gradient * 1000) / 10} %), but there are only ${Math.round(Math.min(c.room.before, c.room.after))} m to the next junction or end. Lower the track, or choose another kind`);
    }
    if (c.track > 0 && (short(c.trackRoom.before, c.track) || short(c.trackRoom.after, c.track))) {
      out.push(`${this.crossing.name}: the track needs ${Math.round(c.track)} m of ramp on each side (12.5 ‰), but it is only ${Math.round(Math.min(c.trackRoom.before, c.trackRoom.after))} m long on one side`);
    }
    return out;
  }

  /** Rows of the info card. */
  rows() {
    const c = this.constraints();
    if (!c) return [];
    const rows = [["Height to make up", `${c.rise.toFixed(1)} m`]];
    if (c.terrain) rows.push(["Ramps", "none: the terrain makes up the height"]);
    if (c.street > 0) rows.push(["Ramps of the street", `${Math.round(c.street)} m on each side (${Math.round(c.gradient * 1000) / 10} %)`]);
    if (c.track > 0) rows.push(["Ramps of the track", `${Math.round(c.track)} m on each side (12.5 ‰)`]);
    return rows;
  }

  /** Ramps for a height `rise`: by the lift, the street's and the track's gradient. */
  _ramps(rise) {
    const g = this.crossing.geometry, lift = LIFTS[this.crossing.spec.lift] ? this.crossing.spec.lift : "street";
    const gradient = g?.tram ? CROSSING_NORMS.tramGradient : CROSSING_NORMS.streetGradient;
    const terrain = !!this.crossing.spec.terrain;
    const streetRise = terrain ? 0 : lift === "street" ? rise : lift === "both" ? rise / 2 : 0;
    const trackRise = terrain ? 0 : rise - streetRise;
    return {
      rise, gradient, street: streetRise / gradient, track: trackRise / CROSSING_NORMS.railGradient, terrain,
      room: this.crossing.room() ?? { before: Infinity, after: Infinity }, trackRoom: g?.trackRoom ?? { before: Infinity, after: Infinity },
    };
  }

  /** Draw it at the crossing (g: the crossing's geometry). */
  draw(view, g) {}
}

/** The street on a bridge over the track (Straßenüberführung). */
export class OverTrack extends CrossingType {
  static key = "over";
  static label = "Bridge: the street over the track";

  constraints() {
    const g = this.crossing.geometry;
    const clearance = g?.electrified === false ? CROSSING_NORMS.railClearanceUnelectrified : CROSSING_NORMS.railClearance;
    return this._ramps(clearance + CROSSING_NORMS.roadDeck);
  }

  draw(view, g) {
    // the deck over the tracks (drawn after them): the street's sidewalks and carriageway, the rails
    // of its tram tracks; parapets along both edges
    const span = g.span, k = view.m(1.1), order = 6.5;
    const band = (t0, t1) => [g.at(-span, t0), g.at(span, t0), g.at(span, t1), g.at(-span, t1)];
    view.polygon(band(-g.half, g.half), { fill: stripColour({ type: "sidewalk" }), order });
    view.polygon(band(-g.width / 2, g.width / 2), { fill: stripColour({ type: "car-lane" }), order: order + 0.01 });
    const xs = this.crossing.world.getObject(g.road)?.geometry?.xs;
    if (xs && xs.tram !== "none") {
      const m = (x) => view.m(x), tracks = xs.tramTracks === "double" ? [-xs.tramOffset, xs.tramOffset] : [0];
      for (const t of tracks) for (const r of [-GAUGE_M / 2, GAUGE_M / 2]) view.line([g.at(-span, m(t + r)), g.at(span, m(t + r))], { stroke: PALETTE.rail, width: 1, order: order + 0.02 });
    }
    for (const side of [-1, 1]) {
      const a = g.at(-span, side * g.half), b = g.at(span, side * g.half);
      view.faces(wallFaces(a, b, 0, k, grey(0.82)), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, k / 2]);
    }
  }
}

/** The street through an underpass under the railway bridge (Eisenbahnüberführung). */
export class UnderTrack extends CrossingType {
  static key = "under";
  static label = "Underpass: the street under the track";

  constraints() {
    return this._ramps(CROSSING_NORMS.roadClearance + CROSSING_NORMS.railDeck);
  }

  draw(view, g) {
    // the railway bridge across the street: its deck along the track, abutments beside the street
    const w = view.m(3.2), h0 = view.m(CROSSING_NORMS.roadClearance), h1 = h0 + view.m(CROSSING_NORMS.railDeck);
    const a = g.trackAt(-(g.half + view.m(1))), b = g.trackAt(g.half + view.m(1));
    const n = [-g.trackDir[1] * w / 2, g.trackDir[0] * w / 2];
    const fp = [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
    view.prism(fp, h0, h1, { side: grey(0.7), top: grey(0.62) });
    for (const t of [-1, 1]) {
      const c = g.trackAt(t * (g.half + view.m(0.6)));
      view.prism(rectFootprint(c, view.m(1.2), w, Math.atan2(g.trackDir[1], g.trackDir[0])), 0, h0, { side: grey(0.78), top: grey(0.7) });
    }
    // the street's surface in the shade of the bridge
    view.polygon([g.at(-w / 2, -g.width / 2), g.at(w / 2, -g.width / 2), g.at(w / 2, g.width / 2), g.at(-w / 2, g.width / 2)], { fill: grey(0.2), alpha: 0.35, order: 1.3 });
  }
}

/** A level crossing (Bahnübergang): the street crosses the rails; protected by the subclasses. */
export class AtGrade extends CrossingType {
  static key = "level";
  static label = "Level crossing";
  static level = true;
  /** Lights, half or full barriers: closes for trains. */
  static closes = false;
  static barriers = "none";

  /**
   * Closed while a train of the control system is near or a timetable train comes into or leaves a
   * platform of its track nearby; without either, for `closed_min` clock minutes `trains_per_hour`
   * times an hour (a line beyond the layout).
   */
  closed(t = this.crossing.world.time) {
    if (!/** @type {typeof AtGrade} */ (this.constructor).closes) return false;
    const c = this.crossing, w = c.world, g = c.geometry;
    if (!g?.ok) return false;
    if (c._closed && c._closed.t === t) return c._closed.v;
    let v = false;
    const near = c.mm(250);
    for (const train of w.trains?.trains?.values?.() || []) {
      if (train.pos && dist2(train.pos, g.pos) < near) v = true;
    }
    const track = g.track ? w.getObject(g.track) : null, trackId = track?.spec?.track_id;
    if (!v && trackId) {
      for (const st of w.services?.docks?.values?.() || []) {
        const veh = st.vehicle;
        if (!veh || st.dock.track !== trackId || (veh.phase !== "arriving" && veh.phase !== "departing")) continue;
        const d = st.dock.area, mid = d.toLayout((st.dock.s0 + st.dock.s1) / 2, 0);
        if (dist2(mid, g.pos) < c.mm(450)) v = true;
      }
    }
    if (!v && !(w.trains?.trains?.size > 0)) {
      const perHour = Math.max(0, Number(c.spec.trains_per_hour ?? 4));
      if (perHour > 0) {
        const every = 60 / perHour, x = (w.clock?.minutes ?? 0) % every;
        v = x < Math.min(every * 0.8, Math.max(0.2, Number(c.spec.closed_min ?? 1.5)));
      }
    }
    c._closed = { t, v };
    return v;
  }

  problems() {
    const g = this.crossing.geometry, out = [];
    if (g?.ok && g.tram) out.push(`${this.crossing.name}: trams cannot cross the railway at street level (BOStrab § 15). Make it a bridge or an underpass`);
    return out;
  }

  rows() {
    const rows = [["Protection", this.constructor.label]];
    rows.push(["Now", this.closed() ? "closed: a train is coming" : "open"]);
    return rows;
  }

  draw(view, g) {
    // concrete panels across the rails, St Andrew's crosses on the right of both approaches
    const s = view.m(2.2);
    view.polygon([g.at(-s, -g.width / 2), g.at(s, -g.width / 2), g.at(s, g.width / 2), g.at(-s, g.width / 2)], { fill: grey(0.6), alpha: 0.8, order: 1.14 });
    const closed = this.closed(), C = /** @type {typeof AtGrade} */ (this.constructor);
    for (const k of [-1, 1]) {
      const foot = g.at(k * (s + view.m(3)), -k * (g.width / 2 + view.m(0.6)));
      drawSign(view, foot, "crossbuck", { height_m: 2.2 });
      if (C.closes) drawTrafficLight(view, g.at(k * (s + view.m(2.2)), -k * (g.width / 2 + view.m(0.9))), closed ? "red" : "off", { height_m: 2.8 });
      if (C.barriers !== "none") {
        // the boom over the right half (half barriers) or the whole street (full barriers), down when closed
        const len = C.barriers === "full" ? g.width : g.width / 2 + view.m(0.3);
        const base = g.at(k * (s + view.m(1.5)), -k * (g.width / 2 + view.m(0.4)));
        const tip = closed ? g.at(k * (s + view.m(1.5)), -k * (g.width / 2 + view.m(0.4)) + k * len) : base;
        const z0 = view.m(1), z1 = closed ? z0 : z0 + len;
        view.faces([{ pts: [[base[0], base[1], z0], [tip[0], tip[1], z1], [tip[0], tip[1], z1 + view.m(0.12)], [base[0], base[1], z0 + view.m(0.12)]], color: CD.rot, twoSided: true }], [base[0], base[1], z0]);
      }
    }
  }
}

export class CrossbuckOnly extends AtGrade {
  static key = "crossbuck";
  static label = "St Andrew's cross only (no technical protection)";

  problems() {
    const out = super.problems(), road = this.crossing.geometry?.road ? this.crossing.world.getObject(this.crossing.geometry.road) : null;
    if (road?.spec?.kind === "main") out.push(`${this.crossing.name}: a main road needs a level crossing with lights or barriers (EBO § 11: St Andrew's crosses only for little traffic)`);
    return out;
  }
}

export class FlashingLights extends AtGrade {
  static key = "lights";
  static label = "Light signals";
  static closes = true;
}

export class HalfBarriers extends AtGrade {
  static key = "half-barriers";
  static label = "Light signals and half barriers";
  static closes = true;
  static barriers = "half";
}

export class FullBarriers extends AtGrade {
  static key = "full-barriers";
  static label = "Full barriers";
  static closes = true;
  static barriers = "full";
}

/** The types of railway crossings by key. */
export const CROSSING_TYPES = { over: OverTrack, under: UnderTrack, crossbuck: CrossbuckOnly, lights: FlashingLights, "half-barriers": HalfBarriers, "full-barriers": FullBarriers };

/** A wall face from a to b (layout mm) between heights z0 and z1. */
function wallFaces(a, b, z0, z1, colour) {
  return [{ pts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], color: colour, twoSided: true }];
}

export class RailCrossing extends LayoutObject {
  static type = "rail-crossing";
  static label = "Railway crossing";
  static category = "Transport";
  static placement = "point";
  static description = "Where a street crosses a railway track: over it on a bridge, under it through an underpass, or at street level with a St Andrew's cross, light signals, half or full barriers. A bridge needs ramps; trams never cross a railway at street level. Put it where the street crosses the track.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(CROSSING_TYPES).map(([k, C]) => [k, C.label]), default: "over" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the street nearest to it." },
    { key: "track", label: "Track", type: "object", objectType: "track", help: "Empty = the track nearest to it." },
    { key: "terrain", label: "The terrain makes up the height", type: "boolean", default: false, when: (v) => v.kind === "over" || v.kind === "under", help: "The track lies in a cutting or on an embankment, or the street on a slope: no ramps needed." },
    { key: "lift", label: "Height made up by", type: "select", options: Object.entries(LIFTS), default: "street", when: (v) => (v.kind === "over" || v.kind === "under") && !v.terrain, help: "A bridge needs the street higher (or lower), the track lower (or higher), or both." },
    { key: "trains_per_hour", label: "Trains an hour", type: "number", min: 0, max: 30, step: 1, default: 4, when: (v) => ["lights", "half-barriers", "full-barriers"].includes(v.kind), help: "When no train of the control system or the timetable passes: how often it closes." },
    { key: "closed_min", label: "Closed for", type: "number", unit: "min", min: 0.2, max: 10, step: 0.1, default: 1.5, when: (v) => ["lights", "half-barriers", "full-barriers"].includes(v.kind) },
  ];

  /** The crossing's type (a CrossingType), by `kind`; a new instance when the kind changes. */
  get crossingType() {
    const C = CROSSING_TYPES[this.spec.kind] || OverTrack;
    if (!(this._type instanceof C)) this._type = new C(this);
    return this._type;
  }

  /** The crossing follows its street and track. */
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
    const r = this.mm(4);
    const lost = { ok: false, center: p, pos: p, footprint: rectFootprint(p, 2 * r, 2 * r) };
    // the street and the track, and where they cross nearest to the point
    const roads = this.spec.road ? [this.world.getObject(this.spec.road)].filter(Boolean) : this.world.objects.filter((o) => typeof o.roadInfo === "function" && o.type === "road");
    const tracks = this.spec.track ? [this.world.getObject(this.spec.track)].filter(Boolean) : this.world.objects.filter((o) => typeof o.walkBarrier === "function");
    let best = null;
    for (const road of roads) {
      const info = road.geometry ? road.roadInfo() : null;
      if (!info || info.hidden) continue;
      for (const track of tracks) {
        const tp = track.geometry ? track.walkBarrier() : null;
        if (!tp || tp.length < 2) continue;
        for (let i = 1; i < info.points.length; i++) {
          for (let k = 1; k < tp.length; k++) {
            const x = segmentIntersection(info.points[i - 1], info.points[i], tp[k - 1], tp[k]);
            if (!x) continue;
            const d = dist2(x.p, p);
            if (!best || d < best.d) best = { d, road, info, track, tp, x };
          }
        }
      }
    }
    if (!best || best.d > this.mm(40)) return lost;
    const { road, info, track, tp, x } = best;
    const rl = polylineLengths(info.points), tl = polylineLengths(tp);
    const rs = polylineProject(info.points, x.p, rl).s, ts = polylineProject(tp, x.p, tl).s;
    const dir = polylineAt(info.points, rs, rl).dir, trackDir = polylineAt(tp, ts, tl).dir;
    const n = [-dir[1], dir[0]];
    // the span: the tracks side by side here (other tracks within 15 m of the crossing)
    let span = this.mm(4);
    for (const o of this.world.objects) {
      if (typeof o.walkBarrier !== "function" || !o.geometry || o === track) continue;
      const pts = o.walkBarrier();
      if (!pts || pts.length < 2) continue;
      for (let i = 1; i < info.points.length; i++) {
        for (let k = 1; k < pts.length; k++) {
          const y = segmentIntersection(info.points[i - 1], info.points[i], pts[k - 1], pts[k]);
          if (y && dist2(y.p, x.p) < this.mm(15)) span = Math.max(span, dist2(y.p, x.p) + this.mm(4));
        }
      }
    }
    // room for ramps: the street to its ends (to the next junctions: see room()), the track to its ends
    const room = { before: this.meters(rs), after: this.meters(rl[rl.length - 1] - rs) };
    const trackRoom = { before: this.meters(ts), after: this.meters(tl[tl.length - 1] - ts) };
    const width = info.width, half = info.half ?? width / 2 + info.sidewalk;
    const at = (a, t) => [x.p[0] + dir[0] * a + n[0] * t, x.p[1] + dir[1] * a + n[1] * t];
    const trackAt = (a) => [x.p[0] + trackDir[0] * a, x.p[1] + trackDir[1] * a];
    const power = track.spec?.power;
    return {
      ok: true, center: x.p, pos: x.p, road: road.id, track: track.id, s: rs, trackS: ts, dir, trackDir, width, half, span: span / 2 + this.mm(2),
      angle: Math.acos(Math.min(1, Math.abs(dot2(dir, trackDir)))), room, trackRoom, at, trackAt,
      tram: !!info.tram && info.tram !== "none", electrified: power ? power !== "none" : null,
      footprint: [at(-span / 2 - r, -half), at(span / 2 + r, -half), at(span / 2 + r, half), at(-span / 2 - r, half)],
    };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** For core/network.js: where it is, and whether vehicles and people cross the rails here. */
  railCrossingInfo() {
    const g = this.geometry;
    if (!g?.ok) return null;
    return { id: this.id, pos: g.pos, road: g.road, track: g.track, kind: this.spec.kind || "over", level: this.crossingType.level, obj: this };
  }

  /** Closed for road traffic now (a level crossing with lights or barriers while a train passes)? */
  closed(t) {
    return this.crossingType.closed(t);
  }

  /**
   * The room for ramps (m): the street from the crossing to the next junction on each side, or to its
   * ends (from the road network; not part of the geometry, which the network itself asks for).
   */
  room() {
    const g = this.geometry;
    if (!g?.ok) return null;
    let net = null;
    try {
      net = this.world.network?.() || null;
    } catch {
      net = null;
    }
    if (!net) return g.room;
    const ahead = net.nextJunctionOnRoad(g.road, g.s + 1e-3, 1), back = net.nextJunctionOnRoad(g.road, g.s - 1e-3, -1);
    return {
      before: back != null ? this.meters(g.s - back) : g.room.before,
      after: ahead != null ? this.meters(ahead - g.s) : g.room.after,
    };
  }

  /** What the type needs: ramps and the room for them (see CrossingType.constraints). */
  constraints() {
    return this.crossingType.constraints();
  }

  problems() {
    const g = this.geometry;
    if (!g) return [];
    if (!g.ok) return ["Not where a street crosses a track: move it onto the crossing."];
    return this.crossingType.problems();
  }

  card() {
    const card = super.card();
    const g = this.geometry;
    card.rows.push(["Kind", this.crossingType.constructor.label]);
    if (g?.ok) {
      card.rows.push(["Street", this.world.getObject(g.road)?.name ?? g.road], ["Track", this.world.getObject(g.track)?.name ?? g.track]);
      card.rows.push(...this.crossingType.rows());
    }
    const problems = this.problems();
    if (problems.length) card.sections = [...(card.sections || []), { title: "Problems", lines: problems }];
    return card;
  }

  draw(view) {
    const g = this.geometry;
    if (!g.ok) {
      view.polygon(g.footprint, { fill: rgba(OVERLAY.danger, 0.18), stroke: OVERLAY.danger, width: 2, dash: [6, 4], order: 3 });
      return;
    }
    this.crossingType.draw(view, g);
  }

  drawSelection(view) {
    super.drawSelection(view);
    // the ramps the street needs, dashed along it
    const c = this.constraints(), g = this.geometry;
    if (!c || !g?.ok || !(c.street > 0)) return;
    const len = this.mm(c.street);
    for (const k of [-1, 1]) {
      const a = g.at(k * g.span, 0), b = g.at(k * (g.span + len), 0);
      view.line([a, b], { stroke: OVERLAY.selection, width: 2, dash: [3, 4], order: 100, layer: "overlay" });
    }
  }
}
