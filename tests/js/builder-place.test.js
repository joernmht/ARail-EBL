// Placing in the builder (web/builder/place.js) and its undo (web/builder/history.js): street points
// join the streets they touch, a bus stop goes on the side of its street it was put on, a building
// turns its front to the street, and undo and redo walk through the changes.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld } from "../../web/arail/index.js";
import { History } from "../../web/builder/history.js";
import { facesStreet, nearestStreetAt, placeSpec, pointsOf, snapStreetPoint } from "../../web/builder/place.js";

function town() {
  return createWorld({
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "main", type: "road", name: "Main Street", points: [[-2000, 0], [0, 0], [2000, 0]] },
      { id: "side", type: "road", name: "Side Street", kind: "residential", points: [[500, 0], [500, 1500]] },
    ],
  });
}

test("a street point snaps to an end or corner nearby, onto a street it is on, in line with the point before, else to the grid", () => {
  const world = town();
  assert.deepEqual(snapStreetPoint(world, [508, 1492], { tolMM: 20, grid: 50 }), { point: [500, 1500], snap: "end", road: "side" });
  assert.deepEqual(snapStreetPoint(world, [10, 6], { tolMM: 20, grid: 50 }), { point: [0, 0], snap: "corner", road: "main" });
  assert.deepEqual(snapStreetPoint(world, [1234, 30], { tolMM: 20, grid: 50 }), { point: [1234, 0], snap: "street", road: "main" }); // within half the width (40 mm)
  assert.deepEqual(snapStreetPoint(world, [1234, 600], { tolMM: 20, grid: 50, own: [[1000, 590]] }), { point: [1250, 590], snap: "align", road: null });
  assert.deepEqual(snapStreetPoint(world, [1234, 700], { tolMM: 20, grid: 50 }), { point: [1250, 700], snap: "grid", road: null });
  assert.deepEqual(snapStreetPoint(world, [1234, 700], { tolMM: 20, grid: null }), { point: [1234, 700], snap: null, road: null });
  // Shift: the direction from the point before in steps of 15°
  assert.deepEqual(snapStreetPoint(world, [1000, 1080], { tolMM: 20, grid: 50, angleFrom: [0, 1000] }), { point: [1003.2, 1000], snap: "angle", road: null }); // 4.6° → 0°
  const s = snapStreetPoint(world, [1000, 1500], { tolMM: 20, grid: 50, angleFrom: [0, 1000] }); // 26.6° → 30°
  assert.ok(Math.abs((Math.atan2(s.point[1] - 1000, s.point[0]) * 180) / Math.PI - 30) < 0.01);
  // a street being moved does not snap to itself
  assert.notEqual(snapStreetPoint(world, [505, 1495], { tolMM: 20, grid: 50, exclude: "side" }).road, "side");
});

test("a bus stop goes on the side of its street it was put on; a building faces the nearest street", () => {
  const world = town(), reg = world.registry.objects;
  assert.equal(placeSpec(world, reg.get("bus-stop"), [[1000, 60]]).side, "left"); // north of a street drawn eastwards
  assert.equal(placeSpec(world, reg.get("bus-stop"), [[1000, -60]]).side, "right");
  assert.ok(facesStreet(reg.get("house")));
  assert.ok(!facesStreet(reg.get("tree")));
  // the front faces −y at 0°: north of the street it stays, south of it it turns round, east of Side Street it faces west
  assert.equal(placeSpec(world, reg.get("house"), [[-1000, 300]]).rotation_deg, 0);
  assert.equal(placeSpec(world, reg.get("house"), [[-1000, -300]]).rotation_deg, 180);
  assert.equal(placeSpec(world, reg.get("house"), [[800, 1000]]).rotation_deg, -90);
  // a bus terminal along the street
  assert.equal(placeSpec(world, reg.get("bus-terminal"), [[1000, 300]]).rotation_deg, 0);
  assert.equal(nearestStreetAt(world, [520, 800]).obj.id, "side");
});

test("the other placements: segment, rect, lines and stops, each with its number of points", () => {
  const world = town(), reg = world.registry.objects;
  assert.deepEqual(placeSpec(world, reg.get("platform"), [[0, 100], [500, 100.04]]), { type: "platform", from: [0, 100], to: [500, 100] });
  assert.deepEqual(placeSpec(world, reg.get("tabletop"), [[0, 0], [1000, 600]]), { type: "tabletop", position: [500, 300], width_mm: 1000, depth_mm: 600, rotation_deg: 0 });
  assert.equal(placeSpec(world, reg.get("tabletop"), [[0, 0], [2, 600]]), null); // too narrow
  assert.equal(placeSpec(world, reg.get("forest"), [[0, 0], [100, 0]]), null);
  assert.deepEqual(placeSpec(world, reg.get("bus-line"), ["a", "b"]), { type: "bus-line", stops: ["a", "b"] });
  assert.deepEqual(pointsOf(reg.get("road")), [2, Infinity]);
  assert.deepEqual(pointsOf(reg.get("bus-stop")), [1, 1]);
  assert.deepEqual(pointsOf(reg.get("forest")), [3, Infinity]);
});

test("undo and redo walk through the changes; a new change after an undo drops what was undone", () => {
  const h = new History(3);
  h.reset("a");
  assert.equal(h.canUndo, false);
  assert.equal(h.push("a"), false); // nothing changed
  h.push("b");
  h.push("c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "b");
  h.push("d");
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.states, ["a", "b", "d"]);
  h.push("e");
  h.push("f"); // at most 3 undo steps
  assert.deepEqual(h.states, ["b", "d", "e", "f"]);
  assert.equal(h.current, "f");
});
