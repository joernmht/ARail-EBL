/**
 * Layout files: loading, defaults and validation.
 *
 * A layout file (JSON) describes one physical model railway layout: its scale, the
 * markers on it, the virtual objects placed on it, service settings, simulations and
 * scenarios. The format is documented in docs/layout-format.md.
 * @module arail/core/layout
 */

import { markersUsed } from "./anchors.js";
import { DEFAULT_CLOCK } from "./clock.js";

export const LAYOUT_FORMAT = "arail-layout/1";

export const DEFAULT_SERVICES = {
  /** Average time between two trains at a platform track (simulated seconds). */
  rail_headway_s: 70,
  rail_dwell_s: 24,
  /** Average time between two buses at a bus bay (simulated seconds). */
  bus_headway_s: 90,
  bus_dwell_s: 20,
  /** Duration of the arrival and departure animations (simulated seconds). */
  approach_s: 6,
};

/** Grid of the flyover and the editor: spacing (mm) and whether placed and dragged things snap to it. */
export const DEFAULT_GRID = { size_mm: 50, snap: true };

/** Largest grid spacing (mm). */
const GRID_MAX_MM = 10000;

const validGridSize = (v) => {
  const size = Number(v);
  return size > 0 && size <= GRID_MAX_MM;
};

/** Grid settings with defaults; invalid values are replaced by the defaults. */
export function normalizeGrid(grid) {
  const g = isObject(grid) ? grid : {};
  return { ...g, size_mm: validGridSize(g.size_mm) ? Number(g.size_mm) : DEFAULT_GRID.size_mm, snap: typeof g.snap === "boolean" ? g.snap : DEFAULT_GRID.snap };
}

/**
 * The orthophoto of the table (`view.ortho`), or null if there is none or it is malformed:
 * `{image: "<url relative to the layout>", bounds_mm: [xmin, ymin, xmax, ymax]}`. Image row 0 is at
 * ymax, column 0 at xmin.
 */
export function orthoOf(layout) {
  const o = layout?.view?.ortho;
  if (!isObject(o) || typeof o.image !== "string" || !o.image) return null;
  const b = Array.isArray(o.bounds_mm) ? o.bounds_mm.map(Number) : [];
  if (b.length !== 4 || !b.every(Number.isFinite) || !(b[2] > b[0]) || !(b[3] > b[1])) return null;
  return { ...o, bounds_mm: b };
}

/**
 * Fill in defaults and normalise a layout object (does not modify the input).
 * @param {object} json
 */
export function normalizeLayout(json = {}) {
  const j = isObject(json) ? structuredClone(json) : {};
  const markers = isObject(j.markers) ? j.markers : {};
  // entries that cannot be used are left out (validateLayout reports them)
  const list = (v, ok = isObject) => (Array.isArray(v) ? v.filter(ok) : null);
  const typed = (o) => isObject(o) && typeof o.type === "string";
  const poses = Object.fromEntries(Object.entries(isObject(markers.poses) ? markers.poses : {}).filter(([id, p]) => validPose(id, p)));
  return {
    format: LAYOUT_FORMAT,
    name: j.name || "Untitled layout",
    description: j.description || "",
    scale: Number(j.scale) > 0 ? Number(j.scale) : 87,
    markers: {
      dictionary: markers.dictionary ?? "ARUCO",
      size_mm: Number(markers.size_mm) > 0 ? Number(markers.size_mm) : 30,
      codes: Number(markers.codes) > 0 ? Number(markers.codes) : 50,
      origin: markers.origin ?? null,
      sizes_mm: isObject(markers.sizes_mm) ? markers.sizes_mm : {},
      // complete map (after "Keep positions" or arail-survey): live tracking surveys nothing
      locked: markers.locked === true,
      // markers on vehicles (e.g. container wagons): never part of the map
      moving: markerIds(markers.moving),
      poses,
    },
    services: { ...DEFAULT_SERVICES, ...(isObject(j.services) ? j.services : {}) },
    clock: { ...DEFAULT_CLOCK, ...(isObject(j.clock) ? j.clock : {}) },
    grid: normalizeGrid(j.grid),
    simulations: list(j.simulations, typed) ?? [{ type: "passengers" }],
    objects: list(j.objects, typed) ?? [],
    scenarios: list(j.scenarios) ?? [],
    plugins: list(j.plugins, (u) => typeof u === "string") ?? [],
    ...(isObject(j.view) ? { view: j.view } : {}),
  };
}

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A marker ID: a non-negative integer, or a string of digits. */
function isMarkerId(v) {
  return (typeof v === "number" && Number.isInteger(v) && v >= 0) || (typeof v === "string" && /^\s*\d+\s*$/.test(v));
}

