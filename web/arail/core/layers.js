/**
 * Layers of a layout: optional parts of one layout file that can be switched on and off, e.g.
 * rail operations or the infrastructure game on top of the same lab photo, table and town. The app
 * shows them as **modules** (View → Modules).
 *
 *   { ...base layout...,
 *     "layers": [
 *       { "id": "operations", "name": "Rail operations", "enabled": false,
 *         "objects": [...], "simulations": [...], "scenarios": [...], "plugins": [...] },
 *       { "id": "terminal", "name": "Container terminal", "layout": "container-terminal.json" } ] }
 *
 * The base (the top-level `objects`, `simulations`, `scenarios`, `plugins`) is always on. The
 * layers that are on are added in their order ({@link composeLayout}):
 * - an object whose id is new is added; an entry whose id is already there (from the base or an
 *   earlier layer) is a **patch**: its keys are merged into that object (e.g. `{"id": "track-g1",
 *   "built": 1994}`). A patch of an object that is not there does nothing.
 * - simulations, scenarios and plugins are added (a scenario with an id that is already there
 *   replaces it while the layer is on). A simulation entry with `"patch": true` is a patch of the simulation of its type
 *   that is already there: its keys are merged into it (e.g. `{"type": "town", "patch": true,
 *   "enabled": false}`).
 *
 * A layer with `"exclusive": true` is not combined with others: switching it on switches the
 * others off, and switching on another one switches it off ({@link toggleLayer}). A layer with
 * `"layout"` is a layout of its own (a path relative to the layout file, e.g. a virtual container
 * terminal): it adds nothing here, the app opens that layout instead; it is always exclusive.
 *
 * {@link decomposeLayout} is the way back: the composed layout as edited (objects moved, added,
 * removed; settings of simulations) is split into the base and the layers again. An object goes
 * back to the layer it came from, the keys a layer patched go back to that layer's patch (of an
 * object or a simulation), a scenario that a layer replaced goes back to where it came from (and
 * the layer keeps its own), and a new object goes to the given layer (by default the base). Layers
 * that are off stay as they were.
 * @module arail/core/layers
 */

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v, ok = isObject) => (Array.isArray(v) ? v.filter(ok) : []);
const clone = (v) => structuredClone(v);
/** A simulation entry of a layer that patches a simulation already there. */
const isPatch = (s) => s.patch === true;

/**
 * The layers of a layout, normalised: [{id, name, description, enabled, exclusive, layout, objects,
 * simulations, scenarios, plugins}]. Entries without an id and repeated ids are left out (see
 * layerProblems). A layer with its own `layout` is exclusive and adds nothing.
 */
