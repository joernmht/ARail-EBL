/**
 * Drawing of the container terminal: containers, wagons, locomotives, trucks, barges, cranes,
 * reach stackers, yard ground, lanes, quays and highlights. Everything goes through the View
 * display list; positions are layout mm, prototype dimensions metres.
 *
 * Sorting (solid layer, far to near by depth of a reference point):
 * - things standing beside each other have ground references [x, y, 0] (wagons, locomotives,
 *   trucks, barges, yard stacks, crane legs and sills). Long ones are cut into pieces at a grid of
 *   cells along their axis, the same grid for everything parallel (see `Cells`): two trains on
 *   neighbouring tracks are then compared piece by piece, at the same place along the track;
 * - what stands on a carrier uses the carrier's reference (of the piece it stands on) and is
 *   queued after it, so equal keys keep their order: the containers of a wagon, truck or barge;
 * - the crane's girders are split into segments of at most 7 m with references at mid-height;
 *   the trolley takes the reference of the nearest girder segment under it and is queued after
 *   it, the ropes are drawn just before the trolley; the spreader and its load are drawn
 *   together, cut at the cells like the carriers below them, with references at the load's
 *   middle (above what it hangs over).
 *
 * Level of detail goes by the size on the screen (the image scale once per carrier or stack): a
 * container is a plain box below 25 px, gets corrugation and doors from 25 px and corner
 * castings from 60 px. Colours are [r, g, b] arrays, so nothing is parsed per frame.
 * @module arail/terminal/draw
 */
import { CD, OVERLAY, PALETTE, grey, mix, parseColor, rgba } from "../core/colors.js";
import { inv3, polylineAt, polylineLengths } from "../core/math.js";
import { DEFAULT_ROLLING } from "../core/layout.js";
import { OUTLINE, convexHull, hash01, hashString } from "../objects/building-kit.js";
import { offsetPolyline } from "../objects/road.js";
import { CAR_COLOURS } from "../sims/traffic.js";
import { stackerReach } from "./handlers.js";
import { BAY_M, CONTAINER_WIDTH_M, ROW_M } from "./model.js";

/** Colours of containers without a colour of their own: muted, derived from the CD; never pure Orange or Rot. */
export const CONTAINER_COLOURS = Object.freeze([
  mix(CD.tuerkis, grey(0.5), 0.25), mix(CD.dunkelblau, grey(0.5), 0.2), mix(CD.brillantblau, grey(0.5), 0.4),
  mix(CD.rot, grey(0.4), 0.45), mix(CD.orange, grey(0.45), 0.45), mix(CD.gelb, grey(0.6), 0.35),
  grey(0.9), grey(0.62), grey(0.4), mix(CD.tuerkis, grey(0.3), 0.5),
]);

/** Colours of the terminal's infrastructure and vehicles. */
export const TERMINAL_COLOURS = Object.freeze({
  concrete: "#c9c6bd", yardLine: PALETTE.busBay, rail: "#5b5f64", craneGirder: grey(0.78), craneLeg: grey(0.62),
  craneTrolley: grey(0.5), spreader: CD.gelb, rope: grey(0.25), wagonFrame: grey(0.32), running: grey(0.2),
  chassis: grey(0.25), wheels: grey(0.12), hull: mix(CD.dunkelblau, grey(0.4), 0.3), hullDeck: grey(0.45),
  wheelhouse: grey(0.88), reachStacker: grey(0.35), card: grey(0.97),
});

/**
 * Body colour of a container as [r, g, b]: its own `colour`, or one of {@link CONTAINER_COLOURS}
 * chosen by its id (the same container always gets the same colour).
 * @param {{id: string, colour?: string|number[]|null}} container
 * @returns {number[]}
 */
export function colourFor(container) {
  if (container.colour) return parseColor(container.colour);
  const i = Math.floor(hash01(hashString(String(container.id)), 0) * CONTAINER_COLOURS.length);
  return parseColor(CONTAINER_COLOURS[Math.min(i, CONTAINER_COLOURS.length - 1)]);
}

/**
 * The 8 corners [x, y, z] (layout mm) of a box: the bottom 4 (counter-clockwise, starting at the
 * back right) then the top 4 in the same order.
 * @param {import("./types.js").Box} box
 * @returns {number[][]}
 */
export function boxCorners(box) {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const l = box.length / 2, w = box.width / 2;
  const base = [[-l, -w], [l, -w], [l, w], [-l, w]].map(([a, b]) => [box.center[0] + a * c - b * s, box.center[1] + a * s + b * c]);
  const z1 = box.z0 + box.height;
  return [...base.map(([x, y]) => [x, y, box.z0]), ...base.map(([x, y]) => [x, y, z1])];
}

/* ---------------------------------------------------------------- colours and constants */

/** A colour (CSS or [r, g, b]) times a factor as [r, g, b], like `shade` (> 1 lighter). */
function tone(c, f) {
  const [r, g, b] = parseColor(c);
  return f <= 1 ? [r * f, g * f, b * f] : [r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)];
}

/** The terminal colours as [r, g, b] (parsed once). */
const C = Object.fromEntries(Object.entries(TERMINAL_COLOURS).map(([k, v]) => [k, parseColor(v)]));
const TRAIN = parseColor(PALETTE.train);
const COL = {
  door: parseColor(grey(0.35)),
  casting: parseColor(grey(0.25)),
  girderTop: tone(TERMINAL_COLOURS.craneGirder, 1.12),
  legTop: tone(TERMINAL_COLOURS.craneLeg, 1.1),
  trolleyTop: tone(TERMINAL_COLOURS.craneTrolley, 1.15),
  cab: parseColor(grey(0.85)),
  glass: parseColor(grey(0.22)),
  lit: parseColor(PALETTE.litWindow),
  spreaderTop: tone(CD.gelb, 0.92),
  spreaderEnd: tone(CD.gelb, 0.8),
  locoRoof: tone(PALETTE.train, 0.78),
  locoEnd: tone(PALETTE.train, 0.9),
  locoWindow: parseColor(PALETTE.trainWindow),
  windscreen: parseColor(grey(0.18)),
  frameTop: tone(TERMINAL_COLOURS.wagonFrame, 1.1),
  card: C.card,
  tag: [0, 0, 0],
  tagInner: [255, 255, 255],
  rail: tone(TERMINAL_COLOURS.hullDeck, 1.25),
  boom: parseColor(CD.gelb),
  boomTop: tone(CD.gelb, 1.08),
  stackerTop: tone(TERMINAL_COLOURS.reachStacker, 1.15),
};
/** CSS colours of drawings made with the canvas directly (dimmed by the view). */
const CSS = {
  rope: TERMINAL_COLOURS.rope,
  yardLine: TERMINAL_COLOURS.yardLine,
  asphalt: grey(0.36),
  marking: "#ffffff",
  edge: grey(0.4),
};
const HEADLIGHT = "#fff3d6";
const FLOODLIGHT = "#ffe9b0";

/** Level of detail of containers by their on-screen length (CSS px). */
const LOD = { plain: 6, detail: 25, castings: 60 };

/** Crane dimensions (m), see the design: legs, sills, girders, trolley, ropes, spreader. */
const CRANE = { leg_m: 1.0, legAlong_m: 7.5, sill_m: 17, sillWidth_m: 1.2, sillHeight_m: 0.8, girderWidth_m: 1.0, girderAlong_m: 1.5, girderDepth_m: 1.6, trolleyAlong_m: 4, trolleyAcross_m: 5, trolleyHeight_m: 2, segment_m: 7, spreaderHeight_m: 0.45 };

/* ---------------------------------------------------------------- geometry helpers */

/**
 * A carrier-local frame: `along` (+ forwards, heading) and `across` (+ left) in metres, z in
 * metres above the layout plane; points come out in layout mm.
 */
class Local {
  constructor(view, center, heading) {
    this.k = view.m(1);
    this.heading = heading;
    this.c = Math.cos(heading);
    this.s = Math.sin(heading);
    this.x = center[0];
    this.y = center[1];
    this.u = [this.c, this.s, 0];
    this.n = [-this.s, this.c, 0];
  }

  /** Layout point [x, y, z] (mm) of local metres. */
  p(a, t, z) {
    const k = this.k;
    return [this.x + (this.c * a - this.s * t) * k, this.y + (this.s * a + this.c * t) * k, z * k];
  }

  /** Layout point [x, y] (mm) of local metres. */
  xy(a, t) {
    const k = this.k;
    return [this.x + (this.c * a - this.s * t) * k, this.y + (this.s * a + this.c * t) * k];
  }

  /** Local [along, across] (m) of a layout point (mm). */
  local(p) {
    const dx = p[0] - this.x, dy = p[1] - this.y;
    return [(dx * this.c + dy * this.s) / this.k, (-dx * this.s + dy * this.c) / this.k];
  }
}

const NEG = (v) => [-v[0], -v[1], -v[2]];
const UP = [0, 0, 1], DOWN = [0, 0, -1];

/**
 * Faces of a box in a local frame: along a0..a1, across t0..t1, z0..z1 (m). Faces carry `side`
 * ("top", "left" (+across), "right", "front" (+along), "back", "bottom") for their decals.
 * @param {Local} L
 * @param {{side: number[], top?: number[] | null, end?: number[], alpha?: number, bottom?: boolean,
 *   front?: boolean, back?: boolean}} o `top: null` leaves the top out, `front`/`back: false` an end
 * @returns {object[]}
 */
