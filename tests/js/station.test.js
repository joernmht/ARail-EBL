// The station building (objects/station.js) and the pedestrian underpass (objects/underpass.js):
// geometry, opening hours of the hall, the underpass in the road network (a footpath out of
// sight that is no junction), its stairs, and drawing.
import assert from "node:assert/strict";
import test from "node:test";

import { BuildingBase, Camera, createWorld, registry, StationBuilding, Underpass, View } from "../../web/arail/index.js";

const K = 1000 / 87; // model mm per prototype metre (H0)

function world(objects) {
  return createWorld({ objects, simulations: [], clock: { start: "10:00", profiles: false } }, { seed: 5 });
}

const nodesNear = (net, p, r = 1) => net.nodes.filter((n) => Math.hypot(n.pos[0] - p[0], n.pos[1] - p[1]) <= r);

/** Width and depth (m) of a rectangular footprint. */
const size = (fp) => [Math.hypot(fp[1][0] - fp[0][0], fp[1][1] - fp[0][1]) / K, Math.hypot(fp[2][0] - fp[1][0], fp[2][1] - fp[1][1]) / K];

test("station building: a long, shallow building with a tall glass hall, shops and an entrance to the street", () => {
  assert.equal(registry.objects.get("station-building"), StationBuilding);
  assert.ok(StationBuilding.prototype instanceof BuildingBase);
  const w = world([
    { id: "s", type: "station-building", position: [0, 0], length_m: 60, depth_m: 8 },
    { id: "plain", type: "station-building", position: [0, 600], length_m: 60, depth_m: 8, clock: false, canopy: false, floors: 1 },
  ]);
  const s = w.getObject("s"), plain = w.getObject("plain");
  // the outline is the walls; the clock pylon stands beside the right wing
  assert.deepEqual(size(plain.footprint()).map((v) => +v.toFixed(6)), [60, 8]);
  const [len, depth] = size(s.footprint());
  assert.ok(len > 60 && len < 65 && Math.abs(depth - 8) < 1e-9, `${len} × ${depth} m`);
  // the hall is taller than the wings (2 floors of 3.6 m), its roof slab on top
  assert.ok(s.heightMM() / K >= 11, `height ${s.heightMM() / K} m`);
  assert.ok(s.heightMM() > plain.heightMM() - 1e-9);
  assert.equal(s.floorsCount(), 2);
  // one entrance in the middle of the street front (−y)
  const es = s.entrances();
  assert.equal(es.length, 1);
  assert.ok(Math.abs(es[0].pos[0]) < 1e-9 && Math.abs(es[0].pos[1] + 4 * K) < 1e-9);
  assert.deepEqual(es[0].dir.map((v) => +v.toFixed(9)), [0, -1]);
  // shops and offices: people work and shop there
  assert.equal(s.use(), "shop");
  const cap = s.capacity();
  assert.ok(cap.jobs > plain.capacity().jobs && cap.visitors > 0 && cap.residents === 0);
  // canopies are drawn only while the street front faces the camera
  assert.ok(s.geometry.parts.some((p) => p.facing) && !plain.geometry.parts.some((p) => p.facing));
});

test("station building: the hall is lit from the first train to the last", () => {
  const w = world([{ id: "s", type: "station-building", position: [0, 0] }]);
  const s = w.getObject("s");
  assert.equal(s.litShare(0).shop, 0, "not by day");
  w.setTime("23:30");
  assert.ok(s.litShare(1).shop > 0.8, "late in the evening");
  w.setTime("05:15");
  assert.ok(s.litShare(1).shop > 0.8, "for the first trains");
  w.setTime("02:30");
  assert.ok(s.litShare(1).shop < 0.1, "closed at night");
});

