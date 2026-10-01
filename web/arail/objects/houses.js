/**
 * German house types for the town around the station, greyscale like a white architectural
 * model (see building-kit.js):
 * - `plattenbau`: GDR prefabricated slab blocks (WBS 70 with 6 or 11 floors, QP 61, P2),
 * - `altbau-block`: Gründerzeit perimeter block (Mietskaserne) around a courtyard,
 * - `house` and `house-estate`: single-family houses and an estate of them (Einfamilienhaussiedlung),
 * - `office`, `school` (like the GDR "Typ Erfurt"), `supermarket` and `factory` (sawtooth roof)
 *   as places of work, learning and shopping for the town simulation.
 * Sizes are prototype metres; the front (street side) is the local −y side.
 * @module arail/objects/houses
 */
import { resolvePoints } from "../core/anchors.js";
import { clamp, pointInPolygon, polygonCentroid } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";
import {
  BuildingBase, BuildingModel, Frame, TIER, TONES, axes, blockPiece, gableRoof, hipRoof, parapetRoof, sawtoothRoof,
} from "./building-kit.js";

const NAME = { key: "name", label: "Name", type: "text", default: "" };
const ROTATION = { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 };

/** Corners of a local rectangle, counter-clockwise from front left; side k runs from corner k. */
const corners = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
const SIDE_DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SIDE_OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Local point at distance s along side k of a rectangle. */
function onSide(r, k, s) {
  const c = corners(r)[k];
  return [c[0] + SIDE_DIR[k][0] * s, c[1] + SIDE_DIR[k][1] * s];
}

const num = (v, fallback, lo, hi) => clamp(Number.isFinite(+v) && v !== "" && v != null ? +v : fallback, lo, hi);

/* ================================================================== Plattenbau */

/**
 * Series of GDR prefabricated housing (Plattenbau). grid: axis spacing of the cross walls (m),
 * axes: grid axes per section (Aufgang), depth (m), fh: floor height (m).
 */
export const PLATTENBAU_SERIES = {
  wbs70: { label: "WBS 70 · 6 floors", floors: 6, grid: 6, axes: 2, depth: 12, fh: 2.8, loggia: "stack" },
  "wbs70-11": { label: "WBS 70 · 11 floors", floors: 11, grid: 6, axes: 2, depth: 12, fh: 2.8, loggia: "stack", lift: true },
  qp61: { label: "QP 61 · 8 floors", floors: 8, grid: 3.6, axes: 3, depth: 10.8, fh: 2.8, loggia: "recess" },
  p2: { label: "P2 · 5 floors", floors: 5, grid: 3.6, axes: 4, depth: 12, fh: 2.8, loggia: "recess" },
};

export class Plattenbau extends BuildingBase {
  static type = "plattenbau";
  static label = "Plattenbau";
  static use = "residential";
  static description = "GDR prefabricated slab block (WBS 70, QP 61, P2): panel joints, a stairwell per entrance, loggias on the garden side.";
  static params = [
    NAME,
    ROTATION,
    { key: "series", label: "Series", type: "select", options: Object.entries(PLATTENBAU_SERIES).map(([k, v]) => [k, v.label]), default: "wbs70" },
    { key: "sections", label: "Sections", type: "number", min: 1, max: 12, step: 1, default: 4, help: "Entrances (Aufgänge), about 12 m each" },
    { key: "floors", label: "Floors", type: "number", min: 2, max: 25, step: 1, help: "Leave empty for the series' number of floors" },
    { key: "balconies", label: "Loggias", type: "boolean", default: true },
  ];

  series() {
    return PLATTENBAU_SERIES[this.spec.series] || PLATTENBAU_SERIES.wbs70;
  }

  floorsCount() {
    return Math.round(num(this.spec.floors, this.series().floors, 1, 25));
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const S = this.series(), floors = this.floorsCount(), fh = S.fh;
    const n = Math.round(num(this.spec.sections, 4, 1, 12));
    const sec = S.grid * S.axes, L = n * sec, D = S.depth;
    const plinth = 1.2, H = plinth + floors * fh, top = H + 0.6;
    const x0 = -L / 2, x1 = L / 2, y0 = -D / 2, y1 = D / 2;
    const wall = m.wallTone([0.9, 0.97]);
    const jointTone = grey(TONES.joint), opening = grey(TONES.opening);
    m.setAnchor(0, 0, top / 2, Math.hypot(L, D) / 2 + 2);
    const body = m.box(x0, y0, x1, y1, 0, top, { wall });
    const roof = parapetRoof(m, { x0, y0, x1, y1, z: top, parapet: 0.35 });
    const [front, right, back, left] = body.walls;
    for (const w of body.walls) m.band(w, 0, plinth, grey(TONES.plinth));
    const J = 0.1;
    const hJoint = (w, z, s0 = 0, s1 = w.length) => m.decal(w, s0, s1, z - J / 2, z + J / 2, jointTone, TIER.fine);
    const vJoint = (w, s, z0 = plinth, z1 = top) => m.decal(w, s - J / 2, s + J / 2, z0, z1, jointTone, TIER.fine);
    const canopies = [], stacks = [], lifts = [];
    // entrance side: a stairwell per section with windows half a floor up, door and canopy
    for (let i = 0; i < n; i++) {
      const s0 = i * sec, sc = s0 + sec / 2, sw = 1.2;
      m.decal(front, sc - 0.8, sc + 0.8, 0, 2.3, grey(TONES.door));
      for (let f = 0; f < floors; f++) {
        const z = plinth + f * fh + fh / 2 + 0.45;
        if (z + 1.2 <= H) m.window(front, sc - 0.6, sc + 0.6, z, z + 1.2);
        if (z - 0.25 < top - 0.3) hJoint(front, z - 0.25, sc - sw, sc + sw);
      }
      for (const [a, b] of [[s0, sc - sw], [sc + sw, s0 + sec]]) {
        for (const s of axes(b - a, 2.4, 0.3)) {
          for (let f = 0; f < floors; f++) {
            const z = plinth + f * fh + 0.95;
            m.window(front, a + s - 0.6, a + s + 0.6, z, z + 1.25);
          }
        }
        for (let f = 1; f <= floors; f++) hJoint(front, plinth + f * fh, a, b);
      }
      vJoint(front, sc - sw);
      vJoint(front, sc + sw);
      if (i > 0) vJoint(front, s0);
      canopies.push(...m.box(x0 + sc - 1.4, y0 - 1.3, x0 + sc + 1.4, y0, 2.45, 2.7, { wall: grey(0.9), top: grey(0.86), skip: [2] }).faces);
      m.entrance(x0 + sc, y0);
      if (S.lift) lifts.push(...m.box(x0 + sc - 1.6, -2, x0 + sc + 1.6, 2, top, top + 2.6, { wall, top: grey(TONES.flatRoof) }).faces);
    }
    // garden side: windows, loggias of neighbouring sections side by side
    const balconies = this.spec.balconies !== false;
    for (let i = 0; i < n; i++) {
      const lp = i % 2 === 0 ? S.axes - 1 : 0;
      for (let j = 0; j < S.axes; j++) {
        const xa = x0 + i * sec + j * S.grid, xb = xa + S.grid;
        const sa = x1 - xb; // the back wall runs against x
        if (balconies && j === lp) {
          const lw = Math.min(3.6, S.grid - 0.6), xc = (xa + xb) / 2;
          if (S.loggia === "stack") stacks.push(...loggiaStack(m, xc, y1, lw, plinth, floors, fh, top - 0.3, wall));
          else recessedLoggias(m, back, x1 - xc, lw, plinth, floors, fh);
        } else {
          const per = S.grid >= 5 ? 2 : 1;
          for (const s of axes(S.grid, S.grid / per, 0.3)) {
            for (let f = 0; f < floors; f++) {
              const z = plinth + f * fh + 0.85;
              m.window(back, sa + s - 0.75, sa + s + 0.75, z, z + 1.45);
            }
          }
        }
        if (i > 0 || j > 0) vJoint(back, x1 - xa);
      }
    }
    for (let f = 1; f <= floors; f++) hJoint(back, plinth + f * fh);
    // gable ends: no windows (typical), two panels per floor
    for (const w of [right, left]) {
      vJoint(w, D / 2);
      for (let f = 1; f <= floors; f++) hJoint(w, plinth + f * fh);
    }
    m.part([...body.faces, roof]);
    if (stacks.length) m.part(stacks, { after: true, facing: back });
    m.part(canopies, { after: true, facing: front });
    if (lifts.length) m.part(lifts, { after: true, facing: roof });
    m.shadow(m.rect(x0, y0, x1, y1), top + (S.lift ? 2.6 : 0));
    return m.finish({
      footprint: m.rect(x0, y0, x1, y1),
      height: top + (S.lift ? 2.6 : 0),
      capacity: { residents: Math.round((L * D * floors) / 30) },
      detail: { window: 1.2, fine: J },
      size: { length: L, depth: D, sections: n, floors },
    });
  }
}

