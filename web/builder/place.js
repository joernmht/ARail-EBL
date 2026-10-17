// Placing in the builder, so that streets and what needs them fit together: street points snap to
// the ends and corners of streets and onto their centre lines (they join the network there), a new
// bus stop goes on the side of the street it was put on, a building turns its front (and its
// entrance) to the nearest street, a bus terminal lines up with it. No DOM here: tested in Node.
import { polylineAt, polylineLengths, polylineProject, snapToGrid } from "../arail/index.js";

const round1 = (v) => Math.round(v * 10) / 10;
const xy = (p) => [round1(p[0]), round1(p[1])];

/** The streets (and footpaths) of the world with their points: [{obj, info, pts}]. */
export function streetLines(world, { exclude = null } = {}) {
  const out = [];
  for (const o of world.objects) {
    if (o.id === exclude || typeof o.roadInfo !== "function" || !o.geometry) continue;
    const info = o.roadInfo();
    if (info?.points?.length >= 2) out.push({ obj: o, info, pts: info.points });
  }
  return out;
}

/**
 * Where a point of a street goes: onto an end or a corner of a street nearby (`tolMM`), onto the
 * centre line of a street it is on, else onto the grid. `own` are the points of the street being
 * drawn (it may close a loop).
 * @param {import("../arail/core/world.js").World} world
 * @param {number[]} p layout mm
 * @param {{tolMM: number, grid?: number | null, own?: number[][], exclude?: string | null, angleFrom?: number[] | null}} options
 *   grid: its size (mm) to snap to, null: no grid; exclude: a street not to snap to (the one whose
 *   point is moved); angleFrom: the point before (Shift: the direction in steps of 15°)
 *   A point level with the last of `own` (or right above or below it) stays so.
 * @returns {{point: number[], snap: "end" | "corner" | "street" | "align" | "grid" | "angle" | null, road: string | null}}
 */
export function snapStreetPoint(world, p, { tolMM, grid = null, own = [], exclude = null, angleFrom = null }) {
  const lines = streetLines(world, { exclude });
  let best = null;
  const near = (q, snap, road) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d <= tolMM && (!best || d < best.d)) best = { d, point: xy(q), snap, road };
  };
  for (const l of lines) l.pts.forEach((q, i) => near(q, i === 0 || i === l.pts.length - 1 ? "end" : "corner", l.obj.id));
  for (const q of own) near(q, "corner", null);
  if (best) return { point: best.point, snap: best.snap, road: best.road };
  for (const l of lines) {
    const pr = polylineProject(l.pts, p);
    if (pr.distance <= Math.max(l.info.width / 2, tolMM)) return { point: xy(polylineAt(l.pts, pr.s).point), snap: "street", road: l.obj.id };
  }
  if (angleFrom) {
    const a = Math.atan2(p[1] - angleFrom[1], p[0] - angleFrom[0]), step = Math.PI / 12;
    const k = Math.round(a / step) * step, d = Math.hypot(p[0] - angleFrom[0], p[1] - angleFrom[1]);
    return { point: xy([angleFrom[0] + d * Math.cos(k), angleFrom[1] + d * Math.sin(k)]), snap: "angle", road: null };
  }
  // straight on from the point before: level with it, or right above or below it
  const last = own[own.length - 1];
  const q = grid > 0 ? snapToGrid(p, grid) : p;
  if (last) {
    const alignX = Math.abs(p[0] - last[0]) <= tolMM, alignY = Math.abs(p[1] - last[1]) <= tolMM;
    if (alignX || alignY) return { point: xy([alignX ? last[0] : q[0], alignY ? last[1] : q[1]]), snap: "align", road: null };
  }
  if (grid > 0) return { point: xy(q), snap: "grid", road: null };
  return { point: xy(p), snap: null, road: null };
}

/** The nearest street for cars (or any street) to p: {obj, point, dir (unit, drawing direction), side (+1 left, −1 right), distance}. */
export function nearestStreetAt(world, p, { car = true } = {}) {
  let best = null;
  for (const l of streetLines(world)) {
    if (car && !l.info.car) continue;
    const cum = polylineLengths(l.pts), pr = polylineProject(l.pts, p, cum);
    if (!best || pr.distance < best.distance) {
      const at = polylineAt(l.pts, pr.s, cum);
      best = { obj: l.obj, point: at.point, dir: at.dir || [1, 0], side: pr.side, distance: pr.distance };
    }
  }
  return best;
}

/** Does an object of this class have a front with an entrance (a building)? */
export function facesStreet(cls) {
  return typeof cls?.prototype?.entrances === "function" && !!cls.params?.some((q) => q.key === "rotation_deg");
}

/**
 * The spec of a new object of a class from the points placed (layout mm), fitted to the streets:
 * - point: `position`; a bus stop on the side of its street the point is on; a building with its
 *   front to the nearest street (within `reachMM`); a bus terminal along the nearest street;
 * - segment: `from`, `to`; rect: centre, `width_mm`, `depth_mm` (null if smaller than 5 mm);
 * - polyline (≥ 2 points), polygon (≥ 3): `points`; stops: `stops` (ids, ≥ 2).
 * Returns null while there are not enough points.
 * @param {import("../arail/core/world.js").World} world
 * @param {typeof import("../arail/core/object.js").LayoutObject} cls
 * @param {Array<number[] | string>} points layout points, for "stops" the ids of the stops
 * @param {{reachMM?: number}} [options]
 */
export function placeSpec(world, cls, points, { reachMM = Infinity } = {}) {
  const spec = { type: cls.type };
  switch (cls.placement) {
    case "point": {
      if (!points.length) return null;
      const p = xy(points[0]);
      spec.position = p;
      // buses need a street for cars; a building's entrance any street or footpath
      const street = nearestStreetAt(world, p, { car: cls.type === "bus-stop" || cls.type === "bus-terminal" });
      if (cls.type === "bus-stop" && street) spec.side = street.side > 0 ? "left" : "right";
      else if (facesStreet(cls) && street && street.distance <= reachMM && street.distance > 1e-6) {
        // the front faces −y at 0°: turn it towards the street
        const dx = street.point[0] - p[0], dy = street.point[1] - p[1];
        spec.rotation_deg = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) * 2) / 2;
      } else if (cls.type === "bus-terminal" && street && street.distance <= reachMM) {
        spec.rotation_deg = Math.round(((Math.atan2(street.dir[1], street.dir[0]) * 180) / Math.PI) * 2) / 2;
      } else if (cls.params?.some((q) => q.key === "rotation_deg")) spec.rotation_deg = 0;
      return spec;
    }
    case "segment":
      if (points.length < 2) return null;
      return { ...spec, from: xy(points[0]), to: xy(points[1]) };
    case "rect": {
      if (points.length < 2) return null;
      const [a, b] = points;
      const w = round1(Math.abs(b[0] - a[0])), d = round1(Math.abs(b[1] - a[1]));
      if (w < 5 || d < 5) return null;
      return { ...spec, position: xy([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), width_mm: w, depth_mm: d, rotation_deg: 0 };
    }
    case "stops":
      return points.length >= 2 ? { ...spec, stops: points.slice() } : null;
    case "polygon":
      return points.length >= 3 ? { ...spec, points: points.map(xy) } : null;
    default:
      return points.length >= 2 ? { ...spec, points: points.map(xy) } : null;
  }
}

/** How many points a placement takes: [at least, at most] (Infinity: until finished). */
export function pointsOf(cls) {
  return { point: [1, 1], segment: [2, 2], rect: [2, 2], polygon: [3, Infinity], stops: [2, Infinity] }[cls.placement] || [2, Infinity];
}