function cuboid(L, a0, a1, t0, t1, z0, z1, o) {
  const alpha = o.alpha ?? 1, side = o.side, end = o.end || side;
  const out = [];
  if (o.top !== null) out.push({ side: "top", pts: [L.p(a0, t0, z1), L.p(a1, t0, z1), L.p(a1, t1, z1), L.p(a0, t1, z1)], normal: UP, color: o.top || side, alpha });
  out.push(
    { side: "left", pts: [L.p(a0, t1, z0), L.p(a1, t1, z0), L.p(a1, t1, z1), L.p(a0, t1, z1)], normal: L.n, color: side, alpha },
    { side: "right", pts: [L.p(a1, t0, z0), L.p(a0, t0, z0), L.p(a0, t0, z1), L.p(a1, t0, z1)], normal: NEG(L.n), color: side, alpha },
  );
  if (o.front !== false) out.push({ side: "front", pts: [L.p(a1, t1, z0), L.p(a1, t0, z0), L.p(a1, t0, z1), L.p(a1, t1, z1)], normal: L.u, color: end, alpha });
  if (o.back !== false) out.push({ side: "back", pts: [L.p(a0, t0, z0), L.p(a0, t1, z0), L.p(a0, t1, z1), L.p(a0, t0, z1)], normal: NEG(L.u), color: end, alpha });
  if (o.bottom) out.push({ side: "bottom", pts: [L.p(a0, t1, z0), L.p(a1, t1, z0), L.p(a1, t0, z0), L.p(a0, t0, z0)], normal: DOWN, color: side, alpha });
  return out;
}

/** A rectangle decal on a side face (constant across t) from along a0..a1, z0..z1 (m). */
function sideDecal(L, a0, a1, t, z0, z1, color, alpha, emissive = false) {
  return { pts: [L.p(a0, t, z0), L.p(a1, t, z0), L.p(a1, t, z1), L.p(a0, t, z1)], color, alpha, emissive };
}

/**
 * Faces of a straight beam of rectangular section between two points (layout mm): booms and
 * braces. `width` is horizontal, `height` perpendicular to it and to the beam (mm).
 * @param {number[]} p0
 * @param {number[]} p1
 * @param {number} width
 * @param {number} height
 * @param {{side: number[], top?: number[], alpha?: number}} colours
 * @returns {object[]}
 */
export function beamFaces(p0, p1, width, height, { side, top = side, alpha = 1 }) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const e = [d[0] / l, d[1] / l, d[2] / l];
  // horizontal side vector (perpendicular to the beam), then "up" across the beam
  let s = [-e[1], e[0], 0];
  const sl = Math.hypot(s[0], s[1]);
  s = sl > 1e-6 ? [s[0] / sl, s[1] / sl, 0] : [1, 0, 0];
  const up = [s[1] * e[2] - s[2] * e[1], s[2] * e[0] - s[0] * e[2], s[0] * e[1] - s[1] * e[0]];
  const hw = width / 2, hh = height / 2;
  const at = (p, a, b) => [p[0] + s[0] * a + up[0] * b, p[1] + s[1] * a + up[1] * b, p[2] + s[2] * a + up[2] * b];
  const q = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const A = q.map(([a, b]) => at(p0, a, b)), B = q.map(([a, b]) => at(p1, a, b));
  const normals = [NEG(up), s, up, NEG(s)];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push({ pts: [A[i], A[j], B[j], B[i]], normal: normals[i], color: i === 2 ? top : side, alpha });
  }
  faces.push({ pts: [B[0], B[1], B[2], B[3]], normal: e, color: side, alpha });
  faces.push({ pts: [A[3], A[2], A[1], A[0]], normal: NEG(e), color: side, alpha });
  return faces;
}

/**
 * Image scale (px per mm) at a layout point: the largest of the vertical scale and the scales
 * along x and y (unlike `View#pxPerMM`, which halves the ground scales, this is the size things
 * really have on the screen, also in the plan view). A point (partly) behind the camera counts
 * as close (`behind`, default 1e3 px/mm): full detail, the view culls what cannot be seen.
 */
function scaleAt(view, x, y, z = 0, behind = 1e3) {
  const d = view.m(1);
  const p = view.project(x, y, z), up = view.project(x, y, z + d), a = view.project(x + d, y, z), b = view.project(x, y + d, z);
  if (!p || !up || !a || !b) return behind;
  return Math.max(Math.hypot(up[0] - p[0], up[1] - p[1]), Math.hypot(a[0] - p[0], a[1] - p[1]), Math.hypot(b[0] - p[0], b[1] - p[1])) / d;
}

/** On-screen length (CSS px) of `mm` millimetres at a point, from a precomputed px/mm. */
function cssPx(view, k, mm) {
  return (k * mm) / (view.px || 1);
}

/**
 * Stroke width (CSS px) of something `mm` wide at a layout point, kept within [lo, hi]: one
 * width serves a whole batch of lines, so a point close to (or behind) the camera must not
 * blow it up; behind the camera it is `lo`.
 */
function strokeWidth(view, p, mm, lo, hi) {
  return Math.min(hi, Math.max(lo, cssPx(view, scaleAt(view, p[0], p[1], p[2] || 0, 0), mm)));
}

/** Highest top (mm) of a carrier's containers, at least `h` (mm): the height to cull with. */
function topOf(boxes, h) {
  for (const b of boxes || []) h = Math.max(h, b.z0 + b.height);
  return h;
}

