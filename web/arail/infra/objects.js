/**
 * Infrastructure objects on the layout (palette group Infrastructure): signals, switches, balises,
 * level crossings, GSM-R masts, interlockings, overhead lines, cable routes, lifts and passenger
 * displays; the maintenance base (Stützpunkt) with its vans and drones, and the plant that builds
 * level crossing systems. Each of them is an asset of the infrastructure simulation, which knows
 * their condition; the layout's tracks and platforms are assets too.
 *
 * Objects marked `real` stand for something on the real layout (the lab's signals and switches):
 * over the camera image only their state is drawn, the flyover draws them. With an infrastructure
 * simulation every asset shows its state: a ring on the ground in the colour of its known grade
 * (Türkis 1 … Rot 5), solid when its condition is known well (live or recently checked), dashed
 * when the last check is long ago, dotted grey when only its age is known; a fault is a red ring.
 * @module arail/infra/objects
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, resolvePoints } from "../core/anchors.js";
import { polylineAt, polylineLengths, toRad } from "../core/math.js";
import { prismFaces } from "../core/view.js";
import { CD, OVERLAY, grey, rgba, shade } from "../core/colors.js";
import { BuildingBase, Frame, TONES, axes, capacityFor, gableRoof } from "../objects/building-kit.js";
import { GENERATIONS } from "./catalog.js";

/** The layout's infrastructure simulation (if it has one). */
const infraSim = (world) => world.simulations?.find((s) => s.constructor.type === "infrastructure") ?? null;

const STEEL = "#7d858f", DARK = "#2b2f36", CONCRETE = "#b9b5ac", RED = "#d20f41", WHITE = "#f4f4f2", YELLOW = "#ffc700";

/** A box in a frame (local metres) as faces. */
function box(frame, x0, y0, x1, y1, z0, z1, colors) {
  const fp = [frame.xy(x0, y0), frame.xy(x1, y0), frame.xy(x1, y1), frame.xy(x0, y1)];
  return prismFaces(fp, z0 * frame.k, z1 * frame.k, colors);
}

/** Draw faces sorted with a reference point (local metres). */
function solid(view, frame, faces, x = 0, y = 0, z = 0) {
  view.faces(faces, frame.at(x, y, z));
}

/**
 * The state of an asset drawn around a point (layout mm): a ring in the colour of its known grade,
 * its style by how well the condition is known; a fault adds a pulsing red ring and a label.
 * @param {object} view
 * @param {LayoutObject} obj
 * @param {number[]} at layout point
 * @param {number} radiusM radius of the ring (prototype metres)
 */
export function drawAssetState(view, obj, at, radiusM = 2.5) {
  const sim = infraSim(obj.world);
  const st = sim?.assetView?.(obj.id);
  if (!st || !at) return;
  const r = obj.mm(radiusM);
  const ring = [];
  for (let k = 0; k < 20; k++) {
    const t = (k * Math.PI) / 10;
    ring.push([at[0] + r * Math.cos(t), at[1] + r * Math.sin(t)]);
  }
  const col = st.colour;
  view.polygon(ring, { fill: rgba(col, st.fault ? 0.5 : 0.42), stroke: st.style === "age" ? "rgba(150,156,166,0.95)" : col, width: 2.4, dash: st.style === "stale" ? [6, 4] : st.style === "age" ? [2, 4] : null, order: 40, emissive: true });
  if (st.fault) {
    const pulse = 1.25 + 0.35 * Math.abs(Math.sin((view.time || 0) * 3));
    view.polygon(ring.map((p) => [at[0] + (p[0] - at[0]) * pulse, at[1] + (p[1] - at[1]) * pulse]), { stroke: OVERLAY.danger, width: 2.6, order: 41, emissive: true });
  }
  if (st.label) {
    view.label([at[0], at[1], obj.mm(st.labelZ ?? 6)], st.label, {
      size: 10, anchor: "bottom", order: st.fault ? 6 : 2, optional: !st.fault && !st.selected, badge: st.badge, badgeColor: st.fault ? OVERLAY.danger : col,
      background: st.fault ? OVERLAY.dangerLabel : OVERLAY.label,
    });
  }
}

