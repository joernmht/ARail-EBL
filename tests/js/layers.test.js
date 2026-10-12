// Layers of a layout (core/layers.js, World.setLayers): merging the layers that are on, splitting
// edits back into the base and the layers, exclusive layers and layers that are layouts of their own,
// patches of simulations, the lab example's layers (the app's modules), and validation.
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  composeLayout, createWorld, decomposeLayout, infraOf, journeysOf, layerChoice, layersOn, layoutPlugins, loadPlugins, normalizeLayers, opsOf, registry,
  toggleLayer, validateLayout, withLayers,
} from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const LAB = readJSON("web/layouts/ebl-lab.json");
await loadPlugins(layoutPlugins(LAB), pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);

const SMALL = {
  objects: [
    { id: "t", type: "track", points: [[0, 0], [1000, 0]] },
    { id: "h", type: "building", position: [0, -300] },
  ],
  simulations: [{ type: "passengers" }],
  scenarios: [{ id: "a", steps: [] }, { id: "b", steps: [] }],
  plugins: ["one.js"],
  layers: [
    {
      id: "x", name: "Extra", enabled: true,
      objects: [{ id: "t", built: 1990, name: "Track 1" }, { id: "s", type: "station-building", position: [0, -150] }, { id: "nothere", built: 1 }],
      simulations: [{ type: "traffic" }],
      scenarios: [{ id: "b", name: "Other b", steps: [] }, { id: "c", steps: [] }],
      plugins: ["two.js"],
    },
    { id: "y", name: "Off", objects: [{ id: "f", type: "tree", position: [5, 5] }], simulations: [{ type: "town" }] },
  ],
};

test("compose: the base plus the layers that are on; entries with a known id patch that object", () => {
  const { layout, layers, origin } = composeLayout(SMALL);
  assert.equal(layout.layers, undefined);
  assert.deepEqual(layout.objects.map((o) => o.id), ["t", "h", "s"], "layer y is off; a patch of an unknown id does nothing");
  assert.deepEqual(layout.objects[0], { id: "t", type: "track", points: [[0, 0], [1000, 0]], built: 1990, name: "Track 1" });
  assert.deepEqual(layout.simulations.map((s) => s.type), ["passengers", "traffic"]);
  assert.deepEqual(layout.scenarios.map((s) => s.name ?? s.id), ["a", "Other b", "c"], "a scenario with the same id is replaced");
  assert.deepEqual(layout.plugins, ["one.js", "two.js"]);
  assert.deepEqual(layoutPlugins(SMALL), ["one.js", "two.js"], "plugins of all layers, also those that are off");
  assert.deepEqual(layers.map((l) => [l.id, l.enabled]), [["x", true], ["y", false]]);
  assert.equal(origin.objects.get("s").layer, "x");
  assert.equal(origin.objects.get("t").layer, null);
  assert.deepEqual(layersOn(SMALL), ["x"]);
  assert.deepEqual(layersOn(withLayers(SMALL, ["y"])), ["y"]);
  assert.equal(SMALL.layers[0].enabled, true, "withLayers does not change its input");
});

