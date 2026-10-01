/**
 * Rail platform: a strip between two markers (or two points). Trains stop along its long
 * edges; each edge that serves trains is a dock (optionally linked to a control-system track).
 * @module arail/objects/platform
 */
import { LayoutObject } from "../core/object.js";
import { resolveSegment, round1 } from "../core/anchors.js";
import { StopArea } from "../core/stops.js";
import { add2, len2, lerp2, perpLeft, scale2, sub2 } from "../core/math.js";
import { FONT, PALETTE } from "../core/colors.js";

export class Platform extends LayoutObject {
  static type = "platform";
  static label = "Rail platform";
  static category = "Transport";
  static placement = "segment";
  static description = "Platform between two markers or points. Trains stop along its long edges.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "number", label: "Number on signs", type: "text", default: "" },
    { key: "width_mm", label: "Width", type: "number", unit: "mm", min: 5, max: 400, step: 1, default: 50 },
    { key: "offset_mm", label: "Sideways offset", type: "number", unit: "mm", min: -400, max: 400, step: 1, default: 0, help: "Shifts the platform sideways from the line between its end points (positive = to the left)." },
    { key: "extend_mm", label: "Extension", type: "number", unit: "mm", min: -400, max: 400, step: 1, default: 0, help: "Added to the length at both ends (negative = shorter)." },
    {
      key: "sides", label: "Trains stop", type: "select", default: "both",
      options: [["both", "on both sides"], ["left", "on the left side"], ["right", "on the right side"], ["none", "nowhere"]],
      help: "Left/right as seen from the first towards the second end point.",
    },
    { key: "track_left", label: "Track name (left)", type: "text", default: "", help: "Name of this track in the control system." },
    { key: "track_right", label: "Track name (right)", type: "text", default: "" },
    { key: "lines", label: "Lines", type: "text", default: "", help: "Comma-separated line names, e.g. \"RE 1, S 2\"." },
    { key: "headway_s", label: "A train every", type: "number", unit: "s (simulated)", min: 10, max: 3600, step: 5, help: "Average interval of the built-in timetable. Empty = layout default." },
    { key: "canopy", label: "Canopy", type: "boolean", default: false },
  ];

  computeGeometry() {
    const seg = resolveSegment(this.world.map, this.spec);
    if (!seg) return null;
    const [a0, b0] = seg;
    const d = sub2(b0, a0), len = len2(d);
    if (len < 1) return null;
    const u = scale2(d, 1 / len), n = perpLeft(u);
    const off = +this.spec.offset_mm || 0, ext = +this.spec.extend_mm || 0;
    const a = add2(add2(a0, scale2(n, off)), scale2(u, -ext));
    const b = add2(add2(b0, scale2(n, off)), scale2(u, ext));
    const L = len + 2 * ext;
    if (L < 5) return null;
    const W = Math.max(1, +this.spec.width_mm || 50), h = W / 2;
    const corners = [add2(a, scale2(n, -h)), add2(b, scale2(n, -h)), add2(b, scale2(n, h)), add2(a, scale2(n, h))];
    return { a, b, u, n, L, W, corners, center: lerp2(a, b, 0.5) };
  }

  footprint() {
    return this.geometry?.corners || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  /** Platform length in the prototype (metres). */
  get lengthM() {
    return this.geometry ? this.meters(this.geometry.L) : 0;
  }

  stopAreas() {
    const g = this.geometry;
    if (!g) return [];
    const svc = this.world.layout.services;
    const headway = Number(this.spec.headway_s) > 0 ? Number(this.spec.headway_s) : svc.rail_headway_s;
    const dwell = svc.rail_dwell_s;
    const docks = [];
    const sides = this.spec.sides || "both";
    const dock = (side, key) => {
      const track = this.spec[`track_${key}`] || null;
      docks.push({ id: `${this.id}:${key}`, side, track, label: track ? `Track ${track}` : key === "left" ? "left track" : "right track", headway, dwell });
    };
    if (sides === "both" || sides === "left") dock(1, "left");
    if (sides === "both" || sides === "right") dock(-1, "right");
    return [new StopArea({ id: this.id, owner: this, kind: "rail", origin: g.a, dir: g.u, lengthMM: g.L, widthMM: g.W, scale: this.world.scale, docks })];
  }

  /** Dragging a marker-anchored platform moves it sideways (changes the offset). */
  translate(dx, dy) {
    if (Array.isArray(this.spec.between)) {
      const g = this.geometry;
      if (g) this.set({ offset_mm: round1((+this.spec.offset_mm || 0) + dx * g.n[0] + dy * g.n[1]) });
    } else super.translate(dx, dy);
  }

  draw(view) {
    const g = this.geometry;
    view.polygon(g.corners, { stroke: "rgba(255,255,255,0.9)", width: 1.3, order: 10 });
    // yellow edge where a train is arriving or standing
    for (const st of this.world.services.forArea(this.id)) {
      const v = st.vehicle;
      if (!v || v.phase === "departing") continue;
      const off = st.dock.side * (g.W / 2 - Math.min(2, g.W * 0.06));
      view.line([add2(g.a, scale2(g.n, off)), add2(g.b, scale2(g.n, off))], { stroke: PALETTE.safetyLine, width: 2.5, order: 11 });
    }
    if (this.spec.canopy) this._drawCanopy(view, g);
    this._drawSign(view, g);
  }

  _drawCanopy(view, g) {
    const m = (x) => view.m(x);
    const len = g.L * 0.6, start = g.L * 0.2;
    const half = Math.min(g.W / 2 - m(0.4), m(3.5));
    if (half <= 0) return;
    const P = (s, t, z) => [g.a[0] + g.u[0] * s + g.n[0] * t, g.a[1] + g.u[1] * s + g.n[1] * t, z];
    const z0 = m(3.6), z1 = m(3.9);
    const roof = [P(start, -half, 0), P(start + len, -half, 0), P(start + len, half, 0), P(start, half, 0)].map((p) => [p[0], p[1]]);
    // posts every ~12 m
    const posts = Math.max(2, Math.round(len / m(12)));
    for (let i = 0; i <= posts; i++) {
      const s = start + (len * i) / posts, r = m(0.15);
      const c = P(s, 0, 0);
      view.prism([[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]], 0, z0, { side: PALETTE.steel, top: PALETTE.steel, alpha: 0.85 });
    }
    view.prism(roof, z0, z1, { side: "#5d6d7e", top: "#8fa3b5", alpha: 0.75 });
  }

  _drawSign(view, g) {
    const number = this.spec.number;
    if (!number) return;
    const p = add2(g.a, scale2(g.u, Math.min(view.m(3), g.L * 0.1)));
    const top = view.project(p[0], p[1], view.m(3.2)), foot = view.project(p[0], p[1], 0);
    if (!top || !foot) return;
    view.solid(view.depth(p[0], p[1], 0), (ctx) => {
      ctx.strokeStyle = view.dim("#4b5563");
      ctx.lineWidth = 1.5 * view.px;
      ctx.beginPath();
      ctx.moveTo(foot[0], foot[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      const s = Math.max(9 * view.px, view.pxPerMM(p[0], p[1], view.m(3)) * view.m(0.8));
      ctx.fillStyle = PALETTE.signBlue;
      ctx.fillRect(top[0] - s / 2, top[1] - s, s, s);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${s * 0.7}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(number), top[0], top[1] - s / 2);
    });
  }
}
