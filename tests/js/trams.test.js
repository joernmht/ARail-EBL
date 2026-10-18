// Trams (objects/tram.js, core/transit.js, core/curves.js, core/stop-signals.js): tram stops of four
// kinds with their step-free access and what cars beside them do, tram lines on tram tracks only,
// curves of at least 25 m, one tram at a time on a single track used both ways, trams changing ends
// at stub tracks or turning in loops, never across a railway at street level, the traffic lights
// where people cross the street to a tram or to an island, and the two tram lines of Bf Neustadt.
import assert from "node:assert/strict";
import test from "node:test";

import { STEP_FREE_M, STOP_SIGNAL, TRAM, TRAM_STOP_TYPES, createWorld, tramRails } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

/** 25 m in H0 (mm): the tightest curve of tram tracks. */
const MM25 = (25 * 1000) / 87;

function world(objects, extra = {}, seed = 5) {
  return createWorld({
    objects,
    simulations: [{ type: "passengers", base_rate: 0 }],
    clock: { start: "10:00", profiles: false },
    ...extra,
  }, { seed });
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

/**
 * A turning loop (Wendeschleife) at the end of a tram track that ends at `N` heading `axisDeg`
 * (degrees): a teardrop of radius `R` (mm; 300 mm are 26 m in H0) whose two legs meet at N at ±40°;
 * its points from N round to N.
 */
function teardrop(N, axisDeg, R = 300, thetaDeg = 40, stepDeg = 10) {
  const rad = Math.PI / 180, th = thetaDeg * rad, ax = axisDeg * rad;
  const D = R / Math.sin(th), L = Math.sqrt(D * D - R * R), C = [N[0] + D * Math.cos(ax), N[1] + D * Math.sin(ax)];
  const T1 = [N[0] + L * Math.cos(ax - th), N[1] + L * Math.sin(ax - th)], T2 = [N[0] + L * Math.cos(ax + th), N[1] + L * Math.sin(ax + th)];
  const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
  let span = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
  while (span <= 0) span += 2 * Math.PI;
  const n = Math.ceil(span / (stepDeg * rad)), pts = [N, T1];
  for (let k = 1; k < n; k++) pts.push([C[0] + R * Math.cos(a1 + (span * k) / n), C[1] + R * Math.sin(a1 + (span * k) / n)]);
  return [...pts, T2, N].map((p) => p.map((v) => Math.round(v * 10) / 10));
}

/** The people of a stop area who are on its strip with traffic now (layout mm). */
function onStrip(w, areaId) {
  const c = w.simulations.find((s) => s.constructor.type === "passengers").crowds.get(areaId);
  if (!c) return [];
  const a = c.area, x = a.crossing, h = a.W / 2;
  const on = (t) => (x.kind === "board" ? t > h + 0.05 : t < -h - 0.05 && t > -h - x.reach + 0.05);
  return c.visible().filter((p) => on(p.pos[1])).map((p) => a.toLayout(p.pos[0], p.pos[1]));
}

/** The cars and bikes now: road users {vehicle, front, rear, dir}. */
function vehicles(w) {
  const out = [];
  for (const s of w.simulations) {
    if (s.constructor.type === "traffic") out.push(...s.roadUsers());
    if (s.constructor.type === "cycling") out.push(...s.riders.map((r) => s._pose(r)));
  }
  return out;
}

/** Distance (mm) from a point to a segment. */
function toSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Run a world with traffic and watch the lights of a stop: nobody on the strip unless the light is
 * red, no car or bike on the street within 1.2 m of anybody on it, nobody past the stop line at red,
 * no tram's doors open before red. What went wrong, and how often the lights were red and people
 * crossed.
 */
function watchLights(w, stopId, seconds) {
  const lights = w.transit.signals.list().filter((s) => s.owner.id === stopId), m = w.scale / 1000;
  const bad = [], seen = { red: 0, green: 0, crossing: 0 }, last = new Map(), dwell = new Map();
  run(w, seconds, () => {
    const all = vehicles(w), t = w.time.toFixed(1);
    for (const sig of lights) {
      const state = w.transit.signals.state(sig.id), people = onStrip(w, sig.areaId);
      // the cars and bikes on the street (its stop line runs across it), not those on the sidewalk
      const a = sig.line[0], b = sig.line.at(-1), len = Math.hypot(b[0] - a[0], b[1] - a[1]), across = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const cars = all.filter((u) => [u.front, u.rear].some((p) => {
        const side = ((p[0] - a[0]) * across[0] + (p[1] - a[1]) * across[1]) * m;
        return side > -0.6 && side < len * m + 0.6;
      }));
      if (state === "red") seen.red++;
      if (state === "green") seen.green++;
      if (people.length) seen.crossing++;
      if (people.length && state !== "red") bad.push(`${t} s: people on the strip at ${state}`);
      for (const p of people) for (const u of cars) if (toSegment(p, u.rear, u.front) * m < 1.2) bad.push(`${t} s: ${u.vehicle.kind || "car"} ${u.vehicle.id} next to a person crossing`);
      for (const u of cars) {
        if (u.dir[0] * sig.dir[0] + u.dir[1] * sig.dir[1] < 0.7) continue;
        const at = ((u.front[0] - a[0]) * sig.dir[0] + (u.front[1] - a[1]) * sig.dir[1]) * m, key = `${sig.id}:${u.vehicle.id}`, prev = last.get(key);
        if (prev?.red && state === "red" && prev.at < -0.1 && at > 0.05) bad.push(`${t} s: ${u.vehicle.id} past the stop line at red`);
        last.set(key, { at, red: state === "red" });
      }
    }
    for (const tram of w.transit.buses) {
      // (at an island the people get on and off on the island: the doors do not wait)
      const sig = lights.find((s) => s.kind === "board" && s.dockId === tram.dock?.id);
      if (tram.kind !== "tram" || tram.phase !== "dwelling" || !sig) {
        dwell.delete(tram);
        continue;
      }
      if (dwell.has(tram) && tram.dwellLeft < dwell.get(tram) && w.transit.signals.state(sig.id) !== "red") bad.push(`${t} s: ${tram.id} opened its doors before red`);
      dwell.set(tram, tram.dwellLeft);
    }
  });
  return { lights, bad, seen };
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
  // people get onto the island over the car lane at its own traffic lights; without them only at a
  // zebra crossing or traffic lights nearby
  assert.deepEqual(stop("island").accessibility().reasons, []);
  const w1 = world([objects[0], { id: "isl", type: "tram-stop", kind: "island", lights: false, position: [2000, 0] }]);
  assert.deepEqual(w1.getObject("isl").accessibility().reasons, ["no zebra crossing or traffic lights to get onto the island"]);
  // a wide street with the tracks in the middle has room; a zebra crossing nearby gets people onto it
  const w2 = world([
    { id: "wide", type: "road", tram: "median", width_m: 11, points: [[0, 0], [6000, 0]] },
    { id: "isl", type: "tram-stop", kind: "island", lights: false, position: [2000, 0] },
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
  // (seed 1: at the start, and two trams at the two ends of the single track in the same step)
  for (const seed of [5, 1]) singleTrackRun(seed);
});

function singleTrackRun(seed) {
  const w = world([
    { id: "west", type: "road", name: "West", tram: "street", points: [[0, 0], [1500, 0]] },
    { id: "single", type: "road", name: "Single", tram: "street", tram_tracks: "single", points: [[1500, 0], [3500, 0]] },
    { id: "east", type: "road", name: "East", tram: "street", points: [[3500, 0], [5500, 0]] },
    { id: "a", type: "tram-stop", name: "A", position: [600, 0] },
    { id: "b", type: "tram-stop", name: "B", position: [4600, 0] },
    { id: "line", type: "tram-line", name: "Line 5", number: "5", headway_s: 60, stops: ["a", "b"] },
  ], {}, seed);
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
  assert.equal(clash, 0, `never two trams on the single track in opposite directions (seed ${seed})`);
  assert.ok(most >= 3, `${most} trams`);
  // the trams serve both stops in both directions
  for (const id of ["a:right", "a:left", "b:right", "b:left"]) assert.ok(log.filter((x) => x === id).length >= 3, `${id}: ${log.filter((x) => x === id).length}`);
  const tram = w.transit.buses.find((b) => b.kind === "tram");
  assert.equal(w.transit.card({ ref: tram }).subtitle.startsWith("Tram"), true);
}

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

test("tram lines turn in loops at their ends (dog bone): no stub tracks, curves of 25 m, every stop both ways", () => {
  // a street with two tracks; at each end a single track (the neck) to a turning loop
  const w = world([
    { id: "main", type: "road", name: "Main", kind: "main", tram: "lanes", points: [[600, 0], [4400, 0]] },
    { id: "neck-w", type: "road", name: "Neck west", kind: "tram", tram_tracks: "single", points: [[600, 0], [300, 0]] },
    { id: "loop-w", type: "road", name: "Loop west", kind: "tram", tram_tracks: "single-oneway", points: teardrop([300, 0], 180) },
    { id: "neck-e", type: "road", name: "Neck east", kind: "tram", tram_tracks: "single", points: [[4400, 0], [4700, 0]] },
    { id: "loop-e", type: "road", name: "Loop east", kind: "tram", tram_tracks: "single-oneway", points: teardrop([4700, 0], 0) },
    { id: "a", type: "tram-stop", name: "A", road: "main", kind: "raised", side: "both", position: [1400, 0] },
    { id: "b", type: "tram-stop", name: "B", road: "main", kind: "raised", side: "both", position: [3600, 0] },
    { id: "line", type: "tram-line", name: "Line 8", number: "8", headway_s: 90, stops: ["a", "b"] },
  ]);
  w.transit.sync();
  const line = w.transit.lines.get("line");
  assert.ok(line.ok, line.problems.join("; "));
  assert.deepEqual(line.problems, []);
  // the trams never change ends: they go round the loops, beyond the necks (a loop is 767 mm long)
  assert.equal(line.reversals.length, 0);
  const xs = line.circuit.points.map((p) => p[0]);
  assert.ok(Math.min(...xs) < 300 - 700 && Math.max(...xs) > 4700 + 700, `${Math.min(...xs)}..${Math.max(...xs)}`);
  // the necks are single track used both ways, one tram at a time; the loops are passed one way
  assert.equal(line.single.length, 4);
  assert.deepEqual(line.single.map((x) => x.dir).sort(), [-1, -1, 1, 1]);
  // no curve is tighter than 25 m, the loops (26 m) and where their legs meet included
  assert.ok(line.curves.length >= 8);
  for (const c of line.curves) assert.ok(c.radius >= MM25 - 0.5, `${c.radius}`);
  // the rails run round the loops: two rails, each in one piece, no crossover
  const rails = tramRails(line, 1435 / 87, 230);
  assert.equal(rails.length, 2);
  assert.ok(rails.every((r) => r.length > 100));
  // the trams serve both stops on both sides, and do not get stuck at the necks
  const log = arrivals(w), still = new Map();
  let longest = 0;
  run(w, 900, () => {
    for (const t of w.transit.buses) {
      if (t.kind !== "tram" || t.phase === "gone") continue;
      const k = t.phase === "dwelling" || t.v > 0.1 ? 0 : (still.get(t) || 0) + 0.1;
      still.set(t, k);
      longest = Math.max(longest, k);
    }
  });
  for (const id of ["a:right", "a:left", "b:right", "b:left"]) assert.ok(log.filter((x) => x === id).length >= 8, `${id}: ${log.filter((x) => x === id).length}`);
  assert.ok(longest < 30, `a tram stood still for ${longest.toFixed(0)} s`);
});

test("traffic lights where people cross the street to a tram: cars and bikes wait, people cross on red, the doors open then", () => {
  // tram lanes in the middle of the street; a raised road (Zeitinsel) at S
  const w = world([
    { id: "main", type: "road", name: "Main", kind: "main", width_m: 6.5, tram: "lanes", points: [[0, 0], [6000, 0]] },
    { id: "a", type: "tram-stop", name: "A", kind: "raised", position: [800, 0] },
    { id: "s", type: "tram-stop", name: "S", kind: "raised", position: [3000, 0] },
    { id: "b", type: "tram-stop", name: "B", kind: "raised", position: [5200, 0] },
    { id: "line", type: "tram-line", name: "Line 6", number: "6", headway_s: 120, stops: ["a", "s", "b"] },
  ], { simulations: [{ type: "passengers", base_rate: 1 }, { type: "traffic", cars_per_km: 30 }, { type: "cycling", riders_per_km: 20 }] });
  const stop = w.getObject("s");
  // a light on each side for the car lane between the sidewalk and the tram (bikes ride in it): 3.5 m
  const lights = stop.stopSignals();
  assert.deepEqual(lights.map((x) => [x.id, x.kind]), [["s:right", "board"], ["s:left", "board"]]);
  for (const x of lights) assert.ok(Math.abs(x.reach - 3.5) < 0.05, `${x.reach}`);
  // its stop line runs across the whole street (a car on the other lane stops too), 2 m before the stop
  for (const x of lights) assert.ok(x.line.length * 0.8 * 87 >= w.getObject("main").roadInfo().width / 1.2);
  // the people walk over the strip to the doors: the areas say so
  assert.deepEqual(w.stopAreas().filter((a) => a.owner === stop).map((a) => a.crossing), [{ kind: "board", reach: 3.5, s: 20 }, { kind: "board", reach: 3.5, s: 20 }]);
  // the card says so; no lights where the layout switches them off
  const card = (o) => Object.fromEntries(w.card({ kind: "object", ref: o, owner: o, label: o.id }).rows);
  assert.equal(card(stop).Cars, "wait at the traffic lights while people cross");
  assert.equal(card(stop)["Lights at A"], "green");
  assert.deepEqual(world([{ id: "main", type: "road", kind: "main", width_m: 6.5, tram: "lanes", points: [[0, 0], [6000, 0]] }, { id: "s", type: "tram-stop", kind: "raised", lights: false, position: [3000, 0] }]).getObject("s").stopSignals(), []);
  const log = arrivals(w);
  const { bad, seen } = watchLights(w, "s", 600);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} times`);
  // the trams stopped there on both sides; people crossed to them; the lights were red then, else green
  for (const id of ["s:right", "s:left"]) assert.ok(log.filter((x) => x === id).length >= 3, `${id}: ${log.filter((x) => x === id).length}`);
  assert.ok(seen.crossing > 300, `people crossed in ${seen.crossing} steps`);
  assert.ok(seen.red > 1000 && seen.green > 4000, JSON.stringify(seen));
  assert.equal(STOP_SIGNAL.amber_s, 3);
});

test("traffic lights at an island in the street: people cross the car lane on red, at the island's end", () => {
  // the tracks in the middle on their own bed; an island stop beside each track, a car lane beside it
  const w = world([
    { id: "main", type: "road", name: "Main", kind: "main", tram: "median", width_m: 11, points: [[0, 0], [6000, 0]] },
    { id: "a", type: "tram-stop", name: "A", kind: "raised", position: [800, 0] },
    { id: "s", type: "tram-stop", name: "S", kind: "island", position: [3000, 0] },
    { id: "b", type: "tram-stop", name: "B", kind: "raised", position: [5200, 0] },
    { id: "line", type: "tram-line", name: "Line 6", number: "6", headway_s: 120, stops: ["a", "s", "b"] },
  ], { simulations: [{ type: "passengers", base_rate: 1 }, { type: "traffic", cars_per_km: 30 }, { type: "cycling", riders_per_km: 20 }] });
  const stop = w.getObject("s");
  assert.deepEqual(stop.problems(), []);
  const lights = stop.stopSignals();
  assert.deepEqual(lights.map((x) => [x.id, x.kind]), [["s:right", "island"], ["s:left", "island"]]);
  // people come to the island from the sidewalk only, over the car lane at the island's end
  for (const a of w.stopAreas().filter((x) => x.owner === stop)) {
    assert.equal(a.crossing.kind, "island");
    assert.ok(Math.abs(a.crossing.reach - lights[0].reach) < 1e-9 && a.crossing.reach >= 3);
    assert.deepEqual(a.access.map((p) => [p.s, p.t < -a.W / 2 - a.crossing.reach]), [[a.crossing.s, true]]);
  }
  const log = arrivals(w);
  const { bad, seen } = watchLights(w, "s", 600);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} times`);
  for (const id of ["s:right", "s:left"]) assert.ok(log.filter((x) => x === id).length >= 3, `${id}: ${log.filter((x) => x === id).length}`);
  // on demand: red while people cross, green in between (12 s at least); no tram asks for red there
  assert.ok(seen.crossing > 300, `people crossed in ${seen.crossing} steps`);
  assert.ok(seen.red > 500 && seen.green > 4000, JSON.stringify(seen));
});

