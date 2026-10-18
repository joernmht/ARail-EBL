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
 * a bike path) and `tram` (a tram track of its own, away from the streets).
 * @module arail/objects/road
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { dist2, dot2, lerp2, polylineAt, polylineLengths, polylineProject, sub2, unit2 } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";
import { NORMS, PARKING_LAYOUTS, PATH_PROFILES, STREET_PROFILES, TRAM_LAYOUTS, TRAM_TRACKS, crossSection, profileOf, widthChoices } from "./street-profile.js";
import { TARIFFS, Tariff } from "./parking.js";

/** Kinds of streets: label in the editor, speed limit, default width of the car lanes (of the path, of the track bed), cars allowed. */
export const ROAD_KINDS = {
  street: { label: "street (50 km/h)", speed_kmh: 50, width_m: 7, car: true, centreLine: true },
  residential: { label: "residential street (30 km/h)", speed_kmh: 30, width_m: 6, car: true, centreLine: false },
  main: { label: "main road (50 km/h, wider)", speed_kmh: 50, width_m: 10, car: true, centreLine: true },
  path: { label: "footpath (no cars)", speed_kmh: 0, width_m: 3, car: false, centreLine: false },
  tram: { label: "tram track of its own (no street)", speed_kmh: 60, width_m: NORMS.tram.bedDouble, car: false, centreLine: false },
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
  parking: grey(0.42),
  buffer: grey(0.62),
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
const profileOfValues = (v) => profileOf({ ...v, kind: roadKind(v.kind) });

export class Road extends LayoutObject {
  static type = "road";
  static label = "Street";
  static category = "Transport";
  static placement = "polyline";
  static description = "A street along a line: car lanes, and by its cross-section sidewalks, bike lanes or bike paths, tram tracks and parking. Streets that meet or cross are connected; buses, cars, bikes and trams drive on them, people walk on the sidewalks.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: options(ROAD_KINDS), default: "street" },
    {
      key: "profile", label: "Cross-section", type: "select",
      options: (v) => options(isPath(v) ? PATH_PROFILES : STREET_PROFILES), when: (v) => !isTram(v),
      help: "What lies beside the car lanes. Bike lanes and bike paths make the street wider.",
    },
    {
      key: "width_m", label: "Width", type: "number", unit: "m", min: 1, max: 30, step: 0.05,
      presets: (v) => widthChoices("width_m", { ...v, kind: roadKind(v.kind) }),
      help: "Of the car lanes together (of the path for footpaths, of the track bed for tram tracks). Empty = by kind: 7 m street, 6 m residential street, 10 m main road, 3 m footpath, 6.6 m tram track.",
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
    { key: "tram", label: "Tram tracks", type: "select", options: options(TRAM_LAYOUTS), default: "none", when: isCarKind },
    { key: "tram_tracks", label: "Tracks", type: "select", options: options(TRAM_TRACKS), default: "double", when: (v) => isTram(v) || (isCarKind(v) && v.tram && v.tram !== "none") },
    { key: "parking", label: "Street parking", type: "select", options: options(PARKING_LAYOUTS), default: "none", when: isCarKind },
    { key: "parking_sides", label: "Parking on", type: "select", options: [["both", "both sides"], ["right", "right side"], ["left", "left side"]], default: "both", when: (v) => isCarKind(v) && v.parking && v.parking !== "none" },
    { key: "parking_tariff", label: "Parking costs", type: "select", options: options(TARIFFS), default: "free", when: (v) => isCarKind(v) && v.parking && v.parking !== "none" },
    { key: "parking_price_eur", label: "Price", type: "number", unit: "€", min: 0, max: 2000, step: 0.1, when: (v) => isCarKind(v) && v.parking && v.parking !== "none" && v.parking_tariff && v.parking_tariff !== "free", help: "Per hour, day, week or year, as chosen. Empty = a usual price." },
    { key: "speed_kmh", label: "Speed limit", type: "number", unit: "km/h", min: 5, max: 130, step: 5, help: "Empty = by kind." },
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
    const piece = mm(25);
    return {
      points, lengths, length: L, kind, car: K.car, xs, width, half, sidewalk,
      carriage: kind === "tram" ? [] : bandPieces(points, h, piece),
      bed: kind === "tram" ? bandPieces(points, h, piece) : [],
      curb: K.car ? bandPieces(points, h + mm(0.25), piece) : null,
      outer: sidewalk > 0 ? bandPieces(points, half, piece) : null,
      footprint: band(points, Math.max(half, mm(1))),
      lamps: this.spec.lamps !== false && kind !== "tram" ? this._lamps(points, lengths, h, sidewalk, K.car) : [],
    };
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
    else {
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
      }
    }
    if (xs.warnings.length) card.sections = [...(card.sections || []), { title: "Below the guidelines", lines: xs.warnings }];
    return card;
  }

  /** What is wrong with the street (shown in the editor): widths below the minimum of the guidelines. */
  problems() {
    return this.geometry?.xs.warnings ?? [];
  }

  /**
   * What the road network needs to know (see core/network.js).
   * @returns {object | null} {points, kind, car, walk, bike, width, half, sidewalk, speed, walkOffset,
   *   laneOffset, bikeOffset, bikeWidth, obstruct, conflict, tram, tramTracks, tramOffset, lanes}:
   *   widths and offsets in mm, speed in m/s; `bike`: what bikes get ("road", "advisory", "lane",
   *   "path", "shared", "none"); `tram`: where the tracks lie ("none", "street", "lanes", "median",
   *   "own")
   */
  roadInfo() {
    const g = this.geometry;
    if (!g) return null;
    const K = ROAD_KINDS[g.kind], xs = g.xs, mm = (m) => this.mm(m);
    const kmh = Number(this.spec.speed_kmh) > 0 ? Number(this.spec.speed_kmh) : K.speed_kmh;
    const tram = g.kind === "tram";
    const walk = tram ? false : g.kind === "path" ? PATH_PROFILES[xs.profile]?.walk !== false : true;
    // a narrow street has one lane for both directions: vehicles keep to its middle
    const oneLane = g.car && xs.carWidth < 5 && (xs.tram === "none" || xs.tram === "street");
    return {
      points: g.points, kind: g.kind, car: g.car, walk, bike: xs.bike, width: g.width, half: g.half, sidewalk: g.sidewalk,
      speed: g.car || tram ? kmh / 3.6 : 1.3,
      walkOffset: g.car ? mm(xs.walkOffset) : 0,
      laneOffset: oneLane ? 0 : g.car ? mm(xs.laneOffset) : 0,
      bikeOffset: mm(xs.bikeOffset), bikeWidth: mm(xs.bikeWidth), obstruct: xs.obstruct, conflict: xs.conflict,
      tram: xs.tram, tramTracks: xs.tramTracks, tramOffset: mm(xs.tramOffset), lanes: xs.lanes,
    };
  }

  /* ---------------------------------------------------------------- junctions, parking, bikes */

  /**
   * Junction details from the road network (cached until it changes): round patches where
   * street ends meet, zebra crossings next to junctions, the stretches the strips are drawn on
   * (they stop short of junctions), lamps that are not on a junction.
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
    const jc = { net, g, patches: [], zebras: [], lamps: g.lamps, busy: [], ranges: [[0, g.length]] };
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
    } else if (g.kind === "tram") {
      fillPolygons(view, g.bed.concat(jc.patches.map((p) => disc(p, g.width / 2))), PALETTE.tramBed, 1.02, 0.9);
    } else {
      const h = g.width / 2;
      if (g.outer) fillPolygons(view, g.outer.concat(jc.patches.map((p) => disc(p, g.half))), COLOURS.sidewalk, 1.0, 0.9);
      fillPolygons(view, g.curb.concat(jc.patches.map((p) => disc(p, h + this.mm(0.25)))), COLOURS.curb, 1.05, 0.95);
      fillPolygons(view, g.carriage.concat(jc.patches.map((p) => disc(p, h))), COLOURS.asphalt, 1.1, 0.95);
      fillPolygons(view, jc.zebras, COLOURS.marking, 1.2, 0.9);
    }
    for (const f of jc.strips.fills) fillPolygons(view, f.quads, f.colour, f.order, f.alpha);
    fillPolygons(view, jc.strips.marks, COLOURS.marking, 1.2, 0.85);
    if (jc.strips.rails.length) {
      const k = view.pxPerMM(g.points[0][0], g.points[0][1], 0) * this.mm(GAUGE_M);
      if (k >= 1.2 * view.px) for (const r of jc.strips.rails) view.line(r, { stroke: PALETTE.rail, width: Math.max(0.6, Math.min(1.6, k / 6)), order: 1.15 });
    }
    for (const l of jc.lamps) if (view.inImage(l.pos[0], l.pos[1], 0, 80)) drawStreetLamp(view, l.pos, l.arm);
  }
}
