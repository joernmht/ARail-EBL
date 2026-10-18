/**
 * Heights: the levels of the table modules and the heights of the streets along their length.
 *
 * A table module (objects/tabletop.js, `groundLevel()`) lies at a level: the height of its top above
 * the track level, the top of the real table (z = 0). What stands on a module stands at its level
 * (`ground`); where modules overlap, the highest one counts; off the modules it is the track level.
 *
 * A street runs on the modules it crosses. From one level to another it climbs at most at its
 * gradient ({@link CROSSING_NORMS}): on the lower side a ramp leads up to the edge. Where it cannot
 * come down to the ground between two higher parts (the tracks between two raised modules), it runs
 * straight from edge to edge, as a bridge. Railway crossings ask for heights (`streetLevels()`,
 * objects/crossings.js): a bridge the clearance over the rails and its deck, an underpass the
 * clearance under the railway bridge and that deck, a level crossing the height of the rails. The
 * street ramps up or down to them where the modules do not make up the height. A street's heights
 * along its centre line are its profile.
 *
 * The street level (`street`) is the height of a street where it leaves the ground (ramps, bridges,
 * underpasses) and the ground everywhere else. The view lifts what is drawn by these heights
 * (`World#draw`, `View#lift`): most things by the street level, the railway (tracks, platforms,
 * trains) by the ground, so that trains pass under a bridge; table modules draw their own heights.
 * @module arail/core/elevation
 */
import { polylineAt, polylineLengths, polylineProject } from "./math.js";

/**
 * Heights and gradients of crossings of streets and railways (prototype metres, shares).
 * Clearances: a street under a railway 4.50 m, new bridges 4.70 m (RE-ING); an electrified railway
 * under a road bridge 5.70 m above the rails; a railway without overhead line about 4.90 m (the EBO's
 * clearance gauge and some room). Decks: about 1.0 m for a road bridge, 1.5 m for a railway bridge
 * (usual, not from a rule). Gradients: built-up streets 8 % (12 % in exceptions, RASt 06), streets
 * with trams about 6 % (usual), footpaths 6 % (DIN 18040-3: without barriers), main-line railways
 * 12.5 ‰ (EBO § 7).
 */
export const CROSSING_NORMS = {
  roadClearance: 4.7,
  railClearance: 5.7,
  railClearanceUnelectrified: 4.9,
  roadDeck: 1.0,
  railDeck: 1.5,
  streetGradient: 0.08,
  tramGradient: 0.06,
  pathGradient: 0.06,
  railGradient: 0.0125,
};

/** Heights closer than this (mm) are the same. */
const EPS = 0.5;

/** Spacing (mm) of the points along a street its profile is worked out on. */
const STEP = 5;

/** The steepest a street climbs (a share): with tram tracks or on a footpath 6 %, else 8 %. */
export function streetGradient(info) {
  if (info.kind === "tram" || (info.tram && info.tram !== "none")) return CROSSING_NORMS.tramGradient;
  return info.kind === "path" ? CROSSING_NORMS.pathGradient : CROSSING_NORMS.streetGradient;
}

/**
 * A street's profile: its heights along the centre line.
 * @typedef {object} Profile
 * @property {string} road the street's id
 * @property {number[]} s arc lengths (mm, ascending, from 0 to the street's length)
 * @property {number[]} z heights of the street there (mm)
 * @property {number[]} ground heights of the ground there (mm)
 * @property {number} gradient the steepest it may climb (a share)
 * @property {Deck[]} decks where it is off the ground
 */

/**
 * A stretch of a street off the ground (a ramp, a bridge, an underpass), for the street level.
 * @typedef {object} Deck
 * @property {string} road
 * @property {number} s0 where it begins on the street (mm)
 * @property {number} s1 where it ends
 * @property {number[][]} pts its centre line
 * @property {number} half half its width (mm)
 * @property {number[]} box [xmin, ymin, xmax, ymax] with the width
 * @property {number[]} s arc lengths along `pts` (mm, from 0)
 * @property {number[]} z heights there
 * @property {number[]} ground the ground there
 */