/** A stack of loggias standing in front of the garden wall (WBS 70); returns its faces. */
function loggiaStack(m, xc, y1, lw, z0, floors, fh, ztop, wall) {
  const b = m.box(xc - lw / 2, y1, xc + lw / 2, y1 + 1.5, z0, ztop, { wall, top: grey(TONES.flatRoof), skip: [0] });
  const face = b.walls[2];
  for (let f = 0; f < floors; f++) {
    const z = f * fh;
    m.decal(face, 0.2, lw - 0.2, z + 1.05, z + fh - 0.12, grey(TONES.opening));
    m.window(face, 0.55, lw - 0.55, z + 1.25, z + fh - 0.3);
    if (f > 0) m.decal(face, 0, lw, z - 0.05, z + 0.05, grey(TONES.joint), TIER.fine);
  }
  return b.faces;
}

/** Loggias set into the garden wall (QP 61, P2): dark recess, white parapet panel, window. */
function recessedLoggias(m, wall, sc, lw, z0, floors, fh) {
  for (let f = 0; f < floors; f++) {
    const z = z0 + f * fh;
    m.decal(wall, sc - lw / 2, sc + lw / 2, z + 0.1, z + fh - 0.15, grey(TONES.opening));
    m.decal(wall, sc - lw / 2, sc + lw / 2, z + 0.1, z + 1.1, grey(0.99));
    m.window(wall, sc - lw / 2 + 0.4, sc + lw / 2 - 0.4, z + 1.25, z + fh - 0.35);
  }
}

/* ================================================================== Altbau block */

const BLOCK_FORMS = [["closed", "closed block"], ["u", "U-shaped (open on one side)"], ["row", "single row"]];

/** Split [a, b] into parcels of about 15–22 m. */
function parcels(a, b, rng) {
  const len = b - a;
  const n = len < 10 ? 1 : Math.max(1, Math.round(len / 18));
  const w = [];
  for (let i = 0; i < n; i++) w.push(rng.uniform(15, 22));
  const sum = w.reduce((s, v) => s + v, 0);
  const out = [];
  let x = a;
  for (let i = 0; i < n; i++) {
    const nx = i === n - 1 ? b : x + (w[i] / sum) * len;
    out.push([x, nx]);
    x = nx;
  }
  return out;
}

