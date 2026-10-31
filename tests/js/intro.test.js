// The introduction of a layout (web/arail/core/intro.js): its scenes made from the layout as it is,
// what is real in the lab (real tables, tracks and platforms; LayoutObject#real) and what the app
// adds; and the age of the infrastructure's assets years ahead (world setting ageYears, the
// maintenance story), which the app's Sandbox shows.
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { boundsOf, createWorld, introScenes, layoutPlugins, loadPlugins, sceneSeconds, SCENE_SECONDS, storyOf, withLayers } from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");
await loadPlugins(layoutPlugins(NEUSTADT), pathToFileURL(join(ROOT, "web/layouts/ebl-neustadt.json")).href);

function world(json) {
  const w = createWorld({});
  w.load(json);
  return w;
}

test("the scenes of Bf Neustadt over its photo: the photo alone for what is real, then what the app adds, then each kind in the flyover", () => {
  const w = world(NEUSTADT);
  const scenes = introScenes(w, { photo: true });
  // the crane and the yard are in the layout itself (the module Terminal adds what moves them)
  assert.deepEqual(scenes.map((s) => s.id), ["welcome", "real", "virtual", "station", "tables", "town", "streets", "people", "terminal", "modules", "end"]);
  const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));
  // the photo first: with what the app draws, without it, with it again
  assert.deepEqual(["welcome", "real", "virtual", "end"].map((id) => [byId[id].view, byId[id].overlay]), [["camera", 1], ["camera", 0], ["camera", 1], ["camera", 1]]);
  for (const id of ["station", "tables", "town", "streets", "people", "modules"]) assert.equal(byId[id].view, "flyover", id);
  // what is real: real tables, tracks and platforms only, outlined
  const real = byId.real.focus.map((id) => w.getObject(id));
  assert.ok(real.length > 5 && real.every((o) => o.real), "only real things");
  assert.ok(real.some((o) => o.type === "track") && real.some((o) => o.type === "platform") && real.some((o) => o.type === "tabletop"));
  assert.equal(byId.real.kind, "real");
  assert.deepEqual(Object.fromEntries(byId.real.facts).Markers, w.map.ids().length);
  // what the app adds is virtual; the town are its buildings
  assert.equal(byId.virtual.kind, "virtual");
  const town = byId.town.focus.map((id) => w.getObject(id));
  assert.ok(town.length > 50 && town.every((o) => o.constructor.category === "Buildings" && !o.real));
  assert.equal(Object.fromEntries(byId.town.facts).Buildings, town.length);
  // the table modules that are not in the lab, and the lines by their numbers
  assert.ok(byId.tables.focus.map((id) => w.getObject(id)).every((o) => o.type === "tabletop" && !o.physical));
  assert.equal(Object.fromEntries(byId.streets.facts)["Bus lines"], "7, 261, 262");
  // people: close to a platform, where passengers wait
  assert.equal(w.getObject(byId.people.focus[0]).type, "platform");
  const [x0, y0, x1, y1] = byId.people.bounds;
  assert.ok(x1 - x0 < 1000 && y1 - y0 < 1000, "close enough to see people");
  // the modules, on or off
  assert.deepEqual(byId.modules.facts, w.layers().map((l) => [l.name, l.enabled ? "on" : "off"]));
  // a place for each scene in the flyover (or the whole layout), and a time while it plays
  for (const s of scenes) {
    assert.ok(s.text.length && s.text.every((t) => typeof t === "string" && t.length > 10 && !/\d/.test(t)), `${s.id}: sentences without numbers`);
    assert.ok(s.seconds >= SCENE_SECONDS.min && s.seconds <= SCENE_SECONDS.max, s.id);
    if (s.bounds) assert.ok(s.bounds[2] > s.bounds[0] && s.bounds[3] > s.bounds[1], s.id);
  }
  assert.deepEqual(introScenes(w, { photo: true }), scenes, "the same layout, the same film");
});

test("without a photo the film stays in the flyover; modules switched on add their scenes", () => {
  const w = world(withLayers(NEUSTADT, ["infrastructure", "terminal"]));
  const scenes = introScenes(w);
  assert.ok(!scenes.some((s) => s.id === "virtual"), "no photo to draw over");
  assert.ok(scenes.every((s) => s.view === "flyover"));
  const ids = scenes.map((s) => s.id);
  assert.ok(ids.includes("infrastructure") && ids.includes("terminal"), ids.join(", "));
  const signals = scenes.find((s) => s.id === "infrastructure");
  assert.ok(signals.focus.map((id) => w.getObject(id)).some((o) => o.type === "signal"));
  assert.equal(Object.fromEntries(signals.facts).Signal, w.objects.filter((o) => o.type === "signal").length);
  assert.ok(scenes.find((s) => s.id === "terminal").focus.map((id) => w.getObject(id)).some((o) => o.type === "gantry-crane"));
});

test("the hybrid container train: its tagged model wagons have a scene; a layout without anything still has a beginning and an end", () => {
  const w = world(readJSON("web/layouts/ebl-container-train.json"));
  const ids = introScenes(w, { photo: true }).map((s) => s.id);
  assert.ok(ids.includes("wagons") && ids.includes("terminal"), ids.join(", "));
  assert.deepEqual(introScenes(world({ format: "arail-layout/1", name: "Empty" })).map((s) => [s.id, s.title]), [["welcome", "Empty"], ["end", "Your turn"]]);
});

test("real things of the lab: real tables, tracks and platforms, assets with real; the rest is virtual", () => {
  const w = world({
    format: "arail-layout/1", name: "Real and virtual",
    objects: [
      { id: "table", type: "tabletop", kind: "physical", position: [0, 0], width_mm: 800, depth_mm: 500 },
      { id: "module", type: "tabletop", position: [0, 600], width_mm: 400, depth_mm: 300 },
      { id: "track", type: "track", points: [[0, 0], [500, 0]] },
      { id: "on-module", type: "track", virtual: true, points: [[0, 600], [300, 600]] },
      { id: "platform", type: "platform", from: [0, 40], to: [400, 40] },
      { id: "house", type: "building", position: [100, 200] },
    ],
  });
  const real = Object.fromEntries(w.objects.map((o) => [o.id, o.real]));
  assert.deepEqual(real, { table: true, module: false, track: true, "on-module": false, platform: true, house: false });
  const b = boundsOf([w.getObject("track")]);
  assert.deepEqual([b[0], b[2]], [0, 500]);
  assert.equal(boundsOf([]), null);
  assert.equal(sceneSeconds("one two three"), SCENE_SECONDS.min);
  assert.equal(sceneSeconds(Array(200).fill("word").join(" ")), SCENE_SECONDS.max);
});

test("the infrastructure ages years ahead (setting ageYears): the maintenance story's year and the assets' condition", () => {
  const w = world(withLayers(NEUSTADT, ["infrastructure"]));
  const story = storyOf(w, "maintenance-story");
  const signal = w.objects.find((o) => o.type === "signal" && +o.spec.built);
  const now = story.ageGrade(signal);
  assert.equal(story.year, 2026);
  w.settings.ageYears = 30;
  assert.equal(story.year, 2056);
  assert.ok(story.ageGrade(signal) > now, "older is worse");
  const mean = () => {
    const items = story.states().flatMap((g) => g.items);
    return items.reduce((s, it) => s + it.score, 0) / items.length;
  };
  const aged = mean();
  w.settings.ageYears = 0;
  assert.ok(mean() > aged, "the Overview's condition follows");
});