test("decompose: edits go back where they came from; new objects to the active layer", () => {
  const world = createWorld(SMALL);
  assert.deepEqual(world.layers().map((l) => [l.id, l.enabled, l.simulations]), [["x", true, ["traffic"]], ["y", false, ["town"]]]);
  // a key the layer patched goes to the layer's patch, others to the base
  world.getObject("t").set({ built: 2001, points: [[0, 10], [1000, 10]] });
  world.getObject("s").set({ length_m: 50 });
  world.removeObject("h");
  world.activeLayer = "x";
  world.addObject({ id: "new1", type: "tree", position: [1, 1] });
  world.activeLayer = null;
  world.addObject({ id: "new2", type: "tree", position: [2, 2] });
  const json = world.toJSON();
  assert.deepEqual(json.objects, [
    { id: "t", type: "track", points: [[0, 10], [1000, 10]] },
    { id: "new2", type: "tree", position: [2, 2] },
  ]);
  const [x, y] = json.layers;
  assert.deepEqual(x.objects.map((o) => o.id), ["t", "s", "new1"]);
  assert.deepEqual(x.objects[0], { id: "t", built: 2001, name: "Track 1" });
  assert.equal(x.objects[1].length_m, 50);
  assert.deepEqual(x.simulations.map((s) => s.type), ["traffic"]);
  assert.deepEqual(json.simulations.map((s) => s.type), ["passengers"]);
  assert.deepEqual(x.scenarios.map((s) => s.id), ["b", "c"]);
  assert.deepEqual(json.scenarios.map((s) => s.id), ["a"]);
  assert.deepEqual(json.plugins, ["one.js"]);
  assert.deepEqual(x.plugins, ["two.js"]);
  assert.deepEqual(y, { id: "y", name: "Off", enabled: false, objects: [{ id: "f", type: "tree", position: [5, 5] }], simulations: [{ type: "town" }] }, "a layer that is off stays as it was");
  // and back again
  const again = createWorld(json);
  assert.equal(again.getObject("t").spec.built, 2001);
  assert.equal(again.layerOf("new1"), "x");
  // a patch that a later layer overrides keeps its own value
  const two = composeLayout({ objects: [{ id: "o", type: "tree", position: [0, 0], height_m: 5 }], layers: [
    { id: "a", enabled: true, objects: [{ id: "o", height_m: 8 }] }, { id: "b", enabled: true, objects: [{ id: "o", height_m: 9 }] }] });
  const back = decomposeLayout({ objects: [{ id: "o", type: "tree", position: [0, 0], height_m: 12 }] }, two);
  assert.deepEqual([back.objects[0].height_m, back.layers[0].objects[0].height_m, back.layers[1].objects[0].height_m], [5, 8, 12]);
});

test("switching layers keeps the edits; new ids are not used by any layer", () => {
  const world = createWorld(SMALL);
  world.getObject("h").set({ floors: 5 });
  assert.equal(world.newId("tree"), "tree-1");
  const added = world.addObject({ type: "tree", position: [0, 0], id: "f" }); // the id of an object of layer y (off)
  assert.equal(added.id, "tree-1", "another id");
  world.setLayers(["y"]);
  assert.deepEqual(world.layers().filter((l) => l.enabled).map((l) => l.id), ["y"]);
  assert.equal(world.getObject("h").spec.floors, 5, "the edit is kept");
  assert.equal(world.getObject("s"), null, "layer x is off");
  assert.ok(world.getObject("f"));
  assert.deepEqual(world.simulations.map((s) => s.constructor.type), ["passengers", "town"]);
  world.setLayers(["x", "y"]);
  assert.ok(world.getObject("s") && world.getObject("f"));
  assert.equal(world.getObject("t").spec.built, 1990);
});

test("validation: layers are checked, with every layer on", () => {
  assert.deepEqual(validateLayout({ layers: {} }), ["layers must be a list"]);
  const bad = validateLayout({
    objects: [{ id: "a", type: "tree", position: [0, 0] }],
    layers: [{ id: "l", objects: [{ type: "nope" }, { id: "b", type: "nope" }] }, { id: "l" }, { name: "no id" }],
  }, registry);
  assert.ok(bad.includes("layers[0].objects[0] has no id"), bad.join("\n"));
  assert.ok(bad.includes('layers[1]: duplicate id "l"'));
  assert.ok(bad.includes("layers[2] has no id"));
  assert.ok(bad.some((p) => p.includes('unknown type "nope"')), "objects of a layer that is off are checked too");
});

