/**
 * Layout files: loading, defaults and validation.
 *
 * A layout file (JSON) describes one physical model railway layout: its scale, the
 * markers on it, the virtual objects placed on it, service settings, simulations and
 * scenarios. The format is documented in docs/layout-format.md.
 * @module arail/core/layout
 */

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
      poses,
    },
    services: { ...DEFAULT_SERVICES, ...(isObject(j.services) ? j.services : {}) },
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
  });
  (Array.isArray(json.scenarios) ? json.scenarios : []).forEach((s, i) => {
    if (!isObject(s)) return problems.push(`scenarios[${i}] is not an object`);
    if (!s.id) problems.push(`scenarios[${i}] has no id`);
    if (!Array.isArray(s.steps)) problems.push(`scenarios[${i}].steps must be a list`);
  });
  return problems;
}
