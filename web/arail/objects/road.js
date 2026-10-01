/**
 * Streets and footpaths (type `road`, "Street"): the road network that people walk on and buses
 * and cars drive on (see core/network.js).
 *
 * A street has a carriageway, sidewalks on both sides with a curb, centre dashes on wider
 * streets, zebra crossings near junctions and street lamps (lit at night). Overlapping streets
 * look clean: all sidewalks are drawn first, then all curbs, then all carriageways, and the
 * corners where street ends meet are filled with round patches.
 *
 * Kinds: `street` (50 km/h; the old value `road` means the same), `residential` (30 km/h),
 * `main` (main road, 50 km/h, wider) and `path` (footpath, no cars).
 * @module arail/objects/road
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { dist2, dot2, lerp2, polylineAt, polylineLengths, polylineProject, sub2, unit2 } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";

/** Kinds of streets: label in the editor, speed limit, default carriageway width, cars allowed. */
export const ROAD_KINDS = {
  street: { label: "street (50 km/h)", speed_kmh: 50, width_m: 7, car: true, centreLine: true },
  residential: { label: "residential street (30 km/h)", speed_kmh: 30, width_m: 6, car: true, centreLine: false },
  main: { label: "main road (50 km/h, wider)", speed_kmh: 50, width_m: 10, car: true, centreLine: true },
  path: { label: "footpath (no cars)", speed_kmh: 0, width_m: 3, car: false, centreLine: false },
};

/** Kind of a street spec (old layouts: "road" = street). */
export function roadKind(kind) {
  return kind === "road" || !ROAD_KINDS[kind] ? "street" : kind;
}

/** Neutral greys like the buildings (a white architectural model); footpaths sandy. */
const COLOURS = {
  asphalt: grey(0.36),
  curb: grey(0.88),
  sidewalk: grey(0.7),
  path: PALETTE.sand,
  marking: "#ffffff",
  lamp: grey(0.32),
  light: "#ffe2a0",
  pool: "#ffd98a",
};

/** Drop repeated points. */
function dedupe(points) {
  const out = [];
  for (const p of points) if (!out.length || dist2(p, out[out.length - 1]) > 1e-6) out.push(p);
  return out;
}

/**
 * A polyline offset sideways by `d` (mm, positive = left), with mitred corners.
 * @param {number[][]} pts
 * @param {number} d
 */
export function offsetPolyline(pts, d, limit = 3) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const dIn = i > 0 ? unit2(sub2(pts[i], pts[i - 1])) : null, dOut = i < n - 1 ? unit2(sub2(pts[i + 1], pts[i])) : null;
    const nIn = dIn && [-dIn[1], dIn[0]], nOut = dOut && [-dOut[1], dOut[0]];
    const m = nIn && nOut ? unit2([nIn[0] + nOut[0], nIn[1] + nOut[1]]) : nIn || nOut;
    const f = nIn && nOut ? Math.min(limit, 1 / Math.max(1e-3, dot2(m, nIn))) : 1;
    out.push([pts[i][0] + m[0] * d * f, pts[i][1] + m[1] * d * f]);
  }
  return out;
}

/** Outline of a band of half width `h` along a polyline. */
function band(pts, h) {
  return offsetPolyline(pts, h).concat(offsetPolyline(pts, -h).reverse());
}

/**
 * The same band cut into quads at most `maxLen` (mm) long. They are filled as one path (no
 * seams), and a long street is still drawn when a part of it is behind the camera.
 */
function bandPieces(pts, h, maxLen) {
  const L = offsetPolyline(pts, h), R = offsetPolyline(pts, -h);
  const left = [L[0]], right = [R[0]];
  for (let i = 1; i < pts.length; i++) {
    const k = Math.max(1, Math.ceil(dist2(pts[i - 1], pts[i]) / maxLen));
    for (let j = 1; j < k; j++) {
      left.push(lerp2(L[i - 1], L[i], j / k));
      right.push(lerp2(R[i - 1], R[i], j / k));
    }
    left.push(L[i]);
    right.push(R[i]);
  }
  const out = [];
  for (let i = 1; i < left.length; i++) out.push(ccw([left[i - 1], left[i], right[i], right[i - 1]]));
  return out;
}