test("exclusive layers and layers that are layouts of their own: switching on one switches the others off", () => {
  const json = {
    objects: [{ id: "h", type: "building", position: [0, 0] }],
    layers: [
      { id: "a", name: "A", objects: [{ id: "t1", type: "tree", position: [1, 1] }] },
      { id: "b", name: "B" },
      { id: "solo", name: "Solo", exclusive: true, objects: [{ id: "t2", type: "tree", position: [2, 2] }] },
      { id: "other", name: "Other layout", layout: "other.json", objects: [{ id: "t3", type: "tree", position: [3, 3] }] },
    ],
  };
  const layers = normalizeLayers(json.layers);
  assert.deepEqual(layers.map((l) => [l.id, l.exclusive, l.layout]), [["a", false, null], ["b", false, null], ["solo", true, null], ["other", true, "other.json"]]);
  assert.deepEqual(layers.find((l) => l.id === "other").objects, [], "a layout of its own adds nothing here");
  assert.deepEqual(toggleLayer(layers, [], "a"), ["a"]);
  assert.deepEqual(toggleLayer(layers, ["a"], "b"), ["a", "b"], "ordinary layers are combined");
  assert.deepEqual(toggleLayer(layers, ["b", "a"], "a"), ["b"], "switched off again");
  assert.deepEqual(toggleLayer(layers, ["a", "b"], "solo"), ["solo"], "an exclusive one switches the others off");
  assert.deepEqual(toggleLayer(layers, ["solo"], "a"), ["a"], "and is switched off by another one");
  assert.deepEqual(toggleLayer(layers, ["solo"], "other"), ["other"]);
  assert.deepEqual(toggleLayer(layers, ["other"], "other"), []);
  assert.deepEqual(toggleLayer(layers, ["a"], "nope"), ["a"]);
  assert.deepEqual(layerChoice(layers, ["b", "x", "a"]), ["a", "b"], "known ids, in layer order");
  assert.deepEqual(layerChoice(layers, ["a", "other", "solo"]), ["solo"], "only the first exclusive one");
  // composed: a layout of its own adds nothing even when it is on; saved, it keeps its path
  const { layout } = composeLayout(withLayers(json, ["other"]));
  assert.deepEqual(layout.objects.map((o) => o.id), ["h"]);
  const world = createWorld(withLayers(json, ["solo"]));
  assert.deepEqual(world.layers().map((l) => [l.id, l.enabled, l.exclusive, l.layout]), [["a", false, false, null], ["b", false, false, null], ["solo", true, true, null], ["other", false, true, "other.json"]]);
  const saved = world.toJSON().layers;
  assert.deepEqual(saved[2], { id: "solo", name: "Solo", enabled: true, exclusive: true, objects: [{ id: "t2", type: "tree", position: [2, 2] }] });
  assert.deepEqual(saved[3], { id: "other", name: "Other layout", enabled: false, layout: "other.json" });
  assert.ok(validateLayout(json).includes("layers[3] is a layout of its own (layout): its objects, simulations, scenarios and plugins are not used"));
  assert.ok(validateLayout({ layers: [{ id: "x", exclusive: "yes", layout: 3 }] }).includes("layers[0].exclusive must be true or false"));
  assert.ok(validateLayout({ layers: [{ id: "x", layout: 3 }] }).includes("layers[0].layout must be the path of a layout file"));
});

test("simulation patches: a layer changes the settings of a simulation of the base, and edits go back where they came from", () => {
  const json = {
    simulations: [{ type: "passengers", base_rate: 0.4 }, { type: "town", people_per_100: 20 }],
    layers: [
      { id: "quiet", name: "Quiet", enabled: true, simulations: [{ type: "passengers", patch: true, others: false }, { type: "town", patch: true, enabled: false }, { type: "traffic" }] },
      { id: "busy", name: "Busy", simulations: [{ type: "passengers", patch: true, base_rate: 2 }] },
      { id: "none", name: "Nothing to patch", enabled: true, simulations: [{ type: "operations", patch: true, enabled: false }] },
    ],
  };
  const { layout, origin } = composeLayout(json);
  assert.deepEqual(layout.simulations, [{ type: "passengers", base_rate: 0.4, others: false }, { type: "town", people_per_100: 20, enabled: false }, { type: "traffic" }]);
  assert.deepEqual([...origin.simulationPatches.keys()], [0, 1]);
  const world = createWorld(json);
  const [pax, town] = world.simulations;
  assert.equal(pax.others, false, "no other passengers");
  assert.equal(town.enabled, false, "the town is switched off");
  assert.deepEqual(world.layers().map((l) => [l.id, l.simulations]), [["quiet", ["traffic"]], ["busy", []], ["none", []]], "patches are not simulations of the layer");
  // an edit of a key the layer patched stays with the layer; other keys go to the base
  pax.config.others = false;
  pax.config.base_rate = 0.7;
  const saved = world.toJSON();
  assert.equal(saved.simulations[0].base_rate, 0.7);
  assert.equal("others" in saved.simulations[0], false);
  assert.equal("enabled" in saved.simulations[1], false);
  assert.deepEqual(saved.layers[0].simulations.slice(0, 2), [{ type: "passengers", patch: true, others: false }, { type: "town", patch: true, enabled: false }]);
  assert.equal(saved.layers[0].simulations[2].type, "traffic");
  assert.deepEqual(saved.layers[1].simulations, [{ type: "passengers", patch: true, base_rate: 2 }], "a layer that is off keeps its patch");
  // switched off: the base as it was
  world.setLayers(["busy"]);
  assert.equal(world.simulations[0].config.base_rate, 2, "the patch of the other layer");
  assert.equal(world.simulations[0].others, true);
  assert.equal(world.simulations[1].enabled, true);
  // a later layer patching the same key wins; the earlier one keeps its value
  const two = composeLayout({ simulations: [{ type: "passengers", base_rate: 1 }], layers: [
    { id: "a", enabled: true, simulations: [{ type: "passengers", patch: true, base_rate: 2 }] },
    { id: "b", enabled: true, simulations: [{ type: "passengers", patch: true, base_rate: 3 }] }] });
  assert.equal(two.layout.simulations[0].base_rate, 3);
  const back = decomposeLayout({ simulations: [{ type: "passengers", base_rate: 5 }] }, two);
  assert.deepEqual([back.simulations[0].base_rate, back.layers[0].simulations[0].base_rate, back.layers[1].simulations[0].base_rate], [1, 2, 5]);
  assert.ok(validateLayout({ layers: [{ id: "x", simulations: [{ patch: true }, { type: "town", patch: "yes" }] }] }).includes("layers[0].simulations[0] has no type"));
});

