/**
 * Bus terminal: a waiting area with bus bays along a bus lane.
 * @module arail/objects/bus-terminal
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { StopArea } from "../core/stops.js";
import { add2, perpLeft, scale2, toRad } from "../core/math.js";
import { PALETTE } from "../core/colors.js";

export class BusTerminal extends LayoutObject {
  static type = "bus-terminal";
  static label = "Bus terminal";
  static category = "Transport";
  static placement = "point";
  static description = "Waiting area with bus bays along a bus lane. Buses stop at the bays.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "bays", label: "Bus bays", type: "number", min: 1, max: 8, step: 1, default: 3 },
    { key: "bay_length_m", label: "Bay length", type: "number", unit: "m", min: 12, max: 30, step: 1, default: 16 },
    { key: "width_m", label: "Waiting area width", type: "number", unit: "m", min: 2, max: 15, step: 0.5, default: 4.5 },
    { key: "lane_width_m", label: "Bus lane width", type: "number", unit: "m", min: 3, max: 8, step: 0.5, default: 3.5 },
    { key: "lines", label: "Lines", type: "text", default: "", help: "Comma-separated, e.g. \"62, 85\"." },
    { key: "headway_s", label: "A bus every", type: "number", unit: "s (simulated)", min: 10, max: 3600, step: 5, help: "Per bay. Empty = layout default." },
    { key: "shelter", label: "Shelters", type: "boolean", default: true },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const ang = toRad(+this.spec.rotation_deg || 0);
    const u = [Math.cos(ang), Math.sin(ang)], n = perpLeft(u);
    const bays = Math.max(1, Math.round(+this.spec.bays || 1));
    const L = this.mm(bays * (+this.spec.bay_length_m || 16));
    const W = this.mm(+this.spec.width_m || 4.5), lane = this.mm(+this.spec.lane_width_m || 3.5);
    // waiting area on the left, bus lane on the right (seen along u); c = centre of both
    const waitC = add2(c, scale2(n, lane / 2)), laneC = add2(c, scale2(n, -W / 2));
    const rect = (m, w) => [add2(add2(m, scale2(u, -L / 2)), scale2(n, -w / 2)), add2(add2(m, scale2(u, L / 2)), scale2(n, -w / 2)),
      add2(add2(m, scale2(u, L / 2)), scale2(n, w / 2)), add2(add2(m, scale2(u, -L / 2)), scale2(n, w / 2))];
    return { center: c, u, n, L, W, lane, bays, wait: rect(waitC, W), laneRect: rect(laneC, lane), origin: add2(waitC, scale2(u, -L / 2)), outline: rect(c, W + lane) };
  }

  footprint() {
    return this.geometry?.outline || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  stopAreas() {
    const g = this.geometry;
    if (!g) return [];
    const svc = this.world.layout.services;
    const headway = Number(this.spec.headway_s) > 0 ? Number(this.spec.headway_s) : svc.bus_headway_s;
    const bayLen = +this.spec.bay_length_m || 16;
    const docks = [];
    for (let i = 0; i < g.bays; i++) {
      docks.push({ id: `${this.id}:bay${i + 1}`, side: -1, s0: i * bayLen, s1: (i + 1) * bayLen, kind: "bus", label: `Bay ${String.fromCharCode(65 + i)}`, headway, dwell: svc.bus_dwell_s });
    }
    const Lm = g.bays * bayLen, Wm = +this.spec.width_m || 4.5;
    return [new StopArea({
      id: this.id, owner: this, kind: "bus", origin: g.origin, dir: g.u, lengthMM: g.L, widthMM: g.W, scale: this.world.scale, docks,
      access: [{ s: Lm / 2, t: Wm / 2 - 0.3, weight: 0.5 }, { s: 0.3, t: 0, weight: 0.25 }, { s: Lm - 0.3, t: 0, weight: 0.25 }],
    })];
  }

  draw(view) {
    const g = this.geometry;
    const m = (x) => view.m(x);
    view.polygon(g.laneRect, { fill: PALETTE.asphalt, alpha: 0.78, order: 2 });
    view.polygon(g.wait, { fill: PALETTE.pavement, alpha: 0.8, order: 3 });
    const P = (s, t) => add2(add2(g.origin, scale2(g.u, s)), scale2(g.n, t));
    // curb and bay markings
    view.line([P(0, -g.W / 2), P(g.L, -g.W / 2)], { stroke: "rgba(255,255,255,0.95)", width: 1.5, order: 4 });
    for (let i = 0; i <= g.bays; i++) {
      const s = (g.L * i) / g.bays;
      view.line([P(s, -g.W / 2), P(s, -g.W / 2 - g.lane * 0.85)], { stroke: PALETTE.busBay, width: 2, order: 4 });
    }
    view.line([P(0, -g.W / 2 - g.lane), P(g.L, -g.W / 2 - g.lane)], { stroke: "rgba(255,255,255,0.7)", width: 1, dash: [6, 5], order: 4 });
    const bayLen = g.L / g.bays;
    for (let i = 0; i < g.bays; i++) {
      const front = bayLen * (i + 1) - m(1);
      if (this.spec.shelter !== false) this._shelter(view, P, bayLen * i + bayLen * 0.35, g.W / 2 - m(1.1));
      this._stopSign(view, P(front, -g.W / 2 + m(0.5)), String.fromCharCode(65 + i));
    }
  }

  _shelter(view, P, s, t) {
    const m = (x) => view.m(x);
    const w = m(4), d = m(1.4);
    const fp = [P(s - w / 2, t - d / 2), P(s + w / 2, t - d / 2), P(s + w / 2, t + d / 2), P(s - w / 2, t + d / 2)];
    view.prism(fp, 0, m(2.4), { side: PALETTE.glass, top: "#6d7f91", alpha: 0.45 });
  }

  _stopSign(view, p, letter) {
    const top = view.project(p[0], p[1], view.m(2.9)), foot = view.project(p[0], p[1], 0);
    if (!top || !foot) return;
    view.solid(view.depth(p[0], p[1], 0), (ctx) => {
      ctx.strokeStyle = "#5b6470";
      ctx.lineWidth = 1.5 * view.px;
      ctx.beginPath();
      ctx.moveTo(foot[0], foot[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      const r = Math.max(5 * view.px, view.pxPerMM(p[0], p[1], view.m(2.9)) * view.m(0.35));
      ctx.beginPath();
      ctx.arc(top[0], top[1], r, 0, 2 * Math.PI);
      ctx.fillStyle = "#f7d417";
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.strokeStyle = "#1f8a3b";
      ctx.stroke();
      ctx.fillStyle = "#1f8a3b";
      ctx.font = `900 ${r * 1.3}px "Archivo", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("H", top[0], top[1] + r * 0.05);
      if (r > 8 * view.px) {
        ctx.font = `700 ${r * 0.6}px "Archivo", system-ui, sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.fillText(letter, top[0], top[1] + r * 1.6);
      }
    });
  }
}