/** The state of a linear asset along a polyline: a coloured band. */
export function drawLinearState(view, obj, points, widthM = 3) {
  const sim = infraSim(obj.world);
  const st = sim?.assetView?.(obj.id);
  if (!st || !points || points.length < 2) return;
  view.ribbon(points, obj.mm(widthM), { fill: rgba(st.colour, st.fault ? 0.55 : 0.4), order: 39, emissive: true });
  const dash = st.style === "stale" ? [8, 5] : st.style === "age" ? [2, 5] : null;
  view.line(points, { stroke: st.fault ? OVERLAY.danger : st.style === "age" ? "rgba(150,156,166,0.95)" : st.colour, width: st.fault ? 3 : 2, dash, order: 40, emissive: true });
  if (st.label) {
    const L = polylineLengths(points);
    const mid = polylineAt(points, L[L.length - 1] / 2, L).point;
    view.label([mid[0], mid[1], obj.mm(2)], st.label, { size: 10, anchor: "bottom", order: st.fault ? 6 : 2, optional: !st.fault && !st.selected, badge: st.badge, badgeColor: st.fault ? OVERLAY.danger : st.colour, background: st.fault ? OVERLAY.dangerLabel : OVERLAY.label });
  }
}

/* ---------------------------------------------------------------- point assets */

const COMMON = [
  { key: "name", label: "Name", type: "text", default: "" },
  { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "Direction of the track (local x)." },
  { key: "built", label: "Year built", type: "number", min: 0, max: 2200, step: 1, default: 0, help: "0: not known (the simulation assumes one)." },
  { key: "real", label: "On the real layout", type: "boolean", default: false, help: "Real in the lab: over the camera image only its state is drawn." },
];
const INTERLOCKING = { key: "interlocking", label: "Interlocking", type: "object", objectType: "interlocking", help: "The interlocking that controls it (how much of its condition is reported live depends on it). Empty: the station's." };

/** Base of the point assets: a frame at `position` turned by `rotation_deg`. */
export class AssetObject extends LayoutObject {
  static category = "Infrastructure";
  static placement = "point";
  /** Asset type of the infrastructure simulation. */
  static asset = null;
  /** Radius of the state ring (m). */
  static ring_m = 2.5;

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const angle = toRad(+this.spec.rotation_deg || 0);
    return { center: c, angle, frame: new Frame(c, angle, this.mm(1)) };
  }

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const r = this.constructor.ring_m;
    return [g.frame.xy(-r, -r), g.frame.xy(r, -r), g.frame.xy(r, r), g.frame.xy(-r, r)];
  }

  anchorPoint() {
    return this.geometry?.center ?? null;
  }

  /** Draw the model (flyover, or a virtual object over the camera image) and the state. */
  draw(view) {
    const g = this.geometry;
    if (!this.spec.real || !view.showsReal([g.center])) this.drawModel(view, g);
    drawAssetState(view, this, g.center, this.constructor.ring_m);
  }

  drawModel(view, g) {}

  /** The asset's state as the infrastructure simulation knows it (or null). */
  state() {
    return infraSim(this.world)?.assetView?.(this.id) ?? null;
  }
}

export class Signal extends AssetObject {
  static type = "signal";
  static label = "Signal";
  static asset = "signal";
  static ring_m = 2.2;
  static description = "Light signal on a mast beside the track (an asset: its condition is known as well as its interlocking reports it).";
  static params = [...COMMON, INTERLOCKING, { key: "side", label: "Side", type: "select", default: "right", options: [["right", "right of the track"], ["left", "left of the track"]] }];