export class Elevation {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** The table modules, the highest first: [{obj, level, fp, box}]. */
    this.modules = [];
    /** @type {Map<string, Profile>} */
    this.profiles = new Map();
    /** @type {Deck[]} */
    this.decks = [];
    /** True while everything lies at the track level (nothing to lift). */
    this.flat = true;
    /** For the view (`View#lift`), null while flat: lift by the street level, by the ground. */
    this.streetLift = null;
    this.groundLift = null;
  }

  /** Work the heights out again when objects, the marker map or the scale have changed; returns this. */
  sync() {
    const w = this.world;
    if (this._v === w.objectsVersion && this._m === w.map.version && this._s === w.scale) return this;
    this._v = w.objectsVersion;
    this._m = w.map.version;
    this._s = w.scale;
    this._build();
    return this;
  }

  _build() {
    const w = this.world;
    const modules = [];
    for (const o of w.objects) {
      if (typeof o.groundLevel !== "function" || !o.geometry) continue;
      const fp = o.footprint();
      if (!fp?.length) continue;
      const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]);
      const g = o.geometry, rect = g.center && g.width > 0 && g.depth > 0 && Number.isFinite(g.angle)
        ? { cx: g.center[0], cy: g.center[1], c: Math.cos(g.angle), s: Math.sin(g.angle), hw: g.width / 2, hd: g.depth / 2 } : null;
      modules.push({ obj: o, level: +o.groundLevel() || 0, fp, rect, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    modules.sort((a, b) => b.level - a.level);
    // a module no higher one overlaps is the ground wherever it is (the last one found is asked first)
    modules.forEach((m, i) => {
      m.alone = modules.slice(0, i).every((h) => h.level === m.level || h.box[0] > m.box[2] || h.box[2] < m.box[0] || h.box[1] > m.box[3] || h.box[3] < m.box[1]);
    });
    this.modules = modules;
    this._last = null;
    this.profiles = new Map();
    this.decks = [];
    // what railway crossings ask of the streets
    const asked = new Map();
    for (const o of w.objects) {
      if (typeof o.streetLevels !== "function" || !o.geometry) continue;
      let list = null;
      try {
        list = o.streetLevels(this);
      } catch {
        list = null;
      }
      for (const r of list || []) {
        if (!asked.has(r.road)) asked.set(r.road, []);
        asked.get(r.road).push({ ...r, by: o.id });
      }
    }
    for (const o of w.objects) {
      if (typeof o.roadInfo !== "function" || !o.geometry) continue;
      let info = null;
      try {
        info = o.roadInfo();
      } catch {
        info = null;
      }
      if (!info?.points || info.points.length < 2 || info.hidden) continue;
      const p = this._profile(o.id, info, asked.get(o.id) || []);
      this.profiles.set(o.id, p);
      this.decks.push(...p.decks);
    }
    this.flat = !this.decks.length && modules.every((m) => Math.abs(m.level) < EPS);
    this.streetLift = this.flat ? null : (x, y) => this.street(x, y);
    this.groundLift = this.flat ? null : (x, y) => this.ground(x, y);
  }

  /* ---------------------------------------------------------------- the ground */

  /** The table module at a layout point (the highest where they overlap), within `tol` mm of its edge; or null. */
  moduleAt(x, y, tol = 0) {
    for (const m of this.modules) {
      const b = m.box;
      if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
      if (onModule(m, x, y) || (tol > 0 && edgeDistance(m.fp, x, y) <= tol)) return m;
    }
    return null;
  }

  /** Height of the ground (mm): the level of the table module there, 0 off the modules. Call `sync()` first. */
  ground(x, y) {
    // what is drawn comes in runs of points close together: the module found last first
    const last = this._last;
    if (last && last.alone && onModule(last, x, y)) return last.level;
    for (const m of this.modules) {
      const b = m.box;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && onModule(m, x, y)) {
        this._last = m;
        return m.level;
      }
    }
    return 0;
  }

  /** Height (mm) of what people and vehicles move on: a street off the ground there, else the ground. Call `sync()` first. */
  street(x, y) {
    for (const d of this.decks) {
      const b = d.box;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const z = deckHeight(d, x, y);
      if (z != null) return z;
    }
    return this.ground(x, y);
  }

  /** The level of the ground at a point (synced). */
  groundAt(p) {
    return this.sync().ground(p[0], p[1]);
  }

  /** The street level at a point (synced). */
  streetAt(p) {
    return this.sync().street(p[0], p[1]);
  }

  /**
   * Are these layout points on the table modules (each within `tol` mm of one)? True when there are
   * no modules at all: then the layout is the real table, wherever it is.
   */
  onModules(points, tol = 1) {
    this.sync();
    if (!this.modules.length) return true;
    return points.every((p) => !!this.moduleAt(p[0], p[1], tol));
  }

  /* ---------------------------------------------------------------- streets */

  /** The profile of a street (by id), or null. */
  profile(id) {
    return this.sync().profiles.get(id) || null;
  }

  /** Height of a street at arc length `s` (mm) along its centre line; null if it has no profile. */
  heightOn(id, s) {
    const p = this.profile(id);
    return p ? interpolate(p.s, p.z, s) : null;
  }

  /**
   * Where a street crosses a track and how it does there: [{track, pos, s, dir, street, rails, clear,
   * kind, need}] (mm; `dir`: the track's direction; `clear` = street − rails). `kind`: "level" at the
   * height of the rails, "over" (or "under") with room for a bridge (an underpass), else "clash";
   * `need`: the height a bridge (an underpass) needs. Tracks are what people do not cross on their
   * own (`walkBarrier()`, objects/track.js). Cached until the heights change.
   */
  trackCrossings(id) {
    this.sync();
    const p = this.profiles.get(id);
    if (!p) return [];
    if (p.crossings) return p.crossings;
    const road = this.world.getObject(id), pts = road.roadInfo().points, cum = polylineLengths(pts), out = [];
    for (const o of this.world.objects) {
      if (typeof o.walkBarrier !== "function" || !o.geometry) continue;
      const tp = o.walkBarrier();
      if (!tp || tp.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        for (let k = 1; k < tp.length; k++) {
          const x = intersect(pts[i - 1], pts[i], tp[k - 1], tp[k]);
          if (!x) continue;
          const s = cum[i - 1] + x.t * (cum[i] - cum[i - 1]);
          const l = Math.hypot(tp[k][0] - tp[k - 1][0], tp[k][1] - tp[k - 1][1]) || 1;
          const dir = [(tp[k][0] - tp[k - 1][0]) / l, (tp[k][1] - tp[k - 1][1]) / l];
          out.push({ track: o.id, pos: x.p, s, dir, ...this._clearance(interpolate(p.s, p.z, s), this.ground(x.p[0], x.p[1]), o) });
        }
      }
    }
    p.crossings = out.sort((a, b) => a.s - b.s);
    return p.crossings;
  }

  /** How a street at height `street` crosses the rails of `track` at height `rails` (see trackCrossings). */
  _clearance(street, rails, track) {
    const mm = (m) => (m * 1000) / this.world.scale, clear = street - rails;
    const N = CROSSING_NORMS, power = track?.spec?.power;
    const over = mm((power === "none" ? N.railClearanceUnelectrified : N.railClearance) + N.roadDeck), under = mm(N.roadClearance + N.railDeck);
    const kind = Math.abs(clear) <= EPS ? "level" : clear >= over - EPS ? "over" : clear <= -under + EPS ? "under" : "clash";
    return { street, rails, clear, kind, need: clear < 0 ? under : over };
  }

  /** How a street crosses a track at a point (on its centre line) where no railway crossing is: see trackCrossings. */
  crossingAt(id, pos, track = null) {
    const p = this.profile(id), road = this.world.getObject(id);
    if (!p || !road) return null;
    const s = polylineProject(road.roadInfo().points, pos).s;
    return { s, ...this._clearance(interpolate(p.s, p.z, s), this.ground(pos[0], pos[1]), track) };
  }

  /**
   * What is wrong with a street's heights: where it meets another street at another height (a ramp
   * reaches into the junction), where it ends in the air. Texts; needs the road network.
   */
  streetProblems(id) {
    const p = this.profile(id), w = this.world;
    if (!p) return [];
    const out = [];
    let net = null;
    try {
      net = w.network?.() || null;
    } catch {
      net = null;
    }
    const road = w.getObject(id), pts = road.roadInfo().points;
    const mm = (v) => Math.round(Math.abs(v));
    if (net) {
      const seen = new Set();
      for (const n of net.nodes) {
        const roads = new Set();
        for (const e of n.edges) {
          const r = net.edges[e]?.road;
          if (r && this.profiles.has(r)) roads.add(r);
        }
        if (!roads.has(id) || roads.size < 2) continue;
        const z = interpolate(p.s, p.z, polylineProject(pts, n.pos).s);
        for (const other of roads) {
          if (other === id || seen.has(other)) continue;
          const o = w.getObject(other), q = this.profiles.get(other);
          const zo = interpolate(q.s, q.z, polylineProject(o.roadInfo().points, n.pos).s);
          if (Math.abs(z - zo) <= 1) continue;
          seen.add(other);
          out.push(`At the junction with ${o.name}: ${mm(z - zo)} mm ${z > zo ? "higher" : "lower"} than it. Streets meet at the same height: keep ramps away from junctions`);
        }
      }
    }
    for (const k of [0, p.s.length - 1]) {
      const d = p.z[k] - p.ground[k];
      if (Math.abs(d) > EPS) out.push(`Ends ${mm(d)} mm ${d > 0 ? "above" : "below"} the ground: let it end on a table module at its height`);
    }
    return out;
  }

  /**
   * The profile of a street from the ground along it and what crossings ask of it (`asked`:
   * [{s0, s1, min?, max?}], heights in mm, positions along the street).
   */
  _profile(id, info, asked) {
    const pts = info.points, cum = polylineLengths(pts), L = cum[cum.length - 1];
    const g = streetGradient(info);
    // the points it is worked out on: a few mm apart, both sides of every module edge it crosses
    // and the ends of what crossings ask for
    const at = [];
    for (let s = 0; s < L; s += STEP) at.push(s);
    at.push(L);
    for (const m of this.modules) {
      for (let i = 1; i < pts.length; i++) {
        for (let k = 0; k < m.fp.length; k++) {
          const x = intersect(pts[i - 1], pts[i], m.fp[k], m.fp[(k + 1) % m.fp.length]);
          if (!x) continue;
          const s = cum[i - 1] + x.t * (cum[i] - cum[i - 1]);
          at.push(Math.max(0, s - 0.01), Math.min(L, s + 0.01));
        }
      }
    }
    for (const r of asked) at.push(clamp(r.s0, 0, L), clamp(r.s1, 0, L));
    at.sort((a, b) => a - b);
    const S = [];
    for (const s of at) if (!S.length || s - S[S.length - 1] > 1e-3) S.push(s);
    const N = S.length;
    // (a street drawn up to the edge of a module ends on it)
    const G = S.map((s) => {
      const q = polylineAt(pts, s, cum).point;
      return this.moduleAt(q[0], q[1], 0.5)?.level ?? 0;
    });
    const lo = G.slice(), hi = G.map(() => Infinity);
    for (const r of asked) {
      for (let k = 0; k < N; k++) {
        if (S[k] < r.s0 - 1e-6 || S[k] > r.s1 + 1e-6) continue;
        if (r.min != null) lo[k] = Math.max(lo[k], r.min);
        if (r.max != null) hi[k] = Math.min(hi[k], r.max);
      }
    }
    // up: the street climbs at most at its gradient to what holds it up; where it cannot come down
    // to the ground between two higher parts, it runs straight from one to the other
    let z = lo.slice();
    spread(S, z, g, 1);
    hull(S, z, G, 1);
    // down: the same for what must lie lower (underpasses, a level crossing below the modules)
    if (hi.some((v, k) => v < z[k] - EPS)) {
      const top = z.map((v, k) => Math.min(v, hi[k]));
      spread(S, top, g, -1);
      hull(S, top, z, -1);
      z = top;
    }
    // the stretches off the ground
    const decks = [];
    const half = info.half ?? info.width / 2 + (info.sidewalk || 0);
    for (let k = 0; k < N; ) {
      if (Math.abs(z[k] - G[k]) <= EPS) {
        k++;
        continue;
      }
      let j = k;
      while (j + 1 < N && Math.abs(z[j + 1] - G[j + 1]) > EPS) j++;
      const a = Math.max(0, k - 1), b = Math.min(N - 1, j + 1);
      decks.push(deck(id, pts, cum, S.slice(a, b + 1), z.slice(a, b + 1), G.slice(a, b + 1), half));
      k = j + 1;
    }
    return { road: id, s: S, z, ground: G, gradient: g, decks };
  }
}