export class AltbauBlock extends BuildingBase {
  static type = "altbau-block";
  static label = "Altbau block";
  static use = "residential";
  static description = "Gründerzeit perimeter block (Mietskaserne) around a courtyard: parcels with different eaves, tall windows, shops, gateways and mansard roofs.";
  static params = [
    NAME,
    ROTATION,
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 20, max: 200, step: 1, default: 60 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 12, max: 200, step: 1, default: 50 },
    { key: "wing_depth_m", label: "Wing depth", type: "number", unit: "m", min: 8, max: 20, step: 0.5, default: 13 },
    { key: "floors", label: "Floors", type: "number", min: 3, max: 6, step: 1, default: 5 },
    { key: "form", label: "Form", type: "select", options: BLOCK_FORMS, default: "closed" },
    { key: "rear_wings", label: "Side wings in the courtyard", type: "boolean", default: false, help: "Seitenflügel and Hinterhäuser" },
    { key: "roof", label: "Roof", type: "select", options: [["mansard", "mansard"], ["pitched", "pitched"]], default: "mansard" },
    { key: "seed", label: "Random seed", type: "number", min: 1, max: 9999, step: 1, default: 1 },
  ];

  floorsCount() {
    return Math.round(num(this.spec.floors, 5, 3, 6));
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec, rng = m.rng;
    const W = num(s.width_m, 60, 20, 200), D = num(s.depth_m, 50, 12, 200);
    const floors = this.floorsCount();
    let form = BLOCK_FORMS.some(([k]) => k === s.form) ? s.form : "closed";
    let wd = num(s.wing_depth_m, 13, 8, 20);
    // a courtyard needs at least 6 m; otherwise the block becomes a row
    const wdMax = form === "closed" ? (Math.min(W, D) - 6) / 2 : form === "u" ? Math.min((W - 6) / 2, D - 6) : D;
    if (wdMax < 8) form = "row";
    wd = form === "row" ? Math.min(wd, D) : Math.min(wd, wdMax);
    const mansard = s.roof !== "pitched";
    const inset = mansard ? 1.6 : wd / 2, rise = mansard ? 3.3 : (wd / 2) * Math.tan((40 * Math.PI) / 180);
    const X0 = -W / 2, X1 = W / 2, Y0 = -D / 2, Y1 = D / 2;
    m.setAnchor(0, 0, 10, Math.hypot(W, D) / 2 + 2);

    // pieces: rectangles with their sides [front, right, back, left]: street | court | joined | end
    const pieces = [];
    const add = (x0, y0, x1, y1, sides, kind) => pieces.push({ x0, y0, x1, y1, sides, kind });
    if (form === "row") {
      const ps = parcels(X0, X1, rng);
      ps.forEach(([a, b], i) => add(a, Y0, b, Y0 + wd, ["street", i === ps.length - 1 ? "end" : "joined", "court", i === 0 ? "end" : "joined"], "front"));
    } else {
      add(X0, Y0, X0 + wd, Y0 + wd, ["street", "joined", "joined", "street"], "corner");
      add(X1 - wd, Y0, X1, Y0 + wd, ["street", "street", "joined", "joined"], "corner");
      for (const [a, b] of parcels(X0 + wd, X1 - wd, rng)) add(a, Y0, b, Y0 + wd, ["street", "joined", "court", "joined"], "front");
      const yEnd = form === "closed" ? Y1 - wd : Y1;
      for (const [sideX0, streetSide] of [[X0, 3], [X1 - wd, 1]]) {
        const ps = parcels(Y0 + wd, yEnd, rng);
        ps.forEach(([a, b], i) => {
          const sides = ["joined", "court", form === "u" && i === ps.length - 1 ? "end" : "joined", "court"];
          sides[streetSide] = "street";
          add(sideX0, a, sideX0 + wd, b, sides, "side");
        });
      }
      if (form === "closed") {
        add(X0, Y1 - wd, X0 + wd, Y1, ["joined", "joined", "street", "street"], "corner");
        add(X1 - wd, Y1 - wd, X1, Y1, ["joined", "street", "street", "joined"], "corner");
        for (const [a, b] of parcels(X0 + wd, X1 - wd, rng)) add(a, Y1 - wd, b, Y1, ["court", "joined", "street", "joined"], "back");
      }
    }
    const rear = !!s.rear_wings;
    for (const p of pieces) {
      p.fh = rng.uniform(3.3, 3.75);
      p.gf = rng.uniform(3.8, 4.4);
      p.h = p.gf + (floors - 1) * p.fh;
      p.tone = rng.uniform(0.86, 0.97);
      p.roofTone = mansard ? rng.uniform(0.58, 0.68) : rng.uniform(0.6, 0.72);
      p.shop = rng.chance(p.kind === "corner" ? 0.85 : 0.5);
      p.gate = p.kind !== "corner" && p.kind !== "side" && rng.chance(rear ? 0.6 : 0.4);
    }

    let residents = 0, jobs = 0, height = 0;
    for (const p of pieces) {
      const r = blockPiece(m, { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, h: p.h, slope: p.sides.map((t) => t !== "joined"), inset, rise, wall: grey(p.tone), roof: grey(p.roofTone) });
      let entrance = null;
      for (let k = 0; k < 4; k++) {
        const t = p.sides[k];
        if (t === "joined") continue;
        const w = r.walls[k];
        let ax;
        if (t === "court") ax = courtFacade(m, w, p, floors, p.gate);
        else {
          const f = streetFacade(m, w, p, floors, { shops: t === "street" && p.shop, gate: t === "street" && p.gate, door: t === "street" });
          ax = f.axes;
          if (t === "street" && !entrance && f.doorAt != null) entrance = { k, s: f.doorAt };
        }
        // dormers in the mansard (or roof windows on the street side of a pitched roof)
        const slope = r.slopes[k];
        if (slope && (mansard || t !== "court")) {
          const sl = Math.hypot(inset, rise);
          const lo = (p.sides[(k + 3) % 4] !== "joined" ? inset : 0) + 0.8, hi = w.length - (p.sides[(k + 1) % 4] !== "joined" ? inset : 0) - 0.8;
          for (const a of ax) {
            if (a < lo || a > hi) continue;
            if (mansard) m.window(slope, a - 0.55, a + 0.55, 0.7, Math.min(sl - 0.5, 2.3));
            else m.window(slope, a - 0.5, a + 0.5, 1.4, 2.5);
          }
        }
      }
      m.part(r.faces);
      const chimneys = blockChimneys(m, p, r.top, mansard);
      if (chimneys.length) m.part(chimneys, { after: true });
      m.shadow(m.rect(p.x0, p.y0, p.x1, p.y1), r.top);
      if (entrance) {
        const [ex, ey] = onSide(p, entrance.k, entrance.s);
        m.entrance(ex, ey, SIDE_OUT[entrance.k][0], SIDE_OUT[entrance.k][1]);
      }
      const area = (p.x1 - p.x0) * (p.y1 - p.y0);
      residents += (area * (floors - (p.shop ? 1 : 0) + (mansard ? 0.6 : 0.3))) / 30;
      if (p.shop) jobs += area / 40;
      height = Math.max(height, r.top);
    }

    // side wings and rear buildings in the courtyard
    const courtDepth = form === "closed" ? D - 2 * wd : D - wd;
    const lr = Math.min((form === "closed" ? 0.42 : 0.6) * courtDepth, 20);
    if (rear && lr >= 5) {
      for (const p of pieces) {
        if (p.kind !== "front" && p.kind !== "back") continue;
        const ww = Math.min(6.5, (p.x1 - p.x0) / 2);
        const area = rearWing(m, p, p.kind === "front" ? [p.x1 - ww, p.y1, p.x1, p.y1 + lr] : [p.x0, p.y0 - lr, p.x0 + ww, p.y0], p.kind === "front", floors);
        residents += (area * (floors - 1)) / 30;
      }
    }

    // courtyard paving
    const paving = { fill: grey(TONES.paving), alpha: 0.45, order: 2 };
    if (form === "closed") m.plate(m.rect(X0 + wd, Y0 + wd, X1 - wd, Y1 - wd), paving);
    else if (form === "u") m.plate(m.rect(X0 + wd, Y0 + wd, X1 - wd, Y1), paving);
    else if (D - wd > 2) m.plate(m.rect(X0, Y0 + wd, X1, Y1), paving);

    return m.finish({
      footprint: m.rect(X0, Y0, X1, Y1),
      height,
      capacity: { residents: Math.round(residents), jobs: Math.round(jobs) },
      detail: { window: 1.25, fine: 0.2 },
      form,
      pieces: pieces.length,
    });
  }
}

/**
 * Street facade of a parcel: darker ground floor, band and cornice, shop windows or a door,
 * a gateway (Tordurchfahrt) in some parcels, tall windows with lintels on the first floor.
 * @returns {{axes: number[], doorAt: number | null}} window axes and the door/gateway position
 */
function streetFacade(m, w, p, floors, { shops, gate, door }) {
  const len = w.length, tone = p.tone;
  m.decal(w, 0, len, 0, p.gf, grey(tone - 0.05));
  m.decal(w, 0, len, p.gf - 0.05, p.gf + 0.3, grey(tone - 0.1));
  m.decal(w, 0, len, p.h - 0.75, p.h - 0.1, grey(tone - 0.11));
  const ax = axes(len, 3.3, 0.7);
  let doorAt = null;
  if (gate) {
    doorAt = len / 2;
    m.decal(w, doorAt - 1.6, doorAt + 1.6, 0, 3.6, grey(TONES.opening));
  } else if (door && ax.length) {
    doorAt = ax[Math.floor((ax.length - 1) / 2)];
    m.decal(w, doorAt - 0.7, doorAt + 0.7, 0, 3.1, grey(TONES.door));
  }
  for (const s of ax) {
    if (doorAt != null && Math.abs(s - doorAt) < (gate ? 2.2 : 0.8)) continue;
    if (shops) m.window(w, s - 1.15, s + 1.15, 0.45, 3.3, { group: "shop" });
    else m.window(w, s - 0.6, s + 0.6, 1.3, 3.3);
  }
  for (let f = 1; f < floors; f++) {
    const z = p.gf + (f - 1) * p.fh + 0.85, zt = z + Math.min(2.25, p.fh - 1.2);
    for (const s of ax) {
      m.window(w, s - 0.62, s + 0.62, z, zt);
      if (f === 1) m.decal(w, s - 0.85, s + 0.85, zt + 0.12, zt + 0.32, grey(tone - 0.12), TIER.fine);
    }
  }
  return { axes: ax, doorAt };
}

