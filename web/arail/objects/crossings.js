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
 * A bridge needs height: the street lies the clearance and the deck above the rails (an underpass:
 * the clearance and the railway bridge's deck below them), a level crossing at the height of the
 * rails. The type says so to the street (`streetLevels()`), and the street's heights follow from it
 * and from the levels of the table modules (core/elevation.js): between two modules high enough the
 * street runs straight over the tracks; otherwise it ramps up (or down) at the gradient a street
 * allows, and the ramps take up length on both sides. The type says what that takes
 * (`constraints()`: the clearance, the ramps) and when the ramps do not fit before the next junction
 * or the end of the street. Trams never cross a railway at street level (BOStrab § 15), and new
 * crossings of streets and railways are built over or under the track (EKrG § 2): a level crossing
 * on a street with tram tracks is an error.
 * @module arail/objects/crossings
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { dist2, dot2, polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { CD, OVERLAY, grey, rgba } from "../core/colors.js";
import { rectFootprint } from "../core/view.js";
import { segmentIntersection } from "../core/network.js";
import { CROSSING_NORMS } from "../core/elevation.js";
import { drawSign, drawTrafficLight } from "./signs.js";

export { CROSSING_NORMS };

/** Slopes flatter than this are flat. */
const FLAT = 1e-4;

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
   * What it asks of the street's height over its span (mm), the rails at `rails` (mm): {min?, max?}.
   * @param {number} rails
   */
  need(rails) {
    return {};
  }

  /** The stretch of the street it asks for (along the street, mm): {s0, s1}. */
  span(g) {
    return { s0: g.s + g.from, s1: g.s + g.to };
  }

  /**
   * What it takes ({rails: height of the rails (mm), low, high: the street's lowest and highest
   * point over the span (mm), clearance: the room left under the bridge or the underpass's deck (m),
   * gradient, ramps: {before, after} (m of ramp beyond the span on each side), room: {before, after}
   * (m of street on each side up to the next junction or end)}), or null while it is not on a crossing.
   */
  constraints() {
    const c = this.crossing, g = c.geometry;
    if (!g?.ok) return null;
    const p = c.world.elevation.profile(g.road);
    if (!p) return null;
    const rails = c.railLevel(), { s0, s1 } = this.span(g);
    let low = Infinity, high = -Infinity;
    for (let k = 0; k < p.s.length; k++) {
      if (p.s[k] < s0 - 1e-6 || p.s[k] > s1 + 1e-6) continue;
      low = Math.min(low, p.z[k]);
      high = Math.max(high, p.z[k]);
    }
    if (!(low <= high)) low = high = c.world.elevation.heightOn(g.road, g.s);
    return {
      rails, low, high, clearance: this._clearance(rails, low, high), gradient: p.gradient,
      ramps: { before: c.meters(ramp(p, s0, -1)), after: c.meters(ramp(p, s1, 1)) },
      room: c.room() ?? { before: Infinity, after: Infinity },
    };
  }

  /** The room under the bridge (or the underpass's deck) in m, or null for a level crossing. */
  _clearance(rails, low, high) {
    return null;
  }

  /** Problems: what does not work or makes no sense (texts). */
  problems() {
    const c = this.constraints(), out = [];
    if (!c) return out;
    const short = (have, need) => Number.isFinite(have) && have + 1e-6 < need;
    if (short(c.room.before, c.ramps.before) || short(c.room.after, c.ramps.after)) {
      const need = Math.max(c.ramps.before, c.ramps.after), room = Math.min(c.room.before, c.room.after);
      out.push(`${this.crossing.name}: the street needs ${Math.round(need)} m of ramp (${Math.round(c.gradient * 1000) / 10} %), but there are only ${Math.round(room)} m to the next junction or end. Change the levels of the table modules, or choose another kind`);
    }
    return out;
  }

  /** Rows of the info card: the clearance and the ramps. */
  rows() {
    const c = this.constraints();
    if (!c) return [];
    const rows = [];
    if (c.clearance != null) rows.push(["Clearance", `${c.clearance.toFixed(1)} m (at least ${this._needed().toFixed(1)} m)`]);
    if (c.ramps.before > 0.5 || c.ramps.after > 0.5) rows.push(["Ramps of the street", `${Math.round(c.ramps.before)} m and ${Math.round(c.ramps.after)} m (${Math.round(c.gradient * 1000) / 10} %)`]);
    else if (c.clearance != null) rows.push(["Ramps", "none: the table modules make up the height"]);
    return rows;
  }

  /** The clearance it needs (m). */
  _needed() {
    return 0;
  }

  /**
   * Draw it at the crossing (g: the crossing's geometry). A bridge and an underpass are drawn by their
   * street (objects/road.js), from its heights: the deck over the tracks, the railway's bridge.
   */
  draw(view, g) {}
}

/**
 * The length (mm) of ramp a street has beyond s (dir 1: on, −1: back) until it stands on the ground
 * again and runs on flat (flat stretches off the ground do not count). Where it ends before, the ramp
 * it would need to come down (or up) to the ground at its gradient.
 */
function ramp(p, s, dir) {
  const S = p.s, Z = p.z, G = p.ground, N = S.length;
  let k = dir > 0 ? S.findIndex((v) => v >= s - 1e-6) : S.findLastIndex((v) => v <= s + 1e-6);
  if (k < 0) return 0;
  const k0 = k;
  let length = 0;
  for (; k + dir >= 0 && k + dir < N; k += dir) {
    const ds = Math.abs(S[k + dir] - S[k]), sloped = Math.abs(Z[k + dir] - Z[k]) > FLAT * ds;
    if (!sloped && Math.abs(Z[k] - G[k]) < 1e-6) return length;
    if (sloped) length += ds;
  }
  return Math.abs(Z[k] - G[k]) < 1e-6 ? length : Math.max(length, Math.abs(Z[k0] - G[k]) / p.gradient);
}

/** The street on a bridge over the track (Straßenüberführung). */
export class OverTrack extends CrossingType {
  static key = "over";
  static label = "Bridge: the street over the track";

  need(rails) {
    return { min: rails + this.crossing.mm(this._needed() + CROSSING_NORMS.roadDeck) };
  }

  _needed() {
    return this.crossing.geometry?.electrified === false ? CROSSING_NORMS.railClearanceUnelectrified : CROSSING_NORMS.railClearance;
  }

  _clearance(rails, low) {
    return this.crossing.meters(low - rails) - CROSSING_NORMS.roadDeck;
  }
}

/** The street through an underpass under the railway bridge (Eisenbahnüberführung). */
export class UnderTrack extends CrossingType {
  static key = "under";
  static label = "Underpass: the street under the track";

  need(rails) {
    return { max: rails - this.crossing.mm(CROSSING_NORMS.roadClearance + CROSSING_NORMS.railDeck) };
  }

  _needed() {
    return CROSSING_NORMS.roadClearance;
  }

  _clearance(rails, low, high) {
    return this.crossing.meters(rails - high) - CROSSING_NORMS.railDeck;
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

  /** The street at the height of the rails. */
  need(rails) {
    return { min: rails, max: rails };
  }

  problems() {
    const g = this.crossing.geometry, out = [];
    if (g?.ok && g.tram) out.push(`${this.crossing.name}: trams cannot cross the railway at street level (BOStrab § 15). Make it a bridge or an underpass`);
    return out.concat(super.problems());
  }

  rows() {
    const rows = [["Protection", this.constructor.label]];
    rows.push(["Now", this.closed() ? "closed: a train is coming" : "open"]);
    return rows.concat(super.rows());
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

/** A wall face from a to b (layout mm) between heights z0 and z1 at a (zb0 and zb1 at b: the same by default). */
function wallFaces(a, b, z0, z1, colour, zb0 = z0, zb1 = z1) {
  return [{ pts: [[a[0], a[1], z0], [b[0], b[1], zb0], [b[0], b[1], zb1], [a[0], a[1], z1]], color: colour, twoSided: true }];
}

export class RailCrossing extends LayoutObject {
  static type = "rail-crossing";
  static label = "Railway crossing";
  static category = "Transport";
  static placement = "point";
  static description = "Where a street crosses a railway track: over it on a bridge, under it through an underpass, or at street level with a St Andrew's cross, light signals, half or full barriers. A bridge needs height: table modules raised beside the tracks, or ramps. Trams never cross a railway at street level. Put it where the street crosses the track.";
  /** On the street, which may span a gap between table modules. */
  static anywhere = true;
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(CROSSING_TYPES).map(([k, C]) => [k, C.label]), default: "over" },
    { key: "road", label: "Street", type: "object", objectType: "road", help: "Empty = the street nearest to it." },
    { key: "track", label: "Track", type: "object", objectType: "track", help: "Empty = the track nearest to it." },
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
    // the span: the tracks side by side here (all tracks the street crosses within 15 m of the
    // crossing, `tracks`: [{track, pos, d}] with d along the street), and 4 m beyond the outer ones
    const crossed = [{ track: track.id, pos: x.p, d: 0 }];
    for (const o of this.world.objects) {
      if (typeof o.walkBarrier !== "function" || !o.geometry || o === track) continue;
      const pts = o.walkBarrier();
      if (!pts || pts.length < 2) continue;
      for (let i = 1; i < info.points.length; i++) {
        for (let k = 1; k < pts.length; k++) {
          const y = segmentIntersection(info.points[i - 1], info.points[i], pts[k - 1], pts[k]);
          if (!y || dist2(y.p, x.p) >= this.mm(15)) continue;
          crossed.push({ track: o.id, pos: y.p, d: polylineProject(info.points, y.p, rl).s - rs });
        }
      }
    }
    const from = Math.min(...crossed.map((c) => c.d)) - this.mm(4), to = Math.max(...crossed.map((c) => c.d)) + this.mm(4);
    // room for ramps: the street to its ends (to the next junctions: see room())
    const room = { before: this.meters(rs), after: this.meters(rl[rl.length - 1] - rs) };
    const width = info.width, half = info.half ?? width / 2 + info.sidewalk;
    const at = (a, t) => [x.p[0] + dir[0] * a + n[0] * t, x.p[1] + dir[1] * a + n[1] * t];
    const trackAt = (a) => [x.p[0] + trackDir[0] * a, x.p[1] + trackDir[1] * a];
    const power = track.spec?.power;
    return {
      ok: true, center: x.p, pos: x.p, road: road.id, track: track.id, tracks: crossed, s: rs, trackS: ts, dir, trackDir, width, half, from, to,
      angle: Math.acos(Math.min(1, Math.abs(dot2(dir, trackDir)))), room, at, trackAt,
      tram: !!info.tram && info.tram !== "none", electrified: power ? power !== "none" : null,
      footprint: [at(from - r, -half), at(to + r, -half), at(to + r, half), at(from - r, half)],
    };
  }

  /** Height of the rails here (mm): the level of the table module under the highest of the tracks it crosses. */
  railLevel() {
    const g = this.geometry;
    if (!g?.ok) return 0;
    const el = this.world.elevation.sync();
    return Math.max(...g.tracks.map((t) => el.ground(t.pos[0], t.pos[1])));
  }

  /**
   * What it asks of its street's height (core/elevation.js): [{road, s0, s1, min?, max?}], along the
   * street and in mm: a bridge at least the clearance and its deck above the rails, an underpass at
   * most the clearance and the railway bridge's deck below them, a level crossing at their height.
   * @param {import("../core/elevation.js").Elevation} el the heights being worked out (the ground is known)
   */
  streetLevels(el) {
    const g = this.geometry;
    if (!g?.ok) return [];
    const T = this.crossingType, rails = Math.max(...g.tracks.map((t) => el.ground(t.pos[0], t.pos[1])));
    return [{ road: g.road, ...T.span(g), ...T.need(rails) }];
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
    // the ramps of the street, dashed along it
    const c = this.constraints(), g = this.geometry;
    if (!c || !g?.ok) return;
    for (const [k, len] of [[-1, this.mm(c.ramps.before)], [1, this.mm(c.ramps.after)]]) {
      if (!(len > 0)) continue;
      const end = k < 0 ? g.from : g.to, a = g.at(end, 0), b = g.at(end + k * len, 0);
      view.line([a, b], { stroke: OVERLAY.selection, width: 2, dash: [3, 4], order: 100, layer: "overlay" });
    }
  }
}
