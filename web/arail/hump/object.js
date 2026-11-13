/**
 * The hump yard on the table (`hump-yard`): a layout object that runs a hump simulation of its own
 * (simulation.js) and draws it where it is placed. Its `position` is the crest; the cuts roll away from it in the
 * direction of `rotation_deg`, the train is pushed towards it from behind. The yard is the standard
 * yard (yard.js) with the object's number of tracks, their length and design, laid out as a fan
 * (`HumpYard#planAt`) at the layout's scale, its heights above the lowest end of a track.
 *
 * It humps one random train after the other, pushes its tracks up and pulls them out when they are full
 * (`pull_below_m`), and draws the raised hump, ballast and rails, the retarders (glowing while they brake),
 * every wagon (a band in the colour of its rolling class, as in the diagrams), the locomotive
 * pushing, impacts too hard (a red flash) and the track numbers. Deterministic: its random numbers come from
 * the world's seed and its id.
 * @module arail/hump/object
 */
import { resolvePoint } from "../core/anchors.js";
import { CD, CD_LIGHT, grey, shade } from "../core/colors.js";
import { createRng } from "../core/math.js";
import { LayoutObject } from "../core/object.js";
import { boxFaces } from "../core/transit.js";
import { randomTrain } from "./cuts.js";
import { DIAGRAM_COLOURS, cutClass } from "./diagrams.js";
import { SEASONS, TRACK_DESIGNS } from "./params.js";
import { HumpSimulation } from "./simulation.js";
import { standardYard } from "./yard.js";

/** Metres between the pieces the ballast and rails are drawn in; the formation beyond the outer ballast (m). */
const PIECE_M = 8, FORMATION_M = 2.5;
/** Widths (m): ballast bed, gauge of the rails, a wagon's body, a retarder beam beside a rail. */
const BALLAST_M = 3.6, GAUGE_M = 1.435, WAGON_W_M = 2.9, BEAM_M = 0.35;
/** Heights (m) of a wagon's body above the rail by type: underframe and roof (or sides). */
const BODY_M = { eanos: [1.0, 3.0], habbins: [1.0, 4.0], hbbillns: [1.0, 3.9], zacns: [1.0, 3.7], sgns: [1.0, 1.6] };
/** The locomotive pushing the train (m long), the gap before the train. */
const LOCO_M = 19;
/** Seconds an impact too hard flashes. */
const FLASH_S = 4;
/** Most simulation steps in one `update` (the rest is dropped, so that a slow frame does not pile up work). */
const MAX_STEPS = 400;
/** Cuts and log entries kept before old ones are dropped (an app that runs for hours). */
const KEEP_CUTS = 600, KEEP_LOG = 2000;

/** A small string hash (FNV-1a) for the object's own random stream. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The colours of the yard on the table: greys for ground, ballast, rails and wagons, CD for what happens. */
const COLOURS = {
  bank: grey(0.7), bankSide: grey(0.66), ballast: grey(0.5), rail: grey(0.2), beam: grey(0.12),
  body: shade(CD.rot, 0.55), top: grey(0.36), load: grey(0.2), loco: CD.rot, locoTop: grey(0.5),
  braking: CD.orange, problem: CD.rot, label: grey(0.15),
};

/** The hump yard as a layout object with its own simulation. */
export class HumpYardObject extends LayoutObject {
  static type = "hump-yard";
  static label = "Hump yard";
  static category = "Hump yard";
  static description = "A hump where trains are broken up: cuts roll down through retarders and switches into the classification tracks.";
  static placement = "point";
  static elevation = "ground";
  static params = [
    { key: "rotation_deg", label: "Direction", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "Where the cuts roll, from the crest (the object's position)." },
    { key: "tracks", label: "Classification tracks", type: "number", min: 2, max: 16, step: 1, default: 6 },
    { key: "track_m", label: "Track length", type: "number", unit: "m", min: 60, max: 750, step: 10, default: 120 },
    { key: "design", label: "Track design", type: "select", default: "speed", options: Object.entries(TRACK_DESIGNS).map(([k, d]) => [k, d.label]) },
    { key: "season", label: "Season", type: "select", default: "summer", options: Object.entries(SEASONS).map(([k, s]) => [k, s.label]) },
    { key: "push_mps", label: "Pushing speed", type: "number", unit: "m/s", min: 0.5, max: 3, step: 0.1, default: 1.2 },
    { key: "wagons", label: "Wagons per train", type: "number", min: 4, max: 60, step: 1, default: 24 },
    { key: "pull_below_m", label: "Pull out a track with less room", type: "number", unit: "m", min: 10, max: 200, step: 5, default: 40 },
  ];

