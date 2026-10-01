/**
 * Built-in vehicle renderers: trains and buses, drawn as simple shaded boxes.
 * Register your own with `registry.registerVehicle({kind, ...})` (e.g. trams).
 * All sizes are prototype metres.
 * @module arail/core/vehicles
 */
import { OVERLAY, PALETTE, rgba, shade } from "./colors.js";

/** Box faces of a vehicle segment in stop-area coordinates (metres), converted to layout mm. */
function vehicleFaces(area, view, { s0, s1, t0, t1, z0, z1 }, colors, decorate) {
  const P = (s, t, z) => {
    const [x, y] = area.toLayout(s, t);
    return [x, y, view.m(z)];
  };
  const tl = Math.min(t0, t1), tr = Math.max(t0, t1);
  const u = area.dir, n = area.normal;
  const faces = [
    { pts: [P(s0, tl, z1), P(s1, tl, z1), P(s1, tr, z1), P(s0, tr, z1)], normal: [0, 0, 1], color: colors.roof, alpha: colors.alpha },
    { pts: [P(s0, tr, z0), P(s1, tr, z0), P(s1, tr, z1), P(s0, tr, z1)], normal: [n[0], n[1], 0], color: colors.body, alpha: colors.alpha, side: "left" },
    { pts: [P(s1, tl, z0), P(s0, tl, z0), P(s0, tl, z1), P(s1, tl, z1)], normal: [-n[0], -n[1], 0], color: colors.body, alpha: colors.alpha, side: "right" },
    { pts: [P(s1, tr, z0), P(s1, tl, z0), P(s1, tl, z1), P(s1, tr, z1)], normal: [u[0], u[1], 0], color: colors.end, alpha: colors.alpha, side: "front" },
    { pts: [P(s0, tl, z0), P(s0, tr, z0), P(s0, tr, z1), P(s0, tl, z1)], normal: [-u[0], -u[1], 0], color: colors.end, alpha: colors.alpha, side: "back" },
  ];
  if (decorate) for (const f of faces) f.decals = decorate(f, P, tl, tr);
  return faces;
}

export const TRAIN = {
  kind: "train",
  label: "Train",
  width_m: 2.9,
  height_m: 3.9,
  floor_m: 0.4,
  gap_m: 0.3,
  overhang_m: 0,
  carLength_m: 26,
  /** Stopped extent along the dock (m): the whole platform track. */
  extent: (dock) => [dock.s0, dock.s1],
  doors(dock) {
    const len = dock.s1 - dock.s0;
    const n = Math.max(2, Math.round(len / 7));
    return Array.from({ length: n }, (_, i) => dock.s0 + len * (0.1 + (0.8 * i) / (n - 1)));
  },
  draw(view, v, place) {
    const area = v.dock.area;
    const alpha = view.virtual ? 0.92 : 0.62; // see-through over the camera image, nearly solid in the flyover
    const colors = { body: PALETTE.train, roof: shade(PALETTE.train, 0.78), end: shade(PALETTE.train, 0.9), alpha };
    const z0 = this.floor_m, z1 = this.height_m;
    const doors = v.doorsOpen ? this.doors(v.dock) : [];
    const inner = v.dock.side > 0 ? "right" : "left"; // wall facing the platform
    const lit = view.darkness > 0.35; // lights on inside
    const cars = Math.max(1, Math.round((place.s1 - place.s0) / this.carLength_m));
    const len = (place.s1 - place.s0) / cars;
    for (let c = 0; c < cars; c++) {
      const s0 = place.s0 + c * len + (c ? 0.35 : 0), s1 = place.s0 + (c + 1) * len - (c < cars - 1 ? 0.35 : 0);
      const faces = vehicleFaces(area, view, { s0, s1, t0: place.t0, t1: place.t1, z0, z1 }, colors, (f, P, tl, tr) => {
        if (f.side !== "left" && f.side !== "right") return [];
        const t = f.side === "left" ? tr : tl;
        const out = [{ pts: [P(s0 + 0.8, t, 2.2), P(s1 - 0.8, t, 2.2), P(s1 - 0.8, t, 3.1), P(s0 + 0.8, t, 3.1)], color: lit ? PALETTE.litWindow : PALETTE.trainWindow, alpha, emissive: lit }];
        if (f.side === inner) {
          for (const d of doors) {
            if (d - 0.7 < s0 || d + 0.7 > s1) continue;
            out.push({ pts: [P(d - 0.7, t, z0), P(d + 0.7, t, z0), P(d + 0.7, t, 3.2), P(d - 0.7, t, 3.2)], color: PALETTE.trainDoor, alpha: Math.min(1, alpha + 0.25) });
          }
        }
        return out;
      });
      const mid = area.toLayout((s0 + s1) / 2, (place.t0 + place.t1) / 2);
      view.faces(faces, [mid[0], mid[1], view.m(2)]);
    }
    if (v.phase === "dwelling" && v.line) {
      const top = area.toLayout(place.s1 - 2, (place.t0 + place.t1) / 2);
      view.label([top[0], top[1], view.m(5)], v.line, { size: 11, background: rgba(OVERLAY.sign, 0.92) });
    }
  },
};

