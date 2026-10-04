/**
 * Layers of a layout: optional parts of one layout file that can be switched on and off, e.g.
 * rail operations or the infrastructure game on top of the same lab photo, table and town.
 *
 *   { ...base layout...,
 *     "layers": [
 *       { "id": "operations", "name": "Rail operations", "enabled": false,
 *         "objects": [...], "simulations": [...], "scenarios": [...], "plugins": [...] } ] }
 *
 * The base (the top-level `objects`, `simulations`, `scenarios`, `plugins`) is always on. The
 * layers that are on are added in their order ({@link composeLayout}):
 * - an object whose id is new is added; an entry whose id is already there (from the base or an
 *   earlier layer) is a **patch**: its keys are merged into that object (e.g. `{"id": "track-g1",
 *   "built": 1994}`). A patch of an object that is not there does nothing.
 * - simulations, scenarios and plugins are added (a scenario with an id that is already there
 *   replaces it).
 *
 * {@link decomposeLayout} is the way back: the composed layout as edited (objects moved, added,
 * removed; settings of simulations) is split into the base and the layers again. An object goes
 * back to the layer it came from, the keys a layer patched go back to that layer's patch, and a
 * new object goes to the given layer (by default the base). Layers that are off stay as they were.
 * @module arail/core/layers
 */

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v, ok = isObject) => (Array.isArray(v) ? v.filter(ok) : []);
const clone = (v) => structuredClone(v);

/**
 * The layers of a layout, normalised: [{id, name, description, enabled, objects, simulations,
 * scenarios, plugins}]. Entries without an id and repeated ids are left out (see layerProblems).
 */
export function normalizeLayers(layers) {
  const seen = new Set(), out = [];
  for (const l of list(layers)) {
    const id = typeof l.id === "string" && l.id ? l.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof l.name === "string" && l.name ? l.name : id,
      description: typeof l.description === "string" ? l.description : "",
      enabled: l.enabled === true,
      objects: list(l.objects, (o) => isObject(o) && typeof o.id === "string" && !!o.id),
      simulations: list(l.simulations, (s) => isObject(s) && typeof s.type === "string"),
      scenarios: list(l.scenarios),
      plugins: list(l.plugins, (u) => typeof u === "string"),
    });
  }
  return out;
}

/** Ids of the layers that are on. */
export function layersOn(json) {
  return normalizeLayers(json?.layers).filter((l) => l.enabled).map((l) => l.id);
}

/**
 * A copy of the layout with exactly these layers on (ids that are not layers of it are ignored).
 * @param {object} json
 * @param {Iterable<string>} ids
 */
export function withLayers(json, ids) {
  const on = new Set(ids);
  const out = clone(json);
  if (Array.isArray(out.layers)) for (const l of out.layers) if (isObject(l)) l.enabled = on.has(l.id);
  return out;
}

/** All plugins of a layout, of the base and of every layer (on or off), each once. */
export function layoutPlugins(json) {
  const all = [...list(json?.plugins, (u) => typeof u === "string"), ...normalizeLayers(json?.layers).flatMap((l) => l.plugins)];
  return [...new Set(all)];
}

/**
 * The layout with the layers that are on merged into it.
 * @param {object} json layout file contents (with or without `layers`)
 * @returns {{layout: object, layers: object[], origin: {objects: Map<string, object>, simulations: (string|null)[],
 *   scenarios: (string|null)[]}, basePlugins: string[]}} `layout`: a plain layout without `layers`; `layers`: the
 *   normalised layers (all of them); `origin`: where each object, simulation and scenario of `layout` came from
 *   (layer id or null for the base), for {@link decomposeLayout}
 */
export function composeLayout(json) {
  const j = isObject(json) ? json : {};
  const layers = normalizeLayers(j.layers);
  const { layers: _, ...base } = j;
  const layout = clone(base);
  const objects = list(layout.objects);
  const origin = { objects: new Map(), simulations: [], scenarios: [] };
  const index = new Map();
  objects.forEach((o, i) => {
    if (typeof o.id === "string" && !index.has(o.id)) index.set(o.id, i);
    if (typeof o.id === "string" && !origin.objects.has(o.id)) origin.objects.set(o.id, { layer: null, base: null, patches: [] });
  });
  const simulations = list(layout.simulations, (s) => isObject(s) && typeof s.type === "string");
  origin.simulations = simulations.map(() => null);
  const scenarios = list(layout.scenarios);
  origin.scenarios = scenarios.map(() => null);
  const plugins = list(layout.plugins, (u) => typeof u === "string");
  for (const l of layers) {
    if (!l.enabled) continue;
    for (const e of l.objects) {
      const i = index.get(e.id);
      if (i == null) {
        if (typeof e.type !== "string") continue; // a patch of an object that is not there
        index.set(e.id, objects.length);
        objects.push(clone(e));
        origin.objects.set(e.id, { layer: l.id, base: null, patches: [] });
        continue;
      }
      const o = origin.objects.get(e.id);
      if (!o.base) o.base = clone(objects[i]);
      const { id, ...keys } = e;
      o.patches.push({ layer: l.id, keys: clone(keys) });
      objects[i] = { ...objects[i], ...clone(keys) };
    }
    for (const s of l.simulations) {
      simulations.push(clone(s));
      origin.simulations.push(l.id);
    }
    for (const s of l.scenarios) {
      const i = s.id != null ? scenarios.findIndex((x) => x.id === s.id) : -1;
      if (i >= 0) {
        scenarios[i] = clone(s);
        origin.scenarios[i] = l.id;
      } else {
        scenarios.push(clone(s));
        origin.scenarios.push(l.id);
      }
    }
    for (const p of l.plugins) if (!plugins.includes(p)) plugins.push(p);
  }
  layout.objects = objects;
  if (simulations.length || Array.isArray(base.simulations)) layout.simulations = simulations;
  layout.scenarios = scenarios;
  layout.plugins = plugins;
  return { layout, layers, origin, basePlugins: list(base.plugins, (u) => typeof u === "string") };
}

