/**
 * Trees and forests (drawn as simple billboards: trunk plus crown).
 * @module arail/objects/trees
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, resolvePoints } from "../core/anchors.js";
import { createRng, pointInPolygon, polygonArea } from "../core/math.js";
import { PALETTE, parseColor, rgba, shade } from "../core/colors.js";
import { leafTone } from "../core/weather.js";

const KINDS = [["deciduous", "deciduous"], ["conifer", "conifer"]];

/** Queue one tree at layout point p (mm), height in prototype metres. */
export function drawTree(view, p, heightM, kind = "deciduous", color = null) {
  const H = view.m(heightM);
  const base = view.project(p[0], p[1], 0), top = view.project(p[0], p[1], H);
  if (!base || !top) return;
  const scale = view.pxPerMM(p[0], p[1], H * 0.6);
  // the season (the view's weather): deciduous trees leaf out, colour and stand bare; snow lies on crowns
  const leaf = kind === "conifer" ? null : view.weather?.leaf ?? null, snow = view.weather?.snow || 0;
  const own = ((Math.abs(Math.round(p[0] * 7 + p[1] * 13)) % 97) / 97);
  const bare = !!leaf && leaf.share < 0.12 + 0.2 * own;
  const green = color || (kind === "conifer" ? PALETTE.conifer : PALETTE.leaves);
  const crown = view.dim(leaf && !color ? rgba(leafTone(parseColor(green), leaf, own)) : green);
  const white = snow > 0.05 ? view.dim(`rgba(244,247,250,${(0.9 * snow).toFixed(2)})`) : null;
  // shadow on the ground
  const sh = view.m(heightM * 0.22);
  const shadow = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    shadow.push([p[0] + sh * Math.cos(a) + view.m(heightM * 0.12), p[1] + sh * 0.7 * Math.sin(a) - view.m(heightM * 0.1)]);
  }
  view.polygon(shadow, { fill: `rgba(20,30,15,${bare ? 0.1 : 0.25})`, order: 6, snow: 0 });
  // trunk and crown lie between base and top, at most a crown radius (the widest part) to the side
  const reach = Math.max(2 * view.px, scale * view.m(heightM * 0.3)) + view.px;
  if (view.boxOffImage(Math.min(base[0], top[0]) - reach, Math.min(base[1], top[1]) - reach, Math.max(base[0], top[0]) + reach, Math.max(base[1], top[1]) + reach)) return;
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    const trunkTop = kind === "conifer" ? 0.25 : 0.45;
    const tx = base[0] + (top[0] - base[0]) * trunkTop, ty = base[1] + (top[1] - base[1]) * trunkTop;
    ctx.strokeStyle = view.dim(PALETTE.trunk);
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
      if (white) {
        // snow on the upper branches
        const mid = [(top[0] + cb[0]) / 2, (top[1] + cb[1]) / 2];
        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        ctx.lineTo(mid[0] + w * 0.5, mid[1]);
        ctx.lineTo(mid[0] - w * 0.5, mid[1]);
        ctx.closePath();
        ctx.fillStyle = white;
        ctx.fill();
      }
    } else if (bare) {
      // bare branches: the trunk goes on, boughs fan out
      const r = Math.max(2 * view.px, scale * view.m(heightM * 0.3));
      const cx = base[0] + (top[0] - base[0]) * 0.68, cy = base[1] + (top[1] - base[1]) * 0.68;
      ctx.lineWidth = Math.max(0.8 * view.px, scale * view.m(heightM * 0.02));
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.42, l = r * (0.75 + 0.25 * ((k * 37 + Math.round(own * 97)) % 5) / 4);
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(cx + Math.cos(a) * l * 0.4, cy + r * 0.2, cx + Math.cos(a) * l, cy + Math.sin(a) * l * 0.9 + r * 0.1);
      }
      ctx.stroke();
      if (white) {
        ctx.strokeStyle = white;
        ctx.lineWidth *= 0.8;
        ctx.stroke();
      }
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
      if (white) {
        // snow on the top of the crown
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.35, r * 0.8, r * 0.5, 0, 0, 2 * Math.PI);
        ctx.fillStyle = white;
        ctx.fill();
      }
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

  /** It stands on its trunk: its crown may reach over the edge of a table module. */
  standsOn() {
    const g = this.geometry;
    return g ? [g.center] : null;
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
