/**
 * Track: the centre line of a real track on the layout. Not drawn normally (the real track
 * is there); used to place trains reported by the control system as "track + offset".
 * @module arail/objects/track
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { polylineAt, polylineLengths } from "../core/math.js";
import { OVERLAY, rgba } from "../core/colors.js";

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
    const h = this.mm(1.5);
    const left = [], right = [];
    g.points.forEach((p, i) => {
      const a = g.points[Math.max(0, i - 1)], b = g.points[Math.min(g.points.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      left.push([p[0] - (dy / l) * h, p[1] + (dx / l) * h]);
      right.push([p[0] + (dy / l) * h, p[1] - (dx / l) * h]);
    });
    return left.concat(right.reverse());
  }

  draw(view) {
    if (!this.world.settings.showTracks) return;
    const g = this.geometry;
    view.line(g.points, { stroke: rgba(OVERLAY.tracked, 0.85), width: 2, dash: [10, 6], order: 25 });
    const mid = polylineAt(g.points, g.total / 2, g.lengths).point;
    view.label([mid[0], mid[1], 0], this.spec.track_id || this.name, { size: 10, background: OVERLAY.label, order: 3 });
  }
}
