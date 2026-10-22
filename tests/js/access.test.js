// Street access (web/arail/core/access.js): what people and vehicles come to by street has a street
// that leads there, the streets form one network, and each problem with a plain fix is fixed by it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createWorld } from "../../web/arail/index.js";
import { accessProblems, applyFix, carGroups, insideLayout, layoutBounds, nearestStreet } from "../../web/arail/core/access.js";

/** A table 6 × 4 m (H0: about 520 × 350 m) with Main Street along the middle, from edge to edge. */
function town(objects = []) {
  return createWorld({
    format: "arail-layout/1", name: "Test", scale: 87,
    objects: [
      { id: "table", type: "tabletop", position: [0, 0], width_mm: 6000, depth_mm: 4000 },
      { id: "main", type: "road", name: "Main Street", kind: "street", points: [[-3000, 0], [3000, 0]] },
      ...objects,
    ],
  });
}

const keys = (world) => accessProblems(world).map((p) => p.key);

test("a street with a bus stop and a house at it: nothing to fix", () => {
  const world = town([
    { id: "stop", type: "bus-stop", name: "Market", position: [0, 60], side: "both" },
    { id: "house", type: "house", position: [600, 200], rotation_deg: 0 },
  ]);
  assert.deepEqual(accessProblems(world), []);
  assert.deepEqual(layoutBounds(world), [-3000, -2000, 3000, 2000]);
  assert.equal(nearestStreet(world, [100, 300]).road.id, "main");
});

test("a house far from the streets: a footpath to the nearest street fixes it", () => {
  const world = town([{ id: "house", type: "house", position: [0, 1500], rotation_deg: 0 }]);
  const [p] = accessProblems(world);
  assert.equal(p.key, "entrance:house:0");
  assert.equal(p.level, "warning");
  assert.match(p.text, /no street or footpath within 80 m of its entrance/);
  assert.equal(p.fix.kind, "street");
  assert.equal(p.fix.roadKind, "path");
  assert.equal(p.fix.text, "Add a footpath to Main Street");
  const path = applyFix(world, p.fix);
  assert.equal(path.type, "road");
  assert.equal(path.spec.kind, "path");
  assert.deepEqual(accessProblems(world), []);
});

test("a street on its own: not connected to the others, and a street to them fixes it", () => {
  const world = town([{ id: "side", type: "road", name: "Side Street", points: [[0, 1000], [0, 2000]] }]);
  assert.deepEqual(carGroups(world.network()).map((g) => [...g.roads]), [["main"], ["side"]]);
  const problems = accessProblems(world);
  assert.deepEqual(problems.map((p) => p.key), ["island:side", "dead:side:0"]);
  assert.match(problems[0].text, /^Side Street: not connected to the other streets/);
  assert.equal(problems[0].fix.text, "Add a street to Main Street");
  applyFix(world, problems[0].fix);
  assert.deepEqual(keys(world), []); // the new street joins its end: no island, no dead end
});

test("a street that ends just before another one: joined to it", () => {
  const world = town([{ id: "side", type: "road", name: "Side Street", points: [[0, 110], [0, 2000]] }]);
  const [p] = accessProblems(world);
  assert.equal(p.key, "near:side:0");
  assert.equal(p.text, "Side Street ends 10 m before Main Street: join them");
  assert.equal(p.fix.kind, "join");
  applyFix(world, p.fix);
  assert.deepEqual(world.getObject("side").spec.points, [[0, 0], [0, 2000]]);
  assert.deepEqual(keys(world), []);
});

test("a dead end inside the layout is reported, one at its edge leads out of it", () => {
  const world = createWorld({
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "table", type: "tabletop", position: [0, 0], width_mm: 6000, depth_mm: 4000 },
      { id: "main", type: "road", name: "Main Street", points: [[-3000, 0], [500, 0]] },
    ],
  });
  const [p, ...rest] = accessProblems(world);
  assert.equal(rest.length, 0);
  assert.equal(p.key, "dead:main:1");
  assert.match(p.text, /ends inside the layout/);
  assert.deepEqual(p.at, [500, 0]);
  // the fix: a dead end there, where cars turn instead of appearing
  assert.equal(p.fix.kind, "dead-end");
  applyFix(world, p.fix);
  assert.equal(world.getObject("main").spec.dead_end, "end");
  assert.deepEqual(accessProblems(world), []);
  assert.deepEqual(world.network().boundaryNodes().map((n) => n.pos), [[-3000, 0]]);
});

