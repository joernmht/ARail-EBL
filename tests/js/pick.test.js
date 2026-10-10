// Pointing at things (core/pick.js): what is under a pixel of the stage, and its info card. People,
// vehicles and objects of the lab example are found where they are seen, small objects before large
// ones, tall ones also on their walls; every card has a title; the simulations add what they know.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, FlyCamera, View, createWorld, findPickable, movingPickables, toRad } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;

/** A View of a flyover camera (no canvas needed for picking). */
function flyView(cam) {
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  return new View({ ctx: null, camera, H: hom, pose, scale: 87, virtual: true });
}

/** The lab example at 07:30, run for a while, seen from above the town and the station. */
function lab({ layers = [] } = {}) {
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers || []) l.enabled = layers.includes(l.id);
  const world = createWorld(json);
  world.setTime("07:30");
  for (let i = 0; i < 300; i++) world.step(0.1);
  const view = flyView(new FlyCamera({ target: [700, -900], distance: 2600, yaw: Math.PI / 2, pitch: toRad(50) }));
  return { world, view };
}

/** The image point of the middle of a pickable's box. */
function middle(view, p) {
  const o = p.outline;
  const x = o.reduce((s, q) => s + q[0], 0) / o.length, y = o.reduce((s, q) => s + q[1], 0) / o.length;
  return view.project(x, y, ((p.z0 ?? 0) + (p.z1 ?? p.z0 ?? 0)) / 2);
}

const inImage = (q) => q && q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H;

test("people, trains, buses and cars of the lab example can be pointed at where they are seen", () => {
  const { world, view } = lab();
  const all = movingPickables(world, view);
  const kinds = new Set(all.map((p) => p.kind));
  for (const k of ["person", "train", "bus", "car"]) assert.ok(kinds.has(k), `no ${k} to point at`);
  const keys = new Set();
  for (const p of all) {
    assert.ok(!keys.has(p.key), `key ${p.key} twice`);
    keys.add(p.key);
    assert.ok(p.label && p.owner && p.outline.length >= 3, `${p.key}: label, owner and outline`);
  }
  // each one in view is found at its middle, or something in front of it
  let found = 0, checked = 0;
  for (const p of all) {
    const q = middle(view, p);
    if (!inImage(q)) continue;
    checked++;
    const hit = world.pick(view, q);
    assert.ok(hit, `${p.key}: nothing at its middle`);
    if (hit.key === p.key) found++;
    else assert.notEqual(hit.kind, "object", `${p.key}: an object (${hit.key}) instead of it`);
  }
  assert.ok(checked > 50 && found / checked > 0.6, `found ${found} of ${checked} at their middle`);
});

test("objects: small ones before large ones, buildings also on their walls, table modules only at their edges", () => {
  const { world, view } = lab();
  world.simulations.forEach((s) => (s.enabled = false)); // only the objects
  for (const v of world.services.vehicles()) v.dock = null;
  world.services.docks.clear();
  world.transit.buses = [];
  // a building is found on its roof, not only on the ground behind it
  const house = world.getObject("plattenbau-1");
  const c = house.anchorPoint();
  const roof = view.project(c[0], c[1], house.pickHeight());
  assert.equal(world.pick(view, roof)?.key, "object:plattenbau-1");
  assert.ok(house.pickHeight() > 0);
  // a tree on a landscape area: the tree
  const tree = world.getObject("tree-hof-1"), t = tree.anchorPoint();
  assert.equal(world.pick(view, view.project(t[0], t[1], 0))?.key, "object:tree-hof-1");
  // the middle of a table module is not the table (a drag there pans the flyover), its edge is
  const table = world.getObject("table-1"), fp = table.footprint();
  const mid = table.anchorPoint();
  assert.notEqual(world.pick(view, view.project(mid[0], mid[1], 0))?.key, "object:table-1");
  const edge = [(fp[0][0] + fp[1][0]) / 2, (fp[0][1] + fp[1][1]) / 2];
  const near = world.objects.filter((o) => o !== table && o.geometry && o.contains(edge, 30));
  if (!near.length) assert.equal(world.pick(view, view.project(edge[0], edge[1], 0))?.key, "object:table-1");
  // nothing in the sky above the layout (a view along the table)
  const low = flyView(new FlyCamera({ target: [700, -900], distance: 2600, yaw: Math.PI / 2, pitch: toRad(10) }));
  assert.equal(world.pick(low, [W / 2, 2])?.key ?? null, null);
});