/* ---------------------------------------------------------------- profiles */

/**
 * Let heights spread along a street at most at gradient g: up (`dir` 1: every height at least the
 * neighbours' less g per mm) or down (−1: at most the neighbours' plus g per mm). In place.
 */
function spread(S, z, g, dir) {
  const N = S.length;
  for (let k = 1; k < N; k++) {
    const v = z[k - 1] - dir * g * (S[k] - S[k - 1]);
    if (dir > 0 ? v > z[k] : v < z[k]) z[k] = v;
  }
  for (let k = N - 2; k >= 0; k--) {
    const v = z[k + 1] - dir * g * (S[k + 1] - S[k]);
    if (dir > 0 ? v > z[k] : v < z[k]) z[k] = v;
  }
}

/**
 * Where the heights z leave `base` (dir 1: above it, −1: below), the street runs straight from
 * where it last stood on it to where it stands on it again, over any dip between (the upper hull;
 * from below: the lower hull). In place.
 */
function hull(S, z, base, dir) {
  const N = S.length;
  const off = (k) => (dir > 0 ? z[k] > base[k] + EPS : z[k] < base[k] - EPS);
  for (let k = 0; k < N; ) {
    if (!off(k)) {
      k++;
      continue;
    }
    let j = k;
    while (j + 1 < N && off(j + 1)) j++;
    const a = Math.max(0, k - 1), b = Math.min(N - 1, j + 1);
    // monotone chain: the upper hull of the points a..b (for dir −1 the lower hull)
    const H = [];
    for (let i = a; i <= b; i++) {
      while (H.length >= 2) {
        const p = H[H.length - 2], q = H[H.length - 1];
        const cross = (S[q] - S[p]) * (z[i] - z[p]) - (z[q] - z[p]) * (S[i] - S[p]);
        if (dir * cross >= 0) H.pop();
        else break;
      }
      H.push(i);
    }
    for (let h = 1; h < H.length; h++) {
      const p = H[h - 1], q = H[h];
      for (let i = p + 1; i < q; i++) z[i] = z[p] + ((z[q] - z[p]) * (S[i] - S[p])) / (S[q] - S[p]);
    }
    k = j + 1;
  }
}