test("the lab example: one layout with the modules rail operations, infrastructure, journeys, border station and the container terminal", () => {
  assert.deepEqual(validateLayout(LAB, registry), []);
  assert.deepEqual(LAB.layers.map((l) => [l.id, l.enabled]), [["operations", false], ["infrastructure", false], ["journeys", false], ["border", false], ["terminal", false]]);
  assert.deepEqual(normalizeLayers(LAB.layers).filter((l) => l.exclusive).map((l) => [l.id, l.layout]), [["terminal", "container-terminal.json"]]);
  // the base is the same with any layers on: the station, the Plattenbau behind the tracks
  for (const on of [[], ["operations"], ["infrastructure"], ["journeys"], ["border"], ["operations", "infrastructure"], ["operations", "infrastructure", "journeys", "border"], ["terminal"]]) {
    const world = createWorld(withLayers(LAB, on));
    for (const id of ["station-1", "underpass-1", "plattenbau-2", "table-back"]) assert.ok(world.getObject(id), `${id} with ${on}`);
    assert.equal(!!world.getObject("depot-1"), on.includes("operations"));
    assert.equal(!!world.getObject("interlocking-bf"), on.includes("infrastructure"));
    assert.equal(world.getObject("track-g1").spec.built, on.includes("infrastructure") ? 1994 : undefined);
    assert.equal(world.getObject("track-g3").spec.country, on.includes("border") ? "CZ" : "DE");
    // the journeys: the town's residents stay at home and no other passengers come
    assert.equal(!!journeysOf(world), on.includes("journeys"));
    assert.equal(world.simulations.find((s) => s.constructor.type === "town").enabled, !on.includes("journeys"));
    assert.equal(world.simulations.find((s) => s.constructor.type === "passengers").others, !on.includes("journeys"));
    // saved, the layout is the file again (only which layers are on differs)
    const json = world.toJSON();
    assert.deepEqual(json.objects, LAB.objects);
    assert.deepEqual(json.layers.map((l) => l.objects), LAB.layers.map((l) => l.objects));
    assert.deepEqual(json.layers.map((l) => l.scenarios), LAB.layers.map((l) => l.scenarios));
    assert.deepEqual(json.layers.find((l) => l.id === "terminal"), { ...LAB.layers.find((l) => l.id === "terminal"), enabled: on.includes("terminal") });
  }
  // all at once: rail operations, the infrastructure game and the journeys run together
  const world = createWorld(withLayers(LAB, ["operations", "infrastructure", "journeys"]));
  for (let i = 0; i < 5; i++) world.step(0.1);
  assert.ok(opsOf(world)?.engine && infraOf(world)?.engine);
  assert.equal(world.services.planner, opsOf(world), "the rail operations run the trains");
  assert.equal(journeysOf(world).rail().kind, "operations", "the journeys take their trains");
  assert.deepEqual(world.scenarios.scenarios.map((s) => s.id), ["signal-failure", "football", "closure", "crew-shortage", "infra-faults"]);
});
