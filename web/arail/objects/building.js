/**
 * Building: a house with windows and a flat or gable roof.
 * @module arail/objects/building
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { toRad } from "../core/math.js";
import { PALETTE } from "../core/colors.js";
import { prismFaces, rectFootprint } from "../core/view.js";

export class Building extends LayoutObject {
  static type = "building";
  static label = "Building";
  static category = "Scenery";
  static placement = "point";
  static description = "House or other building. Sizes are in prototype metres.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 3, max: 120, step: 0.5, default: 12 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 3, max: 80, step: 0.5, default: 9 },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 30, step: 1, default: 2 },
    { key: "floor_height_m", label: "Floor height", type: "number", unit: "m", min: 2.4, max: 6, step: 0.1, default: 3 },
    { key: "roof", label: "Roof", type: "select", options: [["gable", "gable"], ["flat", "flat"]], default: "gable" },
    { key: "color", label: "Wall colour", type: "color", default: "#e2d3b8" },
    { key: "roof_color", label: "Roof colour", type: "color", default: "#9b4a3c" },
    { key: "windows", label: "Windows", type: "boolean", default: true },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const angle = toRad(+this.spec.rotation_deg || 0);
    const w = this.mm(+this.spec.width_m || 12), d = this.mm(+this.spec.depth_m || 9);
    return { center: c, angle, w, d, footprint: rectFootprint(c, w, d, angle) };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  anchorPoint() {
    return this.geometry?.center || null;
  }

  draw(view) {
    const g = this.geometry;
    const s = this.spec;
    const fh = view.m(+s.floor_height_m || 3), floors = Math.max(1, Math.round(+s.floors || 1));
    const H = fh * floors;
    const wall = s.color || PALETTE.wall, roofColor = s.roof_color || PALETTE.roof;
    const faces = prismFaces(g.footprint, 0, H, { side: wall, top: s.roof === "flat" ? "#8d8d8d" : null });
    if (s.windows !== false) {
      for (const f of faces) {
        if (f.normal[2] !== 0) continue;
        f.decals = windows(f.pts[0], f.pts[1], floors, fh, view);
      }
    }
    if (s.roof !== "flat") faces.push(...gableRoof(g, H, roofColor, wall, view));
    view.faces(faces, [g.center[0], g.center[1], H / 2], { outline: "rgba(40,30,20,0.35)" });
  }
}

/** Window decals for one wall (from a to b at the ground), per floor. */
function windows(a, b, floors, fh, view) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const spacing = view.m(3.2), ww = view.m(1.3);
  const n = Math.floor(len / spacing);
  if (n < 1) return [];
  const out = [];
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const eps = view.m(0.02); // tiny offset so windows sit on the wall
  const nx = uy * eps, ny = -ux * eps;
  for (let f = 0; f < floors; f++) {
    const z0 = f * fh + view.m(0.9), z1 = f * fh + Math.min(fh - view.m(0.4), view.m(2.2));
    for (let i = 0; i < n; i++) {
      const c = (len * (i + 0.5)) / n;
      const p0 = [a[0] + ux * (c - ww / 2) + nx, a[1] + uy * (c - ww / 2) + ny], p1 = [a[0] + ux * (c + ww / 2) + nx, a[1] + uy * (c + ww / 2) + ny];
      out.push({ pts: [[p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1]], color: "#2c3e50" });
    }
  }
  return out;
}

/** Gable roof faces: ridge along the longer side, about 35 degrees pitch, small overhang. */
function gableRoof(g, H, roofColor, wallColor, view) {
  const along = g.w >= g.d;
  const half = (along ? g.d : g.w) / 2;
  const rise = half * 0.7;
  const o = view.m(0.35);
  const cs = Math.cos(g.angle), sn = Math.sin(g.angle);
  const T = (x, y, z) => [g.center[0] + cs * x - sn * y, g.center[1] + sn * x + cs * y, z];
  const R = (x, y, z) => [cs * x - sn * y, sn * x + cs * y, z];
  const [A, B] = along ? [g.w / 2, g.d / 2] : [g.d / 2, g.w / 2]; // A: along the ridge, B: across
  // local frame: X along the ridge, Y across; for !along rotate by 90 degrees
  const L = (x, y, z) => (along ? T(x, y, z) : T(-y, x, z));
  const LN = (x, y, z) => (along ? R(x, y, z) : R(-y, x, z));
  const nl = Math.hypot(rise, B + o);
  return [
    { pts: [L(-A - o, -B - o, H - o * 0.7), L(A + o, -B - o, H - o * 0.7), L(A + o, 0, H + rise), L(-A - o, 0, H + rise)], normal: LN(0, -rise / nl, (B + o) / nl), color: roofColor },
    { pts: [L(A + o, B + o, H - o * 0.7), L(-A - o, B + o, H - o * 0.7), L(-A - o, 0, H + rise), L(A + o, 0, H + rise)], normal: LN(0, rise / nl, (B + o) / nl), color: roofColor },
    { pts: [L(A, -B, H), L(A, B, H), L(A, 0, H + rise)], normal: LN(1, 0, 0), color: wallColor },
    { pts: [L(-A, B, H), L(-A, -B, H), L(-A, 0, H + rise)], normal: LN(-1, 0, 0), color: wallColor },
  ];
}