export const BUS = {
  kind: "bus",
  label: "Bus",
  width_m: 2.55,
  height_m: 3.2,
  floor_m: 0.3,
  gap_m: 0.4,
  overhang_m: 30,
  length_m: 12,
  /** A bus stands at the end of its bay (m). */
  extent: (dock) => [Math.max(dock.s0, dock.s1 - 1.5 - 12), dock.s1 - 1.5],
  doors(dock) {
    const [, front] = this.extent(dock);
    return [front - 1.6, front - 6.4];
  },
  draw(view, v, place) {
    const area = v.dock.area;
    const alpha = 0.9;
    const colors = { body: PALETTE.bus, roof: shade(PALETTE.bus, 1.45), end: shade(PALETTE.bus, 0.88), alpha };
    const z0 = this.floor_m, z1 = this.height_m;
    const doors = v.doorsOpen ? this.doors(v.dock) : [];
    const inner = v.dock.side > 0 ? "right" : "left";
    const lit = view.darkness > 0.35;
    const { s0, s1 } = place;
    const faces = vehicleFaces(area, view, { s0, s1, t0: place.t0, t1: place.t1, z0, z1 }, colors, (f, P, tl, tr) => {
      const out = [];
      if (f.side === "left" || f.side === "right") {
        const t = f.side === "left" ? tr : tl;
        out.push({ pts: [P(s0 + 0.6, t, 1.3), P(s1 - 0.4, t, 1.3), P(s1 - 0.4, t, 2.7), P(s0 + 0.6, t, 2.7)], color: lit ? PALETTE.litWindow : PALETTE.busWindow, alpha, emissive: lit });
        if (f.side === inner) {
          for (const d of doors) {
            if (d - 0.6 < s0 || d + 0.6 > s1) continue;
            out.push({ pts: [P(d - 0.6, t, z0), P(d + 0.6, t, z0), P(d + 0.6, t, 2.8), P(d - 0.6, t, 2.8)], color: "#2a2a2a", alpha });
          }
        }
      } else if (f.side === "front") {
        out.push({ pts: [P(s1, tr - 0.2, 1.1), P(s1, tl + 0.2, 1.1), P(s1, tl + 0.2, 2.8), P(s1, tr - 0.2, 2.8)], color: PALETTE.busWindow, alpha });
      }
      return out;
    });
    const mid = area.toLayout((s0 + s1) / 2, (place.t0 + place.t1) / 2);
    view.faces(faces, [mid[0], mid[1], view.m(1.6)]);
    if (v.phase === "dwelling" && v.line) {
      const top = area.toLayout(s1 - 1, (place.t0 + place.t1) / 2);
      view.label([top[0], top[1], view.m(4.2)], v.line, { size: 11, background: OVERLAY.label });
    }
  },
};
