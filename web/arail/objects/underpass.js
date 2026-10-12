/**
 * Pedestrian underpass (Personentunnel): a footpath under the tracks. People walk through it
 * like on any footpath of the road network, but out of sight; on the surface only its stairs
 * are drawn: a glass stair housing at the ends that have one, and a stairwell on every
 * platform the tunnel passes under (its stairs come up there).
 * @module arail/objects/underpass
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { dist2, polylineAt, polylineLengths, sub2, unit2 } from "../core/math.js";
import { segmentIntersection } from "../core/network.js";
import { grey } from "../core/colors.js";
import { offsetPolyline } from "./road.js";
import { BuildingModel, Frame, TONES, drawModel, parapetRoof } from "./building-kit.js";

const STAIRS = [["both", "at both ends"], ["start", "at the start"], ["end", "at the end"], ["none", "none (inside buildings)"]];

/** Stair housing (m): length along the tunnel, width, height. */
const HOUSING = { length: 7, width: 4, height: 2.8 };

export class Underpass extends LayoutObject {
  static type = "underpass";
  static label = "Pedestrian underpass";
  static category = "Transport";
  static placement = "polyline";
  static description = "A footpath under the tracks: people walk through it out of sight. Its stairs are drawn at its ends and on the platforms it passes under. Start and end it on streets.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 2, max: 12, step: 0.5, default: 4 },
    { key: "stairs", label: "Stair housings", type: "select", options: STAIRS, default: "both", help: "An end inside a building (e.g. a station hall) needs none." },
    { key: "stairs_m", label: "Stairs from the end", type: "number", unit: "m", min: 0, max: 40, step: 0.5, default: 8, help: "Where the housing opens, measured from the end of the line (room for the street there)." },
  ];

  computeGeometry() {
    const raw = resolvePoints(this.world.map, this.spec.points);
    const points = [];
    for (const p of raw || []) if (!points.length || dist2(p, points[points.length - 1]) > 1e-6) points.push(p);
    if (points.length < 2) return null;
    const lengths = polylineLengths(points), length = lengths[lengths.length - 1];
    const width = this.mm(+this.spec.width_m > 0 ? +this.spec.width_m : 4);
    const h = width / 2;
    const footprint = offsetPolyline(points, h).concat(offsetPolyline(points, -h).reverse());
    // stair housings: open towards the end, `stairs_m` in from it
    const which = this.spec.stairs || "both", off = this.mm(Math.max(0, +this.spec.stairs_m || 0));
    const housings = [];
    const housing = (s, towards) => {
      const at = polylineAt(points, s, lengths), d = towards > 0 ? at.dir : [-at.dir[0], -at.dir[1]];
      // local frame: the open side (−y) faces the end, so x runs across the tunnel
      const angle = Math.atan2(d[1], d[0]) + Math.PI / 2;
      const c = [at.point[0] - d[0] * this.mm(HOUSING.length / 2), at.point[1] - d[1] * this.mm(HOUSING.length / 2)];
      housings.push(stairHousing(new Frame(c, angle, this.mm(1)), this.world.seed));
    };
    const room = this.mm(HOUSING.length);
    if ((which === "both" || which === "start") && length > off + room) housing(off, -1);
    if ((which === "both" || which === "end") && length > off + room) housing(length - off, 1);
    return { points, lengths, length, width, footprint, housings };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    const g = this.geometry;
    return g ? polylineAt(g.points, g.length / 2, g.lengths).point : null;
  }

  /** For the road network: a footpath whose walkers are hidden (see core/network.js). */
  roadInfo() {
    const g = this.geometry;
    if (!g) return null;
    return { points: g.points, kind: "path", car: false, walk: true, hidden: true, width: g.width, sidewalk: 0, speed: 1.3, walkOffset: 0, laneOffset: 0 };
  }

  /**
   * Stairwells where the tunnel passes under a platform: [{pts, rail}] (layout mm), worked out
   * again when a platform changes.
   */
  _stairwells() {
    const g = this.geometry;
    const platforms = this.world.objects.filter((o) => o.type === "platform" && o.geometry?.a);
    const geoms = platforms.map((p) => p.geometry);
    if (this._sw && this._sw.g === g && this._sw.geoms.length === geoms.length && this._sw.geoms.every((x, i) => x === geoms[i])) return this._sw.list;
    const list = [];
    for (const pg of geoms) {
      for (let i = 1; i < g.points.length; i++) {
        const x = segmentIntersection(g.points[i - 1], g.points[i], pg.a, pg.b);
        if (!x) continue;
        const u = pg.u || unit2(sub2(pg.b, pg.a)), n = [-u[1], u[0]];
        const len = this.mm(6) / 2, w = Math.min(this.mm(2.4), pg.W * 0.5) / 2;
        const at = (s, t) => [x.p[0] + u[0] * s + n[0] * t, x.p[1] + u[1] * s + n[1] * t];
        list.push({ pts: [at(-len, -w), at(len, -w), at(len, w), at(-len, w)] });
      }
    }
    this._sw = { g, geoms, list };
    return list;
  }

  draw(view) {
    const g = this.geometry;
    for (const sw of this._stairwells()) {
      view.polygon(sw.pts, { fill: grey(TONES.opening), alpha: 0.9, stroke: grey(0.9), width: 1, order: 10.5 });
    }
    for (const h of g.housings) drawModel(view, h);
  }
}

/** A glass stair housing with a flat roof, open on its −y side (the stairs go down from there). */
function stairHousing(frame, seed) {
  const m = new BuildingModel(frame, { seed });
  const { length: L, width: W, height: H } = HOUSING;
  const x0 = -W / 2, x1 = W / 2, y0 = -L / 2, y1 = L / 2;
  m.setAnchor(0, 0, H / 2, L / 2 + 1);
  m.plate(m.rect(x0 + 0.4, y0, x1 - 0.4, y1 - 0.8), { fill: grey(TONES.opening), alpha: 0.9, order: 2 });
  const glass = grey(TONES.glass);
  const body = m.box(x0, y0, x1, y1, 0, H, { wall: glass, skip: [0] });
  for (const f of body.walls) {
    if (!f) continue;
    for (let s = 1; s < f.length; s += 1.5) m.decal(f, s - 0.04, s + 0.04, 0, H, grey(0.8));
    m.band(f, 0, 0.25, grey(0.8));
  }
  const roof = parapetRoof(m, { x0: x0 - 0.3, y0: y0 - 0.6, x1: x1 + 0.3, y1: y1 + 0.3, z: H + 0.3, parapet: 0.2 });
  const edge = m.box(x0 - 0.3, y0 - 0.6, x1 + 0.3, y1 + 0.3, H, H + 0.3, { wall: grey(0.92) });
  m.part(body.faces);
  m.part([...edge.faces, roof], { after: true });
  m.shadow(m.rect(x0, y0, x1, y1), H);
  return m.finish({ footprint: m.rect(x0, y0, x1, y1), height: H + 0.3, detail: { window: 1.5, fine: 0.08 } });
}
