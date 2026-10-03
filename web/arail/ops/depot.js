/**
 * The depot (Betriebswerk): a workshop hall with its workshop tracks and inspection pits, stabling
 * tracks beside it, and the crew room where drivers sign on (its door is the crew base for the
 * people walking to work). With an operations simulation the depot shows its units: in the
 * workshop tracks the units being maintained or repaired, on the stabling tracks the units at the
 * depot; and a board with the state of the workshop.
 *
 * Local frame (prototype metres): x along the tracks, y across; the crew room and the yard are at
 * the front (−y), the hall behind them, the stabling tracks at the back.
 * @module arail/ops/depot
 */
import { BuildingBase, TONES, TIER, axes, capacityFor, gableRoof } from "../objects/building-kit.js";
import { CD, OVERLAY, PALETTE, grey, rgba, shade } from "../core/colors.js";

/** Sizes (m). */
const OFFICE = { depth: 9, length: 22, floors: 2 };
const BAY = 6.5, STABLE = 5, HALL_H = 8, UNIT = { width: 2.9, height: 3.9, floor: 0.4 };
const RAIL = "#5b5f64", BALLAST = "#8d8880", PIT = "#3c3f44";

/** The depot's operations simulation (if the layout has one). */
const opsSim = (world) => world.simulations?.find((s) => s.constructor.type === "operations") ?? null;

