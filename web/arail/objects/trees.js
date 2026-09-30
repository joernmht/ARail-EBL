/**
 * Trees and forests (drawn as simple billboards: trunk plus crown).
 * @module arail/objects/trees
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, resolvePoints } from "../core/anchors.js";
import { createRng, pointInPolygon, polygonArea } from "../core/math.js";
import { PALETTE, shade } from "../core/colors.js";

const KINDS = [["deciduous", "deciduous"], ["conifer", "conifer"]];

/** Queue one tree at layout point p (mm), height in prototype metres. */
export function drawTree(view, p, heightM, kind = "deciduous", color = null) {
  const H = view.m(heightM);
  const base = view.project(p[0], p[1], 0), top = view.project(p[0], p[1], H);
  if (!base || !top) return;
  const scale = view.pxPerMM(p[0], p[1], H * 0.6);
  const crown = color || (kind === "conifer" ? PALETTE.conifer : PALETTE.leaves);
  // shadow on the ground
  const sh = view.m(heightM * 0.22);
  const shadow = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    shadow.push([p[0] + sh * Math.cos(a) + view.m(heightM * 0.12), p[1] + sh * 0.7 * Math.sin(a) - view.m(heightM * 0.1)]);
  }
  view.polygon(shadow, { fill: "rgba(20,30,15,0.25)", order: 6 });
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    const trunkTop = kind === "conifer" ? 0.25 : 0.45;
    const tx = base[0] + (top[0] - base[0]) * trunkTop, ty = base[1] + (top[1] - base[1]) * trunkTop;
    ctx.strokeStyle = PALETTE.trunk;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.2 * view.px, scale * view.m(heightM * 0.045));
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (kind === "conifer") {
      const w = Math.max(2 * view.px, scale * view.m(heightM * 0.2));
      const cb = [base[0] + (top[0] - base[0]) * 0.18, base[1] + (top[1] - base[1]) * 0.18];
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(cb[0] + w, cb[1]);
      ctx.lineTo(cb[0] - w, cb[1]);
      ctx.closePath();
      ctx.fillStyle = crown;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(cb[0] - w, cb[1]);
      ctx.lineTo(cb[0] - w * 0.1, cb[1]);
      ctx.closePath();
      ctx.fillStyle = shade(crown, 1.25);
      ctx.fill();
    } else {
      const r = Math.max(2 * view.px, scale * view.m(heightM * 0.3));
      const cx = base[0] + (top[0] - base[0]) * 0.68, cy = base[1] + (top[1] - base[1]) * 0.68;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, 2 * Math.PI);
      ctx.fillStyle = crown;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.5, r * 0.45, 0, 0, 2 * Math.PI);
      ctx.fillStyle = shade(crown, 1.3, 0.8);
      ctx.fill();
      ctx.lineWidth = 0.8 * view.px;
      ctx.strokeStyle = shade(crown, 0.6, 0.8);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
}

export class Tree extends LayoutObject {
  static type = "tree";
  static label = "Tree";
  static category = "Scenery";
  static placement = "point";
  static description = "A single tree.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: KINDS, default: "deciduous" },
    { key: "height_m", label: "Height", type: "number", unit: "m", min: 2, max: 40, step: 0.5, default: 12 },
    { key: "color", label: "Crown colour", type: "color", default: "" },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    return c ? { center: c } : null;
  }

  footprint() {
    const g = this.geometry;
    if (!g) return null;
    const r = this.mm((+this.spec.height_m || 12) * 0.3);
    return [[g.center[0] - r, g.center[1] - r], [g.center[0] + r, g.center[1] - r], [g.center[0] + r, g.center[1] + r], [g.center[0] - r, g.center[1] + r]];
  }

  draw(view) {
    drawTree(view, this.geometry.center, +this.spec.height_m || 12, this.spec.kind, this.spec.color || null);
  }
}

export class Forest extends LayoutObject {
  static type = "forest";
  static label = "Forest";
  static category = "Scenery";
  static placement = "polygon";
  static description = "An area filled with trees.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: [["mixed", "mixed"], ...KINDS], default: "mixed" },
    { key: "height_m", label: "Tree height", type: "number", unit: "m", min: 3, max: 40, step: 1, default: 14 },
    { key: "spacing_m", label: "Tree spacing", type: "number", unit: "m", min: 3, max: 40, step: 1, default: 8 },
    { key: "seed", label: "Random seed", type: "number", min: 1, max: 9999, step: 1, default: 1 },
  ];

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    if (!pts || pts.length < 3) return null;
    const rng = createRng(+this.spec.seed || 1);
    const spacing = this.mm(+this.spec.spacing_m || 8);
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of pts) {
      xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
      ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
    }
    const trees = [];
    const kinds = this.spec.kind === "mixed" ? ["deciduous", "conifer"] : [this.spec.kind];
    const H = +this.spec.height_m || 14;
    const maxTrees = 400;
    const step = Math.max(spacing, Math.sqrt(Math.abs(polygonArea(pts)) / maxTrees));
    for (let y = ymin + step / 2; y < ymax; y += step) {
      for (let x = xmin + step / 2; x < xmax; x += step) {
        const p = [x + rng.uniform(-0.4, 0.4) * step, y + rng.uniform(-0.4, 0.4) * step];
        if (pointInPolygon(p, pts)) trees.push({ p, h: H * rng.uniform(0.75, 1.2), kind: rng.pick(kinds) });
      }
    }
    return { points: pts, trees };
  }

  footprint() {
    return this.geometry?.points || null;
  }

  draw(view) {
    const g = this.geometry;
    view.polygon(g.points, { fill: PALETTE.forest, alpha: 0.35, order: 1 });
    for (const t of g.trees) drawTree(view, t.p, t.h, t.kind);
  }
}
