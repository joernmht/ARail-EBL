/**
 * Landscape: coloured areas (grass, fields, water, ...). Streets are in objects/road.js.
 * @module arail/objects/landscape
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoints } from "../core/anchors.js";
import { PALETTE, mix } from "../core/colors.js";

const AREA_KINDS = {
  grass: { label: "grass", color: PALETTE.grass },
  field: { label: "field", color: PALETTE.field },
  water: { label: "water", color: PALETTE.water },
  sand: { label: "sand", color: PALETTE.sand },
  parking: { label: "parking", color: PALETTE.parking },
  plaza: { label: "plaza / square", color: PALETTE.plaza },
  forest: { label: "forest floor", color: PALETTE.forest },
};

export class Area extends LayoutObject {
  static type = "area";
  static label = "Landscape area";
  static category = "Scenery";
  static placement = "polygon";
  static description = "A coloured area: grass, field, water, parking, ...";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(AREA_KINDS).map(([k, v]) => [k, v.label]), default: "grass" },
    { key: "opacity", label: "Opacity", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.55 },
  ];

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    return pts && pts.length >= 3 ? { points: pts } : null;
  }

  footprint() {
    return this.geometry?.points || null;
  }

  draw(view) {
    const g = this.geometry;
    const kind = AREA_KINDS[this.spec.kind] || AREA_KINDS.grass;
    const alpha = +this.spec.opacity || 0.55;
    view.polygon(g.points, { fill: seasonColour(this.spec.kind, kind.color, view.weather), alpha, stroke: "rgba(255,255,255,0.35)", width: 1, order: 0, snow: this.spec.kind === "water" ? 0 : 1 });
    if (this.spec.kind === "water") {
      // a few slowly moving highlights, clipped to the water
      const img = view.projectAll(g.points);
      if (!img) return;
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const p of img) {
        xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
        ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
      }
      view.ground(0.5, (ctx) => {
        ctx.beginPath();
        img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.2 * view.px;
        const w = xmax - xmin, h = ymax - ymin;
        for (let i = 0; i < 7; i++) {
          const fx = (i * 0.37 + view.time * 0.01) % 1, fy = (i * 0.61) % 1;
          const x = xmin + fx * w, y = ymin + fy * h;
          ctx.beginPath();
          ctx.moveTo(x - w * 0.06, y);
          ctx.quadraticCurveTo(x, y - h * 0.02, x + w * 0.06, y);
          ctx.stroke();
        }
      });
    }
  }
}

/** What grass and fields look like in the seasons: [colour to go towards, how far]. */
const SEASON_TONES = {
  grass: { winter: ["#a8a67c", 0.55], spring: ["#8fc76a", 0.3], autumn: ["#9aa860", 0.35] },
  field: { winter: ["#8a6f4d", 0.75], spring: ["#86b85c", 0.7], autumn: ["#b89b5e", 0.6] },
};

/** The colour of an area in the season of the view's weather (grass pales, fields are ploughed, green, ripe, stubble). */
function seasonColour(kind, colour, weather) {
  const tone = SEASON_TONES[kind]?.[weather?.season];
  return tone ? mix(colour, tone[0], tone[1]) : colour;
}

// Streets moved to objects/road.js; kept here for imports of older plugins.
export { Road } from "./road.js";