  drawModel(view, { frame }) {
    const st = this.state();
    const faces = [
      ...box(frame, -0.35, -0.35, 0.35, 0.35, 0, 0.3, { side: CONCRETE, top: CONCRETE }),
      ...box(frame, -0.09, -0.09, 0.09, 0.09, 0.3, 4.2, { side: STEEL, top: STEEL }),
      ...box(frame, -0.18, -0.32, 0.18, 0.32, 4.2, 5.7, { side: DARK, top: DARK }),
    ];
    solid(view, frame, faces, 0, 0, 2);
    const lamp = st?.fault ? CD.rot : st ? "#3ed37a" : "#3ed37a";
    const p = frame.at(-0.2, 0, 5.2);
    view.glow(p, this.mm(0.8), lamp, 0.9);
    const q = [frame.at(-0.19, -0.12, 5.05), frame.at(-0.19, 0.12, 5.05), frame.at(-0.19, 0.12, 5.35), frame.at(-0.19, -0.12, 5.35)];
    view.faces([{ pts: q, normal: [-Math.cos(frame.angle), -Math.sin(frame.angle), 0], color: lamp, emissive: true }], frame.at(-0.3, 0, 5.2));
  }
}

export class Switch extends AssetObject {
  static type = "switch";
  static label = "Switch";
  static asset = "turnout";
  static ring_m = 3;
  static description = "A switch (turnout): its point machine reports to the interlocking as much as the interlocking can.";
  static params = [...COMMON, INTERLOCKING, { key: "hand", label: "Branch", type: "select", default: "left", options: [["left", "to the left"], ["right", "to the right"]] }, { key: "length_m", label: "Length", type: "number", unit: "m", min: 15, max: 80, step: 1, default: 33 }];

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const L = Math.min(80, Math.max(15, +this.spec.length_m || 33)), s = this.spec.hand === "right" ? -1 : 1;
    return [g.frame.xy(-2, -2.5 * s), g.frame.xy(L, -2.5 * s), g.frame.xy(L, (3 + 0.09 * L) * s), g.frame.xy(-2, 2.5 * s)];
  }

  drawModel(view, { frame }) {
    const L = Math.min(80, Math.max(15, +this.spec.length_m || 33)), s = this.spec.hand === "right" ? -1 : 1;
    const branch = [];
    for (let i = 0; i <= 12; i++) {
      const x = (L * i) / 12;
      branch.push([x, s * 0.09 * L * (x / L) ** 2 * 1.6]);
    }
    const rail = "#5b5f64";
    for (const off of [-0.72, 0.72]) {
      view.line([frame.xy(-3, off), frame.xy(L, off)], { stroke: rail, width: 1.2, order: 6 });
      view.line(branch.map(([x, y]) => frame.xy(x, y + off)), { stroke: rail, width: 1.2, order: 6 });
    }
    // the point machine beside the switch blades
    solid(view, frame, box(frame, 0.2, -2.3 * s - 0.4, 1.4, -2.3 * s + 0.4, 0, 0.6, { side: grey(0.45), top: grey(0.55) }), 0.8, -2.3 * s, 0.3);
  }
}

export class Balise extends AssetObject {
  static type = "balise";
  static label = "Balise";
  static asset = "balise";
  static ring_m = 1.6;
  static description = "A balise or train protection magnet between the rails. It cannot report anything: its condition is known from tests.";
  static params = [...COMMON];

  drawModel(view, { frame }) {
    solid(view, frame, box(frame, -0.25, -0.2, 0.25, 0.2, 0, 0.18, { side: shade(YELLOW, 0.8), top: YELLOW }), 0, 0, 0.1);
  }
}