/** Marker IDs of a list, as numbers, sorted and unique; anything else is left out. */
export function markerIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(isMarkerId).map(Number))].sort((a, b) => a - b);
}

function validPose(id, p) {
  return /^\d+$/.test(id) && Array.isArray(p) && p.length >= 2 && p.slice(0, 3).every((v) => Number.isFinite(Number(v)));
}

/** True if `json` looks like a layout file (and not, say, a camera calibration). */
export function isLayout(json) {
  if (!isObject(json)) return false;
  if (json.format != null) return json.format === LAYOUT_FORMAT;
  return Array.isArray(json.objects) || isObject(json.markers);
}

/**
 * Check a layout for problems.
 * @param {object} json
 * @param {import("./registry.js").Registry} [registry] to check object types
 * @returns {string[]} human-readable problems (empty if none)
 */
export function validateLayout(json, registry) {
  const problems = [];
  if (!isObject(json)) return ["Layout must be a JSON object"];
  if (json.format && json.format !== LAYOUT_FORMAT) problems.push(`Unknown format "${json.format}" (expected ${LAYOUT_FORMAT})`);
  if (json.scale != null && !(Number(json.scale) > 0)) problems.push("scale must be a positive number (87 for H0)");
  const poses = isObject(json.markers?.poses) ? json.markers.poses : {};
  for (const [id, p] of Object.entries(poses)) {
    if (!/^\d+$/.test(id)) problems.push(`markers.poses: "${id}" is not a marker ID`);
    else if (!validPose(id, p)) problems.push(`markers.poses.${id} must be [x_mm, y_mm, rotation_deg]`);
  }
  const markers = isObject(json.markers) ? json.markers : {};
  if (markers.locked != null && typeof markers.locked !== "boolean") problems.push("markers.locked must be true or false");
  const moving = new Set();
  if (markers.moving != null) {
    const ok = Array.isArray(markers.moving) && markers.moving.every(isMarkerId);
    if (!ok) problems.push("markers.moving must be a list of marker IDs, e.g. [40, 41]");
    else for (const id of markerIds(markers.moving)) moving.add(id);
  }
  const codes = Number(markers.codes) > 0 ? Number(markers.codes) : 50;
  for (const id of moving) {
    if (poses[id] != null) problems.push(`markers.poses.${id}: marker ${id} is a moving marker; its pose is ignored`);
    if (id >= codes) problems.push(`markers.moving: marker ${id} is not detected, the layout uses the IDs 0 … ${codes - 1} (markers.codes)`);
  }
  if (markers.origin != null && moving.has(Number(markers.origin))) problems.push(`markers.origin: marker ${markers.origin} is a moving marker; it cannot define the layout frame`);
  if (markers.locked === true && !Object.keys(poses).some((id) => !moving.has(Number(id)))) problems.push("markers.locked: the locked marker map has no poses, so no marker is used for tracking");
  const ids = new Set();
  if (json.objects != null && !Array.isArray(json.objects)) problems.push("objects must be a list");
  (Array.isArray(json.objects) ? json.objects : []).forEach((o, i) => {
    const where = `objects[${i}]`;
    if (!isObject(o)) return problems.push(`${where} is not an object`);
    if (!o.id) problems.push(`${where} has no id`);
    else if (ids.has(o.id)) problems.push(`${where}: duplicate id "${o.id}"`);
    ids.add(o.id);
    if (!o.type) problems.push(`${where} has no type`);
    else if (registry && !registry.objects.has(o.type)) problems.push(`${where}: unknown type "${o.type}" (missing plugin?)`);
    const onMoving = markersUsed(o).filter((m) => moving.has(m));
    if (onMoving.length) problems.push(`${where} (${o.name || o.id}): placed relative to moving marker ${onMoving.join(", ")}, so it cannot be placed`);
  });
  if (json.grid != null) {
    if (!isObject(json.grid)) problems.push('grid must be an object like {"size_mm": 50, "snap": true}');
    else if (json.grid.size_mm != null && !validGridSize(json.grid.size_mm)) problems.push(`grid.size_mm must be a number above 0 and at most ${GRID_MAX_MM} (mm)`);
  }
  if (isObject(json.view) && json.view.ortho != null && !orthoOf(json)) {
    problems.push('view.ortho must be {"image": "<url>", "bounds_mm": [xmin, ymin, xmax, ymax]} with xmin < xmax and ymin < ymax');
  }
  (Array.isArray(json.scenarios) ? json.scenarios : []).forEach((s, i) => {
    if (!isObject(s)) return problems.push(`scenarios[${i}] is not an object`);
    if (!s.id) problems.push(`scenarios[${i}] has no id`);
    if (!Array.isArray(s.steps)) problems.push(`scenarios[${i}].steps must be a list`);
  });
  return problems;
}
