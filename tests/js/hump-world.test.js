// The hump yard on the table (web/arail/hump/object.js, issue #237): Bf Neustadt's module Hump yard (its table
// module, the push track meeting the table), the plan of the yard (a fan), train after train in the world
// (deterministic, a change of figures makes it anew, moving it keeps it), drawing in the flyover (ballast,
// wagons, retarders braking, only finite coordinates), its card and its German texts.
import assert from "node:assert/strict";
import test from "node:test";

import { CD, Camera, FlyCamera, HumpYardObject, View, createWorld, registry, standardYard, toRad, validateLayout } from "../../web/arail/index.js";
import { withLayers } from "../../web/arail/core/layers.js";
import { DE } from "../../web/arail/i18n/de.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} ± ${tol}`);
const hex = (c) => {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  return m ? m[1].split(",").slice(0, 3).map(Number) : [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16));
};
const same = (a, b) => hex(a).every((x, i) => Math.abs(x - hex(b)[i]) < 1.5);

/** A canvas context that records fills and strokes and insists on finite coordinates. */
function fakeContext() {
  const fills = [], strokes = [];
  let path = [];
  const noop = () => {};
  const point = (x, y) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    path.push([x, y]);
  };
  const ctx = {
    canvas: { width: W, height: H }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    save: noop, restore: noop, setTransform: noop, transform: noop, fillRect: noop, closePath: noop, setLineDash: noop, clip: noop, drawImage: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, fillText: noop, strokeText: noop, rect: noop,
    beginPath() {
      path = [];
    },
    moveTo: point,
    lineTo: point,
    fill() {
      fills.push({ color: this.fillStyle, path: path.slice() });
    },
    stroke() {
      strokes.push({ color: this.strokeStyle, path: path.slice() });
    },
    measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return { ctx, fills, strokes };
}

/** A view of the flyover camera, as the app builds it. */
function flyView(cam, { night = 0 } = {}) {
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  const { ctx, fills, strokes } = fakeContext();
  return { view: new View({ ctx, camera, H: hom, pose, scale: 87, night, virtual: true }), fills, strokes };
}

/** A layout with one hump yard at the origin, its cuts rolling towards −x. */
const lone = (extra = {}) => createWorld({ scale: 87, objects: [{ id: "hump", type: "hump-yard", position: [0, 0], rotation_deg: 180, ...extra }] }, { seed: 3 });
const run = (world, seconds, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) world.step(dt);
};

test("Bf Neustadt's module Hump yard: on its table module, the push track meeting the table at its west end", () => {
  const json = readJSON("web/layouts/ebl-neustadt.json");
  assert.deepEqual(validateLayout(json, registry), [], "valid with every module on");
  const layer = json.layers.find((l) => l.id === "hump");
  assert.ok(layer && layer.enabled === false, "a module, off by default");
  const world = createWorld(withLayers(json, ["hump"]), { seed: 7 });
  const hump = world.getObject("hump-yard"), table = world.getObject("table-hump"), lab = world.getObject("table-lab");
  assert.ok(hump instanceof HumpYardObject);
  assert.deepEqual(world.problemsOf(hump), [], "it stands on its table module");
  // the yard lies on its module
  const [a, , c] = hump.footprint(), t = table.footprint();
  const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
  assert.ok(a[0] >= Math.min(...xs) && c[0] <= Math.max(...xs) && a[1] >= Math.min(...ys) && c[1] <= Math.max(...ys), "within its module");
  // the push track starts at the real table's west edge, at its level: the module lies 45 mm lower
  const yard = hump.yard, g = hump.geometry, start = yard.planAt([yard.root], 0);
  const [x0] = g.at(start.x, start.y), labWest = Math.min(...lab.footprint().map((p) => p[0]));
  near(x0, labWest, 40, "the push track begins at the table's edge");
  near(table.spec.level_mm + g.z(yard.height([yard.root], 0)), 0, 6, "and at its level");
  assert.ok(g.z(yard.height([yard.root], yard.crest_m)) > g.z(yard.height([yard.root], 0)), "the crest above it");
  // off by default: Bf Neustadt without the module has no hump
  assert.equal(createWorld(json, { seed: 7 }).getObject("hump-yard"), null);
});