export class LevelCrossing extends AssetObject {
  static type = "level-crossing";
  static label = "Level crossing";
  static asset = "level-crossing";
  static ring_m = 4;
  static description = "A level crossing with light signals and half barriers (EBO § 11); built by the level crossing plant. Place it where a street crosses a track, turned along the track.";
  static params = [
    ...COMMON, INTERLOCKING,
    { key: "road_m", label: "Road width", type: "number", unit: "m", min: 3, max: 20, step: 0.5, default: 7 },
    { key: "span_m", label: "Track spacing", type: "number", unit: "m", min: 0, max: 30, step: 0.1, default: 0, help: "Distance between the centres of the outer tracks it crosses (0: one track). Place it in the middle." },
    { key: "road_owner", label: "Road authority", type: "select", default: "municipal", options: [["municipal", "the town (municipal road)"], ["district", "the district"], ["state", "the Land"], ["federal", "the Bund"]], help: "Who pays which share of measures at the crossing (EKrG § 13)." },
  ];

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const w = (+this.spec.road_m || 7) / 2 + 2, h = this._span() / 2 + 6;
    return [g.frame.xy(-w, -h), g.frame.xy(w, -h), g.frame.xy(w, h), g.frame.xy(-w, h)];
  }

  _span() {
    return Math.min(30, Math.max(0, +this.spec.span_m || 0));
  }

  drawModel(view, { frame }) {
    const w = (+this.spec.road_m || 7) / 2, st = this.state(), half = this._span() / 2;
    const down = !!st?.fault;
    // the crossing panels between and beside the rails
    view.polygon([frame.xy(-w, -half - 1.6), frame.xy(w, -half - 1.6), frame.xy(w, half + 1.6), frame.xy(-w, half + 1.6)], { fill: grey(0.55), order: 7 });
    for (const [sx, sy] of [[-1, -1], [1, 1]]) {
      const x = sx * (w + 0.8), y = sy * (half + 4.2);
      // light signal post with the red lights, and the barrier drive with its boom
      solid(view, frame, [
        ...box(frame, x - 0.12, y - 0.12, x + 0.12, y + 0.12, 0, 3.4, { side: WHITE, top: WHITE }),
        ...box(frame, x - 0.2, y - 0.5, x + 0.2, y + 0.5, 2.6, 3.2, { side: DARK, top: DARK }),
        ...box(frame, x - 0.35, y + sy * 0.6 - 0.3, x + 0.35, y + sy * 0.6 + 0.3, 0, 1.1, { side: grey(0.8), top: grey(0.7) }),
      ], x, y, 1.5);
      const boom = down ? [[x, y + sy * 0.6, 1], [x - sx * (w + 0.4), y + sy * 0.6, 1]] : [[x, y + sy * 0.6, 1], [x, y + sy * 0.6, 4.6]];
      const a = frame.at(...boom[0]), b = frame.at(...boom[1]);
      view.faces([{ pts: [a, b, [b[0], b[1], b[2] + this.mm(0.12)], [a[0], a[1], a[2] + this.mm(0.12)]], color: RED, twoSided: true }], frame.at(x, y, 2));
      if (down) view.glow(frame.at(x, y - 0.25 * sy, 2.9), this.mm(0.8), CD.rot, 1);
    }
  }
}

export class GsmrMast extends AssetObject {
  static type = "gsmr-mast";
  static label = "GSM-R mast";
  static asset = "gsmr";
  static ring_m = 3;
  static description = "A GSM-R site: lattice mast, antennas and the base station in its shelter; the network management reports its state live.";
  static params = [...COMMON, { key: "height_m", label: "Height", type: "number", unit: "m", min: 10, max: 60, step: 1, default: 30 }];

  drawModel(view, { frame }) {
    const H = Math.min(60, Math.max(10, +this.spec.height_m || 30));
    const faces = [...box(frame, -1.4, -1.4, 1.4, 1.4, 0, 0.4, { side: CONCRETE, top: CONCRETE })];
    // the mast tapers in four sections
    for (let i = 0; i < 4; i++) {
      const r = 0.9 - i * 0.18;
      faces.push(...box(frame, -r, -r, r, r, 0.4 + (i * H) / 4, 0.4 + ((i + 1) * H) / 4, { side: grey(0.72), top: grey(0.72), alpha: 0.85 }));
    }
    for (const [x, y] of [[0.6, 0], [-0.3, 0.55], [-0.3, -0.55]]) faces.push(...box(frame, x - 0.15, y - 0.15, x + 0.15, y + 0.15, H - 2.5, H, { side: WHITE, top: WHITE }));
    faces.push(...box(frame, 2.2, -1.5, 5.2, 1.5, 0, 2.6, { side: grey(0.86), top: grey(0.7) }));
    solid(view, frame, faces, 0, 0, H / 2);
  }
}

