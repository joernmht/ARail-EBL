/**
 * Streets, footpaths and tram tracks (type `road`, "Street"): the road network that people walk on
 * and buses, cars, bikes and trams drive on (see core/network.js).
 *
 * A street has a cross-section (objects/street-profile.js): car lanes, and by its profile
 * sidewalks, bike lanes on the street (dashed or solid line), bike paths at sidewalk level or shared
 * foot and bike paths; tram tracks in the car lanes, in lanes of their own or on a track bed of their
 * own in the middle; street parking on one or both sides. It is drawn strip by strip: the side
 * spaces, the curbs, the carriageway, then the bike lanes, parking strips, tram lanes and track
 * bed, the rails and the markings (centre line, lane lines, the solid or dashed line of a bike lane,
 * parking spaces, zebra crossings near junctions). Street lamps stand at the edge (lit at night);
 * a bike can be locked to each of them. Overlapping streets look clean: all side spaces are drawn
 * first, then all curbs, then all carriageways, and the corners where street ends meet are filled
 * with round patches; the strips stop short of junctions.
 *
 * Kinds: `street` (50 km/h; the old value `road` means the same), `residential` (30 km/h),
 * `main` (main road, 50 km/h, wider), `path` (footpath, no cars; or a shared foot and bike path, or
 * a bike path), `pedestrian` (a pedestrian zone, Fußgängerzone: paved from house to house, no cars,
 * bikes only where allowed, trams may run through it; Zeichen 242.1 where it begins) and `tram` (a
 * tram track of its own, away from the streets).
 *
 * A street whose end meets no other street leads out of the layout: cars come and go there. A
 * **dead end** (Sackgasse, `dead_end`) ends in the layout instead: it has a turning circle
 * (Wendekreis) or a turning hammer (Wendehammer) there, vehicles turn round in it, and Zeichen 357
 * stands where the street begins.
 * @module arail/objects/road
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { clamp, dist2, dot2, lerp2, polylineAt, polylineLengths, polylineProject, sub2, unit2 } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";
import { NORMS, PARKING_LAYOUTS, PATH_PROFILES, STREET_PROFILES, TRAM_LAYOUTS, TRAM_TRACKS, crossSection, profileOf, widthChoices } from "./street-profile.js";
import { drawSign } from "./signs.js";
import { TARIFFS, Tariff } from "./parking.js";
import { CROSSING_NORMS, interpolate } from "../core/elevation.js";
import { rectFootprint } from "../core/view.js";

/** Kinds of streets: label in the editor, speed limit, default width of the car lanes (of the path, of the track bed), cars allowed. */
export const ROAD_KINDS = {
  street: { label: "street (50 km/h)", speed_kmh: 50, width_m: 7, car: true, centreLine: true },
  residential: { label: "residential street (30 km/h)", speed_kmh: 30, width_m: 6, car: true, centreLine: false },
  main: { label: "main road (50 km/h, wider)", speed_kmh: 50, width_m: 10, car: true, centreLine: true },
  path: { label: "footpath (no cars)", speed_kmh: 0, width_m: 3, car: false, centreLine: false },
  pedestrian: { label: "pedestrian zone (no cars)", speed_kmh: 20, width_m: NORMS.zone.default, car: false, centreLine: false },
  tram: { label: "tram track of its own (no street)", speed_kmh: 60, width_m: NORMS.tram.bedDouble, car: false, centreLine: false },
};

/** Where a street is a dead end (Sackgasse): none (its free ends lead out of the layout), at its last or first point, at both. */
export const DEAD_ENDS = {
  none: { label: "none: its free ends lead out of the layout", ends: [false, false] },
  end: { label: "at its last point", ends: [false, true] },
  start: { label: "at its first point", ends: [true, false] },
  both: { label: "at both ends", ends: [true, true] },
};

/**
 * Turning areas at a dead end (RASt 06, Wendeanlagen): a turning circle (Wendekreis) of `turning_m`
 * across, or a turning hammer (Wendehammer) as wide across the street; or none (only cars turn,
 * backing up).
 */
export const TURNING_AREAS = {
  circle: { label: "turning circle (Wendekreis)" },
  hammer: { label: "turning hammer (Wendehammer)" },
  none: { label: "none" },
};

/**
 * Size of a turning area (m, curb to curb): 22 m across give a three-axle refuse truck room to turn in
 * one go; a bus needs about 25 m, a car 12 m.
 */
export const TURNING_M = { default: 22, values: [12, 18, 22, 25] };

/** Which ends of a street spec are dead ends: [first point, last point]. Only streets for cars have them. */
export function deadEnds(spec = {}) {
  if (!ROAD_KINDS[roadKind(spec.kind)].car) return [false, false];
  return (DEAD_ENDS[spec.dead_end] || DEAD_ENDS.none).ends.slice();
}

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
  parking: grey(0.42),
  buffer: grey(0.62),
  paving: grey(0.58),
};

/**
 * The colour of a strip of a cross-section (objects/street-profile.js) as streets are drawn, for
 * figures of a cross-section (the builder). `kind`: the street's kind (a footpath is sandy).
 */
export function stripColour(strip, kind = "street") {
  switch (strip.type) {
    case "bike-lane":
      return PALETTE.bikeLane;
    case "bike-path":
      return PALETTE.bikePath;
    case "parking":
      return COLOURS.parking;
    case "tram-bed":
      return PALETTE.tramBed;
    case "curb":
      return COLOURS.curb;
    case "path":
      return COLOURS.path;
    case "zone":
      return PALETTE.plaza;
    case "shared-path":
      return kind === "path" ? COLOURS.path : COLOURS.sidewalk;
    case "sidewalk":
      return COLOURS.sidewalk;
    case "buffer":
      return strip.level === "sidewalk" ? COLOURS.buffer : COLOURS.asphalt;
    default:
      return COLOURS.asphalt; // car lanes, tram lanes, advisory bike lanes
  }
}