/** Is a disc of `r` mm (plus `h` mm upwards) around a ground point entirely outside the image? */
function offScreen(view, p, r, h = 0) {
  const pts = [];
  for (const [dx, dy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
    for (const z of [0, h]) {
      const q = view.project(p[0] + dx, p[1] + dy, z);
      if (!q) return false; // (partly) behind the camera: let the view cull the faces
      pts.push(q);
    }
  }
  return view.offImage(pts);
}

/* ---------------------------------------------------------------- sort keys */

/** The camera position (layout mm) of a view, worked out once per view. */
const EYES = new WeakMap();
function eyeOf(view) {
  let eye = EYES.get(view);
  if (!eye) {
    const { a1, a2, a3, n } = view.pose;
    // camera coordinates are x·a1 + y·a2 + z·n + a3: the camera is where they are 0
    const M = inv3([a1[0], a2[0], n[0], a1[1], a2[1], n[1], a1[2], a2[2], n[2]]);
    eye = M ? [0, 1, 2].map((i) => -(M[3 * i] * a3[0] + M[3 * i + 1] * a3[1] + M[3 * i + 2] * a3[2])) : null;
    EYES.set(view, eye);
  }
  return eye;
}

/**
 * The sort reference of a thing at local (a, t) of frame L and height z (mm). Things aligned with
 * a frame are sorted by their distance from the camera along the frame's axes, weighted with the
 * view direction: |α|·|Δa| + |β|·|Δt| + γ·Δz (α, β, γ: the view's depth per mm along the axes and
 * up). In front of the camera that is the view's depth; for things beside the camera (at the edge
 * of a wide view, where the depth would put the nearer of two neighbours behind the other) it keeps
 * growing with the distance. The point returned has that depth (moved horizontally if needed).
 */
function sortRef(view, L, a, t, z = 0) {
  const p = [...L.xy(a, t), z];
  const eye = eyeOf(view);
  if (!eye) return p;
  const { a1, a2, n } = view.pose;
  const g = [a1[2], a2[2], n[2]];
  const ga = g[0] * L.c + g[1] * L.s, gt = -g[0] * L.s + g[1] * L.c;
  const h2 = ga * ga + gt * gt;
  if (h2 < 1e-12) return p;
  const dx = p[0] - eye[0], dy = p[1] - eye[1];
  const da = dx * L.c + dy * L.s, dt = -dx * L.s + dy * L.c;
  const extra = Math.abs(ga) * Math.abs(da) + Math.abs(gt) * Math.abs(dt) - (ga * da + gt * dt);
  if (extra <= 0) return p;
  const f = extra / h2;
  return [p[0] + g[0] * f, p[1] + g[1] * f, z];
}

/* ---------------------------------------------------------------- sort cells */

/**
 * Sorting of long things standing side by side. A single reference point cannot order two
 * long carriers on parallel tracks (or two rows of a yard) right: seen at an angle, the one
 * further along may be the one in front. So long things are cut into pieces at a grid of cells
 * along their axis, the same grid for everything parallel (its lines lie at multiples of
 * `CELL_M` of the layout position along the axis). The reference of a piece is the middle of
 * its cell, moved only slightly towards the piece (and then made a {@link sortRef}): parallel
 * neighbours are compared at the same position along the axis, i.e. by their distance across it,
 * and pieces one behind the other by their position along it.
 */
const CELL_M = 6;
const CELL_BIAS = 0.05;
/** Below this on-screen length (CSS px) a thing is not cut: its pieces would not be seen. */
const CELL_PX = 30;
/** Pieces of opaque boxes overlap by this much (m), so that no seam shows between them. */
const OVERLAP_M = 0.02;

class Cells {
  /**
   * @param {import("../core/view.js").View} view
   * @param {Local} L frame of the thing
   * @param {number} a0 start of the thing along its axis (m)
   * @param {number} a1 end (m)
   * @param {{t?: number, z?: number, single?: boolean}} [options] `t`: across position of the
   *   sorting axis; `z`: height of the references (mm; things hanging in the air); `single`: one
   *   piece with the reference in the middle (small on the screen)
   */
  constructor(view, L, a0, a1, { t = 0, z = 0, single = false } = {}) {
    this.L = L;
    this.list = [];
    if (single || !(a1 > a0)) {
      this.g0 = null;
      this.list.push({ lo: -Infinity, hi: Infinity, ref: sortRef(view, L, (a0 + a1) / 2, t, z), faces: [] });
      return;
    }
    // position of the frame's origin along the axis, measured from the layout origin (m)
    this.g0 = (L.x * L.c + L.y * L.s) / L.k;
    this.j0 = Math.floor((this.g0 + a0) / CELL_M);
    const j1 = Math.max(this.j0, Math.ceil((this.g0 + a1) / CELL_M) - 1);
    for (let j = this.j0; j <= j1; j++) {
      const lo = j * CELL_M - this.g0, hi = lo + CELL_M;
      const p0 = Math.max(a0, lo), p1 = Math.min(a1, hi), c = lo + CELL_M / 2;
      const a = c + CELL_BIAS * (Math.min(p1, Math.max(p0, c)) - c);
      this.list.push({ lo, hi, ref: sortRef(view, L, a, t, z), faces: [] });
    }
  }

  /** Index of the cell containing `a` (local m; clamped to the cells). */
  index(a) {
    if (this.g0 === null) return 0;
    const j = Math.floor((this.g0 + a) / CELL_M) - this.j0;
    return Math.max(0, Math.min(this.list.length - 1, j));
  }

  /** Pieces [cell index, from, to] of the range a0..a1 (local m). */
  pieces(a0, a1) {
    const out = [];
    for (let i = this.index(a0), n = this.list.length; i < n; i++) {
      const c = this.list[i];
      const p0 = i === 0 ? a0 : Math.max(a0, c.lo), p1 = i === n - 1 ? a1 : Math.min(a1, c.hi);
      if (p1 - p0 > 1e-6) out.push([i, p0, p1]);
      if (c.hi >= a1) break;
    }
    return out.length ? out : [[this.index(a0), a0, a1]];
  }

  /**
   * A box cut at the cells (ends only on the outer pieces). `decorate(faces, p0, p1)` adds the
   * decals of the piece p0..p1.
   */
  cuboid(a0, a1, t0, t1, z0, z1, o, decorate = null) {
    const ov = (o.alpha ?? 1) >= 1 ? OVERLAP_M : 0;
    for (const [i, p0, p1] of this.pieces(a0, a1)) {
      const q0 = p0 > a0 ? p0 - ov : p0, q1 = p1 < a1 ? p1 + ov : p1;
      const faces = cuboid(this.L, q0, q1, t0, t1, z0, z1, { ...o, back: o.back !== false && p0 <= a0, front: o.front !== false && p1 >= a1 });
      if (decorate) decorate(faces, p0, p1);
      this.list[i].faces.push(...faces);
    }
  }

  /**
   * A straight beam from (a0, t0, z0) to (a1, t1, z1) (local m) of `width` × `height` (m), cut at
   * the cells (see {@link beamFaces}).
   */
  beam(a0, t0, z0, a1, t1, z1, width, height, colours) {
    const L = this.L, k = L.k;
    if (Math.abs(a1 - a0) < 1e-6) {
      this.list[this.index(a0)].faces.push(...beamFaces(L.p(a0, t0, z0), L.p(a1, t1, z1), width * k, height * k, colours));
      return;
    }
    const at = (a) => {
      const f = (a - a0) / (a1 - a0);
      return L.p(a, t0 + (t1 - t0) * f, z0 + (z1 - z0) * f);
    };
    for (const [i, p0, p1] of this.pieces(Math.min(a0, a1), Math.max(a0, a1))) {
      const [q0, q1] = a0 < a1 ? [p0, p1] : [p1, p0];
      this.list[i].faces.push(...beamFaces(at(q0), at(q1), width * k, height * k, colours));
    }
  }

  /**
   * A vertical prism over a convex footprint (local [a, t] m, counter-clockwise) from z0 to z1,
   * cut at the cells; `open`: positions along the axis where it joins something else (no wall there).
   */
  prism(pts, z0, z1, colours, { open = [] } = {}) {
    const lo = Math.min(...pts.map((p) => p[0])), hi = Math.max(...pts.map((p) => p[0]));
    for (const [i, p0, p1] of this.pieces(lo, hi)) {
      const piece = clipAlong(clipAlong(pts, p0, 1), p1, -1);
      if (piece.length < 3) continue;
      const cuts = [...open, ...(p0 > lo ? [p0] : []), ...(p1 < hi ? [p1] : [])];
      this.list[i].faces.push(...hullPrism(this.L, piece, z0, z1, colours, cuts));
    }
  }

  /** Queue each cell's faces as one solid with the cell's reference (and empty the cells). */
  queue(view, style) {
    for (const c of this.list) {
      if (c.faces.length) view.faces(c.faces, c.ref, style);
      c.faces = [];
    }
  }
}

/* ---------------------------------------------------------------- containers */

/**
 * Faces of a container in a carrier's frame, cut at the carrier's cells, with level of detail.
 * @param {Cells} cells
 * @param {{a0: number, a1: number, t0: number, t1: number, z0: number, z1: number, colour: number[],
 *   doors: "a0" | "a1", top: boolean}} b local metres; `doors`: the end with the doors
 * @param {number} px on-screen length (CSS px)
 * @param {number} alpha
 * @param {(i: number, faces: object[]) => void} put receives the faces of each piece
 */
function containerPieces(cells, b, px, alpha, put) {
  const L = cells.L, col = b.colour || parseColor(CONTAINER_COLOURS[0]);
  const o = { side: col, top: b.top ? tone(col, 0.92) : null, alpha };
  const detail = px >= LOD.detail, castings = px >= LOD.castings;
  const rib = detail ? tone(col, 0.86) : null;
  const len = b.a1 - b.a0;
  const ribs = detail ? Math.max(3, Math.min(Math.round(len / 0.9), Math.round(px / 9))) : 0;
  const ov = alpha >= 1 ? OVERLAP_M : 0;
  for (const [i, p0, p1] of cells.pieces(b.a0, b.a1)) {
    const q0 = p0 > b.a0 ? p0 - ov : p0, q1 = p1 < b.a1 ? p1 + ov : p1;
    const faces = cuboid(L, q0, q1, b.t0, b.t1, b.z0, b.z1, { ...o, back: p0 <= b.a0, front: p1 >= b.a1 });
    if (detail) {
      for (const f of faces) {
        if (f.side === "left" || f.side === "right") {
          const t = f.side === "left" ? b.t1 : b.t0;
          f.decals = [{ pts: corrugation(L, b, p0, p1, t, ribs), color: rib, alpha }];
          if (castings) f.decals.push(...cornerCastings(L, b, p0, p1, t, alpha));
        } else if ((f.side === "back" && b.doors === "a0") || (f.side === "front" && b.doors === "a1")) {
          f.decals = [{ pts: doors(L, f.side === "back" ? b.a0 : b.a1, b), color: COL.door, alpha }];
        }
      }
    }
    put(i, faces);
  }
}

/**
 * Corrugation of a long side between p0 and p1 as one polygon: a bottom rail with vertical ribs
 * standing on it (one fill instead of one per rib). More ribs the larger the container is on the
 * screen.
 */
function corrugation(L, b, p0, p1, t, n) {
  const half = 0.125, rail = 0.12, pitch = (b.a1 - b.a0) / n;
  const zb = b.z0 + rail, zt = b.z1 - 0.1;
  const pts = [L.p(p0, t, b.z0), L.p(p1, t, b.z0), L.p(p1, t, zb)];
  for (let i = n - 1; i >= 0; i--) {
    const m = b.a0 + pitch * (i + 0.5);
    const r0 = Math.max(p0, m - half), r1 = Math.min(p1, m + half);
    if (r1 - r0 < 0.02) continue;
    pts.push(L.p(r1, t, zb), L.p(r1, t, zt), L.p(r0, t, zt), L.p(r0, t, zb));
  }
  pts.push(L.p(p0, t, zb));
  return pts;
}

/** The door end at `a`: header, the centre gap and four locking bars as one polygon. */
function doors(L, a, b) {
  const bar = 0.05, gap = 0.06, head = 0.14, w = (b.t1 - b.t0) / 2, tc = (b.t0 + b.t1) / 2;
  const zt = b.z1 - 0.12, zb = b.z0 + 0.12;
  // the face's own left to right, seen from outside
  const sgn = a <= b.a0 ? 1 : -1;
  const T = (x) => tc + sgn * x;
  const pts = [L.p(a, T(-w + 0.1), zt), L.p(a, T(-w + 0.1), zt - head)];
  for (const x of [-0.85 * w, -0.27 * w, 0, 0.27 * w, 0.85 * w]) {
    const h = (x === 0 ? gap : bar) / 2;
    pts.push(L.p(a, T(x - h), zt - head), L.p(a, T(x - h), zb), L.p(a, T(x + h), zb), L.p(a, T(x + h), zt - head));
  }
  pts.push(L.p(a, T(w - 0.1), zt - head), L.p(a, T(w - 0.1), zt));
  return pts;
}

/** Corner castings (0.18 m squares) at the corners of a long side that lie within p0..p1. */
function cornerCastings(L, b, p0, p1, t, alpha) {
  const c = 0.18, out = [];
  for (const [a, e] of [[b.a0, b.a0 + c], [b.a1 - c, b.a1]]) {
    const r0 = Math.max(a, p0), r1 = Math.min(e, p1);
    if (r1 - r0 < 0.01) continue;
    for (const [za, zb] of [[b.z0, b.z0 + c], [b.z1 - c, b.z1]]) out.push(sideDecal(L, r0, r1, t, za, zb, COL.casting, alpha));
  }
  return out;
}

/** Depth of a box's centre (for ordering boxes far to near). */
function boxDepth(view, b) {
  return view.depth(b.center[0], b.center[1], b.z0 + b.height / 2);
}

/**
 * A box (layout mm) in a carrier's frame (local metres); `top`: whether its top shows. Boxes
 * turned the other way round have their doors at the other end.
 */
function localBox(L, box, top = true) {
  const k = L.k, [ac, tc] = L.local(box.center);
  const l = box.length / k / 2, w = box.width / k / 2;
  const same = Math.cos(box.heading - L.heading) >= 0;
  return { a0: ac - l, a1: ac + l, t0: tc - w, t1: tc + w, z0: box.z0 / k, z1: (box.z0 + box.height) / k, colour: box.colour, doors: same ? "a0" : "a1", top };
}

/** Is a box turned along (or against) the frame's axis? */
function aligned(L, box) {
  return Math.abs(Math.sin(box.heading - L.heading)) < 1e-3;
}

/** Does another box of at least this length stand on `b`? */
function coveredBy(boxes, b) {
  const top = b.z0 + b.height;
  return boxes.some((o) => o !== b && Math.abs(o.z0 - top) < 1e-3 && o.length >= b.length - 1e-3 && Math.hypot(o.center[0] - b.center[0], o.center[1] - b.center[1]) < 1e-3);
}

/**
 * The containers standing on a carrier drawn with `cells`: each piece is queued with the
 * reference of its cell, after the carrier's pieces (queued before); far boxes first.
 */
function containersOn(view, cells, boxes, k, alpha) {
  if (!boxes?.length) return;
  const list = boxes.length > 1 ? boxes.slice().sort((a, b) => boxDepth(view, b) - boxDepth(view, a)) : boxes;
  for (const b of list) {
    const px = cssPx(view, k, b.length), top = !coveredBy(list, b);
    if (aligned(cells.L, b)) {
      containerPieces(cells, localBox(cells.L, b, top), px, alpha, (i, faces) => view.faces(faces, cells.list[i].ref));
    } else {
      const own = new Cells(view, new Local(view, b.center, b.heading), 0, 0, { single: true });
      containerPieces(own, localBox(own.L, b, top), px, alpha, (i, faces) => view.faces(faces, cells.list[cells.index(cells.L.local(b.center)[0])].ref));
    }
  }
}

/** Along range (local m) of a carrier from a0 to a1 and the boxes on it. */
function extent(L, boxes, a0, a1) {
  for (const b of boxes || []) {
    const ac = L.local(b.center)[0], l = b.length / L.k / 2;
    a0 = Math.min(a0, ac - l);
    a1 = Math.max(a1, ac + l);
  }
  return [a0, a1];
}

/**
 * Containers standing on something (`ref`: the sort reference of what they stand on): queued
 * after it with the same reference, far to near among themselves.
 * @param {import("../core/view.js").View} view
 * @param {import("./types.js").DrawBox[]} boxes
 * @param {number[]} ref
 * @param {{alpha?: number}} [options]
 */
export function drawContainers(view, boxes, ref, { alpha = 1 } = {}) {
  if (!boxes?.length) return;
  const list = boxes.length > 1 ? boxes.slice().sort((a, b) => boxDepth(view, b) - boxDepth(view, a)) : boxes;
  const b0 = list[0];
  const k = scaleAt(view, b0.center[0], b0.center[1], b0.z0);
  for (const b of list) {
    if (offScreen(view, b.center, b.length / 2, b.z0 + b.height)) continue;
    const own = new Cells(view, new Local(view, b.center, b.heading), 0, 0, { single: true });
    containerPieces(own, localBox(own.L, b, !coveredBy(list, b)), cssPx(view, k, b.length), alpha, (i, faces) => view.faces(faces, ref));
  }
}

/**
 * Yard stacks, each bottom to top, standing on the ground: cut at the sort cells like carriers;
 * the tiers of a stack are one solid per cell. Stacks smaller than 6 px on the screen are drawn
 * as a single box.
 * @param {import("../core/view.js").View} view
 * @param {import("./types.js").DrawBox[][]} stacks
 * @param {{alpha?: number}} [options]
 */
export function drawYardStacks(view, stacks, { alpha = 1 } = {}) {
  for (const stack of stacks) {
    if (!stack?.length) continue;
    const b0 = stack[0], top = stack[stack.length - 1];
    const h = top.z0 + top.height;
    const r = Math.max(...stack.map((b) => b.length)) / 2;
    if (offScreen(view, b0.center, r, h)) continue;
    const k = scaleAt(view, b0.center[0], b0.center[1], 0);
    const px = cssPx(view, k, b0.length);
    const L = new Local(view, b0.center, b0.heading);
    const cells = new Cells(view, L, -r / L.k, r / L.k, { single: cssPx(view, k, 2 * r) < CELL_PX });
    const put = (i, faces) => cells.list[i].faces.push(...faces);
    if (px < LOD.plain) {
      containerPieces(cells, { ...localBox(L, { ...top, z0: b0.z0, height: h - b0.z0, length: 2 * r }), doors: "a0" }, px, alpha, put);
    } else {
      for (let i = 0; i < stack.length; i++) {
        const b = stack[i], above = stack[i + 1];
        containerPieces(cells, localBox(L, b, !above || above.length < b.length - 1e-3), cssPx(view, k, b.length), alpha, put);
      }
    }
    cells.queue(view);
  }
}

/* ---------------------------------------------------------------- wagons */

/**
 * A container wagon and its containers. Wagons are skeletal frames (side sills, headstocks,
 * buffers, cross members, bogies): the containers are the load that is seen.
 * @param {import("../core/view.js").View} view
 * @param {{type: object, center: number[], heading: number, deck?: number, alpha?: number,
 *   tags?: {slot: number, id: number}[] | null, tag_mm?: number}} wagon `deck`: height (layout mm)
 *   the containers stand at (default: the type's `deck_m`); `tags`: the deck card of a model wagon
 *   is drawn with these tags (flyover); `tag_mm`: tag size (default 20 mm)
 * @param {import("./types.js").DrawBox[]} boxes
 */
export function drawWagon(view, wagon, boxes) {
  const type = wagon.type;
  if (!type || !wagon.center) return;
  const len = type.length_m, hl = len / 2;
  const L = new Local(view, wagon.center, wagon.heading || 0);
  const [e0, e1] = extent(L, boxes, -hl - 0.6, hl + 0.6);
  if (offScreen(view, wagon.center, view.m(Math.max(-e0, e1)), topOf(boxes, view.m(4)))) return;
  const alpha = wagon.alpha ?? 1;
  const deck = Number.isFinite(wagon.deck) ? wagon.deck / L.k : type.deck_m;
  const k = scaleAt(view, wagon.center[0], wagon.center[1], 0);
  const px = cssPx(view, k, view.m(len));
  const cells = new Cells(view, L, e0, e1, { single: px < CELL_PX });
  const frame = { side: C.wagonFrame, top: COL.frameTop, alpha };
  const end = hl - 0.35, top = Math.max(0.9, deck - 0.05);
  if (px < 10) {
    cells.cuboid(-end, end, -1.1, 1.1, 0.3, top, frame);
  } else {
    // side sills
    for (const t of [-0.95, 0.95]) cells.cuboid(-end, end, t - 0.12, t + 0.12, 0.8, top, frame);
    // headstocks and buffers
    for (const sgn of [-1, 1]) {
      const a = sgn * end;
      cells.cuboid(a - 0.15, a + 0.15, -1.4, 1.4, 0.75, 1.1, frame);
      if (px >= 50) {
        const b = a + sgn * 0.325;
        for (const t of [-0.875, 0.875]) cells.cuboid(b - 0.175, b + 0.175, t - 0.17, t + 0.17, 0.95, 1.15, frame);
      }
    }
    // cross members at the bay boundaries
    if (px >= 50) {
      const bays = type.bays_m || [];
      for (let i = 0; i + 1 < bays.length; i++) {
        const a = (bays[i] + bays[i + 1]) / 2;
        cells.cuboid(a - 0.1, a + 0.1, -0.95, 0.95, 0.95, 1.1, frame);
      }
    }
    // running gear: bogies, or wheelsets of a two-axle wagon
    const half = type.axles ? 0.5 : 1.3, run = { side: C.running, alpha };
    for (const a of type.running_m || []) cells.cuboid(a - half, a + half, -1.15, 1.15, 0.18, 0.8, run);
  }
  cells.queue(view);
  if (wagon.tags && view.virtual) deckCard(view, cells, type, deck, wagon, k, alpha);
  containersOn(view, cells, boxes, k, alpha);
}

/** The deck card of a model wagon with its tags (flyover only): a white card on the deck. */
function deckCard(view, cells, type, deck, wagon, k, alpha) {
  const L = cells.L, bays = type.bays_m || [0];
  const size = (wagon.tag_mm ?? DEFAULT_ROLLING.size_mm) / L.k, margin = 2.5 / L.k;
  const a1 = Math.max(...bays) + size / 2 + margin, a0 = Math.min(...bays) - size / 2 - margin, w = CONTAINER_WIDTH_M / 2;
  const z = deck + 0.01;
  const tags = cssPx(view, k, size * L.k) >= 6 ? wagon.tags.filter((tag) => bays[tag.slot] != null) : [];
  const sq = (a, h) => [L.p(a - h, -h, z), L.p(a + h, -h, z), L.p(a + h, h, z), L.p(a - h, h, z)];
  for (const [i, p0, p1] of cells.pieces(a0, a1)) {
    const decals = [];
    for (const tag of tags) {
      const a = bays[tag.slot];
      if (a >= p0 && a < p1) decals.push({ pts: sq(a, size / 2), color: COL.tag, alpha }, { pts: sq(a, size / 4), color: COL.tagInner, alpha });
    }
    const ov = alpha >= 1 ? OVERLAP_M : 0, q0 = p0 > a0 ? p0 - ov : p0, q1 = p1 < a1 ? p1 + ov : p1;
    cells.list[i].faces.push({ pts: [L.p(q0, -w, z), L.p(q1, -w, z), L.p(q1, w, z), L.p(q0, w, z)], normal: UP, color: COL.card, alpha, decals });
  }
  cells.queue(view);
}

/* ---------------------------------------------------------------- locomotive */

/**
 * A locomotive: body with cab windows at both ends, bogies, head lights at night and the
 * train's name above it.
 * @param {import("../core/view.js").View} view
 * @param {{center: number[], heading: number, length_m?: number, alpha?: number, lit?: boolean, label?: string}} loco
 */
export function drawLocomotive(view, loco) {
  if (!loco.center) return;
  const len = loco.length_m || 19, hl = len / 2;
  if (offScreen(view, loco.center, view.m(hl + 1), view.m(4.5))) return;
  const L = new Local(view, loco.center, loco.heading || 0);
  const alpha = loco.alpha ?? 1, lit = !!loco.lit;
  const k = scaleAt(view, loco.center[0], loco.center[1], 0);
  const px = cssPx(view, k, view.m(len));
  const cells = new Cells(view, L, -hl, hl, { single: px < CELL_PX });
  const win = lit ? COL.lit : COL.locoWindow;
  cells.cuboid(-hl, hl, -1.5, 1.5, 1.0, 4.2, { side: TRAIN, top: COL.locoRoof, end: COL.locoEnd, alpha }, px < 12 ? null : (faces, p0, p1) => {
    for (const f of faces) {
      const d = [];
      if (f.side === "left" || f.side === "right") {
        const t = f.side === "left" ? 1.5 : -1.5;
        for (const [w0, w1] of [[hl - 2.5, hl - 0.6], [-hl + 0.6, -hl + 2.5]]) {
          const r0 = Math.max(w0, p0), r1 = Math.min(w1, p1);
          if (r1 > r0) d.push(sideDecal(L, r0, r1, t, 2.7, 3.5, win, alpha, lit));
        }
        // a dark band along the frame
        d.push(sideDecal(L, p0, p1, t, 1.0, 1.35, COL.locoWindow, alpha));
      } else if (f.side === "front" || f.side === "back") {
        const a = f.side === "front" ? hl : -hl;
        d.push({ pts: [L.p(a, -1.25, 2.7), L.p(a, 1.25, 2.7), L.p(a, 1.25, 3.5), L.p(a, -1.25, 3.5)], color: win, alpha, emissive: lit });
      }
      f.decals = d;
    }
  });
  if (px >= 12) for (const a of [-5.5, 5.5]) cells.cuboid(a - 1.4, a + 1.4, -1.2, 1.2, 0.18, 1.0, { side: C.running, alpha });
  cells.queue(view);
  if (view.darkness > 0.05) {
    for (const t of [-0.85, 0.85]) view.glow(L.p(hl + 0.05, t, 1.4), view.m(0.8), HEADLIGHT, 0.9);
    view.lightPool(L.xy(hl + 6, 0), view.m(4), "#fff1c9", 0.35);
  }
  if (loco.label && px >= 24) view.label(L.p(0, 0, 6), loco.label, { size: 11, background: rgba(OVERLAY.sign, 0.92) });
}

/* ---------------------------------------------------------------- trucks */

/**
 * A truck (tractor and chassis) and its containers. The carrier origin is the middle of the
 * chassis; the rear is at −6.8 m, the front at +9.7 m.
 * @param {import("../core/view.js").View} view
 * @param {{id: string, type: object, center: number[], heading: number, alpha?: number, lit?: boolean, label?: string}} truck
 * @param {import("./types.js").DrawBox[]} boxes
 */
export function drawTruck(view, truck, boxes) {
  if (!truck.center) return;
  const rear = truck.type?.rear_m ?? -6.8, front = truck.type?.front_m ?? 9.7;
  const L = new Local(view, truck.center, truck.heading || 0);
  const mid = L.xy((rear + front) / 2, 0);
  const [e0, e1] = extent(L, boxes, rear, front);
  const c = (rear + front) / 2;
  if (offScreen(view, mid, view.m(Math.max(c - e0, e1 - c) + 0.5), topOf(boxes, view.m(4)))) return;
  const alpha = truck.alpha ?? 1;
  const k = scaleAt(view, mid[0], mid[1], 0);
  const px = cssPx(view, k, view.m(front - rear));
  const cells = new Cells(view, L, e0, e1, { single: px < CELL_PX });
  if (px < 7) {
    cells.cuboid(rear, front, -1.25, 1.25, 0.3, 1.25, { side: C.chassis, alpha });
  } else {
    const chassis = { side: C.chassis, alpha }, wheels = { side: C.wheels, alpha };
    const cab = parseColor(CAR_COLOURS[hashString(String(truck.id ?? "")) % CAR_COLOURS.length]);
    cells.cuboid(rear, 6.6, -1.25, 1.25, 0.95, 1.25, chassis);
    for (const a of [-5.1, -3.8, -2.5]) cells.cuboid(a - 0.45, a + 0.45, -1.25, 1.25, 0, 1.0, wheels);
    cells.cuboid(3.8, front, -1.15, 1.15, 0.5, 1.1, chassis);
    for (const a of [5.0, 8.6]) cells.cuboid(a - 0.5, a + 0.5, -1.25, 1.25, 0, 1.0, wheels);
    cells.cuboid(7.4, front, -1.25, 1.25, 1.1, 3.8, { side: cab, top: tone(cab, 0.95), end: tone(cab, 0.92), alpha }, px < 20 ? null : (faces, p0, p1) => {
      for (const f of faces) {
        if (f.side === "front") f.decals = [{ pts: [L.p(front, 1.1, 2.4), L.p(front, -1.1, 2.4), L.p(front, -1.1, 3.4), L.p(front, 1.1, 3.4)], color: COL.windscreen, alpha }];
        else if ((f.side === "left" || f.side === "right") && Math.min(9.5, p1) > Math.max(8.6, p0)) {
          f.decals = [sideDecal(L, Math.max(8.6, p0), Math.min(9.5, p1), f.side === "left" ? 1.25 : -1.25, 2.4, 3.4, COL.windscreen, alpha)];
        }
      }
    });
  }
  cells.queue(view);
  if (view.darkness > 0.05) {
    for (const t of [-0.9, 0.9]) {
      view.glow(L.p(front + 0.05, t, 1.0), view.m(0.8), HEADLIGHT, 0.9);
      view.glow(L.p(rear - 0.05, t, 1.0), view.m(0.4), CD.rot, 0.8);
    }
    view.lightPool(L.xy(front + 5, 0), view.m(3.5), "#fff1c9", 0.3);
  }
  containersOn(view, cells, boxes, k, alpha);
  if (truck.label && px >= 24) view.label(L.p((rear + front) / 2, 0, 5.2), truck.label, { size: 10, background: OVERLAY.label });
}

/* ---------------------------------------------------------------- barges */

/**
 * An inland barge and its containers: the hull (bow, holds, stern with the wheelhouse) cut at
 * the sort cells; the containers of each cell are queued after the hull's piece there.
 * @param {import("../core/view.js").View} view
 * @param {{type: object, center: number[], heading: number, alpha?: number, lit?: boolean, name?: string}} barge
 * @param {import("./types.js").DrawBox[][]} boxesByBay
 */
export function drawBarge(view, barge, boxesByBay = []) {
  const type = barge.type;
  if (!type || !barge.center) return;
  const len = type.length_m, hl = len / 2, hb = (type.width_m || 9.5) / 2, deck = type.deck_m ?? 1.4;
  // up to the mast light and the name above the wheelhouse (9.5 m), or the top tier
  if (offScreen(view, barge.center, view.m(hl + 1), topOf(boxesByBay.flat().filter(Boolean), view.m(9.5)))) return;
  const L = new Local(view, barge.center, barge.heading || 0);
  const alpha = barge.alpha ?? 1, lit = !!barge.lit;
  const k = scaleAt(view, barge.center[0], barge.center[1], 0);
  const px = cssPx(view, k, view.m(len));
  const cells = new Cells(view, L, -hl, hl, { single: px < CELL_PX });
  const hull = { side: C.hull, top: C.hullDeck, alpha };
  const bays = type.bays_m || [];
  // bow: a convex footprint tapering to 6.5 m
  const bow0 = hl - 6, nb = 3.25;
  const bowPts = [[bow0, -hb], [hl - 1.5, -hb + 0.9], [hl, -nb], [hl, nb], [hl - 1.5, hb - 0.9], [bow0, hb]];
  cells.prism(bowPts, 0, deck, hull, { open: [bow0] });
  // the hull from the stern to the bow, with the hold coamings around the bays
  const holds = bays.length ? [bays[bays.length - 1] - BAY_M / 2, bays[0] + BAY_M / 2] : null;
  cells.cuboid(-hl, bow0, -hb, hb, 0, deck, { ...hull, front: false }, px < 40 || !holds ? null : (faces, p0, p1) => {
    const f = faces.find((x) => x.side === "top");
    const r0 = Math.max(p0, holds[0]), r1 = Math.min(p1, holds[1]), w = hb - 0.35, z = deck;
    if (!f || !(r1 > r0)) return;
    const band = (a0, a1, t0, t1) => ({ pts: [L.p(a0, t0, z), L.p(a1, t0, z), L.p(a1, t1, z), L.p(a0, t1, z)], color: COL.rail, alpha });
    f.decals = [band(r0, r1, -w, -w + 0.25), band(r0, r1, w - 0.25, w)];
    for (let i = 0; i <= bays.length; i++) {
      const a = i < bays.length ? bays[i] + BAY_M / 2 : holds[0];
      if (a >= p0 && a <= p1) f.decals.push(band(Math.max(p0, a - 0.2), Math.min(p1, a), -w, w));
    }
  });
  // wheelhouse at the stern
  const h0 = -hl + 1, h1 = -hl + 7;
  const win = lit ? COL.lit : COL.glass;
  cells.cuboid(h0, h1, -3.5, 3.5, deck, 6.0, { side: C.wheelhouse, top: tone(C.wheelhouse, 1.05), alpha }, px < 30 ? null : (faces, p0, p1) => {
    for (const f of faces) {
      if (f.side === "left" || f.side === "right") {
        const r0 = Math.max(p0, h0 + 0.3), r1 = Math.min(p1, h1 - 0.3);
        if (r1 > r0) f.decals = [sideDecal(L, r0, r1, f.side === "left" ? 3.5 : -3.5, 4.6, 5.4, win, alpha, lit)];
      } else if (f.side === "front" || f.side === "back") {
        const a = f.side === "front" ? h1 : h0;
        f.decals = [{ pts: [L.p(a, -3.2, 4.6), L.p(a, 3.2, 4.6), L.p(a, 3.2, 5.4), L.p(a, -3.2, 5.4)], color: win, alpha, emissive: lit }];
      }
    }
  });
  cells.queue(view);
  containersOn(view, cells, boxesByBay.flat().filter(Boolean), k, alpha);
  if (view.darkness > 0.05) {
    view.glow(L.p(-hl + 4, 0, 8.5), view.m(1.2), "#ffffff", 0.9);
    view.glow(L.p(hl - 0.5, 0, 3.0), view.m(0.9), HEADLIGHT, 0.7);
  }
  if (barge.name && px >= 24) view.label(L.p(-hl + 4, 0, 9.5), barge.name, { size: 11, background: OVERLAY.label });
}

/**
 * Faces of a prism over a local footprint (m, counter-clockwise); walls lying across the axis at one
 * of the positions `open` (m) are left out.
 */
function hullPrism(L, pts, z0, z1, colours, open = []) {
  const faces = [{ pts: pts.map(([a, t]) => L.p(a, t, z1)), normal: UP, color: colours.top, alpha: colours.alpha }];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    if (open.some((a) => Math.abs(p[0] - a) < 1e-6 && Math.abs(q[0] - a) < 1e-6)) continue;
    const da = q[0] - p[0], dt = q[1] - p[1], l = Math.hypot(da, dt) || 1;
    // outward normal of a counter-clockwise edge (local), turned into the layout frame
    const na = dt / l, nt = -da / l;
    faces.push({ pts: [L.p(p[0], p[1], z0), L.p(q[0], q[1], z0), L.p(q[0], q[1], z1), L.p(p[0], p[1], z1)], normal: [L.c * na - L.s * nt, L.s * na + L.c * nt, 0], color: colours.side, alpha: colours.alpha });
  }
  return faces;
}