export class Lift extends AssetObject {
  static type = "lift";
  static label = "Lift";
  static asset = "lift";
  static ring_m = 2.2;
  static description = "A lift to a platform (step-free access); its remote monitoring reports faults and the state of the drive.";
  static params = [...COMMON];

  drawModel(view, { frame }) {
    const glass = grey(TONES.glass);
    const faces = box(frame, -1.2, -1.2, 1.2, 1.2, 0, 5.5, { side: glass, top: grey(0.7), alpha: 0.6 });
    solid(view, frame, faces, 0, 0, 2.5);
  }
}

export class PassengerDisplay extends AssetObject {
  static type = "passenger-display";
  static label = "Passenger display";
  static asset = "pis";
  static ring_m = 1.6;
  static description = "A departure display on a platform; it reports to the passenger information system.";
  static params = [...COMMON];

  drawModel(view, { frame }) {
    const st = this.state();
    const faces = [
      ...box(frame, -0.08, -1, 0.08, -0.85, 0, 2.6, { side: STEEL, top: STEEL }),
      ...box(frame, -0.08, 0.85, 0.08, 1, 0, 2.6, { side: STEEL, top: STEEL }),
      ...box(frame, -0.12, -1.1, 0.12, 1.1, 2.6, 3.4, { side: st?.fault ? grey(0.25) : CD.dunkelblau, top: DARK }),
    ];
    solid(view, frame, faces, 0, 0, 2);
  }
}

/* ---------------------------------------------------------------- linear assets */

/** Base of the linear assets (a polyline along a track). */
export class LinearAssetObject extends LayoutObject {
  static category = "Infrastructure";
  static placement = "polyline";
  static asset = null;

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    if (!pts || pts.length < 2) return null;
    const lengths = polylineLengths(pts);
    return { points: pts, lengths, total: lengths[lengths.length - 1] };
  }

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const w = this.mm(2);
    const left = [], right = [];
    for (let i = 0; i < g.points.length; i++) {
      const a = g.points[Math.max(0, i - 1)], b = g.points[Math.min(g.points.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      left.push([g.points[i][0] - (dy / l) * w, g.points[i][1] + (dx / l) * w]);
      right.push([g.points[i][0] + (dy / l) * w, g.points[i][1] - (dx / l) * w]);
    }
    return left.concat(right.reverse());
  }

  anchorPoint() {
    const g = this.geometry;
    return g ? polylineAt(g.points, g.total / 2, g.lengths).point : null;
  }

  /** Length in prototype km. */
  lengthKm() {
    return this.geometry ? this.meters(this.geometry.total) / 1000 : 0;
  }

  draw(view) {
    const g = this.geometry;
    if (!this.spec.real || !view.showsReal(g.points)) this.drawModel(view, g);
    drawLinearState(view, this, g.points, 2.6);
  }

  drawModel(view, g) {}
}

const LINEAR_COMMON = [
  { key: "name", label: "Name", type: "text", default: "" },
  { key: "built", label: "Year built", type: "number", min: 0, max: 2200, step: 1, default: 0, help: "0: not known (the simulation assumes one)." },
  { key: "real", label: "On the real layout", type: "boolean", default: false },
];

export class Catenary extends LinearAssetObject {
  static type = "catenary";
  static label = "Overhead line";
  static asset = "catenary";
  static description = "Overhead contact line along a track: masts and the contact wire. Draw it along the track's centre line.";
  static params = [...LINEAR_COMMON, { key: "spacing_m", label: "Mast spacing", type: "number", unit: "m", min: 20, max: 80, step: 1, default: 55 }, { key: "side", label: "Masts", type: "select", default: "right", options: [["right", "right of the track"], ["left", "left of the track"]] }];

