// Trams (objects/tram.js, core/transit.js, core/curves.js): tram stops of four kinds with their
// step-free access and what cars beside them do, tram lines on tram tracks only, curves of at least
// 25 m, one tram at a time on a single track used both ways, trams changing ends at stub tracks,
// never across a railway at street level, and the two tram lines of Bf Neustadt.
import assert from "node:assert/strict";
import test from "node:test";

import { STEP_FREE_M, TRAM, TRAM_STOP_TYPES, createWorld, tramRails } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

function world(objects, extra = {}) {
  return createWorld({
    objects,
    simulations: [{ type: "passengers", base_rate: 0 }],
    clock: { start: "10:00", profiles: false },
    ...extra,
  }, { seed: 5 });
}

/** Run a world for `seconds` simulated seconds; `each` is called after every step. */
function run(w, seconds, each = null, dt = 0.1) {
  w.speed = 1;
  for (let t = 0; t < seconds; t += dt) {
    w.step(dt);
    each?.();
  }
}

/** Record the stops the trams arrive at: "areaId". */
function arrivals(w) {
  const log = [];
  w.events.on("vehicle.arrived", (e) => {
    if (e.vehicle.kind === "tram") log.push(e.area.id);
  });
  return log;
}

test("tram stops: four kinds, step-free or not, and the cars beside a standing tram", () => {
  const objects = [{ id: "ring", type: "road", name: "Ring", tram: "street", points: [[0, 0], [6000, 0]] }];
  Object.keys(TRAM_STOP_TYPES).forEach((kind, i) => objects.push({ id: kind, type: "tram-stop", name: kind, kind, position: [800 + 1200 * i, 0] }));
  const w = world(objects);
  assert.deepEqual(Object.keys(TRAM_STOP_TYPES), ["road", "raised", "island", "cape"]);
  const stop = (id) => w.getObject(id);
  // on the road: people step down from the curb and up 30 cm into the tram: not step-free; cars wait
  assert.equal(stop("road").platformHeight(), 0);
  assert.deepEqual(stop("road").accessibility().reasons, ["a step of 30 cm up into the tram", "a gap between the curb and the tram"]);
  assert.equal(stop("road").dwellFactor(), 1.3, "boarding takes longer");
  // a raised road (Zeitinsel) and a curb extension (Kap): 25 cm, step-free for a low-floor tram (30 cm)
  for (const id of ["raised", "cape"]) {
    const a = stop(id).accessibility();
    assert.equal(a.stepFree, true, id);
    assert.ok(a.step <= STEP_FREE_M + 1e-9 && a.gap <= STEP_FREE_M);
    assert.equal(stop(id).dwellFactor(), 1);
  }
  assert.equal(TRAM.floor_m, 0.3);
  // cars wait beside a standing tram (StVO § 20), except at an island
  assert.deepEqual(Object.keys(TRAM_STOP_TYPES).map((k) => stop(k).blocksCars()), [true, true, false, true]);
  // two tracks: a stop area on each side, docks of kind tram
  const areas = w.stopAreas().filter((a) => a.owner === stop("cape"));
  assert.deepEqual(areas.map((a) => a.id).sort(), ["cape:left", "cape:right"]);
  assert.ok(areas.every((a) => a.kind === "tram"));
  // an island in a street of 7 m: no room for the island and a car lane of 3.00 m beside it
  assert.equal(stop("island").problems().length, 1);
  assert.match(stop("island").problems()[0], /^No room for the island and a car lane beside it: the street is [\d.]+ m too narrow there/);
  assert.deepEqual(stop("island").accessibility().reasons, ["no zebra crossing or traffic lights to get onto the island"]);
  // a wide street with the tracks in the middle has room; a zebra crossing nearby gets people onto it
  const w2 = world([
    { id: "wide", type: "road", tram: "median", width_m: 11, points: [[0, 0], [6000, 0]] },
    { id: "isl", type: "tram-stop", kind: "island", position: [2000, 0] },
    { id: "z", type: "zebra-crossing", position: [2400, 0] },
  ]);
  assert.deepEqual(w2.getObject("isl").problems(), []);
  assert.equal(w2.getObject("isl").accessibility().stepFree, true);
  // what makes a stop not step-free: no tactile paving, a narrow platform
  const w3 = world([objects[0], { id: "s", type: "tram-stop", kind: "cape", tactile: false, width_m: 1.6, position: [2000, 0] }]);
  assert.deepEqual(w3.getObject("s").accessibility().reasons, ["no tactile paving for blind people", "the platform is narrower than 2 m"]);
  const card = w3.card({ kind: "object", ref: w3.getObject("s"), owner: w3.getObject("s"), label: "s" });
  assert.equal(Object.fromEntries(card.rows)["Step-free"], "no");
  assert.deepEqual(card.sections.find((x) => x.title === "Not step-free").lines, ["no tactile paving for blind people", "the platform is narrower than 2 m"]);
  // not at a tram track
  const w4 = world([{ id: "plain", type: "road", points: [[0, 0], [6000, 0]] }, { id: "s", type: "tram-stop", position: [2000, 0] }, { id: "t", type: "tram-stop", road: "plain", position: [2000, 0] }]);
  assert.deepEqual(w4.getObject("s").problems(), ["Not at a tram track: move the stop to a street with tram tracks."]);
  assert.deepEqual(w4.getObject("t").problems(), ["The chosen street has no tram tracks."]);
});