/** Rectangle of width `w` from a to b (counter-clockwise). */
function quad(a, b, w) {
  const d = unit2(sub2(b, a)), n = [(-d[1] * w) / 2, (d[0] * w) / 2];
  return [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
}

/** The polygon counter-clockwise: overlapping pieces filled in one path then add up (nonzero rule). */
function ccw(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? poly.reverse() : poly;
}

/** Regular polygon approximating a disc. */
function disc(c, r, n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Polygons of all streets per view and layer (see fillPolygons). */
const LAYERS = new WeakMap();

/**
 * Fill many polygons (pieces of a street, road markings) as one ground item. The pieces of all
 * streets in the same layer (order, colour, alpha) are filled together, in one path: where
 * streets overlap (junctions) the semi-transparent asphalt is not darker than elsewhere.
 */
function fillPolygons(view, quads, colour, order, alpha = 0.92) {
  if (!quads.length) return;
  const img = [];
  for (const q of quads) {
    const p = view.projectAll(q);
    if (p) img.push(p);
  }
  if (!img.length) return;
  let layers = LAYERS.get(view);
  if (!layers) LAYERS.set(view, (layers = new Map()));
  const key = `${order}|${colour}|${alpha}`;
  const batch = layers.get(key);
  if (batch && !batch.drawn) {
    for (const p of img) batch.polys.push(p);
    return;
  }
  const b = { polys: img, drawn: false };
  layers.set(key, b);
  view.ground(order, (ctx) => {
    b.drawn = true;
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = view.dim(colour);
    ctx.beginPath();
    for (const p of b.polys) {
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
    }
    ctx.fill();
  });
}

/**
 * A street lamp: post, arm and lamp head; at night a glow and a pool of light on the ground.
 * @param {import("../core/view.js").View} view
 * @param {number[]} pos foot (layout mm)
 * @param {number[]} arm unit vector from the post towards the street
 */
export function drawStreetLamp(view, pos, arm) {
  const H = view.m(5.5), reach = view.m(1.3);
  const head = [pos[0] + arm[0] * reach, pos[1] + arm[1] * reach, H];
  const px = view.pxPerMM(pos[0], pos[1], H / 2) * H;
  if (px > 7) {
    const foot = view.project(pos[0], pos[1], 0), top = view.project(pos[0], pos[1], H), end = view.project(head[0], head[1], H);
    if (foot && top && end) {
      view.solid(view.depth(pos[0], pos[1], H / 2), (ctx) => {
        ctx.strokeStyle = view.dim(COLOURS.lamp);
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1, px * 0.025);
        ctx.beginPath();
        ctx.moveTo(foot[0], foot[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.lineTo(end[0], end[1]);
        ctx.stroke();
        ctx.lineWidth = Math.max(1.5, px * 0.05);
        ctx.strokeStyle = view.darkness > 0.3 ? COLOURS.light : view.dim(grey(0.85));
        ctx.beginPath();
        ctx.moveTo(end[0] - (end[0] - top[0]) * 0.35, end[1] - (end[1] - top[1]) * 0.35);
        ctx.lineTo(end[0], end[1]);
        ctx.stroke();
      });
    }
  }
  view.glow(head, view.m(2.2), COLOURS.light, 0.85);
  view.lightPool([head[0], head[1]], view.m(7), COLOURS.pool, 0.55);
}

export class Road extends LayoutObject {
  static type = "road";
  static label = "Street";
  static category = "Transport";
  static placement = "polyline";
  static description = "A street with sidewalks (or a footpath) along a line. Streets that meet or cross are connected; buses and cars drive on them, people walk on the sidewalks.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(ROAD_KINDS).map(([k, v]) => [k, v.label]), default: "street" },
    {
      key: "width_m", label: "Width", type: "number", unit: "m", min: 1, max: 30, step: 0.5,
      help: "Of the carriageway (of the path for footpaths). Empty = by kind: 7 m street, 6 m residential street, 10 m main road, 3 m footpath.",
    },
    { key: "sidewalk_m", label: "Sidewalks", type: "number", unit: "m", min: 0, max: 8, step: 0.5, default: 2.5, help: "Width on each side; 0 = none. Footpaths have none." },
    { key: "speed_kmh", label: "Speed limit", type: "number", unit: "km/h", min: 5, max: 130, step: 5, help: "Empty = by kind." },
    { key: "lamps", label: "Street lamps", type: "boolean", default: true },
    { key: "crossings", label: "Zebra crossings at junctions", type: "boolean", default: true },
  ];

  computeGeometry() {
    const raw = resolvePoints(this.world.map, this.spec.points);
    const points = raw ? dedupe(raw) : [];
    if (points.length < 2) return null;
    const kind = roadKind(this.spec.kind), K = ROAD_KINDS[kind];
    const width = this.mm(+this.spec.width_m > 0 ? +this.spec.width_m : K.width_m);
    const sidewalk = K.car ? this.mm(Math.max(0, Number(this.spec.sidewalk_m) || 0)) : 0;
    const lengths = polylineLengths(points), h = width / 2;
    return {
      points, lengths, length: lengths[lengths.length - 1], kind, car: K.car, width, sidewalk,
      carriage: bandPieces(points, h, this.mm(25)),
      curb: K.car ? bandPieces(points, h + this.mm(0.25), this.mm(25)) : null,
      outer: sidewalk > 0 ? bandPieces(points, h + sidewalk, this.mm(25)) : null,
      footprint: band(points, h + sidewalk),
      dashes: K.centreLine && width >= this.mm(5.5) ? this._dashes(points, lengths) : [],
      lamps: this.spec.lamps !== false ? this._lamps(points, lengths, h, sidewalk, K.car) : [],
    };
  }

  /** Centre line: 3 m dashes, 6 m gaps. */
  _dashes(points, lengths) {
    const L = lengths[lengths.length - 1], dash = this.mm(3), gap = this.mm(6), w = this.mm(0.12), out = [];
    for (let s = gap / 2; s + dash < L; s += dash + gap) out.push(quad(polylineAt(points, s, lengths).point, polylineAt(points, s + dash, lengths).point, w));
    return out;
  }

  /** Street lamps every 30 m on each side (staggered), at the outer edge of the sidewalk. */
  _lamps(points, lengths, h, sidewalk, car) {
    const L = lengths[lengths.length - 1], every = this.mm(15), out = [];
    const inset = sidewalk > 0 ? h + sidewalk - this.mm(0.6) : h + this.mm(0.6);
    let k = 0;
    for (let s = every; s < L - every / 3; s += every, k++) {
      if (!car && k % 2) continue;
      const side = car && k % 2 ? 1 : -1;
      const at = polylineAt(points, s, lengths);
      const n = [-at.dir[1], at.dir[0]];
      out.push({ pos: [at.point[0] + n[0] * inset * side, at.point[1] + n[1] * inset * side], arm: [-n[0] * side, -n[1] * side], s });
    }
    return out;
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    const g = this.geometry;
    return g ? polylineAt(g.points, g.length / 2, g.lengths).point : null;
  }

  /**
   * What the road network needs to know (see core/network.js).
   * @returns {{points: number[][], kind: string, car: boolean, walk: boolean, width: number, sidewalk: number,
   *   speed: number, walkOffset: number, laneOffset: number} | null} widths and offsets in mm, speed in m/s
   */
  roadInfo() {
    const g = this.geometry;
    if (!g) return null;
    const K = ROAD_KINDS[g.kind];
    const kmh = Number(this.spec.speed_kmh) > 0 ? Number(this.spec.speed_kmh) : K.speed_kmh;
    return {
      points: g.points, kind: g.kind, car: g.car, walk: true, width: g.width, sidewalk: g.sidewalk,
      speed: g.car ? kmh / 3.6 : 1.3,
      walkOffset: g.car ? (g.sidewalk > 0 ? g.width / 2 + g.sidewalk / 2 : g.width / 2 - this.mm(0.6)) : 0,
      laneOffset: g.car && g.width >= this.mm(5) ? g.width / 4 : 0,
    };
  }

  /**
   * Junction details from the road network (cached until it changes): round patches where
   * street ends meet, zebra crossings next to junctions, lamps that are not on a junction.
   */
  _junctions() {
    const g = this.geometry;
    let net = null;
    try {
      net = this.world.network?.() || null;
    } catch {
      net = null;
    }
    if (this._jc && this._jc.net === net && this._jc.g === g) return this._jc;
    const jc = { net, g, patches: [], zebras: [], lamps: g.lamps };
    this._jc = jc;
    if (!net) return jc;
    const mm = (m) => this.mm(m), h = g.width / 2;
    const roadsAt = (n) => {
      const by = new Map();
      for (const id of n.edges) {
        const e = net.edges[id];
        if (e.kind !== "road" && e.kind !== "path") continue;
        by.set(e.road, (by.get(e.road) || 0) + 1);
      }
      return by;
    };
    const busy = [];
    for (const n of net.nodes) {
      if (n.degree < 2) continue;
      const by = roadsAt(n);
      if (!by.has(this.id) || by.size < 2) continue;
      let reach = 0;
      for (const id of by.keys()) {
        const o = this.world.getObject(id), info = o?.roadInfo?.();
        if (info) reach = Math.max(reach, info.width / 2 + info.sidewalk);
      }
      busy.push({ pos: n.pos, r: reach + mm(1) });
      // all streets end here (corner or fork): fill the corner
      if ([...by.values()].every((k) => k === 1)) jc.patches.push(n.pos);
      // zebra crossings on this street, a little away from the junction
      if (this.spec.crossings === false || !g.car || n.degree < 3) continue;
      const pr = polylineProject(g.points, n.pos, g.lengths);
      const len = mm(4), d0 = reach + mm(1.5);
      for (const sign of [-1, 1]) {
        const s0 = pr.s + sign * d0, s1 = pr.s + sign * (d0 + len);
        if (Math.min(s0, s1) < mm(1) || Math.max(s0, s1) > g.length - mm(1)) continue;
        const a = polylineAt(g.points, s0, g.lengths), b = polylineAt(g.points, s1, g.lengths);
        const nrm = [-a.dir[1], a.dir[0]];
        for (let t = -h + mm(0.75); t <= h - mm(0.5); t += mm(1)) {
          const off = (p) => [p[0] + nrm[0] * t, p[1] + nrm[1] * t];
          jc.zebras.push(quad(off(a.point), off(b.point), mm(0.5)));
        }
      }
    }
    jc.lamps = g.lamps.filter((l) => !busy.some((b) => dist2(l.pos, b.pos) < b.r));
    return jc;
  }

  draw(view) {
    const g = this.geometry;
    const jc = this._junctions();
    if (!g.car) {
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, g.width / 2))), COLOURS.path, 1.02, 0.85);
    } else {
      const h = g.width / 2;
      if (g.outer) fillPolygons(view, g.outer.concat(jc.patches.map((p) => disc(p, h + g.sidewalk))), COLOURS.sidewalk, 1.0, 0.9);
      fillPolygons(view, g.curb.concat(jc.patches.map((p) => disc(p, h + this.mm(0.25)))), COLOURS.curb, 1.05, 0.95);
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, h))), COLOURS.asphalt, 1.1, 0.95);
      fillPolygons(view, g.dashes, COLOURS.marking, 1.2, 0.85);
      fillPolygons(view, jc.zebras, COLOURS.marking, 1.2, 0.9);
    }
    for (const l of jc.lamps) if (view.inImage(l.pos[0], l.pos[1], 0, 80)) drawStreetLamp(view, l.pos, l.arm);
  }
}