  drawModel(view, g) {
    const k = this.mm(1), side = this.spec.side === "left" ? 1 : -1, step = this.mm(Math.max(20, +this.spec.spacing_m || 55));
    const wire = [];
    for (let s = 0; s <= g.total + 1e-6; s += Math.min(step, Math.max(1, g.total))) {
      const { point: p, dir: u } = polylineAt(g.points, Math.min(s, g.total), g.lengths);
      const n = [-u[1] * side, u[0] * side];
      const foot = [p[0] + n[0] * 3.2 * k, p[1] + n[1] * 3.2 * k];
      const fr = new Frame(foot, Math.atan2(u[1], u[0]), k);
      view.faces([
        ...box(fr, -0.15, -0.15, 0.15, 0.15, 0, 7.2, { side: STEEL, top: STEEL }),
        ...prismFaces([[foot[0], foot[1]], [p[0], p[1]], [p[0] + u[0] * 0.15 * k, p[1] + u[1] * 0.15 * k], [foot[0] + u[0] * 0.15 * k, foot[1] + u[1] * 0.15 * k]], 6.6 * k, 6.75 * k, { side: STEEL, top: STEEL }),
      ], [foot[0], foot[1], 3 * k]);
      wire.push([p[0], p[1]]);
    }
    if (wire.length >= 2) view.line(wire, { z: 5.5 * k, stroke: "#4b5058", width: 0.8, order: 8 });
  }
}

export class CableRoute extends LinearAssetObject {
  static type = "cable-route";
  static label = "Cable route";
  static asset = "cable";
  static description = "Concrete cable trough with the signalling cables beside a track; cable theft and damage show as signals going dark.";
  static params = [...LINEAR_COMMON];

  drawModel(view, g) {
    view.ribbon(g.points, this.mm(0.6), { fill: grey(0.74), order: 5 });
  }
}

/* ---------------------------------------------------------------- buildings */

export class Interlocking extends BuildingBase {
  static type = "interlocking";
  static label = "Interlocking";
  static category = "Infrastructure";
  static use = "work";
  static asset = "interlocking";
  static description = "Signal box (Stellwerk). Its generation decides what its signals, switches and level crossings report: a relay interlocking shows faults on its panel, a digital one reports condition data.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "generation", label: "Generation", type: "select", default: "relay", options: Object.entries(GENERATIONS).map(([k, g]) => [k, g.label]) },
    { key: "built", label: "Year built", type: "number", min: 0, max: 2200, step: 1, default: 0 },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "real", label: "On the real layout", type: "boolean", default: false },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const digital = this.spec.generation === "digital" || this.spec.generation === "electronic";
    const L = digital ? 9 : 14, D = digital ? 4 : 7, H = digital ? 3 : 7;
    const wall = digital ? grey(0.9) : m.wallTone([0.82, 0.9]);
    const body = m.box(-L / 2, -D / 2, L / 2, D / 2, 0, H, { wall, top: grey(TONES.flatRoof) });
    if (!digital) {
      // the operator's floor upstairs with its wide windows over the tracks
      const front = body.walls[0];
      for (const a of axes(front.length, 2.2, 1)) m.window(front, a - 0.9, a + 0.9, 4.2, 6.2);
      gableRoof(m, { x0: -L / 2, y0: -D / 2, x1: L / 2, y1: D / 2, z: H, pitch: 30, overhang: 0.4, ridge: "x", roof: grey(0.66), wall });
    }
    m.part(body.faces);
    m.shadow(m.rect(-L / 2, -D / 2, L / 2, D / 2), H);
    m.entrance(0, -D / 2);
    return m.finish({ footprint: m.rect(-L / 2 - 1, -D / 2 - 1, L / 2 + 1, D / 2 + 1), height: H + 2, capacity: capacityFor("work", L * D) });
  }

  draw(view) {
    const g = this.geometry;
    if (!this.spec.real || !view.showsReal([g.center])) super.draw(view);
    drawAssetState(view, this, g.center, 6);
  }
}