test("tram lines: one tram at a time on a single track used both ways; trams change ends at stub tracks", () => {
  const w = world([
    { id: "west", type: "road", name: "West", tram: "street", points: [[0, 0], [1500, 0]] },
    { id: "single", type: "road", name: "Single", tram: "street", tram_tracks: "single", points: [[1500, 0], [3500, 0]] },
    { id: "east", type: "road", name: "East", tram: "street", points: [[3500, 0], [5500, 0]] },
    { id: "a", type: "tram-stop", name: "A", position: [600, 0] },
    { id: "b", type: "tram-stop", name: "B", position: [4600, 0] },
    { id: "line", type: "tram-line", name: "Line 5", number: "5", headway_s: 60, stops: ["a", "b"] },
  ]);
  w.transit.sync();
  const line = w.transit.lines.get("line");
  assert.ok(line.ok, JSON.stringify(line.problems));
  assert.equal(line.vehicle, "tram");
  // the single track is passed both ways: the same stretch twice, in opposite directions
  assert.equal(line.single.length, 2);
  assert.equal(line.single[0].key, line.single[1].key);
  assert.deepEqual(line.single.map((x) => x.dir).sort(), [-1, 1]);
  // both ends are stub tracks: the trams change ends there
  assert.equal(line.reversals.length, 2);
  const log = arrivals(w);
  const C = line.circuit.length, len = (30 * 1000) / w.scale;
  const inside = (s, iv) => ((((s - iv.s0) % C) + C) % C) <= iv.s1 - iv.s0;
  let most = 0, clash = 0;
  run(w, 900, () => {
    const trams = w.transit.buses.filter((b) => b.kind === "tram");
    most = Math.max(most, trams.length);
    const on = line.single.map((iv) => trams.filter((t) => inside(t.s, iv) || inside(t.s - len, iv)));
    if (on[0].some((t) => on[1].some((u) => u !== t))) clash++;
  });
  assert.equal(clash, 0, "never two trams on the single track in opposite directions");
  assert.ok(most >= 3, `${most} trams`);
  // the trams serve both stops in both directions
  for (const id of ["a:right", "a:left", "b:right", "b:left"]) assert.ok(log.filter((x) => x === id).length >= 3, `${id}: ${log.filter((x) => x === id).length}`);
  const tram = w.transit.buses.find((b) => b.kind === "tram");
  assert.equal(w.transit.card({ ref: tram }).subtitle.startsWith("Tram"), true);
});