/** The part of a convex polygon (local [a, t]) with a ≥ c (`sgn` 1) or a ≤ c (`sgn` −1). */
function clipAlong(pts, c, sgn) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dp = sgn * (p[0] - c), dq = sgn * (q[0] - c);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const f = dp / (dp - dq);
      out.push([c, p[1] + (q[1] - p[1]) * f]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- gantry crane */

/**
 * A rail-mounted gantry crane: sills on the rails, legs, portal beams, box girders, the trolley
 * with the operator's cab, ropes, the yellow spreader and the container hanging from it.
 * @param {import("../core/view.js").View} view
 * @param {{geometry: object, s: number, t: number, z: number, spreader_m?: number,
 *   load?: import("./types.js").DrawBox | null, name?: string, lit?: boolean}} crane
 *   `geometry`: of the crane object (`center`, `angle`, `span`, `outreach` and `lift` in mm);
 *   `s`, `t`: trolley position, crane-local mm; `z`: bottom of the spreader (mm)
 */
export function drawCrane(view, crane) {
  const g = crane.geometry;
  if (!g?.center) return;
  const m1 = view.m(1);
  const span = g.span / m1, out = (g.outreach || 0) / m1, Hg = (g.lift || view.m(15)) / m1 + 1.0;
  const s = (crane.s || 0) / m1, t = (crane.t || 0) / m1;
  // the crane's frame: along = s (rails), across = t
  const L = new Local(view, g.center, g.angle || 0);
  const reach = span / 2 + out + 1;
  const portal = L.xy(s, 0);
  // cull with the corners of the rotated footprint (sills, girders, the cab; at night the light
  // pool) up to the trolley's roof
  const corners = [], pool = view.darkness > 0.05 ? 18 : 0;
  const ha = Math.max(CRANE.sill_m / 2, CRANE.legAlong_m + 1, CRANE.girderAlong_m + 3.0, pool), ht = Math.max(reach, pool);
  for (const a of [s - ha, s + ha]) for (const tt of [-ht, ht]) for (const z of [0, Hg + 4]) corners.push(L.p(a, tt, z));
  const cornerImg = view.projectAll(corners);
  if (cornerImg && view.offImage(cornerImg)) return;
  const outline = { outline: OUTLINE };
  const leg = { side: C.craneLeg, top: COL.legTop };
  const k = scaleAt(view, portal[0], portal[1], 0);
  const detail = cssPx(view, k, view.m(span)) >= 40;
  // on both rails: the sill (cut at the sort cells, like the carriers beside it), the legs
  // standing on it with their braces, and the portal beam over the legs
  for (const side of [-1, 1]) {
    const tr = (side * span) / 2, w = CRANE.sillWidth_m / 2, half = CRANE.sill_m / 2;
    const cells = new Cells(view, L, s - half, s + half, { t: tr, single: cssPx(view, k, view.m(CRANE.sill_m)) < CELL_PX });
    cells.cuboid(s - half, s + half, tr - w, tr + w, 0, CRANE.sillHeight_m, leg);
    for (const a of [s - CRANE.legAlong_m, s + CRANE.legAlong_m]) {
      const h = CRANE.leg_m / 2;
      cells.cuboid(a - h, a + h, tr - h, tr + h, CRANE.sillHeight_m, Hg - 1.2, { ...leg, top: null });
      // a brace from the leg's foot up to the portal beam over the middle
      const inward = a < s ? 1 : -1;
      if (detail) cells.beam(a + inward * 0.5, tr, CRANE.sillHeight_m + 1, s - inward * 1.2, tr, Hg - 1.2, 0.5, 0.5, { side: C.craneLeg });
    }
    cells.queue(view, outline);
    // the portal beam in pieces of at most 7 m (references at mid-height)
    const b0 = s - CRANE.legAlong_m - 0.5, b1 = s + CRANE.legAlong_m + 0.5;
    const n = Math.ceil((b1 - b0) / CRANE.segment_m);
    for (let i = 0; i < n; i++) {
      const a0 = b0 + ((b1 - b0) * i) / n, a1 = b0 + ((b1 - b0) * (i + 1)) / n;
      const faces = cuboid(L, a0, a1, tr - 0.6, tr + 0.6, Hg - 1.2, Hg, { ...leg, bottom: true, back: i === 0, front: i === n - 1 });
      view.faces(faces, sortRef(view, L, (a0 + a1) / 2, tr, view.m(Hg - 0.6)), outline);
    }
  }
  // the two box girders across the rails, in segments of at most 7 m with references at mid-height
  const girder = { side: C.craneGirder, top: COL.girderTop, bottom: true };
  const nSeg = Math.ceil((2 * reach) / CRANE.segment_m);
  const zg = Hg + CRANE.girderDepth_m / 2;
  const trolleyT = [t - CRANE.trolleyAcross_m / 2, t + CRANE.trolleyAcross_m / 2];
  let under = null, underDepth = Infinity;
  for (const ga of [s - CRANE.girderAlong_m, s + CRANE.girderAlong_m]) {
    const hw = CRANE.girderWidth_m / 2;
    for (let i = 0; i < nSeg; i++) {
      const a = -reach + (2 * reach * i) / nSeg, b = -reach + (2 * reach * (i + 1)) / nSeg;
      // a segment of the girder (it runs across, along the crane's t): ends only at the girder's ends
      const faces = cuboid(L, ga - hw, ga + hw, a, b, Hg, Hg + CRANE.girderDepth_m, girder).filter((f) => (f.side !== "left" || i === nSeg - 1) && (f.side !== "right" || i === 0));
      const ref = sortRef(view, L, ga, (a + b) / 2, view.m(zg));
      view.faces(faces, ref, outline);
      if (b > trolleyT[0] && a < trolleyT[1]) {
        const d = view.depth(ref[0], ref[1], ref[2]);
        if (d < underDepth) {
          underDepth = d;
          under = ref;
        }
      }
    }
    if (view.darkness > 0.05) for (const tt of [-reach, reach]) view.glow(L.p(ga, tt, Hg - 0.3), view.m(2.5), FLOODLIGHT, 0.95);
  }
  if (view.darkness > 0.05) view.lightPool(portal, view.m(18), "#ffe2a0", 0.6, 4.5);
  // the trolley, queued after the nearest girder segment under it (with its reference)
  const zt0 = Hg + CRANE.girderDepth_m, zt1 = zt0 + CRANE.trolleyHeight_m;
  const tp = [s - CRANE.trolleyAlong_m / 2, s + CRANE.trolleyAlong_m / 2];
  const trolley = cuboid(L, tp[0], tp[1], trolleyT[0], trolleyT[1], zt0, zt1, { side: C.craneTrolley, top: COL.trolleyTop, bottom: true });
  if (detail) {
    const f = trolley.find((x) => x.side === "top");
    f.decals = [{ pts: [L.p(tp[0] + 0.5, trolleyT[0] + 0.6, zt1), L.p(tp[1] - 0.5, trolleyT[0] + 0.6, zt1), L.p(tp[1] - 0.5, t + 0.3, zt1), L.p(tp[0] + 0.5, t + 0.3, zt1)], color: C.craneLeg }];
  }
  const trolleyRef = under || sortRef(view, L, s, t, view.m(zt0));
  view.faces(trolley, trolleyRef, outline);
  // the operator's cab hangs beside the girder, travelling with the trolley
  const c0 = s - CRANE.girderAlong_m - 3.0, c1 = s - CRANE.girderAlong_m - 0.6;
  const cab = cuboid(L, c0, c1, t + 0.3, t + 2.6, Hg - 0.9, Hg + 1.4, { side: COL.cab, top: COL.cab, bottom: true });
  if (detail) {
    const lit = !!crane.lit && view.darkness > 0.05, win = lit ? COL.lit : COL.glass;
    for (const f of cab) {
      const z0 = Hg - 0.2, z1 = Hg + 1.0;
      if (f.side === "left" || f.side === "right") f.decals = [sideDecal(L, c0 + 0.2, c1 - 0.2, f.side === "left" ? t + 2.6 : t + 0.3, z0, z1, win, 1, lit)];
      else if (f.side === "front" || f.side === "back") {
        const a = f.side === "front" ? c1 : c0;
        f.decals = [{ pts: [L.p(a, t + 0.5, z0), L.p(a, t + 2.4, z0), L.p(a, t + 2.4, z1), L.p(a, t + 0.5, z1)], color: win, emissive: lit }];
      }
    }
  }
  view.faces(cab, sortRef(view, L, (c0 + c1) / 2, t + 1.45, view.m(Hg + 0.25)), outline);
  // the spreader with its head block and the container hanging from it, cut at the sort cells like
  // the carriers below (each piece holds both), with references at the middle of the load
  const load = crane.load || null;
  const sp = Math.max(1, crane.spreader_m || load?.length / m1 || 6.058);
  const zs = (crane.z ?? view.m(Hg - 4)) / m1, zsTop = zs + CRANE.spreaderHeight_m;
  const S = new Local(view, L.xy(s, t), load ? load.heading : g.angle || 0);
  const box = load ? { ...load, center: S.xy(0, 0), z0: zs * m1 - load.height } : null;
  const half = Math.max(sp, box ? box.length / m1 : 0) / 2;
  const hanging = new Cells(view, S, -half, half, { z: box ? box.z0 + box.height / 2 : view.m(zs + 0.2), single: cssPx(view, k, view.m(2 * half)) < CELL_PX });
  const sw = CONTAINER_WIDTH_M / 2;
  hanging.cuboid(-sp / 2, sp / 2, -sw, sw, zs, zsTop, { side: C.spreader, top: COL.spreaderTop, end: COL.spreaderEnd, bottom: !load });
  hanging.cuboid(-1.2, 1.2, -0.7, 0.7, zsTop, zsTop + 0.5, { side: C.craneTrolley, top: COL.trolleyTop });
  if (box) containerPieces(hanging, localBox(S, box), cssPx(view, k, box.length), 1, (i, faces) => hanging.list[i].faces.push(...faces));
  hanging.queue(view);
  // ropes: four lines from the trolley to the head block, drawn just before the trolley
  const img = [];
  for (const da of [-1.0, 1.0]) {
    for (const dt of [-0.6, 0.6]) {
      const p = L.p(s + da, t + dt, zt0), q = S.p(da * 0.9, dt, zsTop + 0.5);
      const a = view.project(p[0], p[1], p[2]), b = view.project(q[0], q[1], q[2]);
      if (a && b) img.push(a, b);
    }
  }
  if (img.length && !view.offImage(img)) {
    // the scale halfway down the ropes (not at the portal's foot, which can be much nearer)
    const width = strokeWidth(view, S.p(0, 0, (zsTop + 0.5 + zt0) / 2), view.m(0.06), 0.6, 2.5);
    const draw = (ctx) => {
      ctx.beginPath();
      for (let i = 0; i < img.length; i += 2) {
        ctx.moveTo(img[i][0], img[i][1]);
        ctx.lineTo(img[i + 1][0], img[i + 1][1]);
      }
      ctx.strokeStyle = view.dim(CSS.rope);
      ctx.lineWidth = width * view.px;
      ctx.stroke();
    };
    draw.plain = true;
    view.solid(view.depth(trolleyRef[0], trolleyRef[1], trolleyRef[2]) + 1e-3, draw);
  }
}

/* ---------------------------------------------------------------- reach stacker */

/**
 * A reach stacker: body, cab, wheels, the yellow boom and the spreader across its end, with
 * the container it carries.
 * @param {import("../core/view.js").View} view
 * @param {{center: number[], heading: number, boom?: number, lift?: number, spreader_m?: number,
 *   load?: import("./types.js").DrawBox | null, name?: string, lit?: boolean}} rs `boom`: 0 (in) .. 1 (out);
 *   `lift`: height (layout mm) of the spreader's bottom
 */
export function drawReachStacker(view, rs) {
  if (!rs.center) return;
  if (offScreen(view, rs.center, view.m(12), view.m(14))) return;
  const L = new Local(view, rs.center, rs.heading || 0);
  const k = scaleAt(view, rs.center[0], rs.center[1], 0);
  const px = cssPx(view, k, view.m(8));
  const outline = { outline: OUTLINE };
  const body = cuboid(L, -4, 4, -2, 2, 0.4, 2.4, { side: C.reachStacker, top: COL.stackerTop });
  // counterweight at the back, cab on the right
  body.push(...cuboid(L, -4.3, -3.0, -1.9, 1.9, 0.6, 2.9, { side: C.reachStacker, top: COL.stackerTop }));
  const cab = cuboid(L, -1.5, 0.5, -2, -0.6, 2.4, 4.4, { side: COL.cab, top: COL.cab });
  if (px >= 12) {
    const lit = !!rs.lit && view.darkness > 0.05, win = lit ? COL.lit : COL.glass;
    for (const f of cab) {
      if (f.side === "left" || f.side === "right") f.decals = [sideDecal(L, -1.3, 0.3, f.side === "left" ? -0.6 : -2, 3.0, 4.2, win, 1, lit)];
      else if (f.side === "front" || f.side === "back") {
        const a = f.side === "front" ? 0.5 : -1.5;
        f.decals = [{ pts: [L.p(a, -0.75, 3.0), L.p(a, -1.85, 3.0), L.p(a, -1.85, 4.2), L.p(a, -0.75, 4.2)], color: win, emissive: lit }];
      }
    }
  }
  body.push(...cab);
  for (const a of [-2.8, 2.6]) for (const tt of [-1.6, 1.6]) body.push(...cuboid(L, a - 0.75, a + 0.75, tt - 0.45, tt + 0.45, 0, 1.5, { side: C.wheels }));
  view.faces(body, sortRef(view, L, 0, 0, 0), outline);
  // boom from the back up to the spreader head, spreader across the boom's end, load below it
  const m1 = view.m(1);
  const boom = Math.min(1, Math.max(0, rs.boom ?? 0));
  // the spreader centre where the model has it (the load clears the body), the boom ending above it
  const head = stackerReach(boom);
  const z = (rs.lift ?? view.m(3)) / m1, zTop = z + CRANE.spreaderHeight_m;
  const parts = beamFaces(L.p(-3, 0, 3.2), L.p(head, 0, zTop + 0.9), view.m(0.8), view.m(0.8), { side: COL.boom, top: COL.boomTop });
  const load = rs.load || null;
  const sp = Math.max(1, rs.spreader_m || load?.length / m1 || 6.058);
  const S = new Local(view, L.xy(head, 0), (rs.heading || 0) + Math.PI / 2);
  const sw = CONTAINER_WIDTH_M / 2;
  parts.push(...cuboid(S, -sp / 2, sp / 2, -sw, sw, z, zTop, { side: C.spreader, top: COL.spreaderTop, end: COL.spreaderEnd, bottom: !load }));
  parts.push(...cuboid(S, -0.6, 0.6, -0.6, 0.6, zTop, zTop + 0.9, { side: C.reachStacker, top: COL.stackerTop }));
  let ref = sortRef(view, S, 0, 0, view.m(z));
  if (load) {
    const box = { ...load, center: S.xy(0, 0), heading: S.heading, z0: z * m1 - load.height };
    const own = new Cells(view, S, 0, 0, { single: true });
    containerPieces(own, localBox(S, box), cssPx(view, k, box.length), 1, (i, faces) => parts.push(...faces));
    ref = sortRef(view, S, 0, 0, box.z0 + box.height / 2);
  }
  view.faces(parts, ref, outline);
  if (view.darkness > 0.05) {
    for (const tt of [-1.4, 1.4]) view.glow(L.p(4.05, tt, 1.6), view.m(0.6), HEADLIGHT, 0.8);
    view.glow(L.p(-0.5, -1.3, 4.6), view.m(0.5), CD.gelb, 0.8);
  }
}

/* ---------------------------------------------------------------- ground */

/** Corners of a rectangle around a centre (mm) with half sizes (mm) along u (angle) and across. */
function rectAt(center, angle, ha, ht) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-ha, -ht], [ha, -ht], [ha, ht], [-ha, ht]].map(([a, t]) => [center[0] + c * a - s * t, center[1] + s * a + c * t]);
}

