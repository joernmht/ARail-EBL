/**
 * The geometry of a hump yard (Ablaufberg): a tree of segments from the push track over the crest,
 * through the switch zone, to the classification tracks (Richtungsgleise).
 *
 * Every segment starts where its parent ends; a segment with two or more children ends in a switch,
 * one without children is a classification track. A position `s` is metres along a route from the
 * start of the root segment, so all routes share it up to where they part: two cuts on the same way
 * are compared by their `s` alone. Heights in metres; grades in ‰, positive uphill in the direction
 * of humping (a hump falls: its grades are negative), linear between the points given, so that a
 * change of grade over some metres is a vertical curve.
 *
 * `standardYard` builds a yard from a few figures (see `STANDARD_YARD` in params.js).
 * @module arail/hump/yard
 */
import { RETARDERS, STANDARD_YARD, SWITCHES, TRACK_DESIGNS, TRACK_SPACING_M } from "./params.js";

/**
 * A segment as the yard keeps it (positions along the route, m).
 * @typedef {{id: string, parent: string|null, children: string[], depth: number, s0: number, s1: number, length_m: number,
 *   pts: {s: number, g: number, h: number}[], curves: {s0: number, s1: number, r: number}[], turnout: {s0: number, s1: number}|null,
 *   retarders: Retarder[], track: {name: string, s0: number, s1: number, length_m: number}|null}} Segment
 */

/**
 * A retarder (Gleisbremse) on a segment.
 * @typedef {{id: string, kind: string, seg: string, s0: number, s1: number, length_m: number, capacity_m: number, w_max: number,
 *   response_s: number, vmax_in_mps: number, hold_mps: number|null}} Retarder
 *   capacity_m: the energy height it takes from a wagon that passes it fully braked; w_max: its force, N per kN of the
 *   weight on the axles inside it (1000 · capacity_m / length_m); hold_mps: the speed speed-holding units brake above
 */

/** Height (m) at x on a piece from point a to point b, the grade linear in between. */
function pieceHeight(a, b, x) {
  const d = x - a.s, l = b.s - a.s;
  const slope = l > 0 ? (b.g - a.g) / l : 0;
  return a.h + (a.g * d + (slope * d * d) / 2) / 1000;
}

/** The grade (‰) at a local position, linear between the points, constant beyond them. */
function gradeOf(points, x) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [s1, g1] = points[i];
    if (x <= s1) {
      const [s0, g0] = points[i - 1];
      return s1 > s0 ? g0 + ((g1 - g0) * (x - s0)) / (s1 - s0) : g1;
    }
  }
  return points[points.length - 1][1];
}