test("tram lines never cross a railway at street level; a bridge opens the way", () => {
  const objects = [
    { id: "track", type: "track", points: [[2500, -3000], [2500, 3000]] },
    { id: "main", type: "road", name: "Main", tram: "street", points: [[0, 0], [5000, 0]] },
    { id: "a", type: "tram-stop", name: "A", position: [800, 0] },
    { id: "b", type: "tram-stop", name: "B", position: [4200, 0] },
    { id: "line", type: "tram-line", name: "Line 3", stops: ["a", "b"] },
  ];
  // the trams do not get to B: they turn at A, and the line says why
  const blocked = (w) => {
    w.transit.sync();
    const line = w.transit.lines.get("line");
    assert.ok(line.visits.every((v) => v.objectId !== "b"), "B is not served");
    assert.deepEqual(line.problems, [
      "B: trams towards B cannot get there along the tram tracks: trams cannot cross the railway at street level.",
      "B: trams towards A cannot get there along the tram tracks: trams cannot cross the railway at street level.",
    ]);
  };
  blocked(world(objects));
  // a level crossing does not help; a bridge between raised table modules does
  blocked(world([...objects, { id: "x", type: "rail-crossing", position: [2500, 0], kind: "half-barriers" }]));
  const raised = [
    { id: "table", type: "tabletop", kind: "physical", position: [2500, 0], width_mm: 600, depth_mm: 6000 },
    { id: "west", type: "tabletop", position: [1100, 0], width_mm: 2200, depth_mm: 1000, level_mm: 80 },
    { id: "east", type: "tabletop", position: [3900, 0], width_mm: 2200, depth_mm: 1000, level_mm: 80 },
  ];
  const w3 = world([...objects, ...raised, { id: "x", type: "rail-crossing", position: [2500, 0], kind: "over" }]);
  w3.transit.sync();
  const line3 = w3.transit.lines.get("line");
  assert.ok(line3.ok);
  assert.deepEqual(line3.problems, []);
  assert.deepEqual([...new Set(line3.visits.map((v) => v.objectId))], ["a", "b"]);
  // trams run on tram tracks only: a line along a street without tracks has no way
  const w4 = world([{ id: "plain", type: "road", points: [[0, 0], [5000, 0]] }, { ...objects[2] }, { ...objects[3] }, { ...objects[4] }]);
  w4.transit.sync();
  assert.equal(w4.transit.lines.get("line").ok, false);
});

test("tram tracks bend in arcs of at least 25 m; trams slow down for them; a corner too tight is reported", () => {
  // Main to the east, then round the corner into Side to the north
  const objects = [
    { id: "main", type: "road", name: "Main", tram: "street", points: [[0, 0], [3000, 0]] },
    { id: "side", type: "road", name: "Side", tram: "street", points: [[3000, 0], [3000, 3000]] },
    { id: "a", type: "tram-stop", name: "A", position: [1000, 0] },
    { id: "b", type: "tram-stop", name: "B", position: [3000, 2000] },
    { id: "line", type: "tram-line", name: "Line 4", number: "4", stops: ["a", "b"] },
  ];
  const w = world(objects);
  w.transit.sync();
  const line = w.transit.lines.get("line");
  assert.ok(line.ok);
  assert.deepEqual(line.problems, []);
  const mm25 = (25 * 1000) / 87;
  // a curve at the corner each way, of 25 m; nowhere does the line turn more than 6° at a point
  const corner = line.curves.filter((c) => Math.hypot(c.points[0][0] - 3000, c.points[0][1]) < 2 * mm25);
  assert.equal(corner.length, 2);
  for (const c of corner) assert.ok(Math.abs(c.radius - mm25) < 0.5, `${c.radius}`);
  const P = line.circuit.points;
  for (let i = 1; i < P.length - 1; i++) {
    const a = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]], b = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
    const turn = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    const near = Math.hypot(P[i][0] - 3000, P[i][1]) < 2 * mm25;
    if (near) assert.ok(turn < (6 * Math.PI) / 180 + 1e-6, `${(turn * 180) / Math.PI}° at ${P[i]}`);
  }
  // in the curve at most 16 km/h (0.8 m/s² sideways); a tram never goes faster there
  for (const c of corner) assert.ok(Math.abs(c.v - Math.sqrt(0.8 * 25)) < 1e-6);
  let fastest = 0;
  run(w, 300, () => {
    for (const t of w.transit.buses.filter((b) => b.kind === "tram")) {
      if (corner.some((c) => t.s >= c.s0 && t.s <= c.s1)) fastest = Math.max(fastest, t.v);
    }
  });
  assert.ok(fastest > 2 && fastest <= Math.sqrt(0.8 * 25) + 0.3, `${fastest} m/s in the curve`);
  // the same corner with the stops right at it: no room for 25 m, said so
  const tight = world([objects[0], { ...objects[1], points: [[3000, 0], [3000, 450]] }, { ...objects[2], position: [2850, 0] }, { ...objects[3], position: [3000, 300] }, objects[4]]);
  tight.transit.sync();
  const problems = tight.transit.lines.get("line").problems;
  assert.equal(problems.length, 1, problems.join(" | "));
  assert.match(problems[0], /^A curve of \d+ m at Main \/ Side: tram tracks need at least 25 m\. Give them more room there\.$/);
});