/**
 * Lines (pairs of layout points) projected and stroked as one path in the ground layer; lines
 * with a point behind the camera are drawn on their own (the view cuts them off).
 */
function batchedLines(view, segments, colour, width, order) {
  const img = [];
  for (const [p, q] of segments) {
    const a = view.depth(p[0], p[1], p[2] || 0) > 2 ? view.project(p[0], p[1], p[2] || 0) : null;
    const b = a && view.depth(q[0], q[1], q[2] || 0) > 2 ? view.project(q[0], q[1], q[2] || 0) : null;
    if (a && b) img.push(a, b);
    else view.line([p, q], { stroke: colour, width, order, z: p[2] || 0 });
  }
  if (!img.length || view.offImage(img, (4 + width) * view.px)) return;
  const draw = (ctx) => {
    ctx.beginPath();
    for (let i = 0; i < img.length; i += 2) {
      ctx.moveTo(img[i][0], img[i][1]);
      ctx.lineTo(img[i + 1][0], img[i + 1][1]);
    }
    ctx.strokeStyle = view.dim(colour);
    ctx.lineWidth = width * view.px;
    ctx.lineCap = "butt";
    ctx.stroke();
  };
  draw.plain = true;
  view.ground(order, draw);
}

/**
 * Ground of a yard block: the concrete surface, the cell lines and the block's name.
 * @param {import("../core/view.js").View} view
 * @param {{center: number[], angle: number, width: number, depth: number, footprint: number[][], bays: number, rows: number}} geometry
 * @param {{name?: string}} [options]
 */
