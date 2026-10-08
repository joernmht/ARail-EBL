// Journeys (web/arail/journeys/): the lab example's module, the timetable at the platforms, the
// planner (walks, buses, trains with a change), travellers following their plans, cancellations and
// holds, saving and starting again, the rail operations' trains, other passengers switched off, and
// the validation (one per layout).
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createWorld, journeysOf, layoutPlugins, loadPlugins, registry, sameLine, statusLines, validateLayout, withLayers } from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const LAB = readJSON("web/layouts/ebl-lab.json");
await loadPlugins(layoutPlugins(LAB), pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);

const at = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hm = (t) => `${String(Math.floor((t % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** The lab example with the journeys (and these other modules) on, started. */
function lab(more = []) {
  const world = createWorld(withLayers(LAB, ["journeys", ...more]));
  world.step(0.1);
  return { world, j: journeysOf(world) };
}

/** Run until the clock shows `hhmm` (same day). */
function runUntil(world, hhmm, each = null) {
  world.speed = 10;
  let guard = 0;
  while (world.clock.minutes < at(hhmm) && guard++ < 1e6) {
    world.step(0.1);
    each?.();
  }
}

const B = (id) => ({ kind: "building", id });
const S = (id) => ({ kind: "station", id });

test("journeys module: the town's people stay at home, no other passengers, the trains run to the timetable", () => {
  const { world, j } = lab();
  assert.ok(j, "a journeys simulation");
  assert.equal(world.simulations.find((s) => s.constructor.type === "town").enabled, false);
  assert.equal(world.simulations.find((s) => s.constructor.type === "passengers").others, false);
  assert.equal(world.services.planner, j, "the journeys run the trains at the platforms");
  for (const id of ["platform-1:left", "platform-1:right", "platform-2:left", "platform-2:right"]) assert.equal(world.services.docks.get(id).mode, "plan", id);
  runUntil(world, "07:40");
  const pax = world.simulations.find((s) => s.constructor.type === "passengers");
  assert.equal([...pax.crowds.values()].reduce((n, c) => n + c.people.length, 0), 0, "nobody at the stops");
  // the S 8 to Waldau stands at platform 2 for its departure at 07:41, and the board says so
  const s8 = [...world.services.docks.values()].find((st) => st.vehicle?.line === "S 8 → Waldau 07:41");
  assert.ok(s8, "S 8 07:41 at a platform");
  assert.equal(s8.dock.area.id, "platform-2");
  assert.ok(statusLines(world, world.getStopArea("platform-2")).some((l) => l.startsWith("S 8 → Waldau 07:41") || l.startsWith("S 2 → Talsee")), statusLines(world, world.getStopArea("platform-2")).join(" / "));
});

test("planner: places, plans with walks, buses and trains, and a change of trains with the transfer time kept", () => {
  const { j } = lab();
  const places = j.places();
  assert.ok(places.some((p) => p.kind === "building" && p.id === "plattenbau-2"));
  assert.deepEqual(places.filter((p) => p.kind === "station").map((p) => p.name), ["Altstadt", "Bergheim", "Talsee", "Waldau"]);
  // from a house to a station beyond the layout: walk to platform 2, S 8
  const out = j.plan({ from: B("plattenbau-2"), to: S("waldau"), leave: "07:20" });
  assert.ok(out.length >= 2);
  assert.deepEqual(out[0].legs.map((l) => l.type), ["walk", "train"]);
  const s8 = out[0].legs[1];
  assert.equal(s8.name, "S 8");
  assert.equal(s8.platform, "Platform 2");
  assert.equal(hm(s8.dep), "07:41");
  assert.ok(s8.dep - out[0].legs[0].arr >= 3, "at the platform the transfer time before the train leaves");
  assert.equal(hm(out[1].legs[1].dep), "08:11", "the next departure is offered too");
  // from a station to another one: a change of trains at the Bahnhof, walking from platform 1 to 2
  const change = j.plan({ from: S("altstadt"), to: S("waldau"), leave: "07:20", transfer: 3 })[0];
  assert.deepEqual(change.legs.map((l) => l.type), ["train", "walk", "train"]);
  assert.equal(change.transfers, 1);
  const [re1, walk, next] = change.legs;
  assert.equal(re1.name, "RE 1");
  assert.equal(walk.fromName, "Platform 1");
  assert.equal(walk.toName, "Platform 2");
  assert.ok(next.dep >= walk.arr + 3, `${hm(walk.arr)} + 3 min before ${hm(next.dep)}`);
  // a longer transfer time can take a later train
  const relaxed = j.plan({ from: S("altstadt"), to: S("waldau"), leave: "07:20", transfer: 20 })[0];
  assert.ok(relaxed.legs.at(-1).dep >= relaxed.legs[1].arr + 20);
  // between two buildings: on foot, and by bus
  const town = j.plan({ from: B("estate-1"), to: B("office-1"), leave: "07:20" });
  assert.ok(town.some((p) => p.legs.length === 1 && p.legs[0].type === "walk"));
  assert.ok(town.some((p) => p.legs.some((l) => l.type === "bus" && /^Bus \d+$/.test(l.name) && l.every > 0)));
  for (const p of [...out, change, ...town]) {
    let t = p.dep;
    for (const l of p.legs) {
      assert.ok(l.dep >= t - 1e-9, `${l.type} leaves ${hm(l.dep)} not before ${hm(t)}`);
      t = l.arr;
    }
    assert.equal(p.arr, t);
  }
  assert.deepEqual(j.plan({ from: B("plattenbau-2"), to: B("plattenbau-2"), leave: "07:20" }), [], "nowhere to go");
  assert.deepEqual(j.plan({ from: B("nope"), to: S("waldau"), leave: "07:20" }), []);
});

test("travellers follow their plans: on foot, by bus and by train, with a change of trains", () => {
  const { world, j } = lab();
  const add = (from, to, leave, pick = (p) => p[0]) => j.addTraveller({ from, to, plan: pick(j.plan({ from, to, leave })) });
  const a = add(B("plattenbau-2"), S("waldau"), "07:20");
  const b = add(S("altstadt"), S("waldau"), "07:20");
  const c = add(S("talsee"), B("estate-1"), "07:05");
  const d = add(B("estate-1"), B("office-1"), "07:10", (p) => p.find((x) => x.legs.some((l) => l.type === "bus")));
  assert.deepEqual(j.travellers.map((t) => t.number), [1, 2, 3, 4]);
  assert.equal(new Set(j.travellers.map((t) => t.name)).size, 4, "names of their own");
  assert.deepEqual(j.travellers.map((t) => t.state), ["home", "home", "home", "home"]);
  const seen = new Set();
  runUntil(world, "09:45", () => {
    for (const t of j.travellers) seen.add(`${t.id}:${t.state}`);
  });
  for (const t of [a, b, c, d]) assert.equal(t.state, "arrived", `${t.name}: ${j.status(t).text}\n${t.log.map((e) => `${hm(e.t)} ${e.text}`).join("\n")}`);
  for (const t of [a, b, c]) assert.ok(Math.abs(t.arrived - t.plannedArrival) <= 3, `${t.name} by train on time: ${hm(t.arrived)} for ${hm(t.plannedArrival)}`);
  assert.ok(Math.abs(d.arrived - d.plannedArrival) <= 15, `${d.name} by bus about on time: ${hm(d.arrived)} for ${hm(d.plannedArrival)}`);
  for (const s of ["t1:walking", "t1:waiting", "t1:train", "t2:beyond", "t2:alighting", "t4:bus"]) assert.ok(seen.has(s), s);
  assert.ok(b.log.some((e) => /^S 8 → Waldau 09:11 from Platform 2$/.test(e.text)), b.log.map((e) => e.text).join(" / "));
  assert.equal(b.missed, 0);
  const rows = j.results();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.state === "arrived" && Number.isFinite(r.delay)));
  assert.equal(rows[1].transfers, 1);
});

test("a cancelled train: the traveller takes the next one of its line; a hold makes it late", () => {
  const { world, j } = lab();
  const plan = j.plan({ from: B("plattenbau-2"), to: S("waldau"), leave: "07:20" })[0];
  const t = j.addTraveller({ name: "Ada Lovelace", from: B("plattenbau-2"), to: S("waldau"), plan });
  assert.equal(t.name, "Ada Lovelace");
  let started = false;
  runUntil(world, "08:50", () => {
    if (!started && world.clock.minutes >= at("07:30")) {
      started = true;
      world.disruptions.start({ type: "cancellation", target: "platform-2", params: { minutes: 1 } });
    }
  });
  assert.equal(t.state, "arrived");
  assert.equal(hm(t.arrived), "08:35", "with the S 8 at 08:11");
  assert.equal(t.missed, 1);
  assert.ok(t.log.some((e) => e.text === "S 8 07:41 is cancelled. Next: 08:11."), t.log.map((e) => e.text).join(" / "));
  assert.ok(t.log.some((e) => e.text === "S 8 08:11 instead of 07:41"));
  assert.equal(j.results()[0].delay, 30);
  // a hold at the platform: the train leaves late, and arrives late
  const held = lab();
  const u = held.j.addTraveller({ from: B("plattenbau-2"), to: S("waldau"), plan: held.j.plan({ from: B("plattenbau-2"), to: S("waldau"), leave: "07:20" })[0] });
  let holding = false;
  runUntil(held.world, "08:30", () => {
    if (!holding && held.world.clock.minutes >= at("07:38")) {
      holding = true;
      held.world.disruptions.start({ type: "delay", target: "platform-2", params: { minutes: 1 } });
    }
  });
  assert.equal(u.state, "arrived");
  assert.equal(u.missed, 0, "the same train, late");
  assert.ok(u.arrived - u.plannedArrival >= 5, `${hm(u.arrived)} for ${hm(u.plannedArrival)}`);
});

test("travellers are kept in the layout; loaded again or with the clock set back, they start again", () => {
  const { world, j } = lab();
  const plan = j.plan({ from: S("bergheim"), to: B("school-1"), leave: "07:10" })[0];
  j.addTraveller({ name: "Grace", from: S("bergheim"), to: B("school-1"), plan });
  runUntil(world, "07:55");
  assert.equal(j.travellers[0].state, "train");
  const json = world.toJSON();
  assert.equal(json.simulations.some((s) => s.type === "journeys"), false, "not in the base");
  const saved = json.layers.find((l) => l.id === "journeys").simulations.find((s) => s.type === "journeys");
  assert.deepEqual(saved.travellers.map((t) => [t.name, t.leave, t.from, t.to]), [["Grace", at("07:10"), S("bergheim"), B("school-1")]]);
  assert.deepEqual(saved.travellers[0].plan.legs.map((l) => l.type), ["train", "walk"]);
  // loaded again: the journey starts again
  const again = createWorld(json);
  const t2 = journeysOf(again).travellers[0];
  assert.equal(t2.state, "home");
  runUntil(again, "09:00");
  assert.equal(t2.state, "arrived");
  // the clock set back before the departure: back at the start
  world.setTime("07:00");
  assert.equal(j.travellers[0].state, "home");
  assert.equal(j.status(j.travellers[0]).text, "Not left yet: leaves at 07:10");
  // switching the module off and on keeps them
  world.setLayers([]);
  assert.equal(journeysOf(world), null);
  world.setLayers(["journeys"]);
  assert.equal(journeysOf(world).travellers[0].name, "Grace");
  // removed
  assert.equal(journeysOf(world).removeTraveller("t1"), true);
  assert.equal(journeysOf(world).travellers.length, 0);
});

test("with rail operations: the journeys take the operations' trains", () => {
  const { world, j } = lab(["operations"]);
  for (let i = 0; i < 10; i++) world.step(0.1);
  assert.equal(j.rail().kind, "operations");
  assert.notEqual(world.services.planner, j);
  const plan = j.plan({ from: B("plattenbau-2"), to: S("talsee"), leave: "07:20" })[0];
  assert.equal(plan.legs[1].name, "S 2");
  const t = j.addTraveller({ from: B("plattenbau-2"), to: S("talsee"), plan });
  runUntil(world, "08:40");
  assert.equal(t.state, "arrived", `${j.status(t).text}\n${t.log.map((e) => `${hm(e.t)} ${e.text}`).join("\n")}`);
  assert.ok(t.log.some((e) => e.text.startsWith("S 2 → Talsee")), t.log.map((e) => e.text).join(" / "));
});

test("a layout of its own: the network from the platforms' lines, other passengers switched off", () => {
  const world = createWorld({
    objects: [
      { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both", lines: "S 1" },
      { id: "home", type: "house", position: [400, -300] },
      { id: "path", type: "road", kind: "path", points: [[0, -150], [800, -150]] },
    ],
    simulations: [{ type: "passengers", others: false }, { type: "journeys" }],
    clock: { start: "08:00" },
  });
  world.step(0.1);
  const j = journeysOf(world);
  const stations = j.places().filter((p) => p.kind === "station");
  assert.equal(stations.length, 1, "one line out to a station beyond the layout");
  const plan = j.plan({ from: B("home"), to: stations[0], leave: "08:05" })[0];
  assert.ok(plan, "a plan");
  assert.deepEqual(plan.legs.map((l) => l.type), ["walk", "train"]);
  const t = j.addTraveller({ from: B("home"), to: stations[0], plan });
  runUntil(world, "10:30");
  assert.equal(t.state, "arrived", `${j.status(t).text}\n${t.log.map((e) => `${hm(e.t)} ${e.text}`).join("\n")}`);
  const pax = world.simulations[0];
  assert.equal([...pax.crowds.values()].reduce((n, c) => n + c.people.length, 0), 0, "no other passengers got off the trains");
});

test("journeys: names of lines, validation", () => {
  assert.ok(sameLine("S 8", "S 8"));
  assert.ok(sameLine("s8", "S 8"));
  assert.ok(sameLine("S 8 → Waldau 07:41", "S 8"));
  assert.equal(sameLine("S 80", "S 8"), false);
  assert.equal(sameLine("", "S 8"), false);
  const problems = validateLayout({
    objects: [{ id: "p1", type: "platform", from: [0, 0], to: [800, 0] }],
    simulations: [{
      type: "journeys",
      stations: [{ id: "a", platforms: ["p1", "nope"] }, { id: "a" }],
      lines: [{ id: "L", route: ["a", "x"], first: "5 o'clock" }],
      travellers: [{ id: "t1", name: "Ada", from: { kind: "house", id: "h" }, to: { kind: "building", id: "gone" }, plan: {} }, { id: "t1" }],
    }],
  }, registry);
  for (const p of [
    'simulations[0] (journeys): stations[0] (a): no platform "nope" on the layout',
    'simulations[0] (journeys): stations[1]: duplicate id "a"',
    'simulations[0] (journeys): lines[0] (L): no station "x"',
    'simulations[0] (journeys): lines[0] (L): first must be a time like "05:30"',
    'simulations[0] (journeys): travellers[0] (Ada): from must be {"kind": "building" | "station", "id": …}',
    'simulations[0] (journeys): travellers[0] (Ada): to: no building "gone" on the layout',
    "simulations[0] (journeys): travellers[0] (Ada): plan.legs must be a list of legs",
    'simulations[0] (journeys): travellers[1]: duplicate id "t1"',
  ]) assert.ok(problems.includes(p), `${p}\n in ${problems.join("\n")}`);
  // one per layout: the first one is used, another one stays idle
  const twice = {
    objects: [{ id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both", lines: "S 1" }],
    simulations: [{ type: "passengers", others: false }, { type: "journeys" }, { type: "journeys" }],
  };
  assert.deepEqual(validateLayout(twice, registry), ["simulations[2] (journeys): only one journeys entry per layout (the first one is used)"]);
  const world = createWorld(twice);
  const [first, second] = world.simulations.filter((s) => s.constructor.type === "journeys");
  assert.equal(journeysOf(world), first);
  assert.equal(world.services.planner, first);
  assert.ok(first.active && !second.active);
});