/** Rail gauge (m) and the colour of the rails; Dresden's trams run on 1450 mm, most others on 1435 mm. */
export const GAUGE_M = 1.435;

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
 * Quads between two offset lines `a` and `b` (mm, + = left) along a polyline, at most `maxLen` (mm)
 * long. They are filled as one path (no seams), and a long street is still drawn when a part of it
 * is behind the camera.
 */
function stripPieces(pts, a, b, maxLen) {
  if (pts.length < 2) return [];
  const L = offsetPolyline(pts, a), R = offsetPolyline(pts, b);
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

/** The band of half width `h` cut into quads (see stripPieces). */
function bandPieces(pts, h, maxLen) {
  return stripPieces(pts, h, -h, maxLen);
}

/** The part of a polyline between two arc lengths (mm). */
export function slicePolyline(pts, lengths, s0, s1) {
  const out = [polylineAt(pts, s0, lengths).point];
  for (let i = 1; i < pts.length - 1; i++) if (lengths[i] > s0 + 1e-6 && lengths[i] < s1 - 1e-6) out.push(pts[i]);
  out.push(polylineAt(pts, s1, lengths).point);
  return dedupe(out);
}

/** Dashes (quads `w` wide) along the line `o` (mm, + = left) of a polyline: `dash` long, `gap` apart; solid without a gap. */
function dashes(pts, lengths, ranges, o, w, dash, gap) {
  const out = [];
  for (const [s0, s1] of ranges) {
    if (!gap) {
      const part = slicePolyline(pts, lengths, s0, s1);
      if (part.length >= 2) out.push(...stripPieces(part, o + w / 2, o - w / 2, Infinity));
      continue;
    }
    for (let s = s0 + gap / 2; s + dash <= s1; s += dash + gap) {
      const a = polylineAt(pts, s, lengths), b = polylineAt(pts, s + dash, lengths);
      const n = [-a.dir[1], a.dir[0]], m = [-b.dir[1], b.dir[0]];
      out.push(ccw([
        [a.point[0] + n[0] * (o - w / 2), a.point[1] + n[1] * (o - w / 2)], [b.point[0] + m[0] * (o - w / 2), b.point[1] + m[1] * (o - w / 2)],
        [b.point[0] + m[0] * (o + w / 2), b.point[1] + m[1] * (o + w / 2)], [a.point[0] + n[0] * (o + w / 2), a.point[1] + n[1] * (o + w / 2)],
      ]));
    }
  }
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

/** Labels of the settings' choices. */
const options = (table) => Object.entries(table).map(([k, v]) => [k, v.label]);
const isCarKind = (v) => !v.kind || ROAD_KINDS[roadKind(v.kind)].car;
const isPath = (v) => v.kind === "path";
const isTram = (v) => v.kind === "tram";
const isZone = (v) => v.kind === "pedestrian";
const hasDeadEnd = (v) => isCarKind(v) && !!v.dead_end && v.dead_end !== "none";
/** Tram tracks through a pedestrian zone lie in its paving. */
const ZONE_TRAM = [["none", "no tram"], ["street", "in the paving, through the pedestrian zone"]];
const profileOfValues = (v) => profileOf({ ...v, kind: roadKind(v.kind) });

export class Road extends LayoutObject {
  static type = "road";
  static label = "Street";
  static category = "Transport";
  static placement = "polyline";
  static description = "A street along a line: car lanes, and by its cross-section sidewalks, bike lanes or bike paths, tram tracks and parking; or a footpath, a pedestrian zone or a tram track of its own. Streets that meet or cross are connected; buses, cars, bikes and trams drive on them, people walk on the sidewalks. An end that meets no other street leads out of the layout, unless the street is a dead end there.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: options(ROAD_KINDS), default: "street" },
    {
      key: "profile", label: "Cross-section", type: "select",
      options: (v) => options(isPath(v) ? PATH_PROFILES : STREET_PROFILES), when: (v) => !isTram(v) && !isZone(v),
      help: "What lies beside the car lanes. Bike lanes and bike paths make the street wider.",
    },
    {
      key: "width_m", label: "Width", type: "number", unit: "m", min: 1, max: 30, step: 0.05,
      presets: (v) => widthChoices("width_m", { ...v, kind: roadKind(v.kind) }),
      help: "Of the car lanes together (of the path for footpaths, from house to house for a pedestrian zone, of the track bed for tram tracks). Empty = by kind: 7 m street, 6 m residential street, 10 m main road, 3 m footpath, 12 m pedestrian zone, 6.6 m tram track.",
    },
    { key: "lanes", label: "Lanes each way", type: "number", min: 1, max: 3, step: 1, default: 1, when: isCarKind },
    {
      key: "sidewalk_m", label: "Sidewalks", type: "number", unit: "m", min: 0, max: 8, step: 0.05, default: 2.5,
      presets: () => widthChoices("sidewalk_m"), when: (v) => isCarKind(v) && !["plain", "shared-paths"].includes(profileOfValues(v)),
      help: "Width on each side (RASt 06: 2.50 m); 0 = none.",
    },
    {
      key: "bike_m", label: "Bike lanes or paths", type: "number", unit: "m", min: 0.5, max: 6, step: 0.05,
      presets: (v) => widthChoices("bike_m", { ...v, kind: roadKind(v.kind) }),
      when: (v) => isCarKind(v) && !["plain", "sidewalks"].includes(profileOfValues(v)),
      help: "Width on each side. Empty = the regular width (ERA 2010): advisory lane 1.50 m, bike lane 1.85 m, bike path 2.00 m, shared path 2.50 m.",
    },
    { key: "bikes", label: "Bikes allowed", type: "boolean", default: false, when: isZone, help: "Radverkehr frei: bikes ride through the pedestrian zone at walking pace." },
    { key: "tram", label: "Tram tracks", type: "select", options: (v) => (isZone(v) ? ZONE_TRAM : options(TRAM_LAYOUTS)), default: "none", when: (v) => isCarKind(v) || isZone(v) },
    { key: "tram_tracks", label: "Tracks", type: "select", options: options(TRAM_TRACKS), default: "double", when: (v) => isTram(v) || ((isCarKind(v) || isZone(v)) && v.tram && v.tram !== "none") },
    { key: "parking", label: "Street parking", type: "select", options: options(PARKING_LAYOUTS), default: "none", when: isCarKind },
    { key: "parking_sides", label: "Parking on", type: "select", options: [["both", "both sides"], ["right", "right side"], ["left", "left side"]], default: "both", when: (v) => isCarKind(v) && v.parking && v.parking !== "none" },
    { key: "parking_tariff", label: "Parking costs", type: "select", options: options(TARIFFS), default: "free", when: (v) => isCarKind(v) && v.parking && v.parking !== "none" },
    { key: "parking_price_eur", label: "Price", type: "number", unit: "€", min: 0, max: 2000, step: 0.1, when: (v) => isCarKind(v) && v.parking && v.parking !== "none" && v.parking_tariff && v.parking_tariff !== "free", help: "Per hour, day, week or year, as chosen. Empty = a usual price." },
    { key: "speed_kmh", label: "Speed limit", type: "number", unit: "km/h", min: 5, max: 130, step: 5, help: "Empty = by kind. In a pedestrian zone: of the trams (20 km/h)." },
    {
      key: "dead_end", label: "Dead end", type: "select", options: options(DEAD_ENDS), default: "none", when: isCarKind,
      help: "A free end of a street leads out of the layout: cars come and go there. A dead end (Sackgasse) ends in the layout: vehicles turn round there.",
    },
    { key: "turning", label: "Turning area", type: "select", options: options(TURNING_AREAS), default: "circle", when: hasDeadEnd },
    {
      key: "turning_m", label: "Turning area size", type: "number", unit: "m", min: 8, max: 40, step: 0.5, presets: () => TURNING_M.values,
      when: (v) => hasDeadEnd(v) && v.turning !== "none", help: "Across, curb to curb: 22 m for a refuse truck, 25 m for a bus, 12 m for cars.",
    },
    { key: "lamps", label: "Street lamps", type: "boolean", default: true },
    { key: "crossings", label: "Zebra crossings at junctions", type: "boolean", default: true, when: isCarKind },
  ];

  constructor(world, spec) {
    super(world, spec);
    // the profile of an old street follows from its sidewalks; it is written only once it is chosen
    if (!this._explicit.has("profile")) this.spec.profile = profileOf({ ...this.spec, kind: roadKind(this.spec.kind) });
  }

  set(patch) {
    // a street becomes a footpath (or back): its profile follows unless chosen for that kind
    if ("kind" in patch && !("profile" in patch)) {
      const next = { ...this.spec, ...patch, kind: roadKind(patch.kind) };
      const table = next.kind === "path" ? PATH_PROFILES : STREET_PROFILES;
      if (!table[this.spec.profile]) patch = { ...patch, profile: next.kind === "path" ? "plain" : "sidewalks" };
    }
    super.set(patch);
  }

  toJSON() {
    const out = super.toJSON();
    if (!this._explicit.has("profile")) delete out.profile;
    return out;
  }

  /** The cross-section in prototype metres (objects/street-profile.js). */
  crossSection() {
    const kind = roadKind(this.spec.kind);
    return crossSection({ ...this.spec, kind }, ROAD_KINDS[kind]);
  }

  computeGeometry() {
    const raw = resolvePoints(this.world.map, this.spec.points);
    const points = raw ? dedupe(raw) : [];
    if (points.length < 2) return null;
    const kind = roadKind(this.spec.kind), K = ROAD_KINDS[kind];
    const xs = this.crossSection();
    const mm = (m) => this.mm(m);
    const lengths = polylineLengths(points), L = lengths[lengths.length - 1];
    const width = mm(xs.carriageway), half = mm(xs.half), h = width / 2;
    const sidewalk = K.car ? mm(xs.sidewalk) : 0;
    const piece = mm(25), zone = kind === "pedestrian";
    return {
      points, lengths, length: L, kind, car: K.car, xs, width, half, sidewalk,
      carriage: kind === "tram" ? [] : bandPieces(points, h, piece),
      bed: kind === "tram" ? bandPieces(points, h, piece) : [],
      curb: K.car ? bandPieces(points, h + mm(0.25), piece) : null,
      outer: sidewalk > 0 ? bandPieces(points, half, piece) : null,
      footprint: band(points, Math.max(half, mm(1))),
      // a pedestrian zone has its lamps on both sides, a metre from the houses
      lamps: this.spec.lamps !== false && kind !== "tram" ? this._lamps(points, lengths, zone ? h - mm(1.6) : h, sidewalk, K.car || zone) : [],
      turnings: K.car ? this._turnings(points, width) : [],
    };
  }

  /**
   * The turning areas at the dead ends: [{end (0: first point, 1: last), pos, out (unit vector out
   * of the street), kind ("circle" or "hammer"), size (mm across, curb to curb)}].
   * @param {number} width the carriageway (mm): a turning area is never narrower
   */
  _turnings(points, width) {
    const kind = TURNING_AREAS[this.spec.turning] ? this.spec.turning : "circle";
    if (kind === "none") return [];
    const size = Math.max(this.mm(clamp(Number(this.spec.turning_m) > 0 ? +this.spec.turning_m : TURNING_M.default, 8, 40)), width);
    const out = [], n = points.length;
    deadEnds(this.spec).forEach((dead, end) => {
      if (!dead) return;
      const p = end ? points[n - 1] : points[0], q = end ? points[n - 2] : points[1];
      out.push({ end, pos: p, out: unit2(sub2(p, q)), kind, size });
    });
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
      out.push({ pos: [at.point[0] + n[0] * inset * side, at.point[1] + n[1] * inset * side], arm: [-n[0] * side, -n[1] * side], s, side });
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

  /** The card: the kind of street, its cross-section and widths, its length and speed limit. */
  card() {
    const card = super.card();
    const g = this.geometry;
    if (!g) return card;
    const xs = g.xs, m1 = (v) => Math.round(v * 100) / 100;
    card.rows.push(["Kind", ROAD_KINDS[g.kind]?.label ?? g.kind]);
    card.rows.push(["Length", `${Math.round(this.meters(g.length))} m`]);
    if (g.kind === "tram") card.rows.push(["Track bed", `${m1(xs.tramBed)} m`], ["Tracks", TRAM_TRACKS[xs.tramTracks].label]);
    else if (g.kind === "pedestrian") {
      card.rows.push(["Width", `${m1(xs.half * 2)} m`]);
      card.rows.push(["Bikes", xs.bike === "zone" ? "allowed, at walking pace" : "not allowed"]);
      if (xs.tram !== "none") card.rows.push(["Tram tracks", TRAM_TRACKS[xs.tramTracks].label], ["Speed limit", `${Math.round((this.roadInfo()?.speed ?? 0) * 3.6)} km/h`]);
    } else {
      const P = (g.kind === "path" ? PATH_PROFILES : STREET_PROFILES)[xs.profile];
      card.rows.push(["Cross-section", P?.label ?? xs.profile]);
      card.rows.push(["Width", `${m1(xs.half * 2)} m`]);
      if (g.car) {
        card.rows.push(["Car lanes", `${xs.lanes * 2} × ${m1(xs.laneWidth)} m`]);
        if (xs.bikeWidth > 0) card.rows.push([xs.bike === "shared" ? "Shared paths" : xs.bike === "path" ? "Bike paths" : "Bike lanes", `${m1(xs.bikeWidth)} m`]);
        if (xs.sidewalk > 0 && xs.bike !== "shared") card.rows.push(["Sidewalks", `${m1(this.spec.sidewalk_m > 0 ? +this.spec.sidewalk_m : NORMS.sidewalk.default)} m`]);
        if (xs.tram !== "none") card.rows.push(["Tram tracks", TRAM_LAYOUTS[xs.tram].label], ["Tracks", TRAM_TRACKS[xs.tramTracks].label]);
        const parking = this.parkingInfo();
        const spaces = parking.reduce((s, f) => s + f.spaces, 0);
        if (parking.length) card.rows.push(["Parking", `${spaces} ${spaces === 1 ? "space" : "spaces"} · ${parking[0].tariff.label()}`]);
        card.rows.push(["Speed limit", `${Math.round((this.roadInfo()?.speed ?? 0) * 3.6)} km/h`]);
        if (xs.obstruct) card.rows.push(["Bikes", "hold up the cars behind them (too narrow to pass at 1.5 m)"]);
        if (this.spec.dead_end && DEAD_ENDS[this.spec.dead_end] && this.spec.dead_end !== "none") {
          const t = g.turnings[0];
          card.rows.push(["Dead end", t ? `${DEAD_ENDS[this.spec.dead_end].label} · ${TURNING_AREAS[t.kind].label} · ${m1(this.meters(t.size))} m` : DEAD_ENDS[this.spec.dead_end].label]);
        }
      }
    }
    if (xs.warnings.length) card.sections = [...(card.sections || []), { title: "Below the guidelines", lines: xs.warnings }];
    return card;
  }

  /**
   * What is wrong with the street (shown in the editor): widths below the minimum of the guidelines,
   * and its heights (core/elevation.js): a ramp that reaches into a junction, an end in the air.
   */
  problems() {
    const g = this.geometry;
    if (!g) return [];
    return [...g.xs.warnings, ...this.world.elevation.streetProblems(this.id)];
  }

  /**
   * What the road network needs to know (see core/network.js).
   * @returns {object | null} {points, kind, car, walk, bike, width, half, sidewalk, speed, walkOffset,
   *   laneOffset, bikeOffset, bikeWidth, obstruct, conflict, tram, tramTracks, tramOffset, lanes,
   *   deadEnds}: widths and offsets in mm, speed in m/s; `bike`: what bikes get ("road", "advisory",
   *   "lane", "path", "shared", "zone": a pedestrian zone at walking pace, "none"); `tram`: where the
   *   tracks lie ("none", "street", "lanes", "median", "own"); `deadEnds`: [first point, last point]
   *   are dead ends (vehicles turn there, nobody comes from beyond the layout)
   */
  roadInfo() {
    const g = this.geometry;
    if (!g) return null;
    const K = ROAD_KINDS[g.kind], xs = g.xs, mm = (m) => this.mm(m);
    const kmh = Number(this.spec.speed_kmh) > 0 ? Number(this.spec.speed_kmh) : K.speed_kmh;
    const tram = g.kind === "tram", tracks = g.kind === "pedestrian" && xs.tram !== "none";
    const walk = tram ? false : g.kind === "path" ? PATH_PROFILES[xs.profile]?.walk !== false : true;
    // a narrow street has one lane for both directions: vehicles keep to its middle
    const oneLane = g.car && xs.carWidth < 5 && (xs.tram === "none" || xs.tram === "street");
    return {
      points: g.points, kind: g.kind, car: g.car, walk, bike: xs.bike, width: g.width, half: g.half, sidewalk: g.sidewalk,
      speed: g.car || tram || tracks ? kmh / 3.6 : 1.3,
      walkOffset: g.car || g.kind === "pedestrian" ? mm(xs.walkOffset) : 0,
      laneOffset: oneLane ? 0 : g.car ? mm(xs.laneOffset) : 0,
      bikeOffset: mm(xs.bikeOffset), bikeWidth: mm(xs.bikeWidth), obstruct: xs.obstruct, conflict: xs.conflict,
      tram: xs.tram, tramTracks: xs.tramTracks, tramOffset: mm(xs.tramOffset), lanes: xs.lanes,
      deadEnds: deadEnds(this.spec),
    };
  }

  /* ---------------------------------------------------------------- junctions, parking, bikes */

  /**
   * Junction details from the road network (cached until it changes): round patches where
   * street ends meet, zebra crossings next to junctions, the stretches the strips are drawn on
   * (they stop short of junctions), lamps that are not on a junction, the turning areas of the dead
   * ends that meet no other street, and the signs where a dead end or a pedestrian zone begins.
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
    const jc = { net, g, patches: [], zebras: [], lamps: g.lamps, busy: [], ranges: [[0, g.length]], turnings: g.turnings, signs: [] };
    this._jc = jc;
    if (!net) {
      jc.strips = this._strips(g, jc.ranges);
      return jc;
    }
    const mm = (m) => this.mm(m), h = g.width / 2;
    const roadsAt = (n) => {
      const by = new Map();
      for (const id of n.edges) {
        const e = net.edges[id];
        if ((e.kind !== "road" && e.kind !== "path" && e.kind !== "tram") || e.hidden) continue; // not an underpass
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
        if (id === this.id) continue;
        const o = this.world.getObject(id), info = o?.roadInfo?.();
        if (info) reach = Math.max(reach, info.half ?? info.width / 2 + info.sidewalk);
      }
      busy.push({ pos: n.pos, r: reach + mm(1), s: polylineProject(g.points, n.pos, g.lengths).s });
      // all streets end here (corner or fork): fill the corner
      if ([...by.values()].every((k) => k === 1)) jc.patches.push(n.pos);
      // zebra crossings on this street, a little away from the junction
      if (this.spec.crossings === false || !g.car || n.degree < 3) continue;
      const s0n = busy[busy.length - 1].s;
      const len = mm(4), d0 = reach + mm(1.5);
      for (const sign of [-1, 1]) {
        const s0 = s0n + sign * d0, s1 = s0n + sign * (d0 + len);
        if (Math.min(s0, s1) < mm(1) || Math.max(s0, s1) > g.length - mm(1)) continue;
        const a = polylineAt(g.points, s0, g.lengths), b = polylineAt(g.points, s1, g.lengths);
        const nrm = [-a.dir[1], a.dir[0]];
        for (let t = -h + mm(0.75); t <= h - mm(0.5); t += mm(1)) {
          const off = (p) => [p[0] + nrm[0] * t, p[1] + nrm[1] * t];
          jc.zebras.push(quad(off(a.point), off(b.point), mm(0.5)));
        }
      }
    }
    jc.busy = busy;
    jc.lamps = g.lamps.filter((l) => !busy.some((b) => dist2(l.pos, b.pos) < b.r));
    // the strips stop short of junctions
    const cut = busy.map((b) => [b.s - b.r, b.s + b.r]).sort((a, b) => a[0] - b[0]);
    const ranges = [];
    let s = 0;
    for (const [a, b] of cut) {
      if (a > s + mm(1)) ranges.push([s, Math.min(a, g.length)]);
      s = Math.max(s, b);
    }
    if (s < g.length - mm(1)) ranges.push([s, g.length]);
    jc.ranges = ranges;
    jc.strips = this._strips(g, ranges);
    // the ends: a dead end turns where it meets no other street for cars (a footpath may go on from
    // it); signs where the street begins
    const own = net.roadEdges.get(this.id) || [];
    const ends = own.length ? [net.nodes[own[0].edge.a], net.nodes[own[own.length - 1].edge.b]] : [null, null];
    jc.turnings = g.turnings.filter((t) => !ends[t.end] || ends[t.end].carDegree <= 1);
    const sign = (end, key, plate = "") => {
      const node = ends[end];
      if (!node || (g.car ? node.carDegree : node.degree) < 2) return;
      const d = (busy.find((b) => dist2(b.pos, node.pos) < mm(1))?.r ?? mm(2)) + mm(1.5);
      if (d >= g.length / 2) return;
      const at = polylineAt(g.points, end ? g.length - d : d, g.lengths);
      // on the right of the traffic coming in from that end
      const into = end ? [-at.dir[0], -at.dir[1]] : at.dir, inset = g.half - mm(0.4);
      jc.signs.push({ key, plate, pos: [at.point[0] + into[1] * inset, at.point[1] - into[0] * inset] });
    };
    const dead = deadEnds(this.spec);
    if (dead[0] !== dead[1]) sign(dead[0] ? 1 : 0, "dead-end");
    if (g.kind === "pedestrian") for (const end of [0, 1]) sign(end, "pedestrian-zone", "ZONE");
    return jc;
  }

  /**
   * The strips drawn over the carriageway and the side spaces, as quads by colour, and the
   * markings: {fills: [{colour, order, alpha, quads}], marks: quads, rails: polylines}.
   */
  _strips(g, ranges) {
    const xs = g.xs, mm = (m) => this.mm(m), P = g.points, Ls = g.lengths, piece = mm(25);
    const fills = new Map(), marks = [], rails = [];
    const fill = (colour, order, alpha, quads) => {
      const key = `${colour}|${order}|${alpha}`;
      if (!fills.has(key)) fills.set(key, { colour, order, alpha, quads: [] });
      fills.get(key).quads.push(...quads);
    };
    const parts = ranges.map(([s0, s1]) => slicePolyline(P, Ls, s0, s1)).filter((p) => p.length >= 2);
    const strip = (st, colour, order, alpha = 0.9) => {
      for (const part of parts) fill(colour, order, alpha, stripPieces(part, st.side * mm(st.from), st.side * mm(st.to), piece));
    };
    const line = (o, w, dash = 0, gap = 0) => marks.push(...dashes(P, Ls, ranges, o, w, dash, gap));
    for (const st of xs.strips) {
      if (st.type === "bike-lane") strip(st, PALETTE.bikeLane, 1.12, 0.7);
      else if (st.type === "bike-path") strip(st, PALETTE.bikePath, 1.02, 0.95);
      else if (st.type === "buffer" && st.level === "sidewalk") strip(st, COLOURS.buffer, 1.02, 0.9);
      else if (st.type === "parking") strip(st, COLOURS.parking, 1.12, 0.9);
      else if (st.type === "tram-bed" && g.kind !== "tram") strip(st, PALETTE.tramBed, 1.12, 0.95);
    }
    // a pedestrian zone: bands of darker paving across it every 8 m, a gutter down the middle without trams
    if (g.kind === "pedestrian") {
      const h = g.width / 2 - mm(0.4), bands = [];
      for (const [s0, s1] of ranges) {
        for (let s = s0 + mm(4); s < s1 - mm(1); s += mm(8)) {
          const at = polylineAt(P, s, Ls), n = [-at.dir[1], at.dir[0]];
          bands.push(quad([at.point[0] + n[0] * h, at.point[1] + n[1] * h], [at.point[0] - n[0] * h, at.point[1] - n[1] * h], mm(0.6)));
        }
      }
      fill(COLOURS.paving, 1.03, 0.45, bands);
      if (xs.tram === "none") fill(COLOURS.paving, 1.03, 0.6, dashes(P, Ls, ranges, 0, mm(0.4), 0, 0));
    }
    // markings: the centre line, lane lines, the lines of bike lanes and tram lanes
    const K = ROAD_KINDS[g.kind];
    if (g.car) {
      const laneW = mm(xs.laneWidth), carFrom = mm(xs.tram === "lanes" ? (xs.tramTracks === "double" ? NORMS.tram.lane : NORMS.tram.lane / 2) : xs.tram === "median" ? xs.tramBed / 2 : 0);
      if (xs.tram === "none" || xs.tram === "street") {
        if (xs.lanes > 1) for (const sd of [-1, 1]) line(sd * mm(0.15), mm(0.12));
        else if (K.centreLine && mm(xs.carWidth) >= mm(5.5)) line(0, mm(0.12), mm(3), mm(6));
      }
      for (let i = 1; i < xs.lanes; i++) for (const sd of [-1, 1]) line(sd * (carFrom + i * laneW), mm(0.12), mm(3), mm(6));
      if (xs.tram === "lanes") for (const sd of [-1, 1]) line(sd * carFrom, mm(0.12), mm(1.5), mm(1.5));
      for (const st of xs.strips) {
        if (st.side < 0 || (st.type !== "advisory-lane" && st.type !== "bike-lane")) continue;
        for (const sd of [-1, 1]) line(sd * mm(st.from + (st.type === "bike-lane" ? 0.125 : 0.06)), mm(st.type === "bike-lane" ? 0.25 : 0.12), st.type === "advisory-lane" ? mm(1) : 0, st.type === "advisory-lane" ? mm(1) : 0);
      }
      // parking spaces
      for (const side of ["right", "left"]) {
        const p = xs.parking[side];
        if (!p) continue;
        const sd = side === "right" ? -1 : 1, a = sd * mm(p.from), b = sd * mm(p.from + p.depth);
        for (const [s0, s1] of ranges) {
          for (let s = s0 + mm(p.length); s < s1 - mm(1); s += mm(p.length)) {
            const at = polylineAt(P, s, Ls), n = [-at.dir[1], at.dir[0]];
            const t0 = p.layout === "parallel" ? b - sd * mm(0.5) : a, t1 = b;
            marks.push(quad([at.point[0] + n[0] * t0, at.point[1] + n[1] * t0], [at.point[0] + n[0] * t1, at.point[1] + n[1] * t1], mm(0.1)));
          }
        }
      }
    }
    // the rails: two per track, over the whole street (they cross junctions)
    if (xs.tram !== "none") {
      const offsets = xs.tramTracks === "double" ? [-mm(xs.tramOffset), mm(xs.tramOffset)] : [0];
      for (const o of offsets) for (const r of [-1, 1]) rails.push(offsetPolyline(P, o + (r * mm(GAUGE_M)) / 2));
    }
    return { fills: [...fills.values()], marks, rails };
  }

  /**
   * Street parking (`parking`): one facility per side with its spaces, for core/parking.js: spaces
   * along the parking strip, none within 5 m of a junction and none at bus and tram stops (StVO § 12).
   * @returns {Array<{id: string, owner: Road, kind: "street", label: string, side: "right" | "left", spaces: number,
   *   spots: Array<{pos: number[], dir: number[]}>, tariff: Tariff, access: string, layout: string}>}
   */
  parkingInfo() {
    const g = this.geometry;
    if (!g?.car || !g.xs.parking.right && !g.xs.parking.left) return [];
    const key = `${this.world.objectsVersion}:${this.world.map.version}:${this.world.scale}`;
    if (this._parking?.key === key && this._parking.g === g) return this._parking.list;
    const xs = g.xs, mm = (m) => this.mm(m), list = [];
    const jc = this._junctions();
    const tariff = new Tariff({ kind: this.spec.parking_tariff, price_eur: this.spec.parking_price_eur, street: true });
    for (const side of ["right", "left"]) {
      const p = xs.parking[side];
      if (!p) continue;
      const sd = side === "right" ? -1 : 1, t = sd * mm(p.from + p.depth / 2);
      // no parking near junctions and at stops on this side (and 15 m before and after them)
      const blocked = jc.busy.map((b) => [b.s - b.r - mm(5), b.s + b.r + mm(5)]);
      for (const o of this.world.objects) {
        const free = typeof o.noParking === "function" ? o.noParking(this, side) : null;
        if (free) blocked.push(...free);
      }
      const spots = [];
      const len = mm(p.length);
      for (let s = len / 2 + mm(0.5); s < g.length - len / 2; s += len) {
        if (blocked.some(([a, b]) => s + len / 2 > a && s - len / 2 < b)) continue;
        const at = polylineAt(g.points, s, g.lengths), n = [-at.dir[1], at.dir[0]];
        const heading = p.layout === "parallel" ? (side === "right" ? at.dir : [-at.dir[0], -at.dir[1]]) : [-n[0] * sd, -n[1] * sd];
        spots.push({ pos: [at.point[0] + n[0] * t, at.point[1] + n[1] * t], dir: heading, s });
      }
      list.push({
        id: `${this.id}:${side}`, owner: this, kind: "street", label: `${this.name} (${side} side)`, side, spaces: spots.length, spots,
        tariff, access: tariff.kind === "yearly" ? "residents" : "public", layout: p.layout,
      });
    }
    this._parking = { key, g, list };
    return list;
  }

  /** Where bikes can be locked: to each street lamp, two at most. [{pos, capacity, kind: "lamp"}] */
  bikeParking() {
    const g = this.geometry;
    if (!g) return [];
    return this._junctions().lamps.map((l) => ({ pos: [l.pos[0] - l.arm[0] * this.mm(0.4), l.pos[1] - l.arm[1] * this.mm(0.4)], dir: [-l.arm[1], l.arm[0]], capacity: 2, kind: "lamp" }));
  }

  draw(view) {
    const g = this.geometry;
    const jc = this._junctions();
    if (g.kind === "path") {
      const colour = g.xs.profile === "bike-paths" ? PALETTE.bikePath : COLOURS.path;
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, g.width / 2))), colour, 1.02, 0.85);
    } else if (g.kind === "pedestrian") {
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, g.width / 2))), PALETTE.plaza, 1.02, 0.92);
    } else if (g.kind === "tram") {
      fillPolygons(view, g.bed.concat(jc.patches.map((p) => disc(p, g.width / 2))), PALETTE.tramBed, 1.02, 0.9);
    } else {
      const h = g.width / 2;
      if (g.outer) fillPolygons(view, g.outer.concat(jc.patches.map((p) => disc(p, g.half))), COLOURS.sidewalk, 1.0, 0.9);
      fillPolygons(view, g.curb.concat(jc.patches.map((p) => disc(p, h + this.mm(0.25)))), COLOURS.curb, 1.05, 0.95);
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, h))), COLOURS.asphalt, 1.1, 0.95);
      fillPolygons(view, jc.zebras, COLOURS.marking, 1.2, 0.9);
      // the turning areas of the dead ends, in the same layers as the street
      const area = (t, grow) => (t.kind === "circle" ? disc(t.pos, t.size / 2 + grow, 28) : quad(
        [t.pos[0] + t.out[1] * (t.size / 2 + grow), t.pos[1] - t.out[0] * (t.size / 2 + grow)],
        [t.pos[0] - t.out[1] * (t.size / 2 + grow), t.pos[1] + t.out[0] * (t.size / 2 + grow)], g.width + 2 * grow));
      if (jc.turnings.length) {
        if (g.sidewalk > 0) fillPolygons(view, jc.turnings.map((t) => area(t, g.sidewalk + this.mm(0.25))), COLOURS.sidewalk, 1.0, 0.9);
        fillPolygons(view, jc.turnings.map((t) => area(t, this.mm(0.25))), COLOURS.curb, 1.05, 0.95);
        fillPolygons(view, jc.turnings.map((t) => area(t, 0)), COLOURS.asphalt, 1.1, 0.95);
      }
    }
    for (const f of jc.strips.fills) fillPolygons(view, f.quads, f.colour, f.order, f.alpha);
    fillPolygons(view, jc.strips.marks, COLOURS.marking, 1.2, 0.85);
    if (jc.strips.rails.length) {
      const k = view.pxPerMM(g.points[0][0], g.points[0][1], 0) * this.mm(GAUGE_M);
      if (k >= 1.2 * view.px) for (const r of jc.strips.rails) view.line(r, { stroke: PALETTE.rail, width: Math.max(0.6, Math.min(1.6, k / 6)), order: 1.15 });
    }
    for (const l of jc.lamps) if (view.inImage(l.pos[0], l.pos[1], 0, 80)) drawStreetLamp(view, l.pos, l.arm);
    for (const sg of jc.signs) if (view.inImage(sg.pos[0], sg.pos[1], 0, 80)) drawSign(view, sg.pos, sg.key, { plate: sg.plate });
    this._drawHeights(view, g);
  }

  /**
   * Where the street leaves the ground (core/elevation.js): its sides as walls down to the ground on
   * a low ramp, as the edge of a deck a metre thick where it lies higher (a bridge), as walls up to
   * the ground where it lies lower (a cutting); railings where it lies high. Over a track its deck is
   * drawn as a solid (trains pass under it, cars on it), under a track the railway's bridge. Heights
   * as worked out, without a lift.
   */
  _drawHeights(view, g) {
    const el = this.world.elevation, p = el.profiles.get(this.id);
    if (!p?.decks.length) return;
    const m = (x) => this.mm(x), deck = m(CROSSING_NORMS.roadDeck), wall = grey(0.8), railing = grey(0.9);
    view.withLift(null, () => {
      for (const d of p.decks) {
        const L = d.s[d.s.length - 1], n = Math.max(1, Math.ceil(L / m(4)));
        for (let i = 0; i < n; i++) {
          const a = (L * i) / n, b = (L * (i + 1)) / n;
          const A = polylineAt(d.pts, a, d.lengths), B = polylineAt(d.pts, b, d.lengths);
          const za = interpolate(d.s, d.z, a), zb = interpolate(d.s, d.z, b), ga = interpolate(d.s, d.ground, a), gb = interpolate(d.s, d.ground, b);
          // above the ground: down to it on a low ramp, else a deck's thickness; below it: up to it
          const bottom = (z, gr) => (z >= gr ? (z - gr <= 1.5 * deck ? gr : z - deck) : z), top = (z, gr) => Math.max(z, gr);
          // each side on its own: the far one is drawn before the deck, the near one after it
          for (const side of [-1, 1]) {
            const off = (P) => [P.point[0] - P.dir[1] * d.half * side, P.point[1] + P.dir[0] * d.half * side];
            const pa = off(A), pb = off(B), faces = [];
            const fa = bottom(za, ga), fb = bottom(zb, gb), ta = top(za, ga), tb = top(zb, gb);
            if (ta - fa > 0.05 || tb - fb > 0.05) faces.push({ pts: [[pa[0], pa[1], fa], [pb[0], pb[1], fb], [pb[0], pb[1], tb], [pa[0], pa[1], ta]], color: wall, twoSided: true });
            if (za - ga > m(1.5) || zb - gb > m(1.5)) {
              faces.push({ pts: [[pa[0], pa[1], za], [pb[0], pb[1], zb], [pb[0], pb[1], zb + m(0.9)], [pa[0], pa[1], za + m(0.9)]], color: railing, alpha: 0.7, twoSided: true });
            }
            if (faces.length) view.faces(faces, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (za + zb) / 2]);
          }
        }
      }
      for (const c of el.trackCrossings(this.id)) {
        if (c.kind === "over" || (c.kind === "clash" && c.clear > 0)) this._drawBridgeDeck(view, g, p, c);
        else if (c.kind === "under" || (c.kind === "clash" && c.clear < 0)) drawRailBridge(view, g, c, this.mm(1));
      }
    });
  }

  /** The deck over a track as a solid in pieces: the sidewalks, the carriageway and tram rails on top. */
  _drawBridgeDeck(view, g, p, c) {
    const m = (x) => this.mm(x), xs = g.xs;
    // across the track's clearance: 4 m each side of it, along the street
    const along = polylineAt(g.points, c.s, g.lengths).dir, sin = Math.max(0.3, Math.abs(c.dir[0] * along[1] - c.dir[1] * along[0]));
    const reach = m(4) / sin, s0 = Math.max(0, c.s - reach), s1 = Math.min(g.length, c.s + reach);
    const tracks = xs.tram !== "none" ? (xs.tramTracks === "double" ? [-xs.tramOffset, xs.tramOffset] : [0]) : [];
    const n = Math.max(1, Math.ceil((s1 - s0) / m(3)));
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n, b = s0 + ((s1 - s0) * (i + 1)) / n;
      const A = polylineAt(g.points, a, g.lengths), B = polylineAt(g.points, b, g.lengths);
      const za = interpolate(p.s, p.z, a), zb = interpolate(p.s, p.z, b);
      const at = (P, t, z) => [P.point[0] - P.dir[1] * t, P.point[1] + P.dir[0] * t, z];
      const band = (t0, t1, up = 0) => [at(A, t0, za + up), at(B, t0, zb + up), at(B, t1, zb + up), at(A, t1, za + up)];
      const decals = g.car ? [{ pts: band(-g.width / 2, g.width / 2, 0.01), color: COLOURS.asphalt }] : [];
      for (const t of tracks) for (const r of [-GAUGE_M / 2, GAUGE_M / 2]) decals.push({ pts: band(m(t + r) - m(0.07), m(t + r) + m(0.07), 0.02), color: PALETTE.rail });
      const colour = g.kind === "path" ? COLOURS.path : g.kind === "pedestrian" ? PALETTE.plaza : g.kind === "tram" ? PALETTE.tramBed : COLOURS.sidewalk;
      const mid = polylineAt(g.points, (a + b) / 2, g.lengths).point;
      view.faces([{ pts: band(-g.half, g.half), normal: [0, 0, 1], color: colour, decals, flat: true }], [mid[0], mid[1], (za + zb) / 2]);
    }
  }
}