/** The hump yard: its segments, switches, retarders and classification tracks. */
export class HumpYard {
  /**
   * @param {{name?: string, h0_m?: number, switches?: object, segments: object[]}} spec
   *   segments: `{id, parent, length_m, grades: [[s_m, ‰], …], curves: [[from_m, to_m, radius_m], …],
   *   turnout_m, retarders: [{id, kind, from_m, to_m, capacity_m?, w_nkn?, response_s?, vmax_in_mps?, hold_mps?}], track: {name, from_m}}`
   *   (positions local to the segment); h0_m: the height where the root starts
   */
  constructor(spec) {
    this.name = spec.name || "Hump yard";
    /** Switch settings: loss, throwing time, detection section before and behind the tip, margin. */
    this.switches = { ...SWITCHES, ...(spec.switches || {}) };
    /** @type {Map<string, Segment>} */
    this.segments = new Map();
    /** @type {Retarder[]} */
    this.retarders = [];
    this.problems = [];
    const specs = spec.segments || [];
    for (const s of specs) {
      if (!s.id || this.segments.has(s.id)) {
        this.problems.push(`segment ${s.id || "(no id)"}: needs an id of its own`);
        continue;
      }
      this.segments.set(s.id, { id: String(s.id), parent: s.parent ?? null, children: [], spec: s });
    }
    const roots = [...this.segments.values()].filter((s) => s.parent == null);
    if (roots.length !== 1) throw new Error(`a hump yard needs exactly one root segment, not ${roots.length}`);
    for (const seg of this.segments.values()) {
      if (seg.parent == null) continue;
      const p = this.segments.get(seg.parent);
      if (!p) throw new Error(`segment ${seg.id}: no parent ${seg.parent}`);
      p.children.push(seg.id);
    }
    /** The root segment's id. */
    this.root = roots[0].id;
    /** @type {string[]} the classification tracks' segment ids, in the order of the specs */
    this.trackIds = [];
    const build = (id, s0, h0, depth) => {
      const seg = this.segments.get(id), sp = seg.spec;
      if (seg.s0 != null) throw new Error(`segment ${id}: reached twice`);
      const len = Number(sp.length_m);
      if (!(len > 0)) throw new Error(`segment ${id}: length_m must be positive`);
      Object.assign(seg, { depth, s0, s1: s0 + len, length_m: len });
      // the grade's points, local → along the route, with the heights at them
      const grades = (sp.grades || [[0, 0]]).map(([x, g]) => [Number(x), Number(g)]).sort((a, b) => a[0] - b[0]);
      const xs = [...new Set([0, ...grades.map((p) => p[0]).filter((x) => x > 0 && x < len), len])];
      seg.pts = [];
      for (const x of xs) {
        const g = gradeOf(grades, x);
        const prev = seg.pts[seg.pts.length - 1];
        const h = prev ? pieceHeight(prev, { s: s0 + x, g }, s0 + x) : h0;
        seg.pts.push({ s: s0 + x, g, h });
      }
      seg.curves = (sp.curves || []).map(([a, b, r]) => ({ s0: s0 + Number(a), s1: s0 + Number(b), r: Number(r) })).filter((c) => c.s1 > c.s0 && c.r > 0);
      seg.turnout = sp.turnout_m > 0 ? { s0, s1: s0 + Math.min(len, sp.turnout_m) } : null;
      seg.retarders = (sp.retarders || []).map((r, i) => {
        const kind = r.kind || "group";
        const base = RETARDERS[kind] || RETARDERS.group;
        const a = s0 + Number(r.from_m), b = s0 + Number(r.to_m);
        if (!(b > a)) throw new Error(`segment ${id}: retarder ${r.id || i} needs from_m < to_m`);
        const w_max = r.w_nkn ?? (r.capacity_m != null ? (1000 * r.capacity_m) / (b - a) : base.w_nkn ?? (1000 * base.capacity_m) / (b - a));
        const ret = {
          id: String(r.id || `${id}.${kind}${i ? i + 1 : ""}`), kind, seg: id, s0: a, s1: b, length_m: b - a, capacity_m: (w_max * (b - a)) / 1000,
          w_max, response_s: r.response_s ?? base.response_s, vmax_in_mps: r.vmax_in_mps ?? base.vmax_in_mps,
          hold_mps: r.hold_mps ?? base.hold_mps ?? null,
        };
        this.retarders.push(ret);
        return ret;
      });
      seg.track = null;
      if (!seg.children.length) {
        const from = Math.max(0, Math.min(len, Number(sp.track?.from_m ?? 0)));
        seg.track = { name: String(sp.track?.name ?? id), s0: s0 + from, s1: s0 + len, length_m: len - from };
        this.trackIds.push(id);
      } else if (seg.children.length > 1 && this.switches.guard_m > len) {
        this.problems.push(`segment ${id}: shorter than the switch's detection section (${this.switches.guard_m} m)`);
      }
      const end = seg.pts[seg.pts.length - 1];
      for (const c of seg.children) {
        if (seg.children.length > 1 && this.switches.clear_m > Number(this.segments.get(c).spec.length_m)) {
          this.problems.push(`segment ${c}: shorter than the switch's detection section behind its tip (${this.switches.clear_m} m)`);
        }
        build(c, seg.s1, end.h, depth + 1);
      }
    };
    build(this.root, 0, Number(spec.h0_m ?? 0), 0);
    for (const seg of this.segments.values()) delete seg.spec;
    const names = this.trackIds.map((id) => this.segments.get(id).track.name);
    if (new Set(names).size !== names.length) this.problems.push("two classification tracks have the same name");
    /** The crest (m): the highest point of the routes, where humping starts. */
    this.crest_m = this._crest();
    /** Distance between the centre lines of neighbouring classification tracks (m), for the plan. */
    this.spacing_m = Number(spec.spacing_m ?? TRACK_SPACING_M);
    this._planFan();
  }

