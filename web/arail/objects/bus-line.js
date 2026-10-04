/**
 * Bus line (`bus-line`): buses run along the streets from stop to stop.
 *
 * The editor places a line by tapping its bus stops (or bus terminals) in order (placement
 * "stops"): `spec.stops` is the list of their object ids. The line runs back and forth between
 * the first and the last stop, or round in a loop. `world.transit` (core/transit.js) finds the
 * route over the road network, dispatches the buses and runs them; this object draws the route
 * and reports problems.
 * @module arail/objects/bus-line
 */
import { LayoutObject } from "../core/object.js";
import { CD, OVERLAY, rgba } from "../core/colors.js";
import { polylineProject } from "../core/math.js";

/**
 * Stroke a long line on the ground as one item; parts behind the camera are left out (a single
 * `view.line` would be dropped as a whole).
 */
function strokeRoute(view, points, { colour, width, alpha = 1, dash = null, order }) {
  const runs = [];
  let run = [];
  for (const p of points) {
    const q = view.project(p[0], p[1], 0);
    if (q) run.push(q);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  if (!runs.length) return;
  view.ground(order, (ctx) => {
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = order >= 100 ? colour : view.dim(colour);
    ctx.lineWidth = width * view.px;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (dash) ctx.setLineDash(dash.map((d) => d * view.px));
    ctx.beginPath();
    for (const r of runs) r.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
  });
}

export class BusLine extends LayoutObject {
  static type = "bus-line";
  static label = "Bus line";
  static category = "Transport";
  static placement = "stops";
  /** Object types the editor offers as stops. */
  static stopTypes = ["bus-stop", "bus-terminal"];
  static description = "Buses that drive along the streets from stop to stop. Tap the bus stops (or bus terminals) in order, then press Finish.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "number", label: "Line number", type: "text", default: "", help: "Shown on the buses and signs, e.g. \"62\"." },
    { key: "color", label: "Colour", type: "color", default: CD.tuerkis },
    { key: "headway_s", label: "A bus every", type: "number", unit: "s (simulated)", min: 30, max: 3600, step: 10, default: 240, help: "Outside the rush hours; more often in the morning and evening, no buses at night." },
    { key: "mode", label: "Route", type: "select", options: [["back-and-forth", "back and forth"], ["loop", "loop (round trip)"]], default: "back-and-forth" },
    { key: "speed_kmh", label: "Top speed", type: "number", unit: "km/h", min: 10, max: 80, step: 5, default: 40 },
    { key: "show_route", label: "Show the route", type: "boolean", default: true },
  ];

  computeGeometry() {
    const stops = Array.isArray(this.spec.stops) ? this.spec.stops.filter((id) => typeof id === "string") : [];
    return stops.length ? { stops } : null;
  }

  /** Line number shown on buses and signs: `number`, else the name, else the number in the id. */
  lineLabel() {
    const n = String(this.spec.number ?? "").trim();
    if (n) return n;
    if (this.spec.name) return this.spec.name;
    return String(this.id).match(/(\d+)$/)?.[1] || String(this.id);
  }

  /** The line in operation (core/transit.js), or null. */
  info() {
    const t = this.world.transit;
    if (!t) return null;
    t.sync();
    return t.lines.get(this.id) || null;
  }

  /** What keeps the line from running as planned (shown in the editor). */
  problems() {
    return this.info()?.problems ?? [];
  }

  /** Stops of the line that exist (objects). */
  stopObjects() {
    return (this.geometry?.stops || []).map((id) => this.world.getObject(id)).filter(Boolean);
  }

  anchorPoint() {
    return this.stopObjects()[0]?.anchorPoint() ?? null;
  }

  footprint() {
    return null;
  }

  /** Lines are selected by tapping their route. */
  contains(p, toleranceMM = 0) {
    const c = this.info()?.circuit;
    if (c) return polylineProject(c.points, p, c.lengths).distance <= toleranceMM + this.mm(2);
    return this.stopObjects().some((o) => o.contains(p, toleranceMM));
  }

  /** Nothing to move: the line follows its stops. */
  translate() {}

  draw(view) {
    if (this.spec.show_route === false) return;
    const line = this.info();
    const colour = this.spec.color || CD.tuerkis;
    if (!line?.circuit) {
      // no route (yet): the order of the stops as a dashed line
      const pts = this.stopObjects().map((o) => o.anchorPoint()).filter(Boolean);
      if (pts.length > 1) strokeRoute(view, pts, { colour, width: 2, dash: [5, 6], alpha: 0.9, order: 1.6 });
      return;
    }
    strokeRoute(view, line.circuit.points, { colour, width: 2.5, alpha: 0.85, order: 1.6 });
    const dots = line.visits.map((v) => view.project(v.front[0], v.front[1], 0)).filter(Boolean);
    if (!dots.length) return;
    view.ground(1.65, (ctx) => {
      const r = 3.5 * view.px;
      ctx.lineWidth = 2 * view.px;
      ctx.strokeStyle = view.dim(colour);
      ctx.fillStyle = view.dim("#ffffff");
      for (const d of dots) {
        ctx.beginPath();
        ctx.arc(d[0], d[1], r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });
  }

  /** The simple view (core/simple.js): the route as it is. */
  drawSimple(view) {
    this.draw(view);
  }

  drawSelection(view) {
    const line = this.info();
    if (line?.circuit) strokeRoute(view, line.circuit.points, { colour: rgba(OVERLAY.selection, 0.95), width: 5, dash: [8, 6], order: 100 });
    for (const o of this.stopObjects()) {
      const fp = o.footprint();
      if (fp) view.polygon(fp, { stroke: OVERLAY.selection, width: 2, dash: [4, 4], order: 100, layer: "overlay" });
    }
  }
}