export class Depot extends BuildingBase {
  static type = "depot";
  static label = "Depot and workshop";
  static category = "Transport";
  static use = "work";
  static description = "Maintenance depot: workshop tracks in a hall, stabling tracks and the crew room where drivers sign on. With rail operations it shows the units being maintained.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "length_m", label: "Length", type: "number", unit: "m", min: 30, max: 250, step: 1, default: 64 },
    { key: "bays", label: "Workshop tracks", type: "number", min: 1, max: 6, step: 1, default: 2, help: "Tracks in the hall. The operations simulation uses as many workshop bays as its settings say." },
    { key: "stabling", label: "Stabling tracks", type: "number", min: 0, max: 10, step: 1, default: 3 },
  ];

  floorsCount() {
    return OFFICE.floors;
  }

  /** Layout of the parts (local metres). */
  plan() {
    const s = this.spec;
    const L = Math.min(250, Math.max(30, +s.length_m || 64));
    const bays = Math.round(Math.min(6, Math.max(1, +s.bays || 2)));
    const stabling = Math.round(Math.min(10, Math.max(0, s.stabling ?? 3)));
    const hallW = bays * BAY + 2, stableW = stabling ? stabling * STABLE + 2 : 0;
    const D = OFFICE.depth + hallW + stableW;
    const y0 = -D / 2, x0 = -L / 2, x1 = L / 2;
    const hall = { y0: y0 + OFFICE.depth, y1: y0 + OFFICE.depth + hallW };
    const bayY = Array.from({ length: bays }, (_, i) => hall.y0 + 1 + BAY * (i + 0.5));
    const stableY = Array.from({ length: stabling }, (_, i) => hall.y1 + 1 + STABLE * (i + 0.5));
    return { L, D, x0, x1, y0, y1: D / 2, bays, stabling, hall, bayY, stableY, office: { x0, x1: x0 + Math.min(OFFICE.length, L * 0.45), y0, y1: y0 + OFFICE.depth } };
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const p = this.plan();
    const { x0, x1, hall, office } = p;
    const wall = m.wallTone([0.84, 0.92]), glass = grey(TONES.glass);
    m.setAnchor(0, 0, 4, Math.hypot(p.L, p.D) / 2 + 2);
    // the yard in front and the tracks (on the ground)
    m.plate(m.rect(office.x1, p.y0, x1, hall.y0), { fill: grey(0.62), order: 3 });
    for (const y of p.bayY) {
      m.plate(m.rect(x0, y - 0.55, x1, y + 0.55), { fill: PIT, order: 4 });
      for (const side of [-0.72, 0.72]) m.line([[x0 - 2, y + side], [x1 + 2, y + side]], { stroke: RAIL, width: 1, order: 5 });
    }
    for (const y of p.stableY) {
      m.plate(m.rect(x0 + 2, y - 2.1, x1 - 2, y + 2.1), { fill: BALLAST, order: 3 });
      for (const side of [-0.72, 0.72]) m.line([[x0 + 2, y + side], [x1 - 2, y + side]], { stroke: RAIL, width: 1, order: 5 });
    }
    // the hall: a plinth, glass walls and a glass roof, so that the units inside can be seen
    const plinth = m.box(x0, hall.y0, x1, hall.y1, 0, 2.4, { wall });
    for (const i of [1, 3]) {
      // gates at both ends, one per track
      const f = plinth.walls[i];
      for (const y of p.bayY) {
        const s = i === 1 ? y - hall.y0 : hall.y1 - y;
        m.decal(f, s - 2.4, s + 2.4, 0, 2.4, grey(0.32));
      }
    }
    const upper = m.box(x0, hall.y0, x1, hall.y1, 2.4, HALL_H, { wall: glass });
    for (const f of upper.walls) f.alpha = 0.35;
    const roof = gableRoof(m, { x0, y0: hall.y0, x1, y1: hall.y1, z: HALL_H, pitch: 12, overhang: 0.3, ridge: "x", roof: grey(0.78), wall: glass });
    for (const f of roof.faces) f.alpha = f.normal[2] > 0.5 ? 0.42 : 0.35;
    for (const f of plinth.walls) for (const a of axes(f.length, 6, 1)) m.decal(f, a - 0.08, a + 0.08, 0, 2.4, grey(0.7), TIER.fine);
    m.part([...plinth.faces, ...upper.faces, ...roof.faces], { ref: [0, (hall.y0 + hall.y1) / 2] });
    // the crew room and offices, with the door the crews come in by
    const h = OFFICE.floors * 3.2;
    const body = m.box(office.x0, office.y0, office.x1, office.y1, 0, h, { wall: m.wallTone([0.9, 0.97]), top: grey(TONES.flatRoof) });
    const front = body.walls[0];
    for (let fl = 0; fl < OFFICE.floors; fl++) {
      for (const a of axes(front.length, 3.2, 1.2)) {
        if (fl === 0 && Math.abs(a - front.length * 0.3) < 1.8) continue;
        m.window(front, a - 0.75, a + 0.75, fl * 3.2 + 0.9, fl * 3.2 + 2.3);
      }
    }
    m.decal(front, front.length * 0.3 - 0.6, front.length * 0.3 + 0.6, 0, 2.2, grey(TONES.door));
    m.part(body.faces, { ref: [(office.x0 + office.x1) / 2, (office.y0 + office.y1) / 2] });
    m.shadow(m.rect(x0, hall.y0, x1, hall.y1), HALL_H + 1);
    m.shadow(m.rect(office.x0, office.y0, office.x1, office.y1), h);
    m.entrance(office.x0 + (office.x1 - office.x0) * 0.3, office.y0);
    return m.finish({
      footprint: m.rect(x0 - 2, p.y0, x1 + 2, p.y1), height: HALL_H + 1,
      capacity: capacityFor("work", (office.x1 - office.x0) * OFFICE.depth * OFFICE.floors + p.L * (hall.y1 - hall.y0) * 0.15),
      plan: p,
    });
  }

  /** Layout point (mm) of a local point (m). */
  at(x, y, z = 0) {
    return this.geometry.frame.at(x, y, z);
  }

  /** Where a unit stands: on workshop track i (0…) or stabling track i, place j of n (local metres). */
  _slot(kind, i, j = 0, n = 1) {
    const p = this.geometry.plan;
    const y = kind === "bay" ? p.bayY[i] : p.stableY[i];
    if (y == null) return null;
    const len = (p.L - 6) / n;
    const xa = p.x0 + 3 + j * len, xb = xa + len - 1;
    return { y, xa, xb };
  }

  draw(view) {
    const g = this.geometry;
    const sim = opsSim(this.world);
    const state = sim?.depotState?.(this) ?? null;
    // the units in the hall are drawn before it (seen through its glass), the others on their own
    if (state) this._drawUnits(view, g, state);
    super.draw(view);
    if (state && this.world.settings.labels) this._drawBoard(view, g, state);
  }

  _drawUnits(view, g, state) {
    const p = g.plan;
    // a point behind the hall, seen from the camera: the units in it are drawn first
    const corners = [[p.x0, p.hall.y0], [p.x1, p.hall.y0], [p.x1, p.hall.y1], [p.x0, p.hall.y1]].map(([x, y]) => this.at(x, y, 0));
    const far = corners.reduce((a, b) => (view.depth(a[0], a[1], 0) > view.depth(b[0], b[1], 0) ? a : b));
    const behind = [far[0], far[1], 0];
    const labels = view.pxPerMM(g.center[0], g.center[1], 0) * this.mm(p.L) > 260;
    for (const item of state.bays) {
      const slot = this._slot("bay", item.bay);
      if (slot) this._drawUnit(view, slot, item, behind, labels);
    }
    state.stabled.forEach((list, i) => {
      list.forEach((item, j) => {
        const slot = this._slot("stable", i, j, list.length);
        if (slot) this._drawUnit(view, slot, item, null, labels);
      });
    });
  }

  _drawUnit(view, { y, xa, xb }, item, ref, labels) {
    const w = UNIT.width / 2, z0 = UNIT.floor, z1 = UNIT.height;
    const P = (x, yy, z) => this.at(x, yy, z);
    const body = item.failed ? shade(PALETTE.train, 0.75) : PALETTE.train;
    const stroke = item.failed ? CD.rot : item.job ? CD.orange : null;
    const lit = view.darkness > 0.35 && item.job;
    const faces = [
      { pts: [P(xa, y - w, z1), P(xb, y - w, z1), P(xb, y + w, z1), P(xa, y + w, z1)], normal: [0, 0, 1], color: shade(body, 0.78), stroke },
      { pts: [P(xa, y - w, z0), P(xb, y - w, z0), P(xb, y - w, z1), P(xa, y - w, z1)], normal: this._n(0, -1), color: body, stroke },
      { pts: [P(xb, y + w, z0), P(xa, y + w, z0), P(xa, y + w, z1), P(xb, y + w, z1)], normal: this._n(0, 1), color: body, stroke },
      { pts: [P(xb, y - w, z0), P(xb, y + w, z0), P(xb, y + w, z1), P(xb, y - w, z1)], normal: this._n(1, 0), color: shade(body, 0.9), stroke },
      { pts: [P(xa, y + w, z0), P(xa, y - w, z0), P(xa, y - w, z1), P(xa, y + w, z1)], normal: this._n(-1, 0), color: shade(body, 0.9), stroke },
    ];
    for (const f of faces.slice(1, 3)) {
      const t = f === faces[1] ? y - w : y + w;
      f.decals = [{ pts: [P(xa + 0.8, t, 2.2), P(xb - 0.8, t, 2.2), P(xb - 0.8, t, 3.1), P(xa + 0.8, t, 3.1)], color: lit ? PALETTE.litWindow : PALETTE.trainWindow, emissive: lit }];
    }
    const mid = P((xa + xb) / 2, y, 0);
    view.faces(faces, ref || mid);
    if (labels) {
      const top = P((xa + xb) / 2, y, z1 + 1);
      view.label(top, item.text, { size: 10, background: item.failed ? OVERLAY.dangerLabel : OVERLAY.label, optional: true, order: 6 });
    }
  }

  /** Outward normal (layout frame) of a local direction. */
  _n(x, y) {
    const d = this.geometry.frame.dir(x, y), l = Math.hypot(d[0], d[1]) || 1;
    return [d[0] / l, d[1] / l, 0];
  }

  _drawBoard(view, g, state) {
    const p = g.plan;
    const at = this.at((p.office.x0 + p.office.x1) / 2, p.office.y0 + OFFICE.depth / 2, OFFICE.floors * 3.2 + 4);
    view.label(at, [this.name, ...state.lines], { size: 11, background: OVERLAY.label, colors: [null, ...state.lines.map(() => OVERLAY.status)], badge: "D", badgeColor: rgba(OVERLAY.sign, 1), anchor: "bottom", order: 2 });
  }
}