test("Bf Neustadt: two tram lines from loop to loop, curves of 25 m, every stop served, lights where people cross; none across the level crossing", () => {
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
  // both turn in loops at both ends (Lindenstraße; Busbahnhof and Markt), never on stub tracks;
  // single track only on the necks before the loops; no curve is tighter than 25 m
  assert.ok(lines.every((l) => l.reversals.length === 0));
  assert.ok(lines.every((l) => l.single.length === 4));
  for (const l of lines) for (const c of l.curves) assert.ok(c.radius >= MM25 - 0.5, `${l.id}: ${c.radius}`);
  const loops = ["road-loop-lindenstrasse", "road-loop-busbahnhof", "road-loop-markt"].map((id) => w.getObject(id));
  assert.ok(loops.every((o) => o.roadInfo().tramTracks === "single-oneway"));
  const xs1 = lines[0].circuit.points.map((p) => p[0]), ys2 = lines[1].circuit.points.map((p) => p[1]);
  assert.ok(Math.min(...xs1) < -3300 && Math.max(...xs1) > 4600, "line 1 from loop to loop");
  assert.ok(Math.min(...ys2) < -1200, "line 2 round the Markt's loop");
  // the rails run round: two rails a line, no crossovers
  for (const l of lines) assert.equal(tramRails(l, 1435 / 87, 230).length, 2);
  // Brückenstraße crosses the main line at street level (half barriers): no tram tracks over it
  const crossing = w.getObject("rail-crossing-bruecke");
  assert.equal(crossing.crossingType.level, true);
  assert.deepEqual(crossing.problems(), []);
  assert.equal(w.getObject(crossing.geometry.road).roadInfo().tram, "none");
  for (const o of w.objects.filter((x) => x.type === "tram-stop")) assert.deepEqual(o.problems(), [], o.id);
  // no platform reaches into another street (the Markt's island, on the diagonal track by
  // Bahnhofstraße, has one side only: the one away from Bahnhofstraße)
  const streets = w.objects.filter((x) => x.type === "road" && x.roadInfo().car);
  for (const o of w.objects.filter((x) => x.type === "tram-stop")) {
    const g = o.geometry, h = g.W / 2;
    for (const sd of g.sides) {
      const corners = [[0, -h], [g.L, -h], [g.L, h], [0, h]].map(([a, b]) => [sd.origin[0] + sd.dir[0] * a + sd.normal[0] * b, sd.origin[1] + sd.dir[1] * a + sd.normal[1] * b]);
      for (const r of streets.filter((x) => x.id !== g.road)) {
        const pts = r.geometry.points, half = r.roadInfo().width / 2;
        for (const c of corners) for (let i = 1; i < pts.length; i++) assert.ok(toSegment(c, pts[i - 1], pts[i]) >= half, `${o.id}:${sd.side} reaches into ${r.id}`);
      }
    }
  }
  assert.deepEqual(w.getObject("tram-stop-markt").geometry.sides.map((sd) => sd.side), ["right"]);
  // everything at the track level, the loops on town modules of their own
  assert.equal(w.elevation.sync().flat, true);
  // all kinds of stops are there
  assert.deepEqual([...new Set(w.objects.filter((x) => x.type === "tram-stop").map((x) => x.kind()))].sort(), ["cape", "island", "raised", "road"]);
  // lights at the stops where people cross the road to the tram: in Bahnhofstraße the car lane (3.5 m),
  // in Ringstraße the 1.1 m between the curb and the tram where bikes ride (the cars are on the tracks,
  // behind the tram); none at the curb extension and at the Markt (no cars)
  const lit = new Set(w.transit.signals.list().map((s) => s.owner.id));
  assert.deepEqual([...lit].sort(), ["tram-stop-am-park", "tram-stop-bahnhofstrasse", "tram-stop-busbahnhof", "tram-stop-lindenstrasse", "tram-stop-neustadt-bf", "tram-stop-ring-ost"]);
  assert.ok(w.transit.signals.list().filter((s) => s.owner.id === "tram-stop-neustadt-bf").every((s) => Math.abs(s.reach - 3.5) < 0.05));
  const log = arrivals(w);
  run(w, 600, null, 0.2);
  const served = new Set(log.map((id) => id.split(":")[0]));
  for (const o of w.objects.filter((x) => x.type === "tram-stop")) assert.ok(served.has(o.id), `${o.id} served (${[...served].join(", ")})`);
});
