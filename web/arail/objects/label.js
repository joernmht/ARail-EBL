/**
 * Label: a station name board on posts, or a floating text.
 * @module arail/objects/label
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { FONT, OVERLAY, PALETTE } from "../core/colors.js";

export class Label extends LayoutObject {
  static type = "label";
  static label = "Label / sign";
  static category = "Infrastructure";
  static placement = "point";
  static description = "Station name board or floating text.";
  static params = [
    { key: "text", label: "Text", type: "text", default: "Station" },
    { key: "style", label: "Style", type: "select", options: [["board", "station name board"], ["floating", "floating text"]], default: "board" },
    { key: "height_m", label: "Height", type: "number", unit: "m", min: 0, max: 30, step: 0.5, default: 3 },
  ];

  get name() {
    return this.spec.name || this.spec.text || this.id;
  }

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    return c ? { center: c } : null;
  }

  draw(view) {
    const c = this.geometry.center;
    const z = view.m(+this.spec.height_m || 0);
    if (this.spec.style === "floating") {
      view.label([c[0], c[1], z], this.spec.text || "", { size: 14, background: OVERLAY.label });
      return;
    }
    const top = view.project(c[0], c[1], z), foot = view.project(c[0], c[1], 0);
    if (!top || !foot) return;
    view.solid(view.depth(c[0], c[1], 0), (ctx) => {
      const s = Math.max(10 * view.px, view.pxPerMM(c[0], c[1], z) * view.m(0.9));
      ctx.font = `700 ${s * 0.72}px ${FONT}`;
      const w = ctx.measureText(this.spec.text || "").width + s * 0.8;
      ctx.strokeStyle = view.dim("#4b5563");
      ctx.lineWidth = 1.5 * view.px;
      for (const dx of [-w * 0.35, w * 0.35]) {
        ctx.beginPath();
        ctx.moveTo(foot[0] + dx, foot[1]);
        ctx.lineTo(top[0] + dx, top[1]);
        ctx.stroke();
      }
      ctx.fillStyle = PALETTE.signBlue;
      ctx.fillRect(top[0] - w / 2, top[1] - s, w, s);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.strokeRect(top[0] - w / 2 + s * 0.08, top[1] - s + s * 0.08, w - s * 0.16, s - s * 0.16);
      ctx.fillStyle = PALETTE.signText;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.spec.text || "", top[0], top[1] - s / 2);
    });
  }
}
