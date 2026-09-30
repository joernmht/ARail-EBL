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
  const j = structuredClone(json || {});
  const markers = j.markers || {};
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
      sizes_mm: markers.sizes_mm || {},
      poses: markers.poses || {},
    },
    services: { ...DEFAULT_SERVICES, ...(j.services || {}) },
    simulations: Array.isArray(j.simulations) ? j.simulations : [{ type: "passengers" }],
    objects: Array.isArray(j.objects) ? j.objects : [],
    scenarios: Array.isArray(j.scenarios) ? j.scenarios : [],
    plugins: Array.isArray(j.plugins) ? j.plugins : [],
    ...(j.view ? { view: j.view } : {}),
  };
}

/**
 * Check a layout for problems.
 * @param {object} json
 * @param {import("./registry.js").Registry} [registry] to check object types
 * @returns {string[]} human-readable problems (empty if none)
 */
export function validateLayout(json, registry) {
  const problems = [];
  if (!json || typeof json !== "object") return ["Layout must be a JSON object"];
  if (json.format && json.format !== LAYOUT_FORMAT) problems.push(`Unknown format "${json.format}" (expected ${LAYOUT_FORMAT})`);
  if (json.scale != null && !(Number(json.scale) > 0)) problems.push("scale must be a positive number (87 for H0)");
  const poses = json.markers?.poses || {};
  for (const [id, p] of Object.entries(poses)) {
    if (!/^\d+$/.test(id)) problems.push(`markers.poses: "${id}" is not a marker ID`);
    if (!Array.isArray(p) || p.length < 2 || !p.every((v) => Number.isFinite(Number(v)))) problems.push(`markers.poses.${id} must be [x_mm, y_mm, rotation_deg]`);
  }
  const ids = new Set();
  (json.objects || []).forEach((o, i) => {
    const where = `objects[${i}]`;
    if (!o || typeof o !== "object") return problems.push(`${where} is not an object`);
    if (!o.id) problems.push(`${where} has no id`);
    else if (ids.has(o.id)) problems.push(`${where}: duplicate id "${o.id}"`);
    ids.add(o.id);
    if (!o.type) problems.push(`${where} has no type`);
    else if (registry && !registry.objects.has(o.type)) problems.push(`${where}: unknown type "${o.type}" (missing plugin?)`);
  });
  (json.scenarios || []).forEach((s, i) => {
    if (!s.id) problems.push(`scenarios[${i}] has no id`);
    if (!Array.isArray(s.steps)) problems.push(`scenarios[${i}].steps must be a list`);
  });
  return problems;
}