test("underpass: a footpath out of sight that links streets on both sides of the tracks", () => {
  assert.equal(registry.objects.get("underpass"), Underpass);
  const streets = [
    { id: "front", type: "road", points: [[0, 0], [1000, 0]] },
    { id: "back", type: "road", points: [[0, 1000], [1000, 1000]] },
  ];
  const apart = world(streets).network();
  const a0 = nodesNear(apart, [0, 0])[0], b0 = nodesNear(apart, [0, 1000])[0];
  assert.equal(apart.route(a0, b0, { mode: "walk" }), null, "two separate networks");
  const w = world([...streets, { id: "u", type: "underpass", points: [[500, 0], [500, 1000]] }]);
  const net = w.network();
  const a = nodesNear(net, [0, 0])[0], b = nodesNear(net, [0, 1000])[0];
  const r = net.route(a, b, { mode: "walk" });
  assert.ok(r, "people walk through the underpass");
  assert.deepEqual([...new Set(r.edges.map((e) => e.edge.road))], ["front", "u", "back"]);
  assert.equal(net.route(a, b, { mode: "car" }), null, "no cars");
  // walkers are hidden in it, not on the streets
  const s = r.edges.find((e) => e.edge.road === "u");
  assert.equal(net.pathAt(r, (s.s0 + s.s1) / 2).hidden, true);
  assert.equal(net.pathAt(r, r.edges[0].s1 / 2).hidden, false);
  // where it meets a street there is no junction: no zebra crossing, the street lamps stay
  const t = nodesNear(net, [500, 0])[0];
  assert.equal(t.degree, 2);
  assert.ok(!net.junctions().length);
  const front = w.getObject("front");
  assert.equal(front._junctions().zebras.length, 0);
  // the road network takes it as a footpath of its width
  const info = w.getObject("u").roadInfo();
  assert.equal(info.car, false);
  assert.equal(info.hidden, true);
  assert.ok(Math.abs(info.width - 4 * K) < 1e-9);
});

test("underpass: stair housings at its ends and a stairwell on every platform it passes under", () => {
  const platform = { id: "p", type: "platform", from: [0, 500], to: [1000, 500], width_mm: 60 };
  const housings = (stairs) => world([{ id: "u", type: "underpass", points: [[500, 0], [500, 1000]], stairs }]).getObject("u").geometry.housings.length;
  assert.equal(housings(undefined), 2);
  assert.equal(housings("end"), 1);
  assert.equal(housings("start"), 1);
  assert.equal(housings("none"), 0);
  const w = world([platform, { id: "u", type: "underpass", points: [[500, 0], [500, 1000]], stairs: "end", stairs_m: 8 }]);
  const u = w.getObject("u");
  // the housing opens 8 m before the end and reaches 7 m further in
  const fp = u.geometry.housings[0].footprint, ys = fp.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...ys) - (1000 - 8 * K)) < 1e-6 && Math.abs(Math.min(...ys) - (1000 - 15 * K)) < 1e-6, ys.join());
  const wells = u._stairwells();
  assert.equal(wells.length, 1);
  for (const p of wells[0].pts) assert.ok(Math.abs(p[1] - 500) < 30 && Math.abs(p[0] - 500) < 3 * K + 1e-6, "on the platform, along it");
  // moving the platform moves the stairwell
  w.getObject("p").set({ offset_mm: 100 });
  assert.ok(Math.abs(u._stairwells()[0].pts[0][1] - 500) > 50);
});

test("station building and underpass draw without errors by day and by night", () => {
  const w = world([
    { id: "front", type: "road", points: [[-600, 0], [600, 0]] },
    { id: "s", type: "station-building", position: [0, 150] },
    { id: "u", type: "underpass", points: [[0, 0], [0, 900]], stairs: "end" },
    { id: "p", type: "platform", from: [-500, 500], to: [500, 500], width_mm: 60 },
  ]);
  for (const time of ["12:00", "22:00"]) {
    w.setTime(time);
    const camera = new Camera(1200, 800);
    let fills = 0;
    const noop = () => {};
    const ctx = new Proxy({ canvas: { width: 1200, height: 800 }, fill: () => fills++ }, {
      get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: s.length * 6 }) : k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop: noop }) : noop),
      set: (t, k, v) => ((t[k] = v), true),
    });
    // looking at the street front from above
    const H = [1, 0.1, 600, 0, -0.5, 500, 0, 0.0005, 1];
    const view = new View({ ctx, camera, H, scale: w.scale, night: time === "22:00" ? 1 : 0 });
    w.draw(view);
    assert.ok(fills > 50, `${time}: ${fills} fills`);
  }
});