  /** @param {string} id @returns {Segment} */
  segment(id) {
    const s = this.segments.get(id);
    if (!s) throw new Error(`no segment ${id}`);
    return s;
  }

  /** The classification tracks, in order: `{id (segment), name, s0, s1, length_m}`. */
  get tracks() {
    return this.trackIds.map((id) => ({ id, ...this.segments.get(id).track }));
  }

  /** The segments of the switches (those that end in one). */
  get switchIds() {
    return [...this.segments.values()].filter((s) => s.children.length > 1).map((s) => s.id);
  }

  /** The segment of a classification track by its name (or segment id). */
  trackSegment(name) {
    const id = this.trackIds.find((t) => this.segments.get(t).track.name === String(name)) ?? (this.trackIds.includes(String(name)) ? String(name) : null);
    if (!id) throw new Error(`no classification track ${name}`);
    return this.segments.get(id);
  }

  /** The route to a segment: the ids from the root to it. */
  pathTo(id) {
    const out = [];
    for (let seg = this.segment(id); seg; seg = seg.parent == null ? null : this.segments.get(seg.parent)) out.unshift(seg.id);
    return out;
  }

  /** The route to a classification track by its name. */
  routeTo(name) {
    return this.pathTo(this.trackSegment(name).id);
  }

  /** The segment of a route at s (the first one before its start, the last one beyond its end). */
  segmentOn(route, s) {
    for (const id of route) {
      const seg = this.segments.get(id);
      if (s < seg.s1) return seg;
    }
    return this.segments.get(route[route.length - 1]);
  }

  /** Height (m) at s on a segment; beyond its ends, on with the grade there. */
  heightAt(seg, s) {
    const p = seg.pts;
    if (s <= p[0].s) return p[0].h + (p[0].g * (s - p[0].s)) / 1000;
    for (let i = 1; i < p.length; i++) if (s <= p[i].s) return pieceHeight(p[i - 1], p[i], s);
    const e = p[p.length - 1];
    return e.h + (e.g * (s - e.s)) / 1000;
  }

  /** Grade (‰) at s on a segment. */
  gradeAt(seg, s) {
    const p = seg.pts;
    if (s <= p[0].s) return p[0].g;
    for (let i = 1; i < p.length; i++) {
      if (s <= p[i].s) return p[i].s > p[i - 1].s ? p[i - 1].g + ((p[i].g - p[i - 1].g) * (s - p[i - 1].s)) / (p[i].s - p[i - 1].s) : p[i].g;
    }
    return p[p.length - 1].g;
  }

  /** Height (m) at s along a route. */
  height(route, s) {
    return this.heightAt(this.segmentOn(route, s), s);
  }

  /** Radius (m) of the curve at s on a segment; 0 on straight track. */
  radiusAt(seg, s) {
    for (const c of seg.curves) if (s >= c.s0 && s < c.s1) return c.r;
    return 0;
  }

  /** Is s within the turnout at the start of a segment (the switch it leaves)? */
  inTurnout(seg, s) {
    return !!seg.turnout && s >= seg.turnout.s0 && s < seg.turnout.s1;
  }

  /** The retarders along a route, in order. */
  retardersOn(route) {
    return route.flatMap((id) => this.segments.get(id).retarders);
  }