/** A stretch of a street off the ground: its centre line from s[0] to s[last] and its heights. */
function deck(road, pts, cum, S, z, ground, half) {
  const s0 = S[0], s1 = S[S.length - 1];
  const line = [polylineAt(pts, s0, cum).point];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) line.push(pts[i]);
  line.push(polylineAt(pts, s1, cum).point);
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]), r = half * 1.05;
  return {
    road, s0, s1, pts: line, lengths: polylineLengths(line), half,
    box: [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r],
    s: S.map((v) => v - s0), z, ground,
  };
}

/** Height of a deck at a layout point, or null if the point is not on it. */
function deckHeight(d, x, y) {
  const P = d.pts, C = d.lengths;
  let best = Infinity, s = 0;
  for (let i = 1; i < P.length; i++) {
    const ax = P[i - 1][0], ay = P[i - 1][1], dx = P[i][0] - ax, dy = P[i][1] - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const ex = ax + dx * t - x, ey = ay + dy * t - y, dd = ex * ex + ey * ey;
    if (dd < best) {
      best = dd;
      s = C[i - 1] + t * (C[i] - C[i - 1]);
    }
  }
  const r = d.half * 1.05;
  return best <= r * r ? interpolate(d.s, d.z, s) : null;
}

/** Linear interpolation of Y over ascending X at v (clamped at the ends): a height along a profile or deck. */
export function interpolate(X, Y, v) {
  const n = X.length;
  if (v <= X[0]) return Y[0];
  if (v >= X[n - 1]) return Y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (X[mid] <= v) lo = mid;
    else hi = mid;
  }
  const t = (v - X[lo]) / (X[hi] - X[lo] || 1);
  return Y[lo] + (Y[hi] - Y[lo]) * t;
}

/* ---------------------------------------------------------------- plane geometry */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Is (x, y) on a module: in its rectangle (a table module) or its footprint? */
function onModule(m, x, y) {
  const r = m.rect;
  if (!r) return inside(m.fp, x, y);
  const dx = x - r.cx, dy = y - r.cy;
  return Math.abs(dx * r.c + dy * r.s) <= r.hw && Math.abs(dy * r.c - dx * r.s) <= r.hd;
}

/** Is (x, y) inside the polygon (even-odd)? No arrays: it is asked for every point drawn. */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distance of (x, y) from the edges of a polygon. */
function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y));
  }
  return best;
}

/** Where the segments p1–p2 and q1–q2 cross: {t (along p), p}, or null. */
function intersect(p1, p2, q1, q2) {
  const rx = p2[0] - p1[0], ry = p2[1] - p1[1], sx = q2[0] - q1[0], sy = q2[1] - q1[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = q1[0] - p1[0], qy = q1[1] - p1[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, p: [p1[0] + rx * t, p1[1] + ry * t] };
}