/** Courtyard facade: plain, smaller windows, the gateway if the parcel has one. Returns the axes. */
function courtFacade(m, w, p, floors, gate) {
  const len = w.length;
  const ax = axes(len, 3.0, 0.6);
  if (gate) m.decal(w, len / 2 - 1.6, len / 2 + 1.6, 0, 3.6, grey(TONES.opening));
  for (const s of ax) {
    if (!(gate && Math.abs(s - len / 2) < 2.1)) m.window(w, s - 0.55, s + 0.55, 1.2, 3.0);
    for (let f = 1; f < floors; f++) {
      const z = p.gf + (f - 1) * p.fh + 0.9;
      m.window(w, s - 0.55, s + 0.55, z, z + Math.min(1.9, p.fh - 1.3));
    }
  }
  return ax;
}

/** Chimneys on a block piece: on the flat top of a mansard or on the ridge of a pitched roof. */
function blockChimneys(m, p, top, mansard) {
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  const alongX = p.x1 - p.x0 >= p.y1 - p.y0, len = Math.max(p.x1 - p.x0, p.y1 - p.y0);
  const offsets = p.kind === "corner" ? [0] : len > 14 ? [-len / 4, len / 4] : [0];
  const z0 = mansard ? top - 0.2 : top - 0.35, z1 = top + (mansard ? 1.2 : 0.9);
  const faces = [];
  for (const o of offsets) {
    const x = alongX ? cx + o : cx, y = alongX ? cy : cy + o;
    faces.push(...m.box(x - 0.4, y - 0.4, x + 0.4, y + 0.4, z0, z1, { wall: grey(0.74), top: grey(0.66) }).faces);
  }
  return faces;
}

/**
 * Side wing (Seitenflügel) in the courtyard behind a parcel, one floor lower, with a lean-to
 * roof falling towards the courtyard. `r` = [x0, y0, x1, y1] in the block frame. Returns its area.
 */
function rearWing(m, p, [x0, y0, x1, y1], fromFront, floors) {
  const saved = m.frame;
  // own frame: x towards the main building, −y = the side facing the courtyard
  m.frame = saved.child((x0 + x1) / 2, (y0 + y1) / 2, fromFront ? -Math.PI / 2 : Math.PI / 2);
  const a = (y1 - y0) / 2, b = (x1 - x0) / 2;
  const hr = p.h - p.fh, rise = 1.8, wall = grey(p.tone - 0.03), roof = grey(Math.min(0.74, p.roofTone + 0.04));
  const court = m.wall([-a, -b], [a, -b], 0, hr, wall);
  const fire = m.wall([a, b], [-a, b], 0, hr + rise, wall);
  const end = m.face([[-a, b, 0], [-a, -b, 0], [-a, -b, hr], [-a, b, hr + rise]], wall);
  const top = m.face([[-a, -b, hr], [a, -b, hr], [a, b, hr + rise], [-a, b, hr + rise]], roof);
  const storey = (f) => (f === 0 ? 1.2 : p.gf + (f - 1) * p.fh + 0.9);
  for (let f = 0; f < floors - 1; f++) {
    for (const s of axes(2 * a, 3.0, 0.8)) m.window(court, s - 0.55, s + 0.55, storey(f), storey(f) + 1.7);
    for (const s of axes(2 * b, 3.0, 0.8)) m.window(end, s - 0.55, s + 0.55, storey(f), storey(f) + 1.7);
  }
  m.part([court, fire, end, top]);
  m.shadow(m.rect(-a, -b, a, b), hr + rise);
  m.frame = saved;
  return 4 * a * b;
}

/* ================================================================== single-family houses */

const HOUSE_STYLES = [["gable", "gable roof (Satteldach)"], ["hip", "hip roof (Walmdach, Stadtvilla)"], ["bungalow", "bungalow (flat roof)"], ["semi", "semi-detached (Doppelhaus)"]];

/**
 * Model one single-family house in the model's current frame, centred at the origin with the
 * front at −y: walls with windows and door(s), the roof, chimney, garage with driveway.
 * @param {BuildingModel} m
 * @param {{style: string, w: number, d: number, floors: number, garage?: boolean, garageSide?: number,
 *   chimney?: boolean, wallTone: number, roofTone: number}} o floors: 1, 1.5 (attic) or 2
 * @returns {{height: number, residents: number, footprint: number[][]}} local metres
 */