  /**
   * The plan of the yard, a schematic fan: each classification track's centre line lies `spacing_m`
   * from its neighbour's (in the order of the tree), reached by the first retarder on it (else the
   * start of the track); every segment bends smoothly from where its parent ends to the middle of
   * the tracks behind it. x runs along the hump from the start of the root (as s does), y to the
   * left. Lengths along the bends are taken as their x (they are a few per cent longer).
   */
  _planFan() {
    const n = this.trackIds.length, mid = (n - 1) / 2;
    const offset = new Map(this.trackIds.map((id, k) => [id, (mid - k) * this.spacing_m]));
    const centre = (id) => {
      const seg = this.segments.get(id);
      if (!seg.children.length) return offset.get(id);
      const ys = seg.children.map(centre);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    for (const seg of this.segments.values()) {
      const y0 = seg.parent == null ? centre(seg.id) : null;
      seg.plan = { y0, y1: centre(seg.id), a: seg.s0, b: seg.s1 };
      if (seg.track) seg.plan.b = Math.max(seg.s0 + 1, seg.retarders[0]?.s0 ?? seg.track.s0);
    }
    for (const seg of this.segments.values()) if (seg.parent != null) seg.plan.y0 = this.segments.get(seg.parent).plan.y1;
  }

  /**
   * Where a position of a route lies in the plan (m, the yard's frame: see `_planFan`), and which way
   * the track points there (rad, from the x axis to the left).
   * @param {string[]} route
   * @param {number} s
   * @returns {{x: number, y: number, heading: number}}
   */
  planAt(route, s) {
    const { y0, y1, a, b } = this.segmentOn(route, s).plan;
    const u = Math.min(1, Math.max(0, (s - a) / (b - a)));
    const y = y0 + (y1 - y0) * u * u * (3 - 2 * u);
    const dy = u > 0 && u < 1 ? ((y1 - y0) * 6 * u * (1 - u)) / (b - a) : 0;
    return { x: s, y, heading: Math.atan(dy) };
  }

  /** The profile of a route every `step_m`: s, height, grade, curve radius, in a turnout. */
  profile(route, step_m = 5) {
    const end = this.segment(route[route.length - 1]).s1, out = [];
    for (let s = 0; s <= end + 1e-9; s += step_m) {
      const seg = this.segmentOn(route, s);
      out.push({ s, h: this.heightAt(seg, s), grade: this.gradeAt(seg, s), r: this.radiusAt(seg, s), turnout: this.inTurnout(seg, s), seg: seg.id });
    }
    return out;
  }

  /** The highest point of the root's segment and its first descendants (the crest), m along the route. */
  _crest() {
    const route = this.pathTo(this.trackIds[0]);
    let best = 0, hBest = -Infinity;
    for (const id of route) {
      for (const p of this.segments.get(id).pts) if (p.h > hBest + 1e-9) [best, hBest] = [p.s, p.h];
    }
    // the top of a rounded crest lies where the grade passes zero
    const seg = this.segmentOn(route, best);
    const p = seg.pts;
    for (let i = 1; i < p.length; i++) {
      if (p[i - 1].g > 0 && p[i].g <= 0) return p[i - 1].s + ((p[i].s - p[i - 1].s) * p[i - 1].g) / (p[i - 1].g - p[i].g);
    }
    return best;
  }

  /** The height of the hump: from the crest to the start of the highest classification track (m; the outer ones lie lower). */
  get height_m() {
    const crest = this.height(this.pathTo(this.trackIds[0]), this.crest_m);
    const high = Math.max(...this.trackIds.map((id) => { const s = this.segments.get(id); return this.heightAt(s, s.track.s0); }));
    return crest - high;
  }
}

/**
 * A yard of the usual shape from a few figures: push track and crest, steep ramp, main retarder,
 * a switch zone as a balanced tree of switches (the branch towards the outside curved), a group
 * retarder before every classification track, the tracks of a design (TRACK_DESIGNS: their grade,
 * speed-holding units over `speed_control_m` of them).
 * @param {object} [options] see `STANDARD_YARD` in params.js; `tracks` (count) or `names`
 * @returns {HumpYard}
 */
export function standardYard(options = {}) {
  const design = TRACK_DESIGNS[options.design ?? STANDARD_YARD.design];
  if (!design) throw new Error(`no track design ${options.design}`);
  const o = { ...STANDARD_YARD, ...design, ...options };
  const names = (o.names || Array.from({ length: o.tracks }, (_, i) => String(i + 1))).map(String);
  const n = names.length;
  if (n < 1) throw new Error("a yard needs at least one classification track");
  const levels = Math.ceil(Math.log2(Math.max(1, n)));
  const segments = [];
  // the root: push track (up to the crest), vertical curve, steep ramp, main retarder, run-out to the first switch
  const push = o.push_m, vc = Math.max(1, (o.crest_radius_m * Math.abs(o.push_grade - o.ramp_grade)) / 1000);
  const rampEnd = push + vc / 2 + o.ramp_m;
  const mainFrom = rampEnd + o.before_main_m, mainTo = mainFrom + o.main_m;
  const rootLen = mainTo + o.after_main_m;
  segments.push({
    id: "hump", parent: null, length_m: rootLen,
    grades: [[0, o.push_grade], [push - vc / 2, o.push_grade], [push + vc / 2, o.ramp_grade], [rampEnd, o.ramp_grade], [rampEnd + 5, o.main_grade], [mainTo, o.main_grade], [mainTo + 5, o.switch_grade]],
    retarders: [{ id: "main", kind: "main", from_m: mainFrom, to_m: mainTo }],
  });
  const turnoutLen = o.turnout_radius_m * o.turnout_angle_rad;
  const mid = (n - 1) / 2;
  const centre = (lo, hi) => (lo + hi - 1) / 2;
  /** Children of a switch over tracks lo..hi−1: the half towards the outside is the diverging branch. */
  const grow = (parent, lo, hi, depth, angle) => {
    if (hi - lo === 1) {
      // a classification track: lead-in so that all group retarders line up, counter-curve, group retarder, the track
      const turnout = depth ? turnoutLen : 0;
      const counterLen = angle > 0 ? o.counter_radius_m * angle : 0;
      const gFrom = Math.max(o.lead_m + (levels - depth) * o.switch_spacing_m, turnout + counterLen + 2);
      const gTo = gFrom + o.group_m, trackFrom = gTo + o.after_group_m;
      const len = trackFrom + o.track_m;
      const tg = o.track_grades.map(([x, g]) => [trackFrom + x, g]);
      segments.push({
        id: `t${names[lo]}`, parent, length_m: len,
        turnout_m: turnout,
        curves: counterLen > 0 ? [[turnout, turnout + counterLen, o.counter_radius_m]] : [],
        grades: [[0, o.switch_grade], [gFrom - 2, o.switch_grade], [gFrom, o.group_grade], [gTo, o.group_grade], [trackFrom, tg[0]?.[1] ?? o.switch_grade], ...tg],
        retarders: [
          { id: `g${names[lo]}`, kind: "group", from_m: gFrom, to_m: gTo },
          ...(o.speed_control_m > 0 ? [{ id: `u${names[lo]}`, kind: "speed", from_m: trackFrom, to_m: Math.min(len, trackFrom + o.speed_control_m) }] : []),
        ],
        track: { name: names[lo], from_m: trackFrom },
      });
      return;
    }
    const half = lo + Math.ceil((hi - lo) / 2);
    for (const [a, b] of [[lo, half], [half, hi]]) {
      const outward = Math.abs(centre(a, b) - mid) > Math.abs(centre(lo, hi) - mid) + 1e-9;
      const symmetric = Math.abs(centre(lo, hi) - mid) < 1e-9;
      const diverging = outward || symmetric;
      const turnAngle = symmetric ? o.turnout_angle_rad / 2 : o.turnout_angle_rad;
      const curve = diverging ? [[0, turnoutLen, symmetric ? 2 * o.turnout_radius_m : o.turnout_radius_m]] : [];
      const id = b - a === 1 ? null : `s${depth + 1}.${names[a]}-${names[b - 1]}`;
      if (id) {
        segments.push({ id, parent, length_m: o.switch_spacing_m, turnout_m: turnoutLen, curves: curve, grades: [[0, o.switch_grade]] });
        grow(id, a, b, depth + 1, angle + (diverging ? turnAngle : 0));
      } else {
        const before = segments.length;
        grow(parent, a, b, depth + 1, angle + (diverging ? turnAngle : 0));
        if (diverging) segments[before].curves.unshift(curve[0]);
      }
    }
  };
  if (n === 1) grow("hump", 0, 1, 0, 0);
  else grow("hump", 0, n, 0, 0);
  return new HumpYard({ name: o.name, h0_m: 0, switches: o.switches, spacing_m: o.spacing_m, segments });
}
