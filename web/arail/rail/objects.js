/**
 * Objects of the railway systems: where a system changes along the line (a system separation
 * section, a train control transition, a state border, the boundary between infrastructure
 * managers), drawn as a board beside the track.
 * @module arail/rail/objects
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { pointSegment, toRad } from "../core/math.js";
import { CD, grey, shade } from "../core/colors.js";
import { prismFaces } from "../core/view.js";
import { systemRows } from "./systems.js";

/** The kinds of system changes: what changes, and what drivers and dispatchers do there. */
export const CHANGE_KINDS = {
  power: {
    label: "System separation section", board: CD.brillantblau,
    rule: "Two traction power systems meet. Before the section the driver switches the main switch off and lowers the pantograph, coasts through, and raises the pantograph for the new system after it (in Germany signs El 1 to El 6).",
  },
  train_control: {
    label: "Train control transition", board: CD.tuerkis,
    rule: "The on-board unit changes from one train protection system to the other (e.g. PZB to LS, or to ETCS); the driver acknowledges the change. Without the system of the next section the train must stop.",
  },
  border: {
    label: "State border", board: CD.dunkelblau,
    rule: "The country, the infrastructure manager, the rulebook and often the operating language change. Both dispatchers hand the train over (train reporting), and the train needs the vehicle authorisation and the crew the licence and language of the other side.",
  },
  im: {
    label: "Boundary between infrastructure managers", board: grey(0.35),
    rule: "Another infrastructure manager is responsible from here: its timetable path, its dispatcher, its rules.",
  },
};

export class SystemChange extends LayoutObject {
  static type = "system-change";
  static label = "System change";
  static category = "Infrastructure";
  static placement = "point";
  static description = "Where a railway system changes along the line: a system separation section, a train control transition, a state border or the boundary between infrastructure managers. A board beside the track; its card says what happens there.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", default: "power", options: Object.entries(CHANGE_KINDS).map(([k, v]) => [k, v.label]) },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "Direction of the track (local x)." },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    return { center: c, angle: toRad(+this.spec.rotation_deg || 0) };
  }

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const r = this.mm(1.6);
    return [[g.center[0] - r, g.center[1] - r], [g.center[0] + r, g.center[1] - r], [g.center[0] + r, g.center[1] + r], [g.center[0] - r, g.center[1] + r]];
  }

  anchorPoint() {
    return this.geometry?.center ?? null;
  }

  pickHeight() {
    return this.mm(4.4);
  }

  get kind() {
    return CHANGE_KINDS[this.spec.kind] ? this.spec.kind : "power";
  }

  /** The tracks within a few metres, nearest first: the sections on both sides of the change. */
  nearTracks() {
    const c = this.geometry?.center;
    if (!c) return [];
    const reach = this.mm(25);
    return this.world.objects
      .filter((o) => o.type === "track" && o.geometry)
      .map((o) => {
        const p = o.geometry.points;
        let d = Infinity;
        for (let i = 1; i < p.length; i++) d = Math.min(d, pointSegment(c, p[i - 1], p[i]).distance);
        return { o, d };
      })
      .filter((x) => x.d <= reach)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.o);
  }

  /** The card: what changes here, what drivers do, and the systems of the tracks next to it. */
  card() {
    const card = super.card();
    const k = CHANGE_KINDS[this.kind];
    card.subtitle = this.spec.name ? k.label : card.subtitle;
    card.title = this.spec.name || k.label;
    card.text = k.rule;
    const tracks = this.nearTracks().slice(0, 2);
    card.sections = tracks.map((t) => ({ title: t.spec.track_id ? `Track ${t.spec.track_id}` : t.name, lines: systemRows(t.spec).map(([a, b]) => `${a}: ${b}`) }));
    card.related = tracks.map((t) => t.id);
    return card;
  }

  /** A post with a square board, 3.5 m up, beside the track. */
  draw(view) {
    const g = this.geometry;
    const k = CHANGE_KINDS[this.kind], m = (x) => this.mm(x);
    const u = [Math.cos(g.angle), Math.sin(g.angle)], n = [-u[1], u[0]];
    const at = (a, b) => [g.center[0] + u[0] * a + n[0] * b, g.center[1] + u[1] * a + n[1] * b];
    const rect = (a0, b0, a1, b1) => [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
    view.faces(prismFaces(rect(-0.08, -0.08, 0.08, 0.08), 0, m(3.2), { side: grey(0.55), top: grey(0.6) }), [g.center[0], g.center[1], m(1.6)]);
    view.faces(prismFaces(rect(-0.06, -0.55, 0.06, 0.55), m(3.2), m(4.3), { side: k.board, top: shade(k.board, 0.8) }), [g.center[0], g.center[1], m(3.7)]);
    view.label([g.center[0], g.center[1], m(4.6)], this.spec.name || k.label, { size: 10, anchor: "bottom", optional: true, order: 2 });
  }
}