export function buildHouse(m, o) {
  const style = o.style, w = o.w, d = o.d, semi = style === "semi", side = o.garageSide < 0 ? -1 : 1;
  const plinth = 0.4, sh = 2.75;
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const storeys = style === "bungalow" ? 1 : style === "hip" ? Math.max(1, Math.ceil(o.floors - 0.25)) : Math.max(1, Math.floor(o.floors));
  const attic = (style === "gable" || semi) && o.floors - Math.floor(o.floors) >= 0.5;
  const hw = plinth + storeys * sh + (attic ? 1 : 0) + (style === "bungalow" ? 0.3 : 0);
  const wallA = grey(o.wallTone), wallB = grey(clamp(o.wallTone + (o.wallTone > 0.93 ? -0.05 : 0.04), 0.85, 0.99));
  const roofA = grey(o.roofTone), roofB = grey(clamp(o.roofTone + 0.07, 0.55, 0.78));
  const garages = o.garage ? (semi ? [-1, 1] : [side]) : [];
  const gw = 3.2;
  const fx0 = x0 - (garages.includes(-1) ? gw + 0.6 : 0), fx1 = x1 + (garages.includes(1) ? gw + 0.6 : 0);
  m.setAnchor(0, 0, hw / 2, Math.hypot(fx1 - fx0, d) / 2 + 2);

  // walls; a semi-detached house is two halves in slightly different tones
  const faces = [], doors = [];
  const fronts = [];
  if (semi) {
    const l = m.box(x0, y0, 0, y1, 0, hw, { wall: wallA, skip: [1] }), r = m.box(0, y0, x1, y1, 0, hw, { wall: wallB, skip: [3] });
    faces.push(...l.faces, ...r.faces);
    fronts.push({ face: l.walls[0], door: 1.4, x: x0 }, { face: r.walls[0], door: w / 2 - 1.4, x: 0 });
    for (const f of [l.walls[2], l.walls[3], r.walls[1], r.walls[2]]) houseWindows(m, f, storeys, null, false);
  } else {
    const b = m.box(x0, y0, x1, y1, 0, hw, { wall: wallA });
    faces.push(...b.faces);
    const door = style === "hip" ? w / 2 : side > 0 ? w * 0.68 : w * 0.32;
    fronts.push({ face: b.walls[0], door, x: x0 });
    for (const f of b.walls.slice(1)) houseWindows(m, f, storeys, null, style === "bungalow");
  }
  for (const f of fronts) {
    houseWindows(m, f.face, storeys, f.door, style === "bungalow");
    doors.push([f.x + f.door, y0]);
  }

  // roof
  let height = hw, chimneys = [];
  if (style === "gable" || semi) {
    const pitch = attic ? 45 : 38, ridge = semi || w >= d ? "x" : "y";
    const r = gableRoof(m, { x0, y0, x1, y1, z: hw, pitch, overhang: 0.45, ridge, roof: roofA, wall: wallA, split: semi ? 0 : null, roof2: roofB });
    faces.push(...r.faces);
    height = r.ridgeZ;
    if (attic) {
      for (const g of r.gables) {
        const base = g.length;
        if (r.ridgeZ - hw > 2.6) m.window(g, base / 2 - 0.5, base / 2 + 0.5, 0.5, 1.7);
      }
      for (const sl of r.slopes) for (const a of axes(sl.length, 4, 1.5)) m.window(sl, a - 0.45, a + 0.45, r.slopeLength * 0.42, r.slopeLength * 0.42 + 1.1);
    }
    if (o.chimney !== false) {
      const t = Math.tan((pitch * Math.PI) / 180);
      const spots = semi ? [[-w / 4, 0.6], [w / 4, 0.6]] : ridge === "x" ? [[-side * w / 5, 0.6]] : [[0.6, d / 5]];
      for (const [cx, cy] of spots) {
        const zr = r.ridgeZ - Math.abs(ridge === "x" ? cy : cx) * t;
        chimneys.push(...m.box(cx - 0.3, cy - 0.3, cx + 0.3, cy + 0.3, zr - 0.15, r.ridgeZ + 0.8, { wall: grey(0.74), top: grey(0.66) }).faces);
      }
    }
  } else if (style === "hip") {
    const r = hipRoof(m, { x0, y0, x1, y1, z: hw, pitch: 24, overhang: 0.7, roof: roofA });
    faces.push(...r.faces);
    height = r.ridgeZ;
    if (o.chimney !== false) chimneys = m.box(-0.3, 0.2, 0.3, 0.8, r.ridgeZ - 0.4, r.ridgeZ + 0.6, { wall: grey(0.74), top: grey(0.66) }).faces;
  }
  m.part(faces);
  if (style === "bungalow") {
    m.part(m.box(x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6, hw, hw + 0.35, { wall: grey(0.93), top: grey(TONES.flatRoof) }).faces, { after: true });
    height = hw + 0.35;
    if (o.chimney !== false) chimneys = m.box(w / 4 - 0.25, d / 5 - 0.25, w / 4 + 0.25, d / 5 + 0.25, height, height + 0.8, { wall: grey(0.74), top: grey(0.66) }).faces;
  }
  if (chimneys.length) m.part(chimneys, { after: true });
  m.shadow(m.rect(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5), height);

  // garages with driveways, paths to the doors
  const paving = { fill: grey(TONES.paving), alpha: 0.55, order: 2 };
  for (const g of garages) {
    const gx0 = g > 0 ? x1 + 0.6 : x0 - 0.6 - gw, gx1 = gx0 + gw, gy0 = y0 + 0.6, gy1 = gy0 + 6;
    const b = m.box(gx0, gy0, gx1, gy1, 0, 2.9, { wall: grey(clamp(o.wallTone - 0.02, 0.85, 0.99)) });
    m.decal(b.walls[0], 0.35, gw - 0.35, 0, 2.25, grey(0.62));
    const top = parapetRoof(m, { x0: gx0, y0: gy0, x1: gx1, y1: gy1, z: 2.9, parapet: 0.2 });
    m.part([...b.faces, top]);
    m.shadow(m.rect(gx0, gy0, gx1, gy1), 2.9);
    m.plate(m.rect(gx0, y0 - 5, gx1, gy0), paving);
  }
  for (const [dx] of doors) m.plate(m.rect(dx - 0.6, y0 - 5, dx + 0.6, y0), paving);
  for (const [dx, dy] of doors) m.entrance(dx, dy);
  const floorArea = w * d * (storeys + (attic ? 0.6 : 0));
  const residents = semi ? 2 * Math.max(2, Math.round(floorArea / 2 / 45)) : Math.max(2, Math.round(floorArea / 45));
  return { height, residents, footprint: m.rect(fx0, y0, fx1, y1) };
}

/** Windows of one house wall per storey (and the front door at `door`, m along the wall). */
function houseWindows(m, face, storeys, door, big) {
  const len = face.length;
  if (door != null) m.decal(face, door - 0.55, door + 0.55, 0, 2.6, grey(TONES.door));
  for (let f = 0; f < storeys; f++) {
    const z0 = 0.4 + f * 2.75;
    for (const s of axes(len, big ? 3.2 : 2.6, big ? 1 : 0.9)) {
      if (door != null && f === 0 && Math.abs(s - door) < (big ? 1.7 : 1.3)) continue;
      const hw = big ? 1 : 0.6;
      m.window(face, s - hw, s + hw, z0 + (big ? 0.5 : 0.95), z0 + 2.25);
    }
  }
}

export class House extends BuildingBase {
  static type = "house";
  static label = "Single-family house";
  static use = "residential";
  static description = "A detached or semi-detached house with a gable, hip or flat roof, optionally with a garage.";
  static params = [
    NAME,
    ROTATION,
    { key: "style", label: "Style", type: "select", options: HOUSE_STYLES, default: "gable" },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 6, max: 24, step: 0.5, default: 10, help: "Semi-detached: both halves together" },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 6, max: 16, step: 0.5, default: 9 },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 2, step: 0.5, default: 1.5, help: "1.5 = one floor and an attic" },
    { key: "garage", label: "Garage", type: "boolean", default: true },
    { key: "chimney", label: "Chimney", type: "boolean", default: true },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    const h = buildHouse(m, {
      style: HOUSE_STYLES.some(([k]) => k === s.style) ? s.style : "gable",
      w: num(s.width_m, 10, 6, 24), d: num(s.depth_m, 9, 6, 16), floors: num(s.floors, 1.5, 1, 2),
      garage: !!s.garage, garageSide: 1, chimney: s.chimney !== false,
      wallTone: m.rng.uniform(0.9, 0.98), roofTone: m.rng.uniform(...TONES.roof),
    });
    return m.finish({ footprint: h.footprint, height: h.height, capacity: { residents: h.residents }, detail: { window: 1.1 } });
  }
}

/* ================================================================== estate */

const ESTATE_MIX = [["mixed", "mixed"], ["gable", "gable roofs"], ["hip", "hip roofs (Stadtvillen)"], ["bungalow", "bungalows"]];