/**
 * The railway's bridge over a street in an underpass (Eisenbahnüberführung): its deck along the track
 * with its top at the rails, abutments beside the street down to it, the street in its shade.
 * @param {{pos: number[], dir: number[], street: number, rails: number}} c where the track crosses (core/elevation.js)
 * @param {number} m1 one prototype metre in mm
 */
function drawRailBridge(view, g, c, m1) {
  const w = 3.2 * m1, h1 = c.rails, h0 = Math.max(c.street, c.rails - CROSSING_NORMS.railDeck * m1);
  const reach = g.half + m1, n = [(-c.dir[1] * w) / 2, (c.dir[0] * w) / 2];
  const a = [c.pos[0] - c.dir[0] * reach, c.pos[1] - c.dir[1] * reach], b = [c.pos[0] + c.dir[0] * reach, c.pos[1] + c.dir[1] * reach];
  view.prism([[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]], h0, h1, { side: grey(0.7), top: grey(0.62) });
  for (const t of [-1, 1]) {
    const q = [c.pos[0] + c.dir[0] * t * (g.half + 0.6 * m1), c.pos[1] + c.dir[1] * t * (g.half + 0.6 * m1)];
    view.prism(rectFootprint(q, 1.2 * m1, w, Math.atan2(c.dir[1], c.dir[0])), c.street, h0, { side: grey(0.78), top: grey(0.7) });
  }
  const s = [c.dir[0] * g.width * 0.5, c.dir[1] * g.width * 0.5], k = [-c.dir[1] * w * 0.5, c.dir[0] * w * 0.5];
  view.polygon([[c.pos[0] - s[0] - k[0], c.pos[1] - s[1] - k[1]], [c.pos[0] - s[0] + k[0], c.pos[1] - s[1] + k[1]], [c.pos[0] + s[0] + k[0], c.pos[1] + s[1] + k[1]], [c.pos[0] + s[0] - k[0], c.pos[1] + s[1] - k[1]]], { z: c.street + 0.05, fill: grey(0.2), alpha: 0.35, order: 1.3 });
}