  /** The yard of the object's figures (kept while they stay the same). */
  get yard() {
    const s = this.spec, key = `${s.tracks}:${s.track_m}:${s.design}`;
    if (key !== this._yardKey) {
      this._yardKey = key;
      this._yard = standardYard({ tracks: Math.round(s.tracks), track_m: Number(s.track_m), design: s.design, push_m: 40 });
      const routes = this._yard.tracks.map((t) => this._yard.routeTo(t.name));
      /** The lowest point of the yard: the end of the lowest track (heights are drawn above it). */
      this._low = Math.min(...this._yard.tracks.map((t, i) => this._yard.height(routes[i], t.s1)));
    }
    return this._yard;
  }

  /** The simulation (made again when its figures change; moving the object keeps it). */
  get sim() {
    const s = this.spec, yard = this.yard;
    const key = `${this._yardKey}:${s.season}:${s.push_mps}:${s.wagons}:${s.pull_below_m}:${this.world.seed}:${this.id}`;
    if (key !== this._simKey) {
      this._simKey = key;
      const seed = hash(`${this.world.seed ?? 1}:hump:${this.id}`);
      this._sim = new HumpSimulation(yard, { seed, season: s.season, dt: 0.1, pull_below_m: Number(s.pull_below_m) });
      this._rng = createRng(seed ^ 0x9e3779b9);
      this._trains = 0;
      this._acc = 0;
      this._flashes = [];
      this._seen = 0;
    }
    return this._sim;
  }

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const yard = this.yard, angle = ((Number(this.spec.rotation_deg) || 0) * Math.PI) / 180;
    const k = this.mm(1), cos = Math.cos(angle), sin = Math.sin(angle), crest = yard.crest_m, low = this._low;
    /** Layout mm of a point of the yard's plan (m), and the height (mm) above the lowest track end. */
    const at = (x, y) => [c[0] + (x - crest) * k * cos - y * k * sin, c[1] + (x - crest) * k * sin + y * k * cos];
    const z = (h) => (h - low) * k;
    // the pieces of every segment, once: ballast, both rails, the bank down to the table where it is raised
    const pieces = [];
    for (const seg of yard.segments.values()) {
      const route = yard.pathTo(seg.id);
      for (let s = seg.s0; s < seg.s1 - 1e-6; s += PIECE_M) {
        const e = Math.min(seg.s1, s + PIECE_M), m = (s + e) / 2;
        const a = yard.planAt(route, s), b = yard.planAt(route, e);
        const side = (p, off) => at(p.x - Math.sin(p.heading) * off, p.y + Math.cos(p.heading) * off);
        const quad = (w) => [side(a, w / 2), side(b, w / 2), side(b, -w / 2), side(a, -w / 2)];
        pieces.push({ seg: seg.id, s, e, z: z(yard.height(route, m)), bed: quad(BALLAST_M), rails: [[side(a, GAUGE_M / 2), side(b, GAUGE_M / 2)], [side(a, -GAUGE_M / 2), side(b, -GAUGE_M / 2)]], mid: at(yard.planAt(route, m).x, yard.planAt(route, m).y) });
      }
    }
    // the formation: one graded plateau under all tracks, slice by slice, its outer edges walled down to the table
    const routes = yard.tracks.map((t) => yard.routeTo(t.name)), ends = yard.tracks.map((t) => t.s1);
    const slices = [];
    for (let s = 0; s < Math.max(...ends) - 1e-6; s += PIECE_M) {
      const e = Math.min(Math.max(...ends), s + PIECE_M), live = routes.filter((_, i) => ends[i] > s);
      // its width at both ends (the fan widens), so that its edges run on without steps
      const edge = (x, f) => f(...live.map((r) => yard.planAt(r, Math.min(x, r.length ? yard.segment(r[r.length - 1]).s1 : x)).y));
      const his = edge(s, Math.max) + BALLAST_M / 2 + FORMATION_M, hie = edge(e, Math.max) + BALLAST_M / 2 + FORMATION_M;
      const los = edge(s, Math.min) - BALLAST_M / 2 - FORMATION_M, loe = edge(e, Math.min) - BALLAST_M / 2 - FORMATION_M;
      const low = (x) => z(Math.min(...live.map((r) => yard.height(r, x))));
      slices.push({ z: low((s + e) / 2), zs: low(s), ze: low(e), poly: [at(s, his), at(e, hie), at(e, loe), at(s, los)], mid: at((s + e) / 2, (his + los) / 2), first: s === 0 });
    }
    const xs = [], ys = [];
    for (const p of slices) for (const q of p.poly) [xs, ys].forEach((arr, i) => arr.push(q[i]));
    const outline = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
    return { center: c, angle, k, at, z, pieces, slices, outline };
  }

  /** The yard's outline on the layout (its bounding box). */
  footprint() {
    return this.geometry?.outline ?? null;
  }

  /** Where the label and the editor's handle go: the crest. */
  anchorPoint() {
    return this.geometry?.center ?? null;
  }

  pickHeight() {
    return this.mm(5);
  }

  /** Hump the next train when none waits, and run the simulation on (in its own steps of 0.1 s). */
  update(dt) {
    if (!this.geometry) return;
    const sim = this.sim, s = this.spec;
    if (!sim.pushing && !sim.queue.length) {
      sim.hump({ id: `T${++this._trains}`, push_mps: Number(s.push_mps), wagons: randomTrain(this._rng, { wagons: Math.round(s.wagons), tracks: this.yard.tracks.map((t) => t.name) }) });
    }
    this._acc += dt;
    const h = sim.options.dt;
    let n = 0;
    while (this._acc >= h && n < MAX_STEPS) {
      sim.step();
      this._acc -= h;
      n++;
    }
    if (n >= MAX_STEPS) this._acc = 0;
    // impacts too hard flash for a while; old cuts and log entries go
    for (; this._seen < sim.log.length; this._seen++) {
      const e = sim.log[this._seen];
      if ((e.type === "cut.impact" || e.type === "cut.caught-up" || e.type === "cut.end") && e.v_mps > sim.options.impact_mps) this._flashes.push({ t: sim.t, cut: e.cut });
    }
    this._flashes = this._flashes.filter((f) => sim.t - f.t < FLASH_S);
    if (sim.cuts.length > KEEP_CUTS) sim.cuts = sim.cuts.filter((c) => c.state !== "departed");
    if (sim.log.length > KEEP_LOG) {
      const drop = sim.log.length - KEEP_LOG / 2;
      sim.log.splice(0, drop);
      this._seen = Math.max(0, this._seen - drop);
    }
  }

  /** The yard: the raised hump, ballast and rails, retarders (glowing while they brake), track numbers. */
  draw(view) {
    const g = this.geometry;
    if (!g) return;
    const sim = this._sim, lit = view.darkness > 0.35;
    // the formation, walled down to the table along its outer edges (and at its start)
    for (const p of g.slices) {
      if (!view.inImage(p.mid[0], p.mid[1], p.z, 400)) continue;
      if (p.z > view.m(0.2)) {
        // the walls follow the slope (its heights at both ends of the slice), facing outwards
        const [a, b, c, d] = p.poly;
        const wall = (q, r, zq, zr) => {
          const dx = r[0] - q[0], dy = r[1] - q[1], l = Math.hypot(dx, dy) || 1;
          let n = [dy / l, -dx / l, 0];
          if (n[0] * ((q[0] + r[0]) / 2 - p.mid[0]) + n[1] * ((q[1] + r[1]) / 2 - p.mid[1]) < 0) n = n.map((v) => -v);
          return { pts: [[q[0], q[1], 0], [r[0], r[1], 0], [r[0], r[1], zr], [q[0], q[1], zq]], normal: n, color: COLOURS.bankSide, twoSided: true };
        };
        const walls = [wall(a, b, p.zs, p.ze), wall(c, d, p.ze, p.zs)];
        if (p.first) walls.push(wall(d, a, p.zs, p.zs));
        view.faces(walls, [p.mid[0], p.mid[1], p.z / 2]);
      }
      view.polygon(p.poly, { z: p.z, fill: COLOURS.bank, order: 1.5 });
    }
    for (const p of g.pieces) {
      if (!view.inImage(p.mid[0], p.mid[1], p.z, 400)) continue; // a piece far beyond the picture (polygon culls the rest)
      view.polygon(p.bed, { z: p.z, fill: COLOURS.ballast, order: 2 });
      for (const r of p.rails) view.line(r, { z: p.z + view.m(0.2), stroke: COLOURS.rail, width: 1, order: 3 });
    }
    for (const r of this.yard.retarders) {
      if (r.hold_mps != null) continue; // speed-holding units are part of the track
      const route = this.yard.pathTo(r.seg), level = sim?.retarderState(r.id).level ?? 0;
      const zr = g.z(this.yard.height(route, (r.s0 + r.s1) / 2)) + view.m(0.25);
      for (const side of [-1, 1]) {
        const off = side * (GAUGE_M / 2 + BEAM_M);
        const pts = [r.s0, r.s1].map((s) => { const p = this.yard.planAt(route, s); return g.at(p.x - Math.sin(p.heading) * off, p.y + Math.cos(p.heading) * off); });
        view.line(pts, { z: zr, stroke: level > 0.05 ? COLOURS.braking : COLOURS.beam, width: 3, order: 4 });
      }
      if (level > 0.05) {
        const p = this.yard.planAt(route, (r.s0 + r.s1) / 2);
        view.glow([...g.at(p.x, p.y), zr], view.m(r.length_m / 2 + 4), lit ? CD_LIGHT.orange : COLOURS.braking, level);
      }
    }
    // the track numbers where the tracks begin, behind their group retarders
    for (const t of this.yard.tracks) {
      const route = this.yard.routeTo(t.name), s = t.s0 + 12, p = this.yard.planAt(route, s);
      view.label([...g.at(p.x, p.y), g.z(this.yard.height(route, s)) + view.m(3)], t.name, { size: 11, optional: true, order: 2 });
    }
    view.label([...g.center, g.z(this.yard.height(this.yard.pathTo(this.yard.root), this.yard.crest_m)) + view.m(6)], this.spec.name || "Hump yard", { size: 12, optional: true, order: 3 });
  }

  /** The cuts: every wagon on the hump and in the tracks, the locomotive pushing, impacts too hard. */
  drawMoving(view) {
    const g = this.geometry, sim = this._sim;
    if (!g || !sim) return;
    const yard = this.yard, start = 0, flashing = new Set(this._flashes.map((f) => f.cut));
    const cuts = [...(sim.pushing ? sim.pushing.cuts : []), ...sim.bodies];
    for (const c of cuts) {
      const route = c.state === "pushed" ? [yard.root] : c.route, cls = cutClass(c);
      let front = c.s;
      for (const w of c.wagons) {
        const rear = front - w.length_m;
        if (rear >= start) this._drawWagon(view, g, route, w, rear + 0.4, front - 0.4, cls, flashing.has(c.id));
        front = rear;
      }
    }
    // the locomotive pushing the train, behind its last cut
    const last = sim.pushing?.cuts[sim.pushing.cuts.length - 1];
    if (last) {
      const rear = last.s - last.body.length_m;
      if (rear - LOCO_M >= start) this._drawBox(view, g, [yard.root], rear - LOCO_M, rear - 0.6, [0.9, 4.2], { side: COLOURS.loco, top: COLOURS.locoTop });
    }
  }

  _drawWagon(view, g, route, w, rear, front, cls, flash) {
    const [z0, z1] = BODY_M[w.type] ?? [1.0, 3.2];
    const band = DIAGRAM_COLOURS.light[cls];
    // a wagon in an impact too hard turns red for a while (by day and night), and glows at night
    const side = flash ? COLOURS.problem : COLOURS.body;
    const top = this._drawBox(view, g, route, rear, front, [z0, z1], { side, top: w.loaded >= 0.5 && (w.type === "eanos" || w.type === "sgns") ? COLOURS.load : COLOURS.top }, band);
    if (flash && top) view.glow(top, view.m(8), COLOURS.problem, 1);
  }

  /**
   * A box along the route from `rear` to `front` (m), its body from z0 to z1 (m above the rail);
   * a band in `band` along its sides. Returns the point at its middle, or null when not drawn.
   */
  _drawBox(view, g, route, rear, front, [z0, z1], colours, band = null) {
    const yard = this.yard, a = yard.planAt(route, rear), b = yard.planAt(route, front);
    const A = g.at(a.x, a.y), B = g.at(b.x, b.y), mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    if (!view.inImage(mid[0], mid[1], 0, 300)) return null;
    const zr = g.z(yard.height(route, (rear + front) / 2)) + view.m(0.2), m1 = view.m(1);
    const decorate = band ? (face, P, len, hw) => (face.side === "left" || face.side === "right"
      ? [{ pts: [P(0, face.side === "left" ? hw : -hw, zr + (z1 - 0.7) * m1), P(len, face.side === "left" ? hw : -hw, zr + (z1 - 0.7) * m1), P(len, face.side === "left" ? hw : -hw, zr + (z1 - 0.3) * m1), P(0, face.side === "left" ? hw : -hw, zr + (z1 - 0.3) * m1)], color: band }]
      : []) : null;
    const faces = boxFaces(A, B, WAGON_W_M * m1, zr + z0 * m1, zr + z1 * m1, { side: colours.side, top: colours.top, end: shade(colours.side, 0.9) }, decorate);
    view.faces(faces, [mid[0], mid[1], zr + z1 * m1]);
    return [mid[0], mid[1], zr + z1 * m1];
  }

  /** What the card says: the yard's figures and how the humping goes. */
  card() {
    const card = super.card(), sim = this._sim;
    card.rows.push(["Classification tracks", `${this.yard.tracks.length} × ${Math.round(this.spec.track_m)} m`]);
    if (sim) {
      const r = sim.results();
      card.rows.push(["Trains humped", String(r.trains)], ["Cuts per hour", String(Math.round(r.cuts_per_hour))], ["Misrouted", String(r.misrouted)], ["Impacts too hard", String(r.hard)], ["Trains pulled out", String(sim.departures.length)]);
    }
    return card;
  }
}