export class HouseEstate extends BuildingBase {
  static type = "house-estate";
  static label = "Single-family estate";
  static use = "residential";
  static placement = "polygon";
  static description = "An estate of single-family houses (Einfamilienhaussiedlung): rows of plots along the longest edge, back to back, with room for streets in between.";
  static params = [
    NAME,
    { key: "plot_width_m", label: "Plot width", type: "number", unit: "m", min: 10, max: 40, step: 1, default: 16 },
    { key: "plot_depth_m", label: "Plot depth", type: "number", unit: "m", min: 15, max: 60, step: 1, default: 28 },
    { key: "mix", label: "Houses", type: "select", options: ESTATE_MIX, default: "mixed" },
    { key: "garages", label: "Garages", type: "boolean", default: true },
    { key: "density", label: "Built plots", type: "number", min: 0.5, max: 1, step: 0.05, default: 0.85, help: "Share of the plots with a house" },
    { key: "street_m", label: "Street between rows", type: "number", unit: "m", min: 0, max: 30, step: 1, default: 12, help: "Space left for a street between each pair of rows (0 = none)" },
    { key: "seed", label: "Random seed", type: "number", min: 1, max: 9999, step: 1, default: 1 },
  ];

  floorsCount() {
    return 2;
  }

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    if (!pts || pts.length < 3) return null;
    const s = this.spec;
    const pw = num(s.plot_width_m, 16, 10, 40), pd = num(s.plot_depth_m, 28, 15, 60), st = num(s.street_m, 12, 0, 30);
    const density = num(s.density, 0.85, 0.5, 1);
    const k = this.mm(1);
    // frame on the longest edge, local y into the polygon
    let best = 0, ia = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best) {
        best = l;
        ia = i;
      }
    }
    const a = pts[ia], b = pts[(ia + 1) % pts.length];
    // (an outline whose points all coincide has no direction: no plots, but no NaN either)
    let ux = best > 1e-9 ? (b[0] - a[0]) / best : 1, uy = best > 1e-9 ? (b[1] - a[1]) / best : 0;
    const c = polygonCentroid(pts);
    if ((c[0] - a[0]) * -uy + (c[1] - a[1]) * ux < 0) {
      ux = -ux;
      uy = -uy;
    }
    const frame = new Frame(a, Math.atan2(uy, ux), k);
    const m = new BuildingModel(frame, { seed: this.seed() });
    const rng = m.rng;
    const local = pts.map((p) => [((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / k, ((p[0] - a[0]) * -uy + (p[1] - a[1]) * ux) / k]);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of local) {
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    // a plot is used when it lies completely inside the outline: its corners inside, no corner
    // of the outline in it and no edge of the outline crossing it (a narrow notch or slit)
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const crosses = (p, q, r, t) => {
      const d1 = cross(p, q, r), d2 = cross(p, q, t), d3 = cross(r, t, p), d4 = cross(r, t, q);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    const inside = (x0, y0, x1, y1) => {
      const e = 0.02;
      const c = corners({ x0: x0 + e, y0: y0 + e, x1: x1 - e, y1: y1 - e });
      if (!c.every((q) => pointInPolygon(q, local))) return false;
      if (local.some(([x, y]) => x > x0 + e && x < x1 - e && y > y0 + e && y < y1 - e)) return false;
      for (let i = 0; i < local.length; i++) {
        const p = local[i], q = local[(i + 1) % local.length];
        for (let k = 0; k < 4; k++) if (crosses(p, q, c[k], c[(k + 1) % 4])) return false;
      }
      return true;
    };
    const nCols = Math.floor((xmax - xmin) / pw);
    const xs = xmin + ((xmax - xmin) - nCols * pw) / 2;
    const plots = [], houses = [];
    let residents = 0, height = 0;
    const pick = () => {
      if (s.mix === "gable" || s.mix === "hip" || s.mix === "bungalow") return s.mix;
      const r = rng.next();
      return r < 0.55 ? "gable" : r < 0.85 ? "hip" : "bungalow";
    };
    const t0 = Math.max(0, ymin);
    for (let r = 0; ; r++) {
      const y0 = t0 + Math.floor(r / 2) * (2 * pd + st) + (r % 2) * pd;
      if (!(y0 + pd <= ymax + 1e-6)) break; // (also stops on NaN)
      const facing = r % 2 === 0 ? -1 : 1; // front towards −y (the edge or a street) or +y
      for (let j = 0; j < nCols; j++) {
        const x0 = xs + j * pw, x1 = x0 + pw;
        const built = rng.next() < density;
        const style = pick();
        const jitter = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
        if (!inside(x0, y0, x1, y0 + pd)) continue;
        plots.push(m.rect(x0, y0, x1, y0 + pd));
        if (!built) continue;
        const garage = s.garages !== false && pw >= 13;
        const maxW = pw - 3 - (garage ? 3.8 : 0);
        const w = clamp(8.5 + 3 * jitter[0], 6.5, Math.max(6.5, maxW)), d = clamp(8 + 2 * jitter[1], 7, pd - 10);
        const floors = style === "gable" ? (jitter[2] < 0.7 ? 1.5 : 2) : style === "hip" ? 2 : 1;
        const gSide = jitter[3] < 0.5 ? -1 : 1;
        const front = facing < 0 ? y0 : y0 + pd;
        const hx = (x0 + x1) / 2 - (garage ? gSide * 1.9 * -facing : 0), hy = front - facing * (5 + d / 2);
        const saved = m.frame;
        m.frame = frame.child(hx, hy, facing < 0 ? 0 : Math.PI);
        const h = buildHouse(m, { style, w, d, floors, garage, garageSide: gSide, chimney: style !== "bungalow" || jitter[4] < 0.3, wallTone: rng.uniform(0.89, 0.98), roofTone: rng.uniform(...TONES.roof) });
        m.frame = saved;
        residents += h.residents;
        height = Math.max(height, h.height);
        houses.push({ center: frame.xy(hx, hy), style, front: facing });
      }
    }
    for (const p of plots) m.plate(p, { fill: grey(0.94), alpha: 0.35, stroke: grey(TONES.plot), width: 0.8, order: 1.8 });
    return m.finish({
      layoutFootprint: pts,
      height,
      capacity: { residents },
      detail: { window: 1.1 },
      center: polygonCentroid(pts),
      plots: plots.map((p) => p.map(([x, y]) => frame.xy(x, y))),
      houses,
    });
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }
}

/* ================================================================== office, school, shop, workshop */

export class Office extends BuildingBase {
  static type = "office";
  static label = "Office building";
  static use = "work";
  static description = "Office building with ribbon windows and a flat roof.";
  static params = [
    NAME,
    ROTATION,
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 10, max: 120, step: 1, default: 30 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 8, max: 40, step: 1, default: 15 },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 20, step: 1, default: 4 },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    const w = num(s.width_m, 30, 10, 120), d = num(s.depth_m, 15, 8, 40), floors = this.floorsCount(), fh = 3.6;
    const top = floors * fh + 0.9, x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    m.setAnchor(0, 0, top / 2, Math.hypot(w, d) / 2 + 2);
    const body = m.box(x0, y0, x1, y1, 0, top, { wall: m.wallTone([0.9, 0.97]) });
    const roof = parapetRoof(m, { x0, y0, x1, y1, z: top, parapet: 0.35 });
    const glass = grey(TONES.glass), hall = [w / 2 - 3.2, w / 2 + 3.2];
    body.walls.forEach((wall, side) => {
      const len = wall.length, n = Math.max(1, Math.round((len - 0.8) / 3)), bay = (len - 0.8) / n;
      for (let f = 0; f < floors; f++) {
        const z0 = f * fh + 0.95, z1 = f * fh + 2.95;
        const entrance = side === 0 && f === 0;
        if (!entrance) m.decal(wall, 0.4, len - 0.4, z0, z1, glass);
        for (let i = 0; i < n; i++) {
          const a = 0.4 + i * bay, b = a + bay;
          if (entrance && b > hall[0] && a < hall[1]) continue;
          if (entrance) m.decal(wall, a + 0.1, b - 0.1, z0, z1, glass);
          m.window(wall, a + 0.1, b - 0.1, z0, z1, { colour: glass });
        }
      }
      if (side === 0) m.decal(wall, hall[0], hall[1], 0, 3.2, glass);
    });
    m.part([...body.faces, roof]);
    m.part(m.box(-3.5, y0 - 2.4, 3.5, y0, 3.35, 3.65, { wall: grey(0.88), top: grey(0.84), skip: [2] }).faces, { after: true, facing: body.walls[0] });
    const pw = Math.min(8, w * 0.3), pd = Math.min(5, d * 0.4);
    m.part(m.box(x1 - pw - 2, -pd / 2, x1 - 2, pd / 2, top, top + 2.4, { wall: grey(0.86), top: grey(0.78) }).faces, { after: true, facing: roof });
    m.shadow(m.rect(x0, y0, x1, y1), top);
    m.entrance(0, y0);
    return m.finish({ footprint: m.rect(x0, y0, x1, y1), height: top, capacity: { jobs: Math.round((w * d * floors) / 25) }, detail: { window: 2 } });
  }
}

