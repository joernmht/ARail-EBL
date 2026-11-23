/**
 * The workshop hall seen inside (Werkstatthalle eines Betriebswerks): a hall without its roof, its
 * walls drawn from within, so that from any side one looks in over the near wall. Three tracks
 * with what a depot's hall has: under track 1 the inspection pit with roof platforms on both
 * sides, along track 2 the lifting jacks, in track 3 the underfloor wheel lathe; a crane across,
 * shelves and benches along the far wall, the foreman's cabin in a corner. Outside, three stabling
 * tracks beside the hall, and one throat: every track runs into the lead track through it.
 *
 * What stands where comes from elsewhere (`show`): a game's night in the hall (arail/game/
 * workshop.js through its board on the table) gives every unit with its track and how far it is
 * along the way there, how high it is raised, the lathe cutting, the fitters. The hall draws it:
 * units as the trains at the platforms are drawn, moving in and out through the throat, raised on
 * the jacks with their bogies left on the rails, fitters at the unit they work on, a lamp at each
 * hall track in the colour of its unit's state, the door of a track open while a unit passes, the
 * lathe's chips glowing. Without a game it shows a quiet night of its own.
 *
 * The hall is lit: nothing in it is darkened at night.
 *
 * Local frame (prototype metres): x along the tracks, the doors and the throat at +x; y across,
 * the stabling tracks at +y.
 * @module arail/ops/workshop
 */
import { BuildingBase, capacityFor } from "../objects/building-kit.js";
import { CD, CD_LIGHT, PALETTE, grey, shade } from "../core/colors.js";
import { polylineLengths } from "../core/math.js";
import { boxFaces } from "../core/transit.js";
import { drawTrain } from "../rail/draw.js";
import { carsOf } from "../rail/stock.js";
import { Consist } from "../rail/vehicles.js";
import { drawPerson } from "../sims/passengers.js";

/**
 * The plan of the hall (m): the hall's box, the height of its walls and of its doors, the tracks
 * (their y: 1 the pit, 2 the jacks, 3 the lathe in the hall; A to C outside), where a unit's head
 * stands on its track (`end_x`), where the tracks begin to run together (`fan_x`), and the lead
 * track all of them run into.
 */
export const HALL_PLAN = {
  hall: { x0: -34, x1: 34, y0: -13.5, y1: 13.5, height: 8.6, door: [5, 5.4] },
  tracks: { 1: -8.5, 2: 0, 3: 8.5, A: 21, B: 26.5, C: 32 },
  end_x: -24, fan_x: 47, lead: { x0: 98, x1: 156, y: 12 },
};
const HALL_TRACKS = ["1", "2", "3"];
/** A unit of the hall: the two-car unit of the layout's regional trains, and its length (m). */
const UNIT_CARS = carsOf(new Consist({ vehicles: [{ type: "et442s" }] }));
const UNIT_M = 42.6;
/** How far a unit is raised on the jacks (m), and how far beyond the lead track a unit comes from (m). */
const LIFT_M = 1.5, BEYOND_M = 62;
/** Sizes (m): the gauge's half, the pit's half width, the roof platforms' height, the crane's. */
const RAIL_M = 0.72, PIT_M = 0.6, PLATFORM_M = 3.7, CRANE_M = 7;
/** The colours of the hall: its floor, its walls, steel, safety yellow, the machine's turquoise; and of the lamp at a track by its unit's state. */
const TONE = { floor: grey(0.8), apron: grey(0.6), wall: grey(0.9), steel: grey(0.5), pit: "#3c3f44", rail: "#5b5f64", yellow: CD.gelb, machine: CD.tuerkis, shelf: grey(0.66) };
const LAMP = { idle: grey(0.55), work: CD_LIGHT.tuerkis, wait: CD_LIGHT.orange, released: CD.gelb, fit: "#6fcf6f", bad: CD_LIGHT.rot };
const FITTER = { body: CD.orange, legs: CD.dunkelblau }, DRIVER = { body: CD.dunkelblau, legs: grey(0.25) };

/** The quiet night the hall shows by itself: a unit over the pit, one on the lathe, one outside. */
const QUIET = {
  units: [
    { id: "a", track: "1", at: 1, lift: 0, tone: "work", fitters: 3 },
    { id: "b", track: "3", at: 1, lift: 0, tone: "work", fitters: 1 },
    { id: "c", track: "A", at: 1, lift: 0, tone: "fit", fitters: 0 },
  ],
  lathe: { unit: "b", cutting: true }, driver: null,
};