export function drawYardGround(view, geometry, { name = "" } = {}) {
  const g = geometry;
  if (!g?.footprint) return;
  view.polygon(g.footprint, { fill: TERMINAL_COLOURS.concrete, alpha: 0.9, order: 2.5 });
  const m1 = view.m(1);
  const bays = g.bays || 1, rows = g.rows || 1;
  const ha = (bays * BAY_M * m1) / 2, ht = (rows * ROW_M * m1) / 2;
  const L = new Local(view, g.center, g.angle || 0);
  const k = scaleAt(view, g.center[0], g.center[1], 0);
  if (!(k > 0) || cssPx(view, k, ROW_M * m1) >= 3) {
    const segs = [];
    for (let i = 0; i <= bays; i++) {
      const a = (-ha + (2 * ha * i) / bays) / m1;
      segs.push([L.xy(a, -ht / m1), L.xy(a, ht / m1)]);
    }
    for (let j = 0; j <= rows; j++) {
      const t = (-ht + (2 * ht * j) / rows) / m1;
      segs.push([L.xy(-ha / m1, t), L.xy(ha / m1, t)]);
    }
    const width = strokeWidth(view, g.center, view.m(0.15), 1, 3);
    batchedLines(view, segs, CSS.yardLine, width, 4);
  }
  if (name && cssPx(view, k, g.width) >= 60) {
    view.label([...L.xy(-(g.width / 2) / m1 - 3, 0), 0], name, { size: 10, background: OVERLAY.label, anchor: "right" });
  }
}