export function normalizeLayers(layers) {
  const seen = new Set(), out = [];
  for (const l of list(layers)) {
    const id = typeof l.id === "string" && l.id ? l.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const layout = typeof l.layout === "string" && l.layout ? l.layout : null;
    out.push({
      id,
      name: typeof l.name === "string" && l.name ? l.name : id,
      description: typeof l.description === "string" ? l.description : "",
      enabled: l.enabled === true,
      exclusive: l.exclusive === true || !!layout,
      since: typeof l.since === "string" && l.since ? l.since : null,
      layout,
      objects: layout ? [] : list(l.objects, (o) => isObject(o) && typeof o.id === "string" && !!o.id),
      simulations: layout ? [] : list(l.simulations, (s) => isObject(s) && typeof s.type === "string"),
      scenarios: layout ? [] : list(l.scenarios),
      plugins: layout ? [] : list(l.plugins, (u) => typeof u === "string"),
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

/**
 * Which layers are on after switching one: switched off if it was on; else switched on, and an
 * exclusive layer switches all others off, any other layer the exclusive ones. In layer order.
 * @param {Array<{id: string, exclusive?: boolean}>} layers normalised layers (or `world.layers()`)
 * @param {Iterable<string>} on ids of the layers that are on now
 * @param {string} id the layer to switch
 * @returns {string[]}
 */
export function toggleLayer(layers, on, id) {
  const now = new Set(on), layer = layers.find((l) => l.id === id);
  if (!layer) return layerChoice(layers, now);
  if (now.has(id)) now.delete(id);
  else if (layer.exclusive) return [id];
  else {
    for (const l of layers) if (l.exclusive) now.delete(l.id);
    now.add(id);
  }
  return layerChoice(layers, now);
}

/**
 * Layer ids that were renamed, the old id to the new one: a choice saved, an address or a layout
 * edited before keeps its modules under the new names ({@link renameLayers}, {@link renameLayoutLayers},
 * {@link renameModuleHome}).
 * The Christmas market's module was `striezelmarkt` until the name, which is protected, gave way to
 * `wintermarkt`.
 */
export const RENAMED_LAYERS = Object.freeze({ striezelmarkt: "wintermarkt" });

/** Scenario ids that were renamed with their layer (see {@link RENAMED_LAYERS}). */
export const RENAMED_SCENARIOS = Object.freeze({ "striezelmarkt-evening": "wintermarkt-evening" });
/** The old name and the new one, as the texts of a layout (names, boards, messages) have them. */
const RENAMED_TEXTS = [["Striezelmarkt", "Wintermarkt"]];

const renameText = (t) => (typeof t === "string" ? RENAMED_TEXTS.reduce((s, [old, now]) => s.split(old).join(now), t) : t);

/** A scenario with its renamed id and the old name in its name, description and messages replaced. */
function renameScenario(sc) {
  if (!isObject(sc)) return sc;
  const out = { ...sc, name: renameText(sc.name), description: renameText(sc.description) };
  if (typeof sc.id === "string" && RENAMED_SCENARIOS[sc.id]) out.id = RENAMED_SCENARIOS[sc.id];
  if (Array.isArray(sc.steps)) out.steps = sc.steps.map((st) => (isObject(st) && typeof st.message === "string" ? { ...st, message: renameText(st.message) } : st));
  for (const k of ["name", "description"]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Objects with the old name on a market gate's board replaced; nothing else of them is touched. */
const renameObjects = (objects) => (Array.isArray(objects) ? objects.map((o) => (isObject(o) && o.type === "market-gate" && typeof o.text === "string" ? { ...o, text: renameText(o.text) } : o)) : objects);

/**
 * Layer ids with the renamed ones under their new names ({@link RENAMED_LAYERS}); the order is kept.
 * @param {string[] | null | undefined} ids (anything else comes back as it is)
 * @returns {string[] | null | undefined}
 */
export function renameLayers(ids) {
  if (!Array.isArray(ids)) return ids;
  return [...new Set([...ids].map((id) => RENAMED_LAYERS[id] ?? id))];
}

/**
 * A layout (as saved with a user's own edits) with its renamed layers under their new ids
 * ({@link RENAMED_LAYERS}). Only what the app wrote under the old name is renamed: the ids and names
 * of layers, the board of a market gate, the scenarios that came with the layer (id, name,
 * description, messages) and the descriptions of the layout and its layers. Object ids, paths
 * (`view.image`) and the rest stay as they are. The layout given is not changed; one without a
 * renamed layer comes back as it is.
 * @param {object} layout
 * @returns {object}
 */
export function renameLayoutLayers(layout) {
  if (!isObject(layout) || !Array.isArray(layout.layers) || !layout.layers.some((l) => isObject(l) && RENAMED_LAYERS[l.id])) return layout;
  const scenarios = (v) => (Array.isArray(v) ? v.map(renameScenario) : v);
  const out = { ...layout, objects: renameObjects(layout.objects), scenarios: scenarios(layout.scenarios), description: renameText(layout.description) };
  for (const k of ["objects", "scenarios", "description"]) if (out[k] === undefined) delete out[k];
  out.layers = layout.layers.map((l) => {
    if (!isObject(l)) return l;
    const r = { ...l, id: RENAMED_LAYERS[l.id] ?? l.id, name: renameText(l.name), description: renameText(l.description), objects: renameObjects(l.objects), scenarios: scenarios(l.scenarios) };
    for (const k of ["name", "description", "objects", "scenarios"]) if (r[k] === undefined) delete r[k];
    return r;
  });
  return out;
}

/**
 * A home of a module that is a layout of its own, as the app keeps it ({url, name, module, modules}),
 * with its renamed modules under their new ids and names ({@link RENAMED_LAYERS}).
 * @param {{module?: string, modules?: Array<{id: string, name?: string}>} | null} home
 * @returns {object | null}
 */
export function renameModuleHome(home) {
  if (!isObject(home) || !Array.isArray(home.modules)) return home;
  return {
    ...home,
    module: RENAMED_LAYERS[home.module] ?? home.module,
    modules: home.modules.map((m) => (isObject(m) ? { ...m, id: RENAMED_LAYERS[m.id] ?? m.id, name: renameText(m.name) } : m)),
  };
}

/**
 * A valid choice of layers from a list of ids (an address, a saved choice): known ids in layer
 * order; when an exclusive layer is among them, only the first exclusive one.
 * @param {Array<{id: string, exclusive?: boolean}>} layers
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
export function layerChoice(layers, ids) {
  const want = new Set(ids);
  const chosen = layers.filter((l) => want.has(l.id));
  const alone = chosen.find((l) => l.exclusive);
  return alone ? [alone.id] : chosen.map((l) => l.id);
}

/**
 * A saved choice of layers, with the layers the layout has gained since it was saved: those on by
 * default that were not among its layers then (`known`, the ids it had) are added. A choice saved
 * without `known` (by the app before it kept the ids) gains, once, only the layers on by default that
 * say when they came (`since`): what was switched off by hand stays off.
 * @param {Array<{id: string, enabled?: boolean, exclusive?: boolean}>} layers the layout's layers
 * @param {Iterable<string>} chosen the saved choice
 * @param {Iterable<string> | null} known the layer ids of the layout when the choice was saved
 * @returns {string[]} a valid choice (see {@link layerChoice})
 */
export function withNewLayers(layers, chosen, known) {
  const ids = [...chosen];
  return layerChoice(layers, [...ids, ...newLayers(layers, ids, known)]);
}

/** The layers a saved choice gains (see {@link withNewLayers}), also those an exclusive one chosen keeps out. */
function newLayers(layers, chosen, known) {
  const had = known ? new Set(known) : null, ids = new Set(chosen);
  return layers.filter((l) => l.enabled && !l.exclusive && !ids.has(l.id) && (had ? !had.has(l.id) : !!l.since)).map((l) => l.id);
}

/**
 * The layer ids to keep with a choice as those the layout had (`known` of {@link withNewLayers}): all
 * of its layers, but those the choice would gain that an exclusive layer chosen alone keeps out. They
 * stay new, and come when it is left: a returning user whose last choice was an exclusive module gets
 * them as anybody else.
 * @param {Array<{id: string, enabled?: boolean, exclusive?: boolean, since?: string | null}>} layers the layout's layers
 * @param {Iterable<string>} chosen the choice as saved or made
 * @param {Iterable<string> | null} known the ids kept before (null: see withNewLayers)
 * @returns {string[]}
 */
export function layersKnown(layers, chosen, known) {
  const ids = [...chosen], on = new Set(withNewLayers(layers, ids, known)), added = new Set(newLayers(layers, ids, known));
  return layers.map((l) => l.id).filter((id) => on.has(id) || !added.has(id));
}

/**
 * A choice of layers with these switched on as well, each as switching it on does ({@link toggleLayer}):
 * an exclusive one alone, any other without the exclusive ones (an example that needs a module, with
 * the modules chosen before).
 * @param {Array<{id: string, exclusive?: boolean}>} layers
 * @param {Iterable<string>} on ids of the layers that are on
 * @param {Iterable<string>} ids the layers to switch on
 * @returns {string[]}
 */
export function switchOnLayers(layers, on, ids) {
  let now = layerChoice(layers, on);
  for (const id of ids) if (!now.includes(id)) now = toggleLayer(layers, now, id);
  return now;
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
 *   simulationPatches: Map<number, {base: object, patches: Array<{layer: string, keys: object}>}>,
 *   scenarios: (string|null)[], replacedScenarios: Map<number, Array<{layer: string|null, scenario: object}>>},
 *   basePlugins: string[]}} `layout`: a plain layout without `layers`; `layers`: the normalised layers (all of
 *   them); `origin`: where each object, simulation and scenario of `layout` came from (layer id or null for the
 *   base), which layers patched which simulation, and the scenarios that layers replaced (by index, with where
 *   they came from), for {@link decomposeLayout}
 */
export function composeLayout(json) {
  const j = isObject(json) ? json : {};
  const layers = normalizeLayers(j.layers);
  const { layers: _, ...base } = j;
  const layout = clone(base);
  const objects = list(layout.objects);
  const origin = { objects: new Map(), simulations: [], simulationPatches: new Map(), scenarios: [], replacedScenarios: new Map() };
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
      if (isPatch(s)) {
        const i = simulations.findIndex((x) => x.type === s.type);
        if (i < 0) continue; // a patch of a simulation that is not there
        const { type, patch, ...keys } = s;
        let p = origin.simulationPatches.get(i);
        if (!p) origin.simulationPatches.set(i, (p = { base: clone(simulations[i]), patches: [] }));
        p.patches.push({ layer: l.id, keys: clone(keys) });
        simulations[i] = { ...simulations[i], ...clone(keys) };
        continue;
      }
      simulations.push(clone(s));
      origin.simulations.push(l.id);
    }
    for (const s of l.scenarios) {
      const i = s.id != null ? scenarios.findIndex((x) => x.id === s.id) : -1;
      if (i >= 0) {
        // the one it replaces is kept: decomposeLayout gives it back to where it came from
        if (!origin.replacedScenarios.has(i)) origin.replacedScenarios.set(i, []);
        origin.replacedScenarios.get(i).push({ layer: origin.scenarios[i], scenario: scenarios[i] });
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
 * Split the keys of an edited entry between its owner and the layers that patched it: the last
 * layer that patched a key owns it; the owner keeps its own value of such a key (if it had one).
 * @param {object} spec the entry as edited
 * @param {object} base the entry before the patches
 * @param {Array<{layer: string, keys: object}>} patches in the order they were applied
 * @param {object} head keys every patch starts with (`{id}` of an object, `{type, patch: true}` of a simulation)
 * @returns {{own: object, patches: Array<{layer: string, entry: object}>}}
 */
function splitPatched(spec, base, patches, head) {
  const owner = new Map();
  for (const p of patches) for (const k of Object.keys(p.keys)) owner.set(k, p.layer);
  const own = {};
  for (const [k, v] of Object.entries(spec)) {
    if (!owner.has(k)) own[k] = v;
    else if (k in base) own[k] = base[k];
  }
  return {
    own,
    patches: patches.map((p) => {
      const entry = { ...head };
      for (const [k, v] of Object.entries(p.keys)) {
        if (owner.get(k) !== p.layer) entry[k] = v; // a later layer patches it: this one keeps its value
        else if (k in spec) entry[k] = spec[k];
      }
      return { layer: p.layer, entry };
    }),
  };
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
    const split = splitPatched(spec, o.base, o.patches, { id: spec.id });
    bucket.get(o.layer).objects.push(split.own);
    for (const p of split.patches) bucket.get(p.layer).objects.push(p.entry);
  }
  const sims = list(flat.simulations, (s) => isObject(s) && typeof s.type === "string");
  const simOrigin = simulationOrigin || origin.simulations;
  const patched = origin.simulationPatches || new Map();
  sims.forEach((s, i) => {
    const owner = on.has(simOrigin[i]) ? simOrigin[i] : null;
    const p = patched.get(i);
    if (!p || p.base.type !== s.type) {
      bucket.get(owner).simulations.push(s);
      return;
    }
    const split = splitPatched(s, p.base, p.patches, { type: s.type, patch: true });
    bucket.get(owner).simulations.push(split.own);
    for (const q of split.patches) bucket.get(q.layer).simulations.push(q.entry);
  });
  const replaced = origin.replacedScenarios || new Map();
  list(flat.scenarios).forEach((s, i) => {
    // a scenario that a layer replaced goes back to where it came from; the layer keeps its own
    for (const r of replaced.get(i) ?? []) bucket.get(on.has(r.layer) ? r.layer : null).scenarios.push(r.scenario);
    bucket.get(on.has(origin.scenarios[i]) ? origin.scenarios[i] : null).scenarios.push(s);
  });
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
  if (l.layout) out.layout = l.layout;
  else if (l.exclusive) out.exclusive = true;
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
    if (l.exclusive != null && typeof l.exclusive !== "boolean") problems.push(`${where}.exclusive must be true or false`);
    if (l.since != null && (typeof l.since !== "string" || !/^\d{4}-\d\d-\d\d$/.test(l.since))) problems.push(`${where}.since must be a date (YYYY-MM-DD)`);
    if (l.layout != null) {
      if (typeof l.layout !== "string" || !l.layout) problems.push(`${where}.layout must be the path of a layout file`);
      else if (["objects", "simulations", "scenarios", "plugins"].some((k) => Array.isArray(l[k]) && l[k].length)) {
        problems.push(`${where} is a layout of its own (layout): its objects, simulations, scenarios and plugins are not used`);
      }
    }
    for (const k of ["objects", "simulations", "scenarios", "plugins"]) if (l[k] != null && !Array.isArray(l[k])) problems.push(`${where}.${k} must be a list`);
    (Array.isArray(l.objects) ? l.objects : []).forEach((o, j) => {
      if (!isObject(o) || typeof o.id !== "string" || !o.id) problems.push(`${where}.objects[${j}] has no id`);
    });
    (Array.isArray(l.simulations) ? l.simulations : []).forEach((s, j) => {
      if (!isObject(s) || typeof s.type !== "string" || !s.type) problems.push(`${where}.simulations[${j}] has no type`);
      else if (s.patch != null && typeof s.patch !== "boolean") problems.push(`${where}.simulations[${j}].patch must be true or false`);
    });
  });
  return problems;
}