/** The maintenance base (Instandhaltungsstützpunkt): office, workshop, vans and the drone pad. */
export class MaintenanceBase extends BuildingBase {
  static type = "maintenance-base";
  static label = "Maintenance base";
  static category = "Infrastructure";
  static use = "work";
  static description = "Base of the maintenance staff (Stützpunkt): the emergency vans leave from its yard, the drones from its pad.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const wall = m.wallTone([0.86, 0.94]);
    const office = m.box(-16, 0, -2, 9, 0, 6.4, { wall, top: grey(TONES.flatRoof) });
    for (const a of axes(office.walls[0].length, 2.6, 0.8)) for (const z of [0.9, 4.1]) m.window(office.walls[0], a - 0.6, a + 0.6, z, z + 1.4);
    m.part(office.faces);
    const hall = m.box(0, 0, 16, 12, 0, 6, { wall: grey(0.82), top: grey(0.7) });
    for (const s of [3, 8, 13]) m.decal(hall.walls[0], s - 1.8, s + 1.8, 0, 4.2, grey(0.5));
    m.part(hall.faces);
    // yard with parking bays for the vans, and the drone pad
    m.plate(m.rect(-16, -12, 16, 0), { fill: grey(0.6), order: 3 });
    for (let i = 0; i < 5; i++) m.line([[-14 + i * 3.2, -12], [-14 + i * 3.2, -6.5]], { stroke: grey(0.92), width: 1, order: 4 });
    m.plate(m.rect(6, -11, 14, -3), { fill: grey(0.5), order: 4 });
    m.line([[8, -9], [12, -5]], { stroke: YELLOW, width: 1.5, order: 5 });
    m.line([[8, -5], [12, -9]], { stroke: YELLOW, width: 1.5, order: 5 });
    m.shadow(m.rect(-16, 0, 16, 12), 6);
    m.entrance(-9, -12);
    return m.finish({ footprint: m.rect(-17, -13, 17, 13), height: 6.5, capacity: capacityFor("work", 14 * 9 * 2) });
  }

  /** Where vans park (local metres) and the drone pad. */
  slots() {
    const f = this.geometry?.frame;
    if (!f) return null;
    return { vans: Array.from({ length: 5 }, (_, i) => f.xy(-12.4 + i * 3.2, -9.2)), pad: f.xy(10, -7), angle: f.angle + Math.PI / 2, frame: f };
  }

  draw(view) {
    super.draw(view);
    infraSim(this.world)?.drawBase?.(view, this);
  }
}

/** The level crossing plant (BÜ-Werk): a hall with its production lines and the orders on them. */
export class CrossingPlant extends BuildingBase {
  static type = "crossing-plant";
  static label = "Level crossing plant";
  static category = "Infrastructure";
  static use = "work";
  static description = "Plant that builds level crossing systems (barriers, lights, controller cabinets): with the infrastructure simulation it shows its orders and their stage.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const hall = m.box(-24, -10, 24, 10, 0, 9, { wall: grey(0.86), top: grey(0.74) });
    for (const a of axes(hall.walls[0].length, 4, 2)) m.window(hall.walls[0], a - 1.2, a + 1.2, 5.5, 7.5);
    for (const s of [10, 24, 38]) m.decal(hall.walls[0], s - 2, s + 2, 0, 4.5, grey(0.5));
    m.part(hall.faces);
    m.plate(m.rect(-24, -22, 24, -10), { fill: grey(0.62), order: 3 });
    m.shadow(m.rect(-24, -10, 24, 10), 9);
    m.entrance(-18, -10);
    return m.finish({ footprint: m.rect(-25, -23, 25, 11), height: 9.5, capacity: capacityFor("work", 48 * 20 * 0.6) });
  }

  draw(view) {
    super.draw(view);
    infraSim(this.world)?.drawPlant?.(view, this);
  }
}

/** Object types that are assets, by object type: the asset type. */
export const ASSET_OBJECTS = {
  signal: "signal", switch: "turnout", balise: "balise", "level-crossing": "level-crossing", "gsmr-mast": "gsmr", interlocking: "interlocking",
  catenary: "catenary", "cable-route": "cable", lift: "lift", "passenger-display": "pis", track: "track", platform: "platform",
};

export const INFRA_OBJECTS = [Signal, Switch, Balise, LevelCrossing, GsmrMast, Interlocking, Catenary, CableRoute, Lift, PassengerDisplay, MaintenanceBase, CrossingPlant];
