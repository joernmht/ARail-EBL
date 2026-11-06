// The photo tour of the hybrid container train (web/lab-map/data.json, web/app/tour.js): its own
// photo is on the photo map, and the photos with model wagons are those of the loading task.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PhotoTour, perspectiveOf } from "../../web/app/tour.js";

const DATA = JSON.parse(readFileSync(new URL("../../web/lab-map/data.json", import.meta.url), "utf8"));
const LAYOUT = JSON.parse(readFileSync(new URL("../../web/layouts/ebl-container-train.json", import.meta.url), "utf8"));
const photo = (id) => DATA.photos.find((p) => p.id === id);

test("the hybrid container train's own photo is a photo of its digital layer on the photo map", () => {
  const own = photo("terminal-wagons");
  assert.ok(own, "the frame of the tagged train's clip");
  // the same file as the layout's own photo, as each side shows it (the tour a covered version where the photo
  // has one, the layout its image_covered): each address relative to its own file; one covered alone would
  // make the tour miss the photo the scenario opens with
  const map = new URL(own.covered || own.image, "https://x/web/lab-map/data.json").href;
  const layout = new URL(LAYOUT.view.image_covered || LAYOUT.view.image, "https://x/web/layouts/ebl-container-train.json").href;
  assert.equal(map, layout);
  assert.equal(!!own.covered, !!LAYOUT.view.image_covered, "covered on both sides or on neither");
  assert.equal(own.layer, "container");
  assert.equal(DATA.layers[own.layer].layout, "../layouts/ebl-container-train.json");
  assert.equal(DATA.layers[own.layer].photo, "terminal-wagons", "the layer's own photo, first from its side");
  assert.equal(own.group, "S12");
});

test("model wagons: only the layout's, and only in photos that show them", () => {
  const numbers = new Set(LAYOUT.simulations.find((s) => s.type === "terminal").rolling_stock.map((r) => r.number));
  const withWagons = DATA.photos.filter((p) => p.wagons);
  assert.deepEqual(withWagons.map((p) => p.id).sort(), ["141012", "141017", "terminal-wagons"]);
  for (const p of withWagons) {
    assert.ok(p.wagons.length > 0, p.id);
    for (const n of p.wagons) assert.ok(numbers.has(n), `${p.id}: W${n} is one of the layout's model wagons`);
  }
  // a photo the layout cannot track (none of its markers in the picture) has no layer
  assert.equal(photo("132323").layer, undefined);
});

test("the loading task's tour: the photos of its layer with model wagons, its own photo from the front", () => {
  const all = new PhotoTour(DATA);
  const task = new PhotoTour(DATA, { only: (p) => p.layer === "container" && p.wagons?.length > 0 });
  assert.deepEqual(task.parts.map((p) => p.id), ["S12"]);
  const views = Object.fromEntries(Object.entries(task.parts[0].views).map(([v, p]) => [v, p.id]));
  assert.deepEqual(views, { "front-left": "141012", front: "terminal-wagons" });
  // its perspectives are those of the whole tour's part
  const s12 = all.parts.find((p) => p.id === "S12");
  assert.equal(perspectiveOf(photo("terminal-wagons").heading - s12.front), "front");
  // the whole tour too: the layer's own photo first from its side, the others as they were
  assert.equal(s12.views.front.id, "terminal-wagons");
  assert.equal(s12.views["front-left"].id, "141012");
});

test("a layer's own photo comes first from its side, before a closer match of the same layer", () => {
  const photo = (id, heading, x, extra = {}) => ({ id, group: "P", x, y: 1000, heading, markers: 6, layer: "a", ...extra });
  const data = {
    layers: { a: { layout: "a.json", label: "A" } },
    groups: { P: { name: "Part" }, Q: { name: "Other" } },
    photos: [photo("near", 90, 3000), photo("own", 105, 3600, { markers: 2 }), { id: "q", group: "Q", x: 3000, y: -3000, heading: -90, markers: 4 }],
  };
  assert.equal(new PhotoTour(data).parts.find((p) => p.id === "P").views.front.id, "near");
  data.layers.a.photo = "own";
  assert.equal(new PhotoTour(data).parts.find((p) => p.id === "P").views.front.id, "own");
});