/**
 * Bay and row numbers (1-based) of a yard block, where a bay is at least 20 px on the screen.
 * @param {import("../core/view.js").View} view
 * @param {{center: number[], angle: number, bays: number, rows: number}} geometry
 */
export function drawYardLabels(view, geometry) {
  const g = geometry;
  if (!g?.center) return;
  const m1 = view.m(1), bays = g.bays || 1, rows = g.rows || 1;
  const L = new Local(view, g.center, g.angle || 0);
  const ha = (bays * BAY_M) / 2, ht = (rows * ROW_M) / 2;
  const style = { size: 10, background: OVERLAY.label, padding: 3 };
  for (let i = 0; i < bays; i++) {
    const a = -ha + BAY_M * (i + 0.5);
    const p = L.xy(a, -ht - 1.8);
    if (cssPx(view, scaleAt(view, p[0], p[1], 0), BAY_M * m1) >= 20) view.label([p[0], p[1], 0], String(i + 1), style);
  }
  for (let j = 0; j < rows; j++) {
    const t = -ht + ROW_M * (j + 0.5);
    const p = L.xy(-ha - 2.2, t);
    if (cssPx(view, scaleAt(view, p[0], p[1], 0), BAY_M * m1) >= 20) view.label([p[0], p[1], 0], String(j + 1), style);
  }
}