export class School extends BuildingBase {
  static type = "school";
  static label = "School";
  static use = "school";
  static description = "School like the GDR \"Typ Erfurt\": a long block with a stair tower at the entrance and a gym hall behind.";
  static params = [
    NAME,
    ROTATION,
    { key: "floors", label: "Floors", type: "number", min: 2, max: 5, step: 1, default: 3 },
    { key: "gym", label: "Gym hall", type: "boolean", default: true },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const floors = Math.round(num(this.spec.floors, 3, 2, 5)), gym = this.spec.gym !== false;
    const W = 60, D = 13, fh = 3.5, plinth = 0.5, top = plinth + floors * fh + 0.6;
    const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
    const wall = m.wallTone([0.9, 0.97]), glass = grey(TONES.glass);
    m.setAnchor(0, gym ? 6 : 0, top / 2, 40);
    const body = m.box(x0, y0, x1, y1, 0, top, { wall });
    const roof = parapetRoof(m, { x0, y0, x1, y1, z: top, parapet: 0.35 });
    body.walls.forEach((w, side) => {
      m.band(w, 0, plinth, grey(TONES.plinth));
      if (side === 1 || side === 3) return;
      // groups of three windows between piers, a parapet band under each row
      for (const g of axes(w.length, 10.8, 1.2)) {
        if (side === 0 && Math.abs(g - W / 2) < 6) continue;
        for (let f = 0; f < floors; f++) {
          const z = plinth + f * fh + 0.95;
          for (let i = -1; i <= 1; i++) m.window(w, g + i * 3 - 1.3, g + i * 3 + 1.3, z, z + 1.95);
          m.decal(w, g - 4.6, g + 4.6, z - 0.2, z - 0.05, grey(0.8), TIER.fine);
        }
      }
    });
    m.part([...body.faces, roof]);
    // stair tower with the entrance, in front of the middle
    const tower = m.box(-4, y0 - 3, 4, y0, 0, top + 1.2, { wall, top: grey(TONES.flatRoof), skip: [2] });
    const tf = tower.walls[0];
    m.decal(tf, 2.5, 5.5, 3.6, top + 0.4, glass);
    for (let f = 1; f < floors; f++) m.window(tf, 2.7, 5.3, plinth + f * fh + 0.2, plinth + f * fh + 2.2);
    m.decal(tf, 2, 6, 0, 2.9, glass);
    m.part(tower.faces, { ref: [0, y0 - 1.5] });
    m.part(m.box(-3, y0 - 5.5, 3, y0 - 3, 3.1, 3.4, { wall: grey(0.88), top: grey(0.84), skip: [2] }).faces, { after: true, facing: tf });
    m.shadow(m.rect(x0, y0 - 3, x1, y1), top + 1.2);
    m.entrance(0, y0 - 3);
    let ymax = y1;
    if (gym) {
      const gx0 = x1 - 32, gx1 = x1 - 4, gy0 = y1 + 6, gy1 = y1 + 24, gh = 7.5;
      const hall = m.box(gx0, gy0, gx1, gy1, 0, gh, { wall });
      const hallRoof = parapetRoof(m, { x0: gx0, y0: gy0, x1: gx1, y1: gy1, z: gh, parapet: 0.3 });
      for (const side of [0, 2]) for (const a of axes(gx1 - gx0, 3.5, 1)) m.window(hall.walls[side], a - 1.5, a + 1.5, 4.6, 6.8);
      m.part([...hall.faces, hallRoof]);
      m.shadow(m.rect(gx0, gy0, gx1, gy1), gh);
      const cx = (gx0 + gx1) / 2;
      const corridor = m.box(cx - 2, y1, cx + 2, gy0, 0, 3.6, { wall, top: grey(TONES.flatRoof), skip: [0, 2] });
      for (const w of [corridor.walls[1], corridor.walls[3]]) m.window(w, 0.5, w.length - 0.5, 1.1, 2.9);
      m.part(corridor.faces);
      ymax = gy1;
    }
    return m.finish({
      footprint: m.rect(x0, y0 - 3, x1, ymax),
      height: top + 1.2,
      capacity: { pupils: 100 * floors, jobs: 10 * floors },
      detail: { window: 1.9, fine: 0.15 },
    });
  }

  floorsCount() {
    return Math.round(num(this.spec.floors, 3, 2, 5));
  }
}

