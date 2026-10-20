// The operations plan (ops/plan.js): the trains of an hour at Bf Neustadt with their units and
// drivers (the railway undertaking) and tracks (the infrastructure); the checks, the run's schedule,
// Run on the layout with the boards and the result, the plan kept in the layout file.
import assert from "node:assert/strict";
import test from "node:test";

import { OpsPlan, createWorld, planOf, registry, validateLayout } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");

/** Bf Neustadt with its module Operations. */
function neustadt(seed = 2) {
  const world = createWorld(NEUSTADT, { seed });
  world.setLayers(["plan"]);
  return world;
}

/** The kinds of the problems, train by train (only trains with problems). */
const kinds = (plan) => Object.fromEntries([...plan.checks()].filter(([, ps]) => ps.length).map(([id, ps]) => [id, ps.map((p) => p.kind)]));

/** The plan that works: every problem of the draft solved. */
function solve(plan) {
  plan.set("s1-0725", "unit", "442 102").set("s1-0725", "track", "G2");
  plan.set("s1-0745", "driver", "becker").set("s1-0745", "track", "G3");
  plan.set("rb71-0752", "unit", "442 202").set("rb71-0752", "driver", "weber");
  return plan;
}

/** Run the world until the plan's run is over. */
function play(world, plan) {
  for (let i = 0; i < 40000 && plan.running; i++) world.step(0.05);
  assert.equal(plan.running, null, "the run ended");
}

test("the checks: what does not work, for the railway undertaking and for the infrastructure", () => {
  const plan = planOf(neustadt());
  assert.ok(plan instanceof OpsPlan);
  assert.deepEqual(plan.tracks.map((t) => t.id), ["G1", "G2", "G3"], "the platform tracks of the station");
  assert.deepEqual(kinds(plan), {
    "s1-0725": ["places", "track-taken"],
    "s1-0745": ["driver-out", "track"],
    "rb71-0752": ["unit-out", "shift"],
  });
  const texts = [...plan.checks().values()].flat().map((p) => p.text);
  assert.ok(texts.includes("Too few places: 216 for 420"), texts.join("\n"));
  assert.ok(texts.includes("Track G3 is taken by RB 71 until 07:24"));
  assert.ok(texts.includes("Weber is still out until 07:45"));
  assert.ok(texts.includes("442 201 is still out until 07:52"));
  assert.ok(texts.includes("Outside the shift of Becker (05:30–08:10)"));
  assert.equal(plan.problems("evu").length, 4);
  assert.equal(plan.problems("infra").length, 2);
  solve(plan);
  assert.deepEqual(kinds(plan), {}, "the plan works");
  // taking things off
  plan.set("re2-0723", "unit", null).set("re2-0723", "driver", "").set("re2-0723", "track", null);
  assert.deepEqual(kinds(plan), { "re2-0723": ["unit", "driver", "track"] });
  plan.reset();
  assert.equal(plan.problems().length, 6, "Start again: the plan as the layout has it");
});

test("a train longer than its platform; the length of a train without a unit is its line's usual", () => {
  const world = neustadt();
  const plan = planOf(world);
  plan.units.push(plan._unit({ id: "long", vehicles: [{ type: "br146" }, { type: "dbpza", count: 9 }] }));
  plan.set("re2-0723", "unit", "long");
  const p = plan.checks().get("re2-0723").find((x) => x.kind === "length");
  assert.ok(p, "too long");
  assert.match(p.text, /^Too long: 2\d\d m for 224 m$/);
  plan.set("re2-0723", "unit", null);
  assert.equal(Math.round(plan.consistOf("re2-0723").length_m), 126, "RE: a locomotive with four double-deck coaches");
  assert.equal(Math.round(plan.consistOf("s1-0705").length_m), 66);
});

test("the run's schedule: a train waits for its track, unit and driver; without one it is cancelled", () => {
  const plan = planOf(neustadt());
  const s = plan.schedule();
  assert.deepEqual(s.get("s1-0705"), { arrive: 422, depart: 425, delay: 0, cancelled: null });
  // the S 1 at 07:25 waits for track G3 (RB 71 until 07:22, then 2 minutes)
  assert.deepEqual(s.get("s1-0725"), { arrive: 444, depart: 449, delay: 4, cancelled: null });
  assert.equal(s.get("s1-0745").cancelled, "no track");
  assert.equal(s.get("rb71-0752").cancelled, "the driver's shift");
  solve(plan);
  for (const [id, x] of plan.schedule()) assert.deepEqual([id, x.delay, x.cancelled], [id, 0, null]);
  // a driver still out: the train waits until the driver is back
  plan.set("s1-0745", "driver", "weber");
  assert.equal(plan.schedule().get("s1-0745").delay, 5, "Weber is back at 07:45: in at 07:45, out at 07:50");
});

