/**
 * Station building (Empfangsgebäude) of today: a tall glass hall in the middle under a
 * cantilevered roof slab, two lower wings with shops on the ground floor and fins in front of
 * the ribbon windows upstairs, a canopy along the street front, solar panels on the wing roofs
 * and a clock pylon. Long and shallow, so that it fits the strip between a street and the
 * tracks. Greyscale like the other buildings (see building-kit.js).
 *
 * Local frame in prototype metres: x along the building (and the tracks), y across; the street
 * front with the entrance is the −y side, the track side +y.
 * @module arail/objects/station
 */
import { clamp } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";
import { BuildingBase, TIER, TONES, axes, parapetRoof } from "./building-kit.js";

const num = (v, fallback, lo, hi) => clamp(Number.isFinite(+v) && v !== "" && v != null ? +v : fallback, lo, hi);

/** Floor height of the wings and the ground floor (m). */
const FLOOR_M = 3.6;
const PLINTH_M = 0.3;

export class StationBuilding extends BuildingBase {
  static type = "station-building";
  static label = "Station building";
  static use = "shop";
  static description = "Modern station building: a glass hall under a cantilevered roof, two wings with shops and offices, a canopy along the street front and a clock pylon.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "length_m", label: "Length", type: "number", unit: "m", min: 24, max: 160, step: 1, default: 66, help: "Along the tracks, hall and both wings" },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 6, max: 24, step: 0.5, default: 9 },
    { key: "hall_m", label: "Hall width", type: "number", unit: "m", min: 8, max: 40, step: 1, default: 18 },
    { key: "floors", label: "Floors of the wings", type: "number", min: 1, max: 4, step: 1, default: 2 },
    { key: "canopy", label: "Canopy along the front", type: "boolean", default: true },
    { key: "clock", label: "Clock pylon", type: "boolean", default: true },
  ];

  floorsCount() {
    return Math.round(num(this.spec.floors, 2, 1, 4));
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    const L = num(s.length_m, 66, 24, 160), D = num(s.depth_m, 9, 6, 24);
    const hw = Math.min(num(s.hall_m, 18, 8, 40), L - 8), floors = this.floorsCount();
    const x0 = -L / 2, x1 = L / 2, y0 = -D / 2, y1 = D / 2, h0 = -hw / 2, h1 = hw / 2;
    const Hw = PLINTH_M + floors * FLOOR_M + 0.6; // wings, up to the parapet
    const Hh = Math.max(Hw + 3.5, 11); // the hall
    const glass = grey(TONES.glass), frame = grey(0.8), slab = grey(0.93);
    const wall = m.wallTone([0.9, 0.96]);
    m.setAnchor(0, 0, Hh / 2, Math.hypot(L, D) / 2 + 4);

    // wings: shops behind glass on the ground floor, ribbon windows with fins upstairs
    const wings = [[x0, h0, 1], [h1, x1, 3]]; // [from, to, side towards the hall]
    for (const [a, b, inner] of wings) {
      const w = b - a;
      const body = m.box(a, y0, b, y1, 0, Hw, { wall, skip: [inner] });
      const roof = parapetRoof(m, { x0: a, y0, x1: b, y1, z: Hw, parapet: 0.35 });
      for (const side of [0, 2]) {
        const f = body.walls[side];
        m.band(f, 0, PLINTH_M, grey(TONES.plinth));
        // ground floor: shop fronts in 3 m bays
        const g0 = PLINTH_M + 0.1, g1 = PLINTH_M + FLOOR_M - 0.5;
        m.decal(f, 0.6, w - 0.6, g0, g1, glass);
        for (const c of axes(w - 1.2, 3, 0)) m.window(f, 0.6 + c - 1.35, 0.6 + c + 1.35, g0, g1, { group: "shop", colour: glass });
        // upper floors: a dark ribbon of windows, light fins in front of it
        for (let k = 1; k < floors; k++) {
          const z0 = PLINTH_M + k * FLOOR_M + 0.8, z1 = z0 + 2.1;
          m.decal(f, 0.6, w - 0.6, z0 - 0.1, z1 + 0.1, frame);
          for (const c of axes(w - 1.2, 1.5, 0)) m.window(f, 0.6 + c - 0.6, 0.6 + c + 0.6, z0, z1);
          for (const c of axes(w - 1.2, 0.75, 0)) m.decal(f, 0.6 + c - 0.06, 0.6 + c + 0.06, z0 - 0.2, z1 + 0.2, grey(0.9), TIER.fine);
        }
        m.decal(f, 0, w, Hw - 0.6, Hw - 0.15, grey(0.84), TIER.fine); // coping
      }
      // the outer gable end: closed, with a slit of glass at the stairs
      const end = body.walls[inner === 3 ? 1 : 3];
      if (end) {
        m.band(end, 0, PLINTH_M, grey(TONES.plinth));
        m.decal(end, D / 2 - 0.7, D / 2 + 0.7, PLINTH_M + 0.3, Hw - 1, glass);
      }
      // solar panels on the roof, in rows
      const rw = w - 1.6, rd = D - 1.6;
      for (const t of axes(rd, 2.4, 0)) for (const c of axes(rw, 1.8, 0)) m.decal(roof, 0.8 + c - 0.8, 0.8 + c + 0.8, 0.8 + t - 0.9, 0.8 + t + 0.9, grey(0.52), TIER.window);
      m.part([...body.faces, roof], { ref: [(a + b) / 2, 0] });
      if (s.canopy !== false) {
        const cy = Math.min(2.5, D * 0.3);
        const c = m.box(a + 0.3, y0 - cy, b - 0.3, y0, PLINTH_M + FLOOR_M, PLINTH_M + FLOOR_M + 0.35, { wall: slab, top: grey(0.86), skip: [2] });
        m.part(c.faces, { after: true, facing: body.walls[0] });
      }
    }

    // the hall: glass on both long sides and above the wings, a sign band, doors to the street
    const hall = m.box(h0, y0, h1, y1, 0, Hh, { wall: glass, skip: [1, 3] });
    const sides = [m.wall([h1, y0], [h1, y1], Hw, Hh, glass), m.wall([h0, y1], [h0, y0], Hw, Hh, glass)];
    for (const side of [0, 2]) {
      const f = hall.walls[side];
      for (const c of axes(hw, 1.5, 0)) m.window(f, c - 0.7, c + 0.7, 0.2, Hh - 0.3, { group: "shop", colour: glass, tier: TIER.coarse });
      for (const c of axes(hw, 1.5, 0)) m.decal(f, c + 0.7, c + 0.8, 0, Hh, frame, TIER.fine);
      for (let z = 3.2; z < Hh - 0.5; z += 3.2) m.decal(f, 0, hw, z - 0.06, z + 0.06, frame, TIER.fine);
    }
    const front = hall.walls[0];
    m.decal(front, 1.5, hw - 1.5, Hh - 2.4, Hh - 1.3, grey(0.62)); // sign band
    for (const c of [hw / 2 - 4, hw / 2, hw / 2 + 4]) m.decal(front, c - 1.2, c + 1.2, 0, 2.6, grey(TONES.door));
    for (const f of sides) for (let z = Hw + 2.5; z < Hh - 0.5; z += 3.2) m.decal(f, 0, D, z - 0.06, z + 0.06, frame, TIER.fine);
    m.part([...hall.faces, ...sides], { ref: [0, 0] });
    // its roof: a thin slab cantilevered over the forecourt and a little over the track side
    const over = Math.min(3, D * 0.35);
    const roof = m.box(h0, y0 - over, h1, y1 + 1, Hh, Hh + 0.7, { wall: slab, top: grey(TONES.flatRoof) });
    m.decal(roof.top, 0.4, hw - 0.4, 0.4, D + over + 1 - 0.4, grey(TONES.roofSurface));
    m.part(roof.faces, { after: true });

    // clock pylon beside the right wing
    let px1 = x1;
    if (s.clock !== false) {
      const pw = 1.3, px = x1 + 2.2, py = y0 + pw, H = Hh + 3;
      const p = m.box(px - pw / 2, py - pw / 2, px + pw / 2, py + pw / 2, 0, H, { wall: grey(0.9), top: grey(0.8) });
      for (const f of p.walls) {
        m.decal(f, 0.1, pw - 0.1, H - 1.3, H - 0.1, grey(0.97)); // dial
        m.decal(f, pw / 2 - 0.04, pw / 2 + 0.04, H - 0.7, H - 0.2, grey(TONES.window), TIER.window); // minute hand at 12
        m.decal(f, pw / 2, pw / 2 + 0.4, H - 0.74, H - 0.66, grey(TONES.window), TIER.window); // hour hand at 3
      }
      m.part(p.faces, { ref: [px, py] });
      m.shadow(m.rect(px - pw / 2, py - pw / 2, px + pw / 2, py + pw / 2), H);
      px1 = px + pw / 2;
    }

    m.shadow(m.rect(x0, y0, x1, y1), Hw);
    m.shadow(m.rect(h0, y0 - over, h1, y1 + 1), Hh + 0.7);
    m.entrance(0, y0);
    const wingArea = (L - hw) * D;
    return m.finish({
      footprint: m.rect(x0, y0, px1, y1), // the walls (and the pylon); the roofs reach out further
      height: Hh + 0.7,
      capacity: { jobs: Math.round((wingArea * Math.max(0, floors - 1)) / 25 + wingArea / 90 + 6), visitors: Math.round(wingArea / 12) },
      detail: { window: 1.4, fine: 0.12 },
      lights: { door: m.frame.xy(0, y0 - 2), canopy: [m.frame.xy((x0 + h0) / 2, y0 - 1.5), m.frame.xy((h1 + x1) / 2, y0 - 1.5)] },
    });
  }

  /** The hall stays lit from the first train to the last (05:00 to 01:00). */
  litShare(darkness) {
    const lit = super.litShare(darkness);
    const minutes = this.world.clock?.minutes ?? 720;
    const open = minutes >= 300 || minutes < 60;
    return { main: lit.main, shop: open ? Math.max(lit.shop, clamp((darkness - 0.15) / 0.2, 0, 1) * 0.9) : lit.shop };
  }

  draw(view) {
    super.draw(view);
    const g = this.geometry, open = this.litShare(view.darkness).shop;
    if (open < 0.05) return;
    view.lightPool(g.lights.door, this.mm(10), PALETTE.litWindow, 0.9 * open);
    for (const p of g.lights.canopy) view.lightPool(p, this.mm(9), "#fff4dc", 0.5 * open);
  }
}