/**
 * Rails and runway of a gantry crane: a concrete runway 1 m wide and the rail on it.
 * @param {import("../core/view.js").View} view
 * @param {{railA: number[][], railB: number[][]}} geometry
 */
export function drawCraneRails(view, geometry) {
  const g = geometry;
  if (!g?.railA || !g?.railB) return;
  for (const rail of [g.railA, g.railB]) {
    view.ribbon(rail, view.m(1.0), { fill: TERMINAL_COLOURS.concrete, order: 3 });
    // the rail head as a ribbon (right in perspective, clipped at the camera) and a hairline on
    // it, so that it never vanishes in the distance
    view.ribbon(rail, view.m(0.072 * 1.6), { fill: TERMINAL_COLOURS.rail, order: 6 });
    view.line(rail, { stroke: TERMINAL_COLOURS.rail, width: 0.8, order: 6 });
  }
}

/** Dash quads of a truck lane's divider, per geometry (kept while the geometry lives). */
const DASHES = new WeakMap();

/**
 * A truck lane: asphalt for the loading lane and the passing lane beside it, a dashed divider
 * and the outlines of the truck positions.
 * @param {import("../core/view.js").View} view
 * @param {{points: number[][], lengths?: number[], total?: number, side: number, passingOffset: number}} geometry
 * @param {{positions?: number[]}} [options] arc lengths (mm) of the loading centres
 */
export function drawTruckLane(view, geometry, { positions = [] } = {}) {
  const g = geometry;
  if (!g?.points || g.points.length < 2) return;
  const m1 = view.m(1), side = g.side || 1, lane = 3.5 * m1;
  const off = g.passingOffset ?? side * lane;
  const a = offsetPolyline(g.points, -side * (lane / 2)), b = offsetPolyline(g.points, off + side * (lane / 2));
  view.polygon(a.concat(b.slice().reverse()), { fill: CSS.asphalt, order: 2 });
  // divider: 3 m dashes, 6 m gaps
  let dashes = DASHES.get(g);
  if (!dashes || dashes.m1 !== m1) {
    const line = offsetPolyline(g.points, off / 2);
    const lengths = polylineLengths(line), total = lengths[lengths.length - 1];
    const quads = [], w = 0.075 * m1;
    for (let s = 1.5 * m1; s + 3 * m1 < total; s += 9 * m1) {
      const p = polylineAt(line, s, lengths), q = polylineAt(line, s + 3 * m1, lengths);
      const n = [-p.dir[1] * w, p.dir[0] * w];
      quads.push([[p.point[0] - n[0], p.point[1] - n[1]], [q.point[0] - n[0], q.point[1] - n[1]], [q.point[0] + n[0], q.point[1] + n[1]], [p.point[0] + n[0], p.point[1] + n[1]]]);
    }
    dashes = { m1, quads };
    DASHES.set(g, dashes);
  }
  fillQuads(view, dashes.quads, CSS.marking, 2.2);
  // truck positions: 16.5 × 2.8 m from the rear (−6.8 m) to the front (+9.7 m) of a parked truck
  const lengths = g.lengths || polylineLengths(g.points);
  for (const s of positions) {
    const p = polylineAt(g.points, s, lengths);
    const center = [p.point[0] + p.dir[0] * 1.45 * m1, p.point[1] + p.dir[1] * 1.45 * m1];
    const rect = rectAt(center, Math.atan2(p.dir[1], p.dir[0]), 8.25 * m1, 1.4 * m1);
    view.polygon(rect, { stroke: CSS.marking, width: 1, alpha: 0.85, order: 2.3 });
  }
}

/** Quads (layout mm, on the ground) filled as one path. */
function fillQuads(view, quads, colour, order) {
  const imgs = [];
  for (const q of quads) {
    const img = view.projectAll(q);
    if (img && !view.offImage(img)) imgs.push(img);
  }
  if (!imgs.length) return;
  const draw = (ctx) => {
    ctx.beginPath();
    for (const img of imgs) {
      ctx.moveTo(img[0][0], img[0][1]);
      for (let i = 1; i < img.length; i++) ctx.lineTo(img[i][0], img[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = view.dim(colour);
    ctx.fill();
  };
  draw.plain = true;
  view.ground(order, draw);
}

/**
 * Water of the fairway and the quay wall with its edge.
 * @param {import("../core/view.js").View} view
 * @param {{points: number[][], lengths?: number[], quayOffset: number, water: number[][], wall: number[][], berth?: number[]}} geometry
 */
export function drawQuay(view, geometry) {
  const g = geometry;
  if (!g?.points) return;
  if (g.water) view.polygon(g.water, { fill: PALETTE.water, alpha: 0.95, order: 0.6 });
  if (g.wall) view.polygon(g.wall, { fill: TERMINAL_COLOURS.concrete, order: 3 });
  if (g.berth && Number.isFinite(g.quayOffset)) {
    const lengths = g.lengths || polylineLengths(g.points);
    const edge = slice(g.points, lengths, g.berth[0], g.berth[1]);
    if (edge.length >= 2) view.line(offsetPolyline(edge, g.quayOffset), { stroke: CSS.edge, width: 1.5, order: 3.1 });
  }
}

/** The part of a polyline between arc lengths s0 and s1. */
function slice(points, lengths, s0, s1) {
  const total = lengths[lengths.length - 1];
  const a = Math.max(0, Math.min(total, s0)), b = Math.max(0, Math.min(total, s1));
  if (!(b > a)) return [];
  const out = [polylineAt(points, a, lengths).point];
  for (let i = 1; i < points.length - 1; i++) if (lengths[i] > a && lengths[i] < b) out.push(points[i]);
  out.push(polylineAt(points, b, lengths).point);
  return out;
}

/* ---------------------------------------------------------------- highlights and picking */

/**
 * The selected container, possible targets and empty slots (overlay layer, never darkened).
 * @param {import("../core/view.js").View} view
 * @param {{selected?: import("./types.js").Box | null, targets?: import("./types.js").Box[], empties?: import("./types.js").Box[]}} [options]
 */
export function drawHighlights(view, { selected = null, targets = [], empties = [] } = {}) {
  for (const b of empties || []) {
    view.polygon(boxCorners(b).slice(0, 4), { z: b.z0, stroke: rgba(OVERLAY.tracked, 0.8), width: 1.5, layer: "overlay", order: 30 });
  }
  for (const b of targets || []) {
    view.polygon(boxCorners(b).slice(0, 4), { z: b.z0, stroke: OVERLAY.tracked, fill: rgba(OVERLAY.tracked, 0.16), width: 2, dash: [6, 4], layer: "overlay", order: 90 });
  }
  if (selected) {
    const top = selected.z0 + selected.height;
    view.polygon(boxCorners(selected).slice(4), { z: top, stroke: OVERLAY.selection, width: 2.5, layer: "overlay", order: 100 });
    view.label([selected.center[0], selected.center[1], top], selected.id, { size: 11, background: OVERLAY.label, anchor: "bottom", order: 100 });
  }
}

/**
 * A dashed outline at height z with a label (e.g. a model wagon that is not visible: "W3 not visible").
 * @param {import("../core/view.js").View} view
 * @param {number[][]} footprint layout mm
 * @param {number} z height (mm)
 * @param {string} label
 */
export function drawGhost(view, footprint, z, label) {
  if (!footprint?.length) return;
  view.polygon(footprint, { z, stroke: OVERLAY.tracked, width: 2, dash: [6, 4], alpha: 0.5, layer: "overlay", order: 20 });
  if (label) {
    let x = 0, y = 0;
    for (const p of footprint) {
      x += p[0];
      y += p[1];
    }
    view.label([x / footprint.length, y / footprint.length, z], label, { size: 11, background: OVERLAY.label, order: 20 });
  }
}

/**
 * The box under a canvas point (image px): the one whose projected outline (convex hull of its 8
 * corners) contains it, with 3 CSS px tolerance; the box nearest to the camera wins.
 * @param {import("../core/view.js").View} view
 * @param {import("./types.js").Box[]} boxes
 * @param {number} u
 * @param {number} v
 * @returns {string | null} its id
 */
export function pickBoxes(view, boxes, u, v) {
  const tol = 3 * (view.px || 1);
  let best = null, bestDepth = Infinity;
  for (const b of boxes || []) {
    const img = view.projectAll(boxCorners(b));
    if (!img) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of img) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    if (u < x0 - tol || u > x1 + tol || v < y0 - tol || v > y1 + tol) continue;
    if (!nearHull(convexHull(img), u, v, tol)) continue;
    const d = boxDepth(view, b);
    if (d < bestDepth) {
      bestDepth = d;
      best = b.id;
    }
  }
  return best;
}

/** Is (u, v) inside a convex polygon (counter-clockwise) or within `tol` of its outline? */
function nearHull(hull, u, v, tol) {
  const n = hull.length;
  if (n < 3) return n > 0 && hull.some((p) => Math.hypot(p[0] - u, p[1] - v) <= tol);
  let inside = true;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    if ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]) < 0) {
      inside = false;
      break;
    }
  }
  if (inside) return true;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / l2));
    if (Math.hypot(a[0] + dx * t - u, a[1] + dy * t - v) <= tol) return true;
  }
  return false;
}