test("cards: every object type of the examples and every pickable has a title; the simulations add what they know", () => {
  const { world, view } = lab({ layers: ["operations", "infrastructure", "journeys"] });
  for (const o of world.objects) {
    if (!o.geometry) continue;
    const card = world.card(findPickable(world, view, `object:${o.id}`));
    assert.ok(card.title, `${o.id}: a title`);
    assert.ok(Array.isArray(card.rows) && Array.isArray(card.sections) && Array.isArray(card.related), `${o.id}: the fields of a card`);
    for (const [k, v] of card.rows) assert.ok(k && v != null && String(v) !== "undefined" && !String(v).includes("NaN"), `${o.id}: row ${k} = ${v}`);
  }
  for (const p of movingPickables(world, view)) {
    const card = world.card(p);
    assert.ok(card.title, `${p.key}: a title`);
    for (const [k, v] of card.rows) assert.ok(k && v != null && String(v) !== "undefined" && !String(v).includes("NaN"), `${p.key}: row ${k} = ${v}`);
  }
  // a stop: the people waiting and the next departures (passenger simulation)
  const stop = world.card(findPickable(world, view, "object:bus-stop-altmarkt"));
  assert.ok(stop.rows.some(([k]) => k === "Waiting"), "people waiting at the stop");
  assert.ok(stop.rows.some(([k, v]) => k === "Bus lines" && /62/.test(v)), "its bus lines");
  assert.ok(stop.sections.some((s) => s.title === "Next" && s.lines.length), "the next buses");
  // a building: the people it holds (the journeys switch the town off: a typical occupancy)
  const house = world.card(findPickable(world, view, "object:plattenbau-1"));
  assert.ok(house.rows.some(([k, v]) => k === "Holds" && /residents/.test(v)));
  assert.ok(house.rows.some(([k, v]) => k === "Occupancy" && /typical/.test(v)));
  // an asset of the infrastructure: its condition as it is known
  const asset = world.objects.find((o) => o.type === "signal" || o.type === "switch");
  if (asset) assert.ok(world.card(findPickable(world, view, `object:${asset.id}`)).rows.some(([k]) => k === "Condition"), `${asset.id}: its condition`);
  // the depot of the rail operations: its workshop
  const depot = world.objects.find((o) => o.type === "depot");
  assert.ok(world.card(findPickable(world, view, `object:${depot.id}`)).sections.some((s) => s.title === "Depot"));
});

test("a resident waiting at a stop is described by the town: who it is, and what it waits for", () => {
  const { world, view } = lab();
  const agents = () => movingPickables(world, view).some((p) => p.key.startsWith("passenger:") && p.ref.person.agent);
  for (let i = 0; i < 3000 && !agents(); i += 50) for (let k = 0; k < 50; k++) world.step(0.1);
  let checked = 0;
  for (const p of movingPickables(world, view)) {
    if (!p.key.startsWith("passenger:") || !p.ref.person.agent) continue;
    const card = world.card(p);
    assert.equal(card.title, p.ref.person.agent.name);
    assert.match(card.subtitle, /^Town · /);
    assert.ok(card.rows.some(([k]) => k === "Lives"), "where it lives");
    assert.ok(card.rows.some(([k]) => k === "Mood"), "its mood");
    checked++;
  }
  assert.ok(checked > 0, "residents at the stops");
  // with the town, a building knows how many are inside now
  const house = world.card(findPickable(world, view, "object:plattenbau-1"));
  assert.ok(house.rows.some(([k, v]) => k === "Inside now" && /\d+ (person|people)/.test(v)));
  assert.ok(!house.rows.some(([, v]) => /typical/.test(v)));
});

test("a pickable keeps its key while it moves, so a card follows it", () => {
  const { world, view } = lab();
  const walker = movingPickables(world, view).find((p) => p.key.startsWith("resident:"));
  assert.ok(walker, "a resident walking");
  const before = walker.outline[0].slice();
  world.step(0.1);
  const now = findPickable(world, view, walker.key);
  assert.ok(now, "still there");
  assert.notDeepEqual(now.outline[0], before, "it moved on");
  assert.equal(findPickable(world, view, "resident:nobody"), null);
  assert.equal(findPickable(world, view, "object:platform-1")?.ref, world.getObject("platform-1"));
});

test("the container terminal: containers and wagons can be pointed at, with where they are", () => {
  const world = createWorld(readJSON("web/layouts/container-terminal.json"));
  for (let i = 0; i < 50; i++) world.step(0.1);
  const view = flyView(new FlyCamera({ target: [0, 0], distance: 2200, yaw: Math.PI / 2, pitch: toRad(55) }));
  const all = movingPickables(world, view);
  const box = all.find((p) => p.kind === "container");
  assert.ok(box, "a container");
  const card = world.card(box);
  assert.equal(card.title, box.label);
  assert.ok(card.rows.some(([k]) => k === "Size") && card.rows.some(([k]) => k === "On"));
  const wagon = all.find((p) => p.key.startsWith("carrier:"));
  if (wagon) assert.ok(world.card(wagon).rows.some(([k]) => k === "Load"));
});
