/**
 * Track: the centre line of a real track on the layout. Not drawn over the camera image (the
 * real track is there) unless "Tracks" is switched on; used to place trains reported by the
 * control system as "track + offset". A virtual camera (flyover) draws the track itself:
 * ballast, sleepers and rails.
 * @module arail/objects/track
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { polylineAt, polylineLengths } from "../core/math.js";
import { OVERLAY, rgba } from "../core/colors.js";

/** Prototype dimensions (m) and colours of the track drawn in the flyover. */
const BED = { width_m: 4.2, color: "#8d8880" };
const SLEEPER = { length_m: 2.6, width_m: 0.26, spacing_m: 0.65, color: "#aaa69d" };
const RAIL = { gauge_m: 1.435, head_m: 0.072, color: "#5b5f64" };

export class Track extends LayoutObject {
  static type = "track";
  static label = "Track";
  static category = "Infrastructure";
  static placement = "polyline";
  static description = "Centre line of a real track, for train positions from the control system (\"track + offset\").";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "track_id", label: "Track name in the control system", type: "text", default: "" },
    { key: "offset_start_mm", label: "Offset at the first point", type: "number", unit: "mm", step: 1, default: 0, help: "Position value the control system reports at the first point of the line." },
  ];

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    if (!pts || pts.length < 2) return null;
    const lengths = polylineLengths(pts);
    return { points: pts, lengths, total: lengths[lengths.length - 1] };
  }

  /** Layout point and direction at a control-system offset (mm). */
  at(offsetMM) {
    const g = this.geometry;
    return g ? polylineAt(g.points, offsetMM - (+this.spec.offset_start_mm || 0), g.lengths) : null;
  }

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    return offsetLine(g.points, this.mm(1.5)).concat(offsetLine(g.points, -this.mm(1.5)).reverse());
  }

  draw(view) {
    const g = this.geometry;
    if (!view.showsReal(g.points)) this._drawTrack(view, g);
    if (!this.world.settings.showTracks) return;
    view.line(g.points, { stroke: rgba(OVERLAY.tracked, 0.85), width: 2, dash: [10, 6], order: 25 });
    const mid = polylineAt(g.points, g.total / 2, g.lengths).point;
    view.label([mid[0], mid[1], 0], this.spec.track_id || this.name, { size: 10, background: OVERLAY.label, order: 3 });
  }

  /** Sleepers as quads (layout mm), cached with the geometry. */
  _sleepers(g) {
    if (g.sleepers) return g.sleepers;
    const step = this.mm(SLEEPER.spacing_m), half = this.mm(SLEEPER.length_m) / 2, w = this.mm(SLEEPER.width_m) / 2;
    const out = [];
    for (let s = step / 2; s < g.total; s += step) {
      const { point: p, dir: u } = polylineAt(g.points, s, g.lengths);
      const n = [-u[1], u[0]];
      const q = (a, b) => [p[0] + u[0] * a + n[0] * b, p[1] + u[1] * a + n[1] * b];
      out.push([q(-w, -half), q(w, -half), q(w, half), q(-w, half)]);
    }
    g.sleepers = out;
    return out;
  }

  /** The real track, for a virtual camera: ballast bed, sleepers (when large enough on screen), rails. */
  _drawTrack(view, g) {
    view.ribbon(g.points, view.m(BED.width_m), { fill: BED.color, order: 4 });
    const mid = polylineAt(g.points, g.total / 2, g.lengths).point;
    const k = view.pxPerMM(mid[0], mid[1], 0);
    if (k * view.m(SLEEPER.spacing_m) >= 2.5 * view.px) {
      const quads = this._sleepers(g);
      view.ground(5, (ctx) => {
        ctx.beginPath();
        for (const quad of quads) {
          const img = view.projectAll(quad);
          if (!img) continue;
          img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
        }
        ctx.fillStyle = view.dim(SLEEPER.color);
        ctx.fill();
      });
    }
    // the rail heads as ribbons (right in perspective, also with the camera close to one end of
    // the track) and a hairline on them, so that they never vanish in the distance
    for (const side of [1, -1]) {
      const rail = offsetLine(g.points, (side * view.m(RAIL.gauge_m)) / 2);
      view.ribbon(rail, view.m(RAIL.head_m * 1.6), { fill: RAIL.color, order: 6 });
      view.line(rail, { stroke: RAIL.color, width: 0.8, order: 6 });
    }
  }
}

/** A polyline shifted sideways by `d` (mm, positive = to the left). */
function offsetLine(points, d) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d];
  });
}