test("the edge of the layout is the edge of its table modules, not of the box around them", () => {
  // Main Street ends at the east edge of the table; a module beside it juts out to the south-east
  // (the box around both would put the end of the street inside the layout)
  const world = createWorld({
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "table", type: "tabletop", position: [0, 0], width_mm: 6000, depth_mm: 4000 },
      { id: "wing", type: "tabletop", position: [4000, 2500], width_mm: 2000, depth_mm: 1000 },
      { id: "main", type: "road", name: "Main Street", points: [[-3000, 0], [3000, 0]] },
    ],
  });
  assert.deepEqual(layoutBounds(world), [-3000, -2000, 5000, 3000]);
  assert.deepEqual(keys(world), []);
  assert.equal(insideLayout(world, [3000, 0], 100), false);
  assert.equal(insideLayout(world, [2800, 0], 100), true);
  assert.equal(insideLayout(world, [4000, 2500], 100), true, "on the other module");
  assert.equal(insideLayout(world, [4000, 0], 100), false, "beside both");
});

test("a truck lane needs a street at its entry and at its end", () => {
  const world = town([{ id: "lane", type: "truck-lane", name: "Truck lane", points: [[-1000, 800], [1000, 800]] }]);
  const truck = accessProblems(world).filter((p) => p.key.startsWith("truck:"));
  assert.deepEqual(truck.map((p) => [p.key, p.level]), [["truck:lane:0", "error"], ["truck:lane:1", "error"]]);
  assert.match(truck[0].text, /trucks cannot get to it: no street at its entry/);
  assert.match(truck[1].text, /trucks cannot leave it: no street at its end/);
  for (const p of truck) applyFix(world, p.fix);
  assert.deepEqual(keys(world).filter((k) => k.startsWith("truck:")), []);
});

test("without any street the truck lane's street leads out of the layout", () => {
  const world = createWorld({
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "table", type: "tabletop", position: [0, 0], width_mm: 4000, depth_mm: 2000 },
      { id: "lane", type: "truck-lane", points: [[-1500, 0], [1990, 0]] },
    ],
  });
  const [entry, end] = accessProblems(world);
  assert.equal(entry.fix.text, "Add a street to the edge of the layout");
  assert.deepEqual(entry.fix.points, [[-1500, 0], [-2000, 0]]);
  assert.equal(end.fix.text, "Add a street out of the layout"); // at the edge already: on in its direction
  assert.ok(end.fix.points[1][0] > 2000);
  applyFix(world, entry.fix);
  applyFix(world, end.fix);
  assert.deepEqual(keys(world).filter((k) => k.startsWith("truck:")), []);
});

test("a platform behind a track: the way to it goes under the track", () => {
  const world = town([
    { id: "track", type: "track", points: [[-3000, 300], [3000, 300]] },
    { id: "platform", type: "platform", name: "Platform 1", from: [-500, 450], to: [500, 450], width_mm: 70 },
  ]);
  const p = accessProblems(world).find((x) => x.id === "platform");
  assert.equal(p.key, "area:platform");
  assert.match(p.text, /^Platform 1: people cannot get there/);
  assert.equal(p.fix.roadKind, "underpass");
  assert.equal(p.fix.text, "Add an underpass to Main Street");
  assert.equal(applyFix(world, p.fix).type, "underpass");
  assert.equal(accessProblems(world).find((x) => x.id === "platform"), undefined);
});

test("the example layouts: every error has a fix, and the fixes leave no error", () => {
  for (const name of ["ebl-neustadt", "ebl-lab", "container-terminal", "ebl-container-train"]) {
    const json = JSON.parse(readFileSync(new URL(`../../web/layouts/${name}.json`, import.meta.url), "utf8"));
    const world = createWorld(json);
    for (let round = 0; round < 10; round++) {
      const fixable = accessProblems(world).filter((p) => p.fix);
      if (!fixable.length) break;
      applyFix(world, fixable[0].fix);
    }
    const left = accessProblems(world);
    assert.deepEqual(left.filter((p) => p.level === "error").map((p) => p.key), [], name);
    assert.ok(left.every((p) => !p.fix), name);
  }
});

test("a street that runs on past the end of another one, which ends on it, needs no joining", () => {
  // Side Street ends on Main Street; Main Street runs on 10 m past it to the edge of the layout
  const world = createWorld({
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "table", type: "tabletop", position: [0, 0], width_mm: 6000, depth_mm: 4000 },
      { id: "main", type: "road", name: "Main Street", points: [[0, 2000], [0, -2000]] },
      { id: "side", type: "road", name: "Side Street", points: [[-3000, -1885], [0, -1885]] },
    ],
  });
  assert.deepEqual(keys(world), []);
});