test("the plan of the yard: a fan of tracks spacing_m apart, in the order of the tree, without crossings", () => {
  const yard = standardYard({ tracks: 6, track_m: 120 });
  const routes = yard.tracks.map((t) => yard.routeTo(t.name));
  const ends = routes.map((r, i) => yard.planAt(r, yard.tracks[i].s1 - 1).y);
  for (let i = 1; i < ends.length; i++) near(ends[i - 1] - ends[i], yard.spacing_m, 1e-9, `tracks ${i} and ${i + 1}`);
  near(yard.planAt([yard.root], yard.crest_m).y, 0, 1e-12, "the hump on its axis");
  // along the way, the tracks keep their order (never crossing) and run straight once they are parallel
  for (let s = yard.crest_m; s < Math.min(...yard.tracks.map((t) => t.s1)); s += 2) {
    const ys = routes.map((r) => yard.planAt(r, s).y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] >= ys[i] - 1e-9, `order at ${s}`);
  }
  const t1 = yard.tracks[0], p = yard.planAt(routes[0], t1.s0 + 50);
  near(p.heading, 0, 1e-12, "straight in the track");
  assert.equal(yard.planAt(routes[0], 10).y, 0, "on the axis before the first switch");
  // continuous where a segment ends and the next one begins
  for (const r of routes) {
    for (let i = 1; i < r.length; i++) {
      const s = yard.segment(r[i]).s0;
      near(yard.planAt(r, s - 1e-6).y, yard.planAt(r, s + 1e-6).y, 1e-3, `at the start of ${r[i]}`);
    }
  }
});

test("it humps train after train in the world: deterministic, made anew when its figures change, kept when moved", () => {
  const a = lone(), b = lone(), hump = a.getObject("hump");
  run(a, 900);
  run(b, 900);
  const ra = hump.sim.results(), rb = b.getObject("hump").sim.results();
  assert.ok(ra.trains >= 2 && ra.cuts > 20, `${ra.trains} trains, ${ra.cuts} cuts`);
  assert.ok(hump.sim.departures.length >= 1, "full tracks leave as trains");
  assert.equal(ra.derailed, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ra)), JSON.parse(JSON.stringify(rb)), "the same seed, the same run");
  near(hump.sim.t, a.time, 0.2, "the simulation keeps up with the world's time");
  // another world's seed: another run
  const other = createWorld({ scale: 87, objects: [{ id: "hump", type: "hump-yard", position: [0, 0], rotation_deg: 180 }] }, { seed: 4 });
  run(other, 300);
  assert.notDeepEqual(other.getObject("hump").sim.cuts.map((c) => c.body.w), hump.sim.cuts.slice(0, other.getObject("hump").sim.cuts.length).map((c) => c.body.w));
  // moving it keeps its simulation; another number of tracks makes it anew
  const sim = hump.sim;
  hump.translate(100, 50);
  assert.equal(hump.sim, sim, "moved: the same run");
  hump.set({ tracks: 4 });
  assert.notEqual(hump.sim, sim, "other figures: a new run");
  assert.equal(hump.yard.tracks.length, 4);
  // its card
  run(a, 30);
  const rows = Object.fromEntries(hump.card().rows);
  assert.equal(rows["Classification tracks"], "4 × 120 m");
  assert.ok("Trains humped" in rows && "Cuts per hour" in rows && "Trains pulled out" in rows);
});

test("drawn in the flyover: formation, ballast and rails, wagons, retarders orange while they brake", () => {
  const world = lone();
  const hump = world.getObject("hump");
  const cam = new FlyCamera({ target: [-1800, 0], distance: 2600, yaw: toRad(100), pitch: toRad(35) });
  // before the first step: the yard without wagons
  const empty = flyView(cam);
  world.draw(empty.view);
  assert.ok(empty.fills.length > 50, `${empty.fills.length} fills`);
  // run until a cut is braked in a retarder, then draw: wagons in their red, a retarder in orange
  let braking = false;
  for (let i = 0; i < 6000 && !braking; i++) {
    world.step(0.1);
    braking = hump.yard.retarders.some((r) => r.hold_mps == null && hump.sim.retarderState(r.id).level > 0.05);
  }
  assert.ok(braking, "a retarder braked");
  const { view, fills, strokes } = flyView(cam);
  world.draw(view);
  assert.ok(fills.length > empty.fills.length, `wagons drawn: ${fills.length} fills against ${empty.fills.length}`);
  assert.ok(strokes.some((s) => same(s.color, CD.orange)), "a retarder in orange");
  // at night as well, without anything that is not finite (the context checks every point)
  const dark = flyView(cam, { night: 1 });
  world.draw(dark.view);
  assert.ok(dark.fills.length > 50);
});

test("the hump yard's texts in German", () => {
  for (const key of [HumpYardObject.label, HumpYardObject.category, HumpYardObject.description, ...HumpYardObject.params.map((p) => p.label), "Speed-holding units", "Target braking", "Summer", "Trains humped"]) {
    assert.ok(DE[key], `no German for "${key}"`);
  }
  assert.equal(DE["Hump yard"], "Ablaufberg");
});
