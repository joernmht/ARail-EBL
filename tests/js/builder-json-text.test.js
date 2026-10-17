// What the builder pushes (web/builder/json-text.js): the changes merged into the file's own JSON,
// written into the file's own text, so an edit changes the lines of what was edited and nothing else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pathToFileURL } from "node:url";

import { createWorld, layoutPlugins, loadPlugins } from "../../web/arail/index.js";
import { mergeChanges, parseText, sameJSON, stringifyLike } from "../../web/builder/json-text.js";

const read = (path) => readFileSync(new URL(`../../web/${path}`, import.meta.url), "utf8");
const FILES = ["layouts/ebl-lab.json", "layouts/ebl-neustadt.json", "layouts/container-terminal.json", "layouts/ebl-container-train.json", "lab-map/data.json"];

/** Lines only in a (removed) and only in b (added). */
function lineDiff(a, b) {
  const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const ca = count(a.split("\n")), cb = count(b.split("\n"));
  const only = (x, y) => [...x].flatMap(([l, n]) => Array(Math.max(0, n - (y.get(l) || 0))).fill(l));
  return { removed: only(ca, cb), added: only(cb, ca) };
}

/** Open a layout as the builder does, change it, and write the file (the modules shown are no change). */
function edit(path, change) {
  const text = read(path), original = JSON.parse(text);
  const world = createWorld(original);
  const baseline = world.toJSON();
  change(world);
  const current = world.toJSON();
  for (const l of current.layers || []) l.enabled = baseline.layers.find((x) => x.id === l.id)?.enabled ?? l.enabled;
  const merged = mergeChanges(original, baseline, current);
  const out = stringifyLike(text, merged);
  assert.ok(sameJSON(JSON.parse(out), merged), "the text is the merged JSON");
  return { text, out, merged, diff: lineDiff(text, out) };
}

test("a file written again without changes is the same text", () => {
  for (const f of FILES) {
    const text = read(f);
    assert.equal(stringifyLike(text, JSON.parse(text)), text, f);
    assert.ok(sameJSON(parseText(text).value, JSON.parse(text)), f);
  }
});

test("opened and not changed: the file stays as it is, without the defaults the world fills in", async () => {
  // the lab's windmill comes from a plugin, as in the builder
  const lab = JSON.parse(read("layouts/ebl-lab.json"));
  assert.deepEqual(await loadPlugins(layoutPlugins(lab), pathToFileURL(new URL("../../web/layouts/ebl-lab.json", import.meta.url).pathname).href), []);
  for (const f of FILES.filter((x) => x.startsWith("layouts/"))) {
    const { out, text } = edit(f, () => {});
    assert.equal(out, text, f);
  }
});

test("a moved bus stop is one changed line", () => {
  const { diff } = edit("layouts/ebl-lab.json", (world) => world.getObject("bus-stop-altmarkt").set({ position: [655, -760] }));
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0], diff.removed[0].replace("[650, -760]", "[655, -760]"));
});

test("a new street is one new line, written like the objects next to it; a removed one is gone", () => {
  const { diff } = edit("layouts/ebl-neustadt.json", (world) => {
    world.addObject({ type: "road", name: "Neue Straße", kind: "residential", points: [[0, -900], [400, -900]] });
    world.removeObject("road-plattenring");
  });
  // at the end of the objects: the line before gets a comma
  assert.deepEqual(diff.added.slice(1), ['    {"id": "road-1", "type": "road", "name": "Neue Straße", "kind": "residential", "points": [[0, -900], [400, -900]]}']);
  assert.equal(diff.added[0], `${diff.removed[1]},`);
  assert.match(diff.removed[0], /"id": "road-plattenring"/);
  assert.equal(diff.removed.length, 2);
});

test("in a file with spaces inside the braces, a new object has them too", () => {
  const { diff } = edit("layouts/container-terminal.json", (world) => world.addObject({ type: "road", kind: "street", points: [[0, 0], [100, 0]] }));
  assert.deepEqual(diff.added.slice(1), ['    { "id": "road-1", "type": "road", "kind": "street", "points": [[0, 0], [100, 0]] }']);
  assert.equal(diff.removed.length, 1);
});

test("a change to an object of a layer stays in the layer, on its line", () => {
  const { diff, merged } = edit("layouts/ebl-lab.json", (world) => {
    world.setLayers(["infrastructure"]);
    world.getObject("road-werk").set({ kind: "street" });
  });
  const layer = merged.layers.find((l) => l.id === "infrastructure");
  assert.equal(layer.objects.find((o) => o.id === "road-werk").kind, "street");
  assert.deepEqual(diff.removed.map((l) => l.includes('"id": "road-werk"')), [true]);
  assert.deepEqual(diff.added.map((l) => l.includes('"kind": "street"')), [true]);
});

test("a new value in an object written over several lines gets a line of its own", () => {
  const text = read("layouts/ebl-lab.json"), json = JSON.parse(text);
  const next = { ...json, view: { ...json.view, image_covered: "../media/ebl-lab-covered.png" } };
  const { added, removed } = lineDiff(text, stringifyLike(text, next));
  assert.deepEqual(removed, ["    }"]); // the end of view.ortho gets a comma
  assert.deepEqual(added, ["    },", '    "image_covered": "../media/ebl-lab-covered.png"']);
});

test("merging: what is the same as when it was opened keeps the file's value, ids match objects in arrays", () => {
  const original = { name: "A", grid: undefined, objects: [{ id: "a", x: 1 }, { id: "b", x: 2 }] };
  const baseline = { name: "A", grid: { size_mm: 50 }, objects: [{ id: "a", x: 1, d: 0 }, { id: "b", x: 2, d: 0 }] };
  const current = { name: "B", grid: { size_mm: 50 }, objects: [{ id: "b", x: 3, d: 0 }, { id: "c", x: 4 }] };
  assert.deepEqual(mergeChanges(original, baseline, current), { name: "B", objects: [{ id: "b", x: 3 }, { id: "c", x: 4 }] });
});
