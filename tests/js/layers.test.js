// Layers of a layout (core/layers.js, World.setLayers): merging the layers that are on, splitting
// edits back into the base and the layers, the lab example's layers, and validation.
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  composeLayout, createWorld, decomposeLayout, infraOf, layersOn, layoutPlugins, loadPlugins, opsOf, registry, validateLayout, withLayers,
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

test("the lab example: one layout with the layers rail operations and infrastructure", () => {
  assert.deepEqual(validateLayout(LAB, registry), []);
  assert.deepEqual(LAB.layers.map((l) => [l.id, l.enabled]), [["operations", false], ["infrastructure", false]]);
  // the base is the same with any layers on: the station, the Plattenbau behind the tracks
  for (const on of [[], ["operations"], ["infrastructure"], ["operations", "infrastructure"]]) {
    const world = createWorld(withLayers(LAB, on));
    for (const id of ["station-1", "underpass-1", "plattenbau-2", "table-back"]) assert.ok(world.getObject(id), `${id} with ${on}`);
    assert.equal(!!world.getObject("depot-1"), on.includes("operations"));
    assert.equal(!!world.getObject("interlocking-bf"), on.includes("infrastructure"));
    assert.equal(world.getObject("track-g1").spec.built, on.includes("infrastructure") ? 1994 : undefined);
    // saved, the layout is the file again (only which layers are on differs)
    const json = world.toJSON();
    assert.deepEqual(json.objects, LAB.objects);
    assert.deepEqual(json.layers.map((l) => l.objects), LAB.layers.map((l) => l.objects));
    assert.deepEqual(json.layers.map((l) => l.scenarios), LAB.layers.map((l) => l.scenarios));
  }
  // both at once: rail operations and the infrastructure game run together
  const world = createWorld(withLayers(LAB, ["operations", "infrastructure"]));
  for (let i = 0; i < 5; i++) world.step(0.1);
  assert.ok(opsOf(world)?.engine && infraOf(world)?.engine);
  assert.deepEqual(world.scenarios.scenarios.map((s) => s.id), ["signal-failure", "football", "closure", "crew-shortage", "infra-faults"]);
});