export class Supermarket extends BuildingBase {
  static type = "supermarket";
  static label = "Supermarket";
  static use = "shop";
  static description = "Single-storey supermarket with a glass front and a parking lot in front of it.";
  static params = [
    NAME,
    ROTATION,
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 20, max: 120, step: 1, default: 45 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 15, max: 80, step: 1, default: 30 },
    { key: "parking", label: "Parking lot", type: "boolean", default: true },
  ];

  floorsCount() {
    return 1;
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    const w = num(s.width_m, 45, 20, 120), d = num(s.depth_m, 30, 15, 80), parking = s.parking !== false;
    const H = 5, x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    m.setAnchor(0, parking ? -10 : 0, 2.5, Math.hypot(w, d + (parking ? 20 : 0)) / 2 + 2);
    const body = m.box(x0, y0, x1, y1, 0, H, { wall: m.wallTone([0.92, 0.98]) });
    const roof = parapetRoof(m, { x0, y0, x1, y1, z: H, parapet: 0.3 });
    const front = body.walls[0], glass = grey(TONES.glass);
    const g0 = 1.5, g1 = g0 + Math.round((0.55 * w) / 2.5) * 2.5;
    m.decal(front, g0, g1, 0.15, 3.6, glass);
    for (let a = g0; a < g1 - 0.1; a += 2.5) m.window(front, a + 0.06, a + 2.44, 0.15, 3.6, { group: "shop", colour: glass });
    m.decal(front, 0.5, w - 0.5, 4.3, 4.8, grey(0.82));
    m.decal(body.walls[2], 3, 7.5, 0, 4.2, grey(0.62));
    m.part([...body.faces, roof]);
    m.part(m.box(x0 + g0 - 0.5, y0 - 2.8, x0 + g1 + 0.5, y0, 3.8, 4.2, { wall: grey(0.9), top: grey(0.84), skip: [2] }).faces, { after: true, facing: front });
    const hvac = [];
    for (const [cx, cy] of [[w * 0.2, d * 0.15], [-w * 0.15, -d * 0.1]]) hvac.push(...m.box(cx - 1.5, cy - 1, cx + 1.5, cy + 1, H, H + 1.4, { wall: grey(0.84), top: grey(0.76) }).faces);
    m.part(hvac, { after: true, facing: roof });
    m.shadow(m.rect(x0, y0, x1, y1), H);
    const door = x0 + g0 + 2.5;
    m.entrance(door, y0);
    let fy0 = y0;
    if (parking) {
      fy0 = y0 - 20;
      m.plate(m.rect(x0, fy0, x1, y0 - 0.5), { fill: grey(TONES.asphalt), alpha: 0.85, order: 2 });
      const mark = { stroke: grey(TONES.marking), width: 1, order: 2.2 };
      for (const [ya, yb] of [[y0 - 3.5, y0 - 8.5], [y0 - 14.5, y0 - 19.5]]) {
        m.line([[x0 + 1, yb], [x1 - 1, yb]], mark);
        for (let x = x0 + 1; x <= x1 - 1 + 1e-6; x += 2.5) m.line([[x, ya], [x, yb]], mark);
      }
    }
    const lights = { door: m.frame.xy(door, y0 - 3), lot: parking ? [m.frame.xy(x0 + w * 0.25, y0 - 11.5), m.frame.xy(x0 + w * 0.75, y0 - 11.5)] : [] };
    return m.finish({
      footprint: m.rect(x0, fy0, x1, y1),
      height: H + 1.4,
      capacity: { visitors: Math.round((w * d) / 12), jobs: Math.max(5, Math.round((w * d) / 90)) },
      detail: { window: 2.4 },
      lights,
    });
  }

  draw(view) {
    super.draw(view);
    const g = this.geometry, open = this.litShare(view.darkness).shop;
    if (open < 0.05) return;
    view.lightPool(g.lights.door, this.mm(9), PALETTE.litWindow, 0.9 * open);
    for (const p of g.lights.lot) view.lightPool(p, this.mm(8), "#fff4dc", 0.6 * open);
  }
}

export class Factory extends BuildingBase {
  static type = "factory";
  static label = "Workshop / factory";
  static use = "work";
  static description = "Workshop hall with a sawtooth (shed) roof and an optional chimney.";
  static params = [
    NAME,
    ROTATION,
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 15, max: 150, step: 1, default: 40 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 10, max: 80, step: 1, default: 25 },
    { key: "chimney", label: "Chimney", type: "boolean", default: true },
  ];

  floorsCount() {
    return 1;
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    const w = num(s.width_m, 40, 15, 150), d = num(s.depth_m, 25, 10, 80), chimney = s.chimney !== false;
    const H = 6.5, rise = 2.6, teeth = Math.max(2, Math.round(d / 5));
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    const wall = m.wallTone([0.88, 0.95]), glass = grey(TONES.glass);
    m.setAnchor(0, 0, 4, Math.hypot(w + 8, d) / 2 + 2);
    const body = m.box(x0, y0, x1, y1, 0, H, { wall, skip: [1, 3] });
    const roof = sawtoothRoof(m, { x0, y0, x1, y1, z: H, teeth, rise, roof: grey(0.7), glass, wall });
    for (const g of roof.glazing) for (let a = 0.6; a < g.length - 1; a += 3) m.window(g, a, a + 2.6, 0.3, rise - 0.3, { colour: glass });
    const walls = [body.walls[0], body.walls[2], ...roof.ends];
    walls.forEach((f, i) => {
      const len = f.length;
      m.decal(f, 0.5, len - 0.5, 3, 5.6, glass);
      const gate = i === 0 ? [len * 0.25 - 2.5, len * 0.25 + 2.5] : null;
      for (const a of axes(len, 4, 0.5)) {
        if (gate && a + 1.7 > gate[0] - 0.5 && a - 1.7 < gate[1] + 0.5) continue;
        m.window(f, a - 1.7, a + 1.7, 3, 5.6, { colour: glass });
      }
      if (gate) {
        m.decal(f, gate[0], gate[1], 0, 4.6, grey(0.62));
        for (let z = 0.5; z < 4.5; z += 0.5) m.decal(f, gate[0], gate[1], z - 0.03, z + 0.03, grey(0.7), TIER.fine);
        m.decal(f, len * 0.6, len * 0.6 + 1.1, 0, 2.3, grey(TONES.door));
      }
    });
    m.part([...body.faces, ...roof.faces]);
    m.shadow(m.rect(x0, y0, x1, y1), H + rise);
    let fx1 = x1;
    if (chimney) {
      const cx = x1 + 2.5, cy = y1 - 3, hc = 28, ring = [];
      for (let i = 0; i < 8; i++) ring.push([Math.cos((i * Math.PI) / 4 + Math.PI / 8), Math.sin((i * Math.PI) / 4 + Math.PI / 8)]);
      const faces = [];
      for (let i = 0; i < 8; i++) {
        const p = ring[i], q = ring[(i + 1) % 8];
        faces.push(m.face([[cx + p[0] * 1.1, cy + p[1] * 1.1, 0], [cx + q[0] * 1.1, cy + q[1] * 1.1, 0], [cx + q[0] * 0.75, cy + q[1] * 0.75, hc], [cx + p[0] * 0.75, cy + p[1] * 0.75, hc]], grey(0.72)));
      }
      faces.push(m.face(ring.map(([x, y]) => [cx + x * 0.75, cy + y * 0.75, hc]), grey(0.55)));
      m.part(faces, { ref: [cx, cy] });
      m.shadow(ring.map(([x, y]) => [cx + x, cy + y]), hc);
      fx1 = x1 + 4;
    }
    m.entrance(x0 + w * 0.6 + 0.55, y0);
    return m.finish({ footprint: m.rect(x0, y0, fx1, y1), height: chimney ? 28 : H + rise, capacity: { jobs: Math.round((w * d) / 40) }, detail: { window: 2.4, fine: 0.06 } });
  }
}
