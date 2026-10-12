// Railway systems of the track sections (rail/systems.js): the values usual in a country, values
// set per track, line categories of EN 15528, where systems change between sections, the overlay
// that colours the tracks, the system change object and the border station of the lab example.
import assert from "node:assert/strict";
import test from "node:test";

import {
  COUNTRIES, SYSTEMS, SYSTEM_OVERLAYS, Track, createWorld, routeClassLimits, sectionSystems, systemChanges, systemRows, systemValue, worldSystemChanges,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

test("a section has the systems usual in its country, unless the track says otherwise", () => {
  const de = sectionSystems({});
  assert.equal(de.values.country, "DE");
  assert.equal(de.values.power, "ac15");
  assert.equal(de.values.train_control, "pzb");
  assert.equal(de.values.im, "DB InfraGO");
  assert.ok(de.usual.has("power") && !de.usual.has("country"));
  const cz = sectionSystems({ country: "CZ", etcs: "l2", max_speed_kmh: 160 });
  assert.equal(cz.values.power, "dc3");
  assert.equal(cz.values.train_control, "ls");
  assert.equal(cz.values.etcs, "l2");
  assert.ok(!cz.usual.has("etcs"), "set on the track");
  assert.equal(cz.values.max_speed_kmh, 160);
  assert.equal(sectionSystems({ gauge_mm: "1520" }).values.gauge_mm, 1520, "a number from the select");
  // every country fills every system of the catalogue
  for (const [code, c] of Object.entries(COUNTRIES)) {
    for (const s of SYSTEMS) {
      if (s.key === "country" || s.key === "max_speed_kmh") continue;
      const v = sectionSystems({ country: code }).values[s.key];
      assert.ok(v != null, `${code}: ${s.key}`);
      if (s.values) assert.ok(s.values[v], `${code}: ${s.key} = ${v} is in the catalogue`);
    }
    assert.ok(c.label && c.im);
  }
  // card rows: each system with where its value comes from
  const rows = systemRows({ country: "PL" });
  assert.ok(rows.some(([k, v]) => k === "Traction power" && v === "3 kV DC (usual in PL)"));
  assert.ok(rows.some(([k, v]) => k === "Country" && v === "Poland (PL)"));
});

test("line categories of EN 15528: the axle load and the metre load", () => {
  assert.deepEqual(routeClassLimits("D4"), { axle_t: 22.5, metre_t: 8 });
  assert.deepEqual(routeClassLimits("A"), { axle_t: 16, metre_t: 5 });
  assert.deepEqual(routeClassLimits("E5"), { axle_t: 25, metre_t: 8.8 });
  assert.deepEqual(routeClassLimits("C2"), { axle_t: 20, metre_t: 6.4 });
  assert.deepEqual(routeClassLimits("X9"), { axle_t: null, metre_t: null });
});

test("tracks: the systems are parameters (empty: as usual), shown on the card; free values get a colour of their own", () => {
  for (const s of SYSTEMS) assert.ok(Track.params.some((p) => p.key === s.key), `track parameter ${s.key}`);
  for (const [key] of SYSTEM_OVERLAYS) assert.ok(SYSTEMS.some((s) => s.key === key), key);
  const a = systemValue("im", "DB InfraGO"), b = systemValue("im", "DB InfraGO"), c = systemValue("im", "Správa železnic");
  assert.equal(a.colour, b.colour);
  assert.ok(a.colour && c.colour);
  assert.equal(systemValue("power", "dc3").short, "3 kV DC");
  const world = createWorld({ objects: [{ id: "t1", type: "track", points: [[0, 0], [500, 0]], country: "CZ", track_id: "7" }] });
  const card = world.getObject("t1").card();
  const systems = card.sections.find((s) => s.title === "Systems");
  assert.ok(systems.lines.includes("Traction power: 3 kV DC (usual in CZ)"));
  assert.deepEqual(world.getObject("t1").toJSON().country, "CZ");
  assert.equal(world.getObject("t1").toJSON().power, undefined, "empty values are not written");
});

test("where neighbouring sections meet with different systems", () => {
  const tracks = [
    { id: "a", spec: { country: "DE" }, geometry: { points: [[0, 0], [500, 0]] } },
    { id: "b", spec: { country: "CZ" }, geometry: { points: [[505, 0], [1000, 0]] } },
    { id: "c", spec: { country: "CZ" }, geometry: { points: [[1000, 0], [1500, 0]] } },
    { id: "d", spec: { country: "DE" }, geometry: { points: [[0, 200], [500, 200]] } },
  ];
  const all = systemChanges(tracks);
  assert.equal(all.length, 1, "only between a and b; b and c are the same; d meets nothing");
  assert.deepEqual([all[0].a, all[0].b].sort(), ["a", "b"]);
  const keys = all[0].changes.map((c) => c.key);
  for (const k of ["power", "train_control", "signalling", "country", "im"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("gauge_mm"));
  const power = systemChanges(tracks, "power");
  assert.deepEqual(power[0].changes, [{ key: "power", from: power[0].a === "a" ? "ac15" : "dc3", to: power[0].a === "a" ? "dc3" : "ac15" }]);
  assert.equal(systemChanges(tracks, "gauge_mm").length, 0);
});

test("View → Track systems colours every track, also over the camera image, and marks the changes", () => {
  const world = createWorld({
    objects: [
      { id: "t1", type: "track", points: [[0, 0], [500, 0]] },
      { id: "t2", type: "track", points: [[500, 0], [1000, 0]], country: "CZ" },
    ],
  });
  const ribbons = [], labels = [], polygons = [];
  const view = {
    virtual: false, m: (x) => (x * 1000) / 87, showsReal: () => true,
    ribbon: (pts, w, style) => ribbons.push(style), line: () => {}, label: (at, text) => labels.push(text), polygon: (pts, style) => polygons.push(style),
  };
  for (const o of world.objects) o.draw(view);
  assert.equal(ribbons.length, 0, "off by default");
  world.settings.trackSystems = "power";
  for (const o of world.objects) o.draw(view);
  assert.equal(ribbons.length, 2);
  assert.notEqual(ribbons[0].fill, ribbons[1].fill, "two colours");
  assert.ok(labels.includes("15 kV 16.7 Hz") && labels.includes("3 kV DC"));
  assert.ok(labels.includes("15 kV 16.7 Hz | 3 kV DC") || labels.includes("3 kV DC | 15 kV 16.7 Hz"), "the change");
  assert.equal(polygons.length, 1, "one mark for one change");
  assert.equal(worldSystemChanges(world, "power").length, 1);
  assert.equal(worldSystemChanges(world, "gauge_mm").length, 0);
});

test("a system change object: what happens there, and the systems of the tracks beside it", () => {
  const world = createWorld({
    objects: [
      { id: "t1", type: "track", points: [[0, 0], [500, 0]], track_id: "1" },
      { id: "t2", type: "track", points: [[500, 0], [1000, 0]], track_id: "2", country: "CZ" },
      { id: "sc", type: "system-change", position: [500, 30], kind: "power" },
    ],
  });
  const card = world.getObject("sc").card();
  assert.equal(card.title, "System separation section");
  assert.match(card.text, /pantograph/);
  assert.deepEqual(card.related.sort(), ["t1", "t2"]);
  assert.equal(card.sections.length, 2);
  assert.ok(world.getObject("sc").pickHeight() > 0);
});

test("the lab example's module Border station: track G3 is Czech, G1 and G2 German", () => {
  const json = readJSON("web/layouts/ebl-lab.json");
  const layer = json.layers.find((l) => l.id === "border");
  assert.ok(layer, "the module");
  for (const l of json.layers) l.enabled = l.id === "border";
  const world = createWorld(json);
  const v = (id) => sectionSystems(world.getObject(id).spec).values;
  assert.equal(v("track-g3").country, "CZ");
  assert.equal(v("track-g3").power, "dc3");
  assert.equal(v("track-g1").power, "ac15");
  assert.ok(world.objects.some((o) => o.type === "system-change"));
  // off: the tracks keep no system of the module
  const plain = createWorld(readJSON("web/layouts/ebl-lab.json"));
  assert.equal(plain.getObject("track-g3").spec.country, "DE");
  assert.equal(plain.getObject("track-g3").toJSON().country, undefined);
});