test("Run plays the plan on the layout: its trains, the boards, the result; the tracks go back to the timetable", () => {
  const world = neustadt();
  const plan = planOf(world);
  const came = [], boards = new Set();
  world.events.on("vehicle.arrived", ({ vehicle }) => vehicle.plan && came.push(vehicle));
  assert.ok(plan.canRun);
  assert.ok(plan.run());
  assert.equal(world.clock.label(), "07:00");
  assert.ok([...world.services.docks.values()].filter((st) => st.dock.kind === "rail").every((st) => st.mode === "plan"), "its tracks");
  for (let i = 0; i < 40000 && plan.running; i++) {
    world.step(0.05);
    if (i % 100) continue;
    for (const a of world.stopAreas()) for (const line of plan.statusLines(a)) boards.add(line);
  }
  assert.equal(plan.running, null);
  assert.deepEqual(came.map((v) => [v.line, v.dock.track]), [
    ["S 1 → Talsee 07:05", "G2"], ["RB 71 → Bergdorf 07:22", "G3"], ["RE 2 → Altstadt 07:23", "G1"], ["S 1 → Talsee 07:25", "G3"],
  ]);
  const s1 = came[3];
  assert.equal(s1.consistSpec.name, "442 202", "with its unit");
  assert.deepEqual(s1.info, ["442 202 · Weber", "+4 min"]);
  assert.equal(world.services.capacityOf(s1), 216);
  const card = Object.fromEntries(world.services.card({ ref: s1 }).rows);
  assert.equal(card.Unit, "442 202");
  assert.equal(card.Driver, "Weber");
  assert.equal(card.Delay, "+4 min");
  assert.ok(boards.has("S 1 07:45 cancelled") && boards.has("S 1 → Talsee 07:25 +4"), [...boards].join("\n"));
  assert.deepEqual({ ...plan.result, trains: undefined }, { trains: undefined, onTime: 3, late: 1, cancelled: 2, leftBehind: 204 });
  assert.ok([...world.services.docks.values()].every((st) => st.mode === "timetable"), "the timetable again");
  // the plan that works: all on time, nobody left behind
  solve(plan).run();
  play(world, plan);
  assert.deepEqual({ ...plan.result, trains: undefined }, { trains: undefined, onTime: 6, late: 0, cancelled: 0, leftBehind: 0 });
});

test("the plan stays as it is while it runs; setting the clock or switching the module off ends a run", () => {
  const world = neustadt();
  const plan = planOf(world);
  plan.run();
  for (let i = 0; i < 400; i++) world.step(0.05);
  assert.ok(plan.running);
  plan.set("s1-0745", "track", "G3").reset();
  assert.equal(plan.get("s1-0745").track, null, "no change while it runs");
  world.setTime("12:00");
  assert.equal(plan.running, null);
  assert.equal(world.services.planner, null);
  plan.run();
  world.setLayers([]);
  assert.equal(planOf(world), null);
  assert.equal(world.services.planner, null, "the tracks are the timetable's again");
});

test("the layout file keeps the plan as it is; the check names what is missing", () => {
  const world = neustadt();
  solve(planOf(world));
  const json = world.toJSON();
  const entry = json.layers.find((l) => l.id === "plan").simulations[0];
  const s1 = entry.trains.find((t) => t.id === "s1-0745");
  assert.deepEqual([s1.unit, s1.driver, s1.track], ["442 101", "becker", "G3"]);
  // loaded again: the plan works
  const again = createWorld(json, { seed: 2 });
  again.setLayers(["plan"]);
  assert.equal(planOf(again).problems().length, 0);
  // the layout check
  assert.deepEqual(OpsPlan.validate({ trains: [] }), ["no trains"]);
  const bad = OpsPlan.validate({ units: [{ id: "u" }], drivers: [{ id: "d", from: "7" }], trains: [{ id: "t", line: "S 1", arr: "x", dep: "07:05", unit: "nope", driver: "d" }] });
  assert.deepEqual(bad, ['train t: arr and dep as "HH:MM"', "train t: no unit nope", "unit u: id and type (or vehicles)", "driver d: id, from and to"]);
  assert.deepEqual(validateLayout(NEUSTADT, registry), [], "Bf Neustadt is sound");
});
