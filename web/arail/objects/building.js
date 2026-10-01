/**
 * Building: a generic house or other building, a box with windows and a flat or gable roof.
 * Greyscale by default (white-model look); the colour parameters are kept for existing layouts.
 * For typical German house types see objects/houses.js.
 * @module arail/objects/building
 */
import { grey } from "../core/colors.js";
import { clamp } from "../core/math.js";
import { BuildingBase, TONES, USE_OPTIONS, capacityFor, gableRoof } from "./building-kit.js";

export class Building extends BuildingBase {
  static type = "building";
  static label = "Building";
  static placement = "point";
  static description = "Generic house or other building. Sizes are in prototype metres.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 3, max: 120, step: 0.5, default: 12 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 3, max: 80, step: 0.5, default: 9 },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 30, step: 1, default: 2 },
    { key: "floor_height_m", label: "Floor height", type: "number", unit: "m", min: 2.4, max: 6, step: 0.1, default: 3 },
    { key: "roof", label: "Roof", type: "select", options: [["gable", "gable"], ["flat", "flat"]], default: "gable" },
    { key: "use", label: "Use", type: "select", options: USE_OPTIONS, default: "residential" },
    { key: "color", label: "Wall colour", type: "color", default: "#f2f2f2" },
    { key: "roof_color", label: "Roof colour", type: "color", default: "#a6a6a6" },
    { key: "windows", label: "Windows", type: "boolean", default: true },
  ];

  floorsCount() {
    return clamp(Math.round(+this.spec.floors || 1), 1, 30);
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const s = this.spec;
    // sizes within the ranges of the parameters (a mistyped 1e6 m would hang the app)
    const w = clamp(+s.width_m || 12, 3, 120), d = clamp(+s.depth_m || 9, 3, 80);
    const fh = clamp(+s.floor_height_m || 3, 2.4, 6), floors = this.floorsCount(), H = fh * floors;
    const wall = s.color || "#f2f2f2", roof = s.roof_color || "#a6a6a6";
    const flat = s.roof === "flat";
    m.setAnchor(0, 0, H / 2, Math.hypot(w, d) / 2 + 1);
    const body = m.box(-w / 2, -d / 2, w / 2, d / 2, 0, H, { wall, top: flat ? grey(TONES.flatRoof) : null });
    if (s.windows !== false) {
      for (const f of body.walls) {
        const len = f.length, n = Math.floor(len / 3.2);
        for (let fl = 0; fl < floors; fl++) {
          const z0 = fl * fh + 0.9, z1 = fl * fh + Math.min(fh - 0.4, 2.2);
          for (let i = 0; i < n; i++) {
            const c = (len * (i + 0.5)) / n;
            m.window(f, c - 0.65, c + 0.65, z0, z1);
          }
        }
      }
    }
    const faces = body.faces;
    let height = H;
    if (!flat) {
      const r = gableRoof(m, { x0: -w / 2, y0: -d / 2, x1: w / 2, y1: d / 2, z: H, pitch: 35, overhang: 0.35, ridge: w >= d ? "x" : "y", roof, wall });
      faces.push(...r.faces);
      height = r.ridgeZ;
    }
    m.part(faces);
    m.shadow(m.rect(-w / 2, -d / 2, w / 2, d / 2), height);
    m.entrance(0, -d / 2);
    return m.finish({
      footprint: m.rect(-w / 2, -d / 2, w / 2, d / 2),
      height,
      capacity: capacityFor(this.use(), w * d * floors),
      detail: { window: 1.3 },
    });
  }
}