test("Bf Neustadt: two tram lines to the station and the Markt, curves of 25 m, every stop served; none across the level crossing", () => {
  const json = readJSON("web/layouts/ebl-neustadt.json");
  for (const l of json.layers || []) l.enabled = false;
  json.simulations = json.simulations.filter((s) => s.type === "passengers");
  const w = createWorld(json, { seed: 3 });
  w.setTime("08:00");
  w.transit.sync();
  const lines = ["tram-line-1", "tram-line-2"].map((id) => w.transit.lines.get(id));
  for (const l of lines) {
    assert.ok(l.ok, `${l.id}: ${l.problems.join("; ")}`);
    assert.equal(l.vehicle, "tram");
    assert.deepEqual(l.problems, []);
  }
  // both start on the single track of Ringstraße's west end (used both ways) and change ends at both
  // ends (stub tracks); no curve is tighter than 25 m
  assert.ok(lines.every((l) => l.single.length > 0));
  assert.ok(lines.every((l) => l.reversals.length === 2));
  for (const l of lines) for (const c of l.curves) assert.ok(c.radius >= (25 * 1000) / 87 - 0.5, `${l.id}: ${c.radius}`);
  // the rails end where the tram tracks end (Bahnhofstraße at x = 3350, the Markt's track at
  // [2761, -454]), not in a loop beyond: a crossover leads from one track to the other
  const gauge = 1435 / 87, rails1 = tramRails(lines[0], gauge, 230), rails2 = tramRails(lines[1], gauge, 230);
  assert.ok(rails1.flat().every((p) => p[0] < 3350 + 2), "no rails beyond the end of Bahnhofstraße's tram tracks");
  assert.ok(rails2.flat().every((p) => Math.hypot(p[0] - 2350, p[1] + 217) < Math.hypot(2761 - 2350, 454 - 217) + 2 || p[0] < 2350), "nor beyond the Markt's");
  // two rails for each crossover (at the ends with two tracks; Lindenstraße has one)
  assert.equal(rails1.filter((r) => r.length === 2 && Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) > 200).length, 2);
  // Brückenstraße crosses the main line at street level (half barriers): no tram tracks over it
  const crossing = w.getObject("rail-crossing-bruecke");
  assert.equal(crossing.crossingType.level, true);
  assert.deepEqual(crossing.problems(), []);
  assert.equal(w.getObject(crossing.geometry.road).roadInfo().tram, "none");
  for (const o of w.objects.filter((x) => x.type === "tram-stop")) assert.deepEqual(o.problems(), [], o.id);
  // everything at the track level
  assert.equal(w.elevation.sync().flat, true);
  // all kinds of stops are there
  assert.deepEqual([...new Set(w.objects.filter((x) => x.type === "tram-stop").map((x) => x.kind()))].sort(), ["cape", "island", "raised", "road"]);
  const log = arrivals(w);
  run(w, 600, null, 0.2);
  const served = new Set(log.map((id) => id.split(":")[0]));
  for (const o of w.objects.filter((x) => x.type === "tram-stop")) assert.ok(served.has(o.id), `${o.id} served (${[...served].join(", ")})`);
});