export class WorkshopHall extends BuildingBase {
  static type = "workshop-hall";
  static label = "Workshop hall, inside";
  static category = "Transport";
  static use = "work";
  static description = "A depot's workshop hall seen inside: the pit, the lifting jacks and the wheel lathe on its three tracks, stabling tracks and the throat outside. A game's night in the hall shows its units in it.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
  ];
  /** The hall's plan (local m): what a board on the table needs of it. */
  static plan = HALL_PLAN;

  /** What gives the hall's picture instead of its own quiet night (`show`): a function returning it, or null. */
  external = null;

  /**
   * Show the hall of somebody else (a game's night, see arail/game/workshop.js `hall()`): a function
   * that returns `{units: [{id, track, at, lift, tone, fitters}], lathe: {unit, cutting}, driver}`
   * whenever the hall is drawn. Null: the hall's own quiet night again.
   * @param {(() => object) | null} picture
   */
  show(picture) {
    this.external = typeof picture === "function" ? picture : null;
  }

  floorsCount() {
    return 1;
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const P = HALL_PLAN, { x0, x1, y0, y1, height: H } = P.hall, [dw, dh] = P.hall.door;
    m.setAnchor(0, 0, 4, Math.hypot(x1 - x0, y1 - y0) / 2 + 4);
    // the routes: every track from the lead track's far end through the throat to where a unit's head stands
    const route = (y) => [[P.lead.x1, P.lead.y], [P.lead.x0, P.lead.y], [P.fan_x, y], [P.end_x - 4, y]];
    // outside: ballast under the lead track, the fan and the stabling tracks; the apron before the doors
    m.plate(m.rect(x1, y0, P.fan_x, y1), { fill: TONE.apron, order: 2.5 });
    const strip = (a, b, w, style) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, n = [(-dy / l) * w, (dx / l) * w];
      m.plate([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], style);
    };
    for (const [id, y] of Object.entries(P.tracks)) {
      const r = route(y), hall = HALL_TRACKS.includes(id);
      for (let i = 0; i < r.length - 1; i++) {
        // (in the hall the rails lie in the floor)
        const a = r[i], b = i === 2 && hall ? [x1, y] : r[i + 1];
        strip(a, b, 1.7, { fill: PALETTE.ballast, order: 2.6 });
      }
    }
    // the hall's floor, the pit under track 1, the lathe's pit across track 3, safety lines along the tracks
    m.plate(m.rect(x0, y0, x1, y1), { fill: TONE.floor, order: 3, snow: 0, emissive: true });
    m.plate(m.rect(P.end_x - 3, P.tracks[1] - PIT_M, 24, P.tracks[1] + PIT_M), { fill: TONE.pit, order: 3.2, snow: 0, emissive: true });
    m.plate(m.rect(-6, P.tracks[3] - 2.2, -1, P.tracks[3] + 2.2), { fill: TONE.pit, order: 3.2, snow: 0, emissive: true });
    for (const id of HALL_TRACKS) {
      for (const side of [-2.1, 2.1]) m.line([[x0 + 2, P.tracks[id] + side], [x1 - 1, P.tracks[id] + side]], { stroke: TONE.yellow, width: 1, order: 3.4, emissive: true });
    }
    for (const [id, y] of Object.entries(P.tracks)) {
      const r = route(y), hall = HALL_TRACKS.includes(id);
      for (const side of [-RAIL_M, RAIL_M]) m.line(r.map(([x, yy]) => [x, yy + side]), { stroke: TONE.rail, width: 1, order: 3.6, emissive: hall });
    }
    // the walls, seen from within: each is drawn only while the camera looks at its inner side
    const walls = [];
    const inner = (a, b, z0, z1, colour = TONE.wall) => {
      const f = m.wall(a, b, z0, z1, colour);
      walls.push(f);
      return f;
    };
    const far = inner([x1, y0], [x0, y0], 0, H);
    m.band(far, 0, 1.1, grey(0.74));
    for (let s = 3; s < far.length - 3; s += 8) m.decal(far, s, s + 5, 4.4, 7.2, shade(CD.dunkelblau, 1.62));
    m.band(far, H - 0.5, H, CD.tuerkis);
    inner([x0, y0], [x0, y1], 0, H);
    inner([x0, y1], [x1, y1], 0, H);
    // the door wall: piers between the doors, a lintel over each
    let y = y1;
    for (const id of [...HALL_TRACKS].reverse()) {
      const ty = P.tracks[id];
      inner([x1, y], [x1, ty + dw / 2], 0, H);
      inner([x1, ty + dw / 2], [x1, ty - dw / 2], dh, H);
      y = ty - dw / 2;
    }
    inner([x1, y], [x1, y0], 0, H);
    m.part(walls.slice(0, 1), { ref: [0, y0] });
    m.part(walls.slice(1, 2), { ref: [x0, 0] });
    m.part(walls.slice(2, 3), { ref: [0, y1] });
    m.part(walls.slice(3), { ref: [x1, 0] });
    // along the far wall: shelves and benches, the foreman's cabin in the corner
    const solid = (bx0, by0, bx1, by1, z0, z1, wall, top = shade(wall, 1.15)) => m.part(m.box(bx0, by0, bx1, by1, z0, z1, { wall, top }).faces, { ref: [(bx0 + bx1) / 2, (by0 + by1) / 2] });
    for (let x = -24; x < 28; x += 9) solid(x, y0 + 0.3, x + 6, y0 + 1.5, 0, x % 2 ? 2.2 : 3.2, x % 2 ? TONE.shelf : shade(CD.dunkelblau, 1.5));
    const cabin = m.box(x0 + 0.4, y0 + 0.4, x0 + 6, y0 + 3, 0, 2.7, { wall: grey(0.95), top: grey(0.7) });
    m.window(cabin.walls[2], 0.6, 4.8, 1, 2.2);
    m.window(cabin.walls[1], 0.5, 2.1, 1, 2.2);
    m.part(cabin.faces, { ref: [x0 + 3, y0 + 1.7] });
    // track 1: the roof platforms on both sides of the pit, on their posts
    for (const side of [-1, 1]) {
      const py = P.tracks[1] + side * 2.5;
      solid(P.end_x - 2, py - 0.5, 20, py + 0.5, PLATFORM_M, PLATFORM_M + 0.18, TONE.yellow, grey(0.6));
      for (let x = P.end_x - 1; x <= 20; x += 7) solid(x - 0.12, py - 0.12, x + 0.12, py + 0.12, 0, PLATFORM_M, TONE.steel);
    }
    // track 2: the lifting jacks, a pair at each end of each car
    for (const x of [P.end_x + 2.5, P.end_x + 18.5, P.end_x + 24, P.end_x + 40]) for (const side of [-1, 1]) solid(x - 0.35, P.tracks[2] + side * 2.25 - 0.35, x + 0.35, P.tracks[2] + side * 2.25 + 0.35, 0, 2.6, TONE.yellow);
    // track 3: the wheel lathe's machine beside its pit (towards the hall's long wall, where it is seen), its chip bin, wheelsets waiting on their stand
    solid(-6, P.tracks[3] + 2.9, -1, P.tracks[3] + 4.2, 0, 1.9, TONE.machine);
    solid(1, P.tracks[3] + 3, 2.6, P.tracks[3] + 4, 0, 1.1, TONE.steel);
    for (let i = 0; i < 3; i++) {
      const wx = x0 + 3 + i * 1.6;
      for (const wy of [y1 - 4.4, y1 - 2.95]) solid(wx - 0.46, wy - 0.07, wx + 0.46, wy + 0.07, 0.1, 1.02, grey(0.35));
      solid(wx - 0.08, y1 - 4.4, wx + 0.08, y1 - 2.95, 0.48, 0.64, grey(0.45));
    }
    const g = m.finish({
      footprint: m.rect(x0 - 2, y0 - 2, P.lead.x1 + 2, P.tracks.C + 3), height: H,
      capacity: capacityFor("work", (x1 - x0) * (y1 - y0) * 0.2),
    });
    // the hall is lit: its inside is not darkened at night
    for (const part of g.parts) {
      for (const f of part.faces) {
        f.emissive = true;
        for (const d of f.lod?.[2] ?? []) d.emissive = true;
      }
    }
    const k = this.mm(1);
    g.lines = Object.fromEntries(Object.entries(P.tracks).map(([id, ty]) => {
      const r = route(ty);
      r[3] = [P.end_x, ty];
      const points = r.map(([x, yy]) => g.frame.xy(x, yy)), lengths = polylineLengths(points);
      return [id, { points, lengths, total: lengths[lengths.length - 1], m: k, lead: (P.lead.x1 - P.lead.x0 - 6) * k }];
    }));
    return g;
  }

  /** Layout point (mm) of a local point (m). */
  at(x, y, z = 0) {
    return this.geometry.frame.at(x, y, z);
  }

  /**
   * Where a unit's head is on the way to a track: a line and the place of its head along it (mm).
   * `at` 1: on its place; 0: on the lead track, clear of the throat; below 0: beyond the depot.
   * @param {string} track
   * @param {number} at
   */
  pose(track, at) {
    const line = this.geometry?.lines[track];
    if (!line) return null;
    return { line, head: at >= 0 ? line.lead + at * (line.total - line.lead) : line.lead + at * BEYOND_M * line.m };
  }

  /**
   * Where a thing of the hall is on the layout: a unit's middle (`"unit-103"`, in the picture shown)
   * or the middle of a track's place (`"track-2"`); null where there is none.
   * @param {string} item
   * @returns {number[] | null} [x, y, z] layout mm
   */
  placeOf(item) {
    const g = this.geometry;
    if (!g) return null;
    const [kind, id] = String(item ?? "").split(/-(.*)/s);
    if (kind === "track") {
      const y = HALL_PLAN.tracks[id];
      return y == null ? null : this.at(HALL_PLAN.end_x + UNIT_M / 2, y, 0);
    }
    if (kind !== "unit") return null;
    const u = this.picture().units.find((x) => x.id === id), p = u && this.pose(u.track, u.at);
    if (!p) return null;
    const s = Math.min(p.line.total, Math.max(0, p.head - (UNIT_M / 2) * p.line.m));
    let i = 1;
    while (i < p.line.lengths.length - 1 && p.line.lengths[i] < s) i++;
    const a = p.line.points[i - 1], b = p.line.points[i], t = (s - p.line.lengths[i - 1]) / (p.line.lengths[i] - p.line.lengths[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, this.mm(2 + (u.lift || 0) * LIFT_M)];
  }

  /** The picture the hall shows: a game's, or its own quiet night. */
  picture() {
    return this.external?.() ?? QUIET;
  }

  draw(view) {
    const g = this.geometry;
    if (!g) return;
    super.draw(view);
    const P = HALL_PLAN, pic = this.picture(), t = view.time ?? 0, k = this.mm(1);
    const lit = (faces) => {
      for (const f of faces) Object.assign(f, { color: shade(f.color, view.light(f.normal)), flat: true, emissive: true });
      return faces;
    };
    const box = (x0, y0, x1, y1, z0, z1, side, top = shade(side, 1.12)) => view.faces(lit(boxFaces(this.at(x0, (y0 + y1) / 2), this.at(x1, (y0 + y1) / 2), Math.abs(y1 - y0) * k, z0 * k, z1 * k, { side, top })), this.at((x0 + x1) / 2, (y0 + y1) / 2, 0));
    const here = (id) => pic.units.find((u) => u.track === id && u.at > 0.55);
    // a lamp at each hall track, by the door, in the colour of its unit's state; the door open while a unit passes
    for (const id of HALL_TRACKS) {
      const y = P.tracks[id], u = here(id), [dw, dh] = P.hall.door;
      box(P.hall.x1 - 2.2, y - 3.1, P.hall.x1 - 1.9, y - 2.8, 0, 3, TONE.steel);
      box(P.hall.x1 - 2.6, y - 3.5, P.hall.x1 - 1.5, y - 2.4, 3, 4.1, u ? LAMP[u.tone] ?? LAMP.idle : LAMP.idle);
      const passing = pic.units.some((x) => x.track === id && x.at > 0.05 && x.at < 0.999);
      if (!passing && !u?.moving) {
        const a = this.at(P.hall.x1, y + dw / 2, 0), b = this.at(P.hall.x1, y - dw / 2, 0), n = g.frame.dir(-1, 0);
        view.faces([{ pts: [a, b, [b[0], b[1], dh * k], [a[0], a[1], dh * k]], normal: [n[0], n[1], 0], color: shade(CD.tuerkis, 1.55), flat: true, emissive: true }], this.at(P.hall.x1, y, 0));
      }
    }
    // the crane's bridge: over the unit on the jacks while it is raised, else at rest near the end wall
    const raised = pic.units.find((u) => u.track === "2" && u.lift > 0.02);
    const cx = raised ? P.end_x + UNIT_M * 0.28 : P.hall.x0 + 7;
    box(cx - 0.35, P.hall.y0 + 0.3, cx + 0.35, P.hall.y1 - 0.3, CRANE_M, CRANE_M + 0.6, TONE.yellow);
    // the lamps of the yard: pools of light on the stabling tracks and the throat at night
    for (const [x, y] of [[-20, 23.7], [6, 29.2], [30, 23.7], [70, 14], [120, 14]]) {
      box(x - 0.12, y - 0.12, x + 0.12, y + 0.12, 0, 7, TONE.steel);
      view.lightPool(this.at(x, y), 11 * k, undefined, 0.55);
      view.glow(this.at(x, y, 7.2), 0.9 * k, undefined, 0.8);
    }
    // the lathe cutting: chips glow under the wheelset
    if (pic.lathe?.cutting) {
      const y = P.tracks[3], f = 0.6 + 0.4 * Math.sin(t * 23) * Math.sin(t * 7.3);
      view.polygon([this.at(-4.6, y - 1.1), this.at(-2.4, y - 1.1), this.at(-2.4, y + 1.1), this.at(-4.6, y + 1.1)], { fill: CD_LIGHT.orange, alpha: 0.35 + 0.5 * f, order: 3.5, emissive: true });
      view.glow(this.at(-3.5, y, 0.6), 3 * k, CD_LIGHT.orange, 0.9);
    }
    // the units: those inside lit by the hall, those raised with their bogies left on the rails
    for (const u of pic.units) {
      const p = this.pose(u.track, u.at);
      if (!p) continue;
      const inside = HALL_TRACKS.includes(u.track) && u.at > 0.6, lift = (u.lift || 0) * LIFT_M;
      const cars = lift > 0.02 ? UNIT_CARS.map((c) => ({ ...c, floor_m: c.floor_m + lift, roof_m: c.roof_m + lift })) : UNIT_CARS;
      if (lift > 0.02) {
        const y = P.tracks[u.track];
        for (const x of [P.end_x + 3.5, P.end_x + 17.5, P.end_x + 25, P.end_x + 39]) box(x - 1.3, y - 1.1, x + 1.3, y + 1.1, 0.05, 0.85, grey(0.28));
      }
      drawTrain(view, p.line, { head: p.head, dir: 1, cars, doors: 0, powered: !!u.moving, pantograph: 0 }, { bright: inside });
      if (this.world.settings?.labels && u.name) {
        const at = this.placeOf(`unit-${u.id}`);
        if (at) view.label([at[0], at[1], this.mm(6 + lift)], u.name, { size: 10, optional: true, order: 6 });
      }
      // its fitters, on the side of the track towards the other tracks, stepping about their work
      if (u.fitters && u.at >= 1) {
        const y = P.tracks[u.track] + 2.9;
        for (let i = 0; i < u.fitters; i++) {
          const x = P.end_x + 6 + (i * (UNIT_M - 12)) / Math.max(1, u.fitters - 1) + 1.2 * Math.sin(t * 0.5 + i * 2.1);
          drawPerson(view, this.at(u.track === "3" ? -7.6 - i : x, y, 0), { dir: g.frame.dir(Math.cos(t * 0.5 + i * 2.1), 0), heading: g.frame.dir(0, -1), speed: 0.4, phase: t * 4 + i, height: 1.78, colour: FITTER.body, legs: FITTER.legs });
        }
      }
    }
    // a driver at the door of a unit that is released and not yet returned to operation
    const d = pic.driver && pic.units.find((u) => u.id === pic.driver);
    if (d && P.tracks[d.track] != null) drawPerson(view, this.at(P.end_x + UNIT_M + 2, P.tracks[d.track] + 2.4, 0), { heading: g.frame.dir(-1, -0.4), speed: 0, height: 1.8, colour: DRIVER.body, legs: DRIVER.legs });
  }
}
