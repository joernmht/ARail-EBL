/**
 * Position specs used in layout files.
 *
 * A *point* is either
 * - `[x, y]`: layout coordinates in mm, or
 * - `{ "marker": 4, "offset": [dx, dy] }`: relative to a marker, offset in the marker's own
 *   frame (x to the right, y up as printed), in mm. Such objects move with their marker.
 * A *segment* (platforms) is `{ "between": [idA, idB] }` (marker centres) or
 * `{ "from": point, "to": point }`.
 * @module arail/core/anchors
 */
import { poseApply, poseInverseApply, rotate2 } from "./math.js";

/**
 * Resolve a point spec to layout coordinates.
 * @param {import("./tracker.js").MarkerMap} map
 * @returns {number[] | null} null if the referenced marker is not (yet) known
 */
export function resolvePoint(map, p) {
  if (Array.isArray(p)) return p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [+p[0], +p[1]] : null;
  if (p && typeof p === "object" && p.marker != null) {
    const e = map.get(Number(p.marker));
    return e ? poseApply(e, p.offset || [0, 0]) : null;
  }
  return null;
}

/** Resolve a list of point specs; null if any of them cannot be resolved. */
export function resolvePoints(map, pts) {
  if (!Array.isArray(pts)) return null;
  const out = [];
  for (const p of pts) {
    const q = resolvePoint(map, p);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

/** Resolve a segment spec to its two end points, or null. */
export function resolveSegment(map, spec) {
  if (Array.isArray(spec.between) && spec.between.length === 2) {
    const a = map.get(Number(spec.between[0])), b = map.get(Number(spec.between[1]));
    return a && b ? [[a.x, a.y], [b.x, b.y]] : null;
  }
  const a = resolvePoint(map, spec.from), b = resolvePoint(map, spec.to);
  return a && b ? [a, b] : null;
}

/** Move a point spec by (dx, dy) layout mm; marker-relative points keep their marker. */
export function translatePoint(map, p, dx, dy) {
  if (Array.isArray(p)) return [round1(+p[0] + dx), round1(+p[1] + dy)];
  if (p && typeof p === "object" && p.marker != null) {
    const e = map.get(Number(p.marker));
    if (!e) return p;
    const d = rotate2([dx, dy], -e.theta);
    const off = p.offset || [0, 0];
    return { ...p, offset: [round1(off[0] + d[0]), round1(off[1] + d[1])] };
  }
  return p;
}

/** Express a layout point relative to a marker (for objects that should follow it). */
export function pointRelativeTo(map, markerId, xy) {
  const e = map.get(markerId);
  if (!e) return null;
  const off = poseInverseApply(e, xy);
  return { marker: markerId, offset: [round1(off[0]), round1(off[1])] };
}

export const round1 = (v) => Math.round(v * 10) / 10;