/**
 * Split an edited composed layout into the base and its layers again.
 * @param {object} flat the composed layout as edited (e.g. `world.toJSON()` without layers)
 * @param {{layers: object[], origin: object}} composed what {@link composeLayout} returned
 * @param {{newObjects?: string | null, simulationOrigin?: (string|null)[]}} [options]
 *   `newObjects`: the layer that gets objects without an origin (null: the base);
 *   `simulationOrigin`: the layer of each simulation of `flat` (default: `composed.origin.simulations`)
 * @returns {object} a layout with `layers` (or the layout as it is, if it has no layers)
 */
export function decomposeLayout(flat, composed, { newObjects = null, simulationOrigin = null } = {}) {
  const { layers, origin } = composed;
  if (!layers.length) {
    const { layers: _, ...plain } = flat;
    return plain;
  }
  const on = new Set(layers.filter((l) => l.enabled).map((l) => l.id));
  const target = on.has(newObjects) ? newObjects : null;
  const bucket = new Map([[null, { objects: [], simulations: [], scenarios: [], plugins: [] }]]);
  for (const l of layers) bucket.set(l.id, { objects: [], simulations: [], scenarios: [] });
  for (const spec of list(flat.objects)) {
    const o = origin.objects.get(spec.id) || { layer: target, base: null, patches: [] };
    if (!o.patches.length) {
      bucket.get(o.layer).objects.push(spec);
      continue;
    }
    // the keys each patch owns: the last layer that patched a key owns it
    const owner = new Map();
    for (const p of o.patches) for (const k of Object.keys(p.keys)) owner.set(k, p.layer);
    const own = {};
    for (const [k, v] of Object.entries(spec)) {
      if (!owner.has(k)) own[k] = v;
      else if (k in o.base) own[k] = o.base[k];
    }
    bucket.get(o.layer).objects.push(own);
    for (const p of o.patches) {
      const patch = { id: spec.id };
      for (const [k, v] of Object.entries(p.keys)) {
        if (owner.get(k) !== p.layer) patch[k] = v; // a later layer patches it: this one keeps its value
        else if (k in spec) patch[k] = spec[k];
      }
      bucket.get(p.layer).objects.push(patch);
    }
  }
  const sims = list(flat.simulations, (s) => isObject(s) && typeof s.type === "string");
  const simOrigin = simulationOrigin || origin.simulations;
  sims.forEach((s, i) => bucket.get(on.has(simOrigin[i]) ? simOrigin[i] : null).simulations.push(s));
  list(flat.scenarios).forEach((s, i) => bucket.get(on.has(origin.scenarios[i]) ? origin.scenarios[i] : null).scenarios.push(s));
  const { layers: _, ...rest } = flat;
  const base = bucket.get(null);
  return {
    ...rest,
    simulations: base.simulations,
    objects: base.objects,
    scenarios: base.scenarios,
    plugins: composed.basePlugins, // (plugins are not edited; a layer's stay with it)
    layers: layers.map((l) => {
      if (!on.has(l.id)) return layerJSON(l);
      const b = bucket.get(l.id);
      return layerJSON({ ...l, objects: b.objects, simulations: b.simulations, scenarios: b.scenarios });
    }),
  };
}

/** A layer as written to a layout file (empty lists left out). */
function layerJSON(l) {
  const out = { id: l.id, name: l.name };
  if (l.description) out.description = l.description;
  out.enabled = l.enabled;
  for (const k of ["objects", "simulations", "scenarios", "plugins"]) if (l[k]?.length) out[k] = l[k];
  return out;
}

/** Problems of a layout's layers (for validateLayout). */
export function layerProblems(json) {
  if (json?.layers == null) return [];
  if (!Array.isArray(json.layers)) return ["layers must be a list"];
  const problems = [], ids = new Set();
  json.layers.forEach((l, i) => {
    const where = `layers[${i}]`;
    if (!isObject(l)) return problems.push(`${where} is not an object`);
    if (typeof l.id !== "string" || !l.id) problems.push(`${where} has no id`);
    else if (ids.has(l.id)) problems.push(`${where}: duplicate id "${l.id}"`);
    ids.add(l.id);
    for (const k of ["objects", "simulations", "scenarios", "plugins"]) if (l[k] != null && !Array.isArray(l[k])) problems.push(`${where}.${k} must be a list`);
    (Array.isArray(l.objects) ? l.objects : []).forEach((o, j) => {
      if (!isObject(o) || typeof o.id !== "string" || !o.id) problems.push(`${where}.objects[${j}] has no id`);
    });
  });
  return problems;
}
