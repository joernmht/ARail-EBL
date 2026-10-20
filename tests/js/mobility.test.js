// Passenger mobility (core/mobility.js, #165): one kind of person with a profile of characteristics.
// The truncated normal walking speed (mean, spread, bounds, reproducible), the shares of the traits,
// walking speeds, boarding times by the step and the help there, the room people take; heights of
// platforms and kerbs; at the stops: wheelchair users left behind or helped, people one after the
// other at a door holding the doors open, full and squeezed vehicles; the town's residents with their
// profiles, cars and trips from door to door; the journeys' travellers planned with their own traits.
import assert from "node:assert/strict";
import test from "node:test";

import {
  aidShares, boardingAccess, boardingTime, carLegTime, createRng, createWorld, DEFAULT_MOBILITY, drawPerson, drawProfile, isLevel,
  journeysOf, luggageShares, MOBILITY_PARAMS, mobilityOf, mobilitySettings, normalizeProfile, PEOPLE, profileGroups, profileWords,
  registry, spaceOf, validateLayout, vehicleSpaces, walkingSpeed, withLayers,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const mob = DEFAULT_MOBILITY;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

test("the walking speed: a normal distribution cut to 0.5–2.2 m/s, with one random number a draw", () => {
  const rng = createRng(11);
  const xs = Array.from({ length: 40000 }, () => rng.truncNormal(1.34, 0.26, 0.5, 2.2));
  assert.ok(Math.abs(mean(xs) - 1.34) < 0.01, `mean ${mean(xs)}`);
  assert.ok(Math.abs(sd(xs) - 0.26) < 0.01, `spread ${sd(xs)} (a little less than 0.26: cut at 3 σ)`);
  assert.ok(Math.min(...xs.slice(0, 1000)) >= 0.5 && Math.max(...xs.slice(0, 1000)) <= 2.2);
  // the same seed, the same speeds; the bounds do not change what is drawn after
  const a = createRng(5), b = createRng(5);
  assert.equal(a.truncNormal(1.34, 0.26, 0.5, 2.2), b.truncNormal(1.34, 0.26, 0.5, 2.2));
  const c = createRng(5), d = createRng(5);
  c.truncNormal(1.34, 0.26, 1.3, 1.31);
  d.truncNormal(1.34, 0.26);
  assert.equal(c.next(), d.next(), "one random number, whatever the bounds");
  assert.equal(createRng(1).truncNormal(2, 0), 2, "without a spread: the mean");
});

test("profiles: the shares of the traits, the luggage of long trips, drivers", () => {
  const rng = createRng(3), n = 30000;
  const all = Array.from({ length: n }, () => drawProfile(rng, {}, mob));
  const share = (f) => all.filter(f).length / n;
  assert.ok(Math.abs(share((p) => p.age === "child") - mob.child.share) < 0.01);
  assert.ok(Math.abs(share((p) => p.age === "old") - mob.old.share) < 0.01);
  assert.ok(Math.abs(share((p) => p.aid === "wheelchair") - mob.wheelchair.share) < 0.003);
  const old = all.filter((p) => p.age === "old");
  assert.ok(Math.abs(old.filter((p) => p.aid === "rollator").length / old.length - mob.rollator.share) < 0.015, "rollators of the old");
  assert.ok(all.filter((p) => p.age === "child").every((p) => !p.licence && !p.car && p.aid !== "rollator" && p.aid !== "stick" && p.aid !== "pram"));
  const adults = all.filter((p) => p.age === "adult");
  assert.ok(Math.abs(adults.filter((p) => p.licence).length / adults.length - mob.adult.licence) < 0.015);
  assert.ok(all.every((p) => !p.car || p.licence), "a car only with a licence");
  assert.ok(Math.abs(mean(all.map((p) => p.base_mps)) - mob.everybody.walk_mps) < 0.01);
  // heavy luggage grows with the length of the trip; half of it to work
  const heavy = (ctx) => Object.fromEntries(luggageShares(ctx, "adult", mob)).heavy;
  assert.equal(heavy({ km: 2 }), mob.heavy.share);
  assert.equal(heavy({ km: 300 }), mob.heavy.share_long);
  assert.ok(heavy({ km: 50 }) > heavy({ km: 10 }));
  assert.equal(heavy({ km: 300, purpose: "work" }), mob.heavy.share_long / 2);
  const long = Array.from({ length: 5000 }, () => drawProfile(rng, { km: 300 }, mob));
  assert.ok(Math.abs(long.filter((p) => p.luggage === "heavy" && p.age !== "child").length / long.filter((p) => p.age !== "child").length - mob.heavy.share_long) < 0.03);
  // drivers have a licence and a car, and are no children
  for (let i = 0; i < 500; i++) {
    const p = drawProfile(rng, { driver: true }, mob);
    assert.ok(p.licence && p.car && p.age !== "child");
  }
  // what is fixed is kept; the same random numbers are taken either way
  const x = createRng(9), y = createRng(9);
  const fixed = drawProfile(x, { age: "old", aid: "rollator", luggage: "heavy" }, mob);
  drawProfile(y, {}, mob);
  assert.deepEqual([fixed.age, fixed.aid, fixed.luggage], ["old", "rollator", "heavy"]);
  assert.equal(x.next(), y.next());
  assert.deepEqual(aidShares("child", mob).filter(([, s]) => s > 0).map(([a]) => a), ["wheelchair"]);
});

test("walking speed: the base × the factors of age, aid and luggage, cut to 0.3–2.2 m/s", () => {
  const p = { age: "old", aid: "rollator", luggage: "heavy", base_mps: 1.4 };
  assert.equal(walkingSpeed(p, mob), Math.round(1.4 * 0.83 * 0.46 * 0.85 * 100) / 100);
  assert.equal(walkingSpeed({ age: "adult", aid: "none", luggage: "none", base_mps: 1.34 }, mob), 1.34);
  assert.equal(walkingSpeed({ age: "old", aid: "rollator", luggage: "bulky", base_mps: 0.5 }, mob), 0.3, "never slower than 0.3 m/s");
  assert.equal(walkingSpeed(null, mob), mob.everybody.walk_mps);
  // the settings change it
  const slow = mobilitySettings({ people: { old: { speed: 0.5 }, everybody: { walk_mps: 9 } } });
  assert.equal(slow.old.speed, 0.5);
  assert.equal(slow.old.board, mob.old.board, "the cells not given: their defaults");
  assert.equal(slow.everybody.walk_mps, 2, "cut to its range");
  assert.equal(mobilitySettings({ people: { old: { speed: "x" } } }).old.speed, mob.old.speed, "not a number: the default");
  assert.deepEqual(mobilitySettings({ people: "x", standing_per_m2: 3 }), { ...mob, standing_per_m2: 3 }, "no table: the defaults");
  assert.equal(walkingSpeed({ age: "old", aid: "none", luggage: "none", base_mps: 1.2 }, slow), 0.6);
  const cells = [...PEOPLE.flatMap((r) => Object.values(r.cells)), ...MOBILITY_PARAMS.filter((q) => q.type === "number")];
  assert.ok(cells.every((q) => q.source && q.label && q.unit && q.default >= q.min && q.default <= q.max), "every setting has a source and a default in its range");
  assert.deepEqual(MOBILITY_PARAMS.map((q) => q.key), ["people", "standing_per_m2", "onboard_share"], "one table and the room in the vehicles");
  assert.equal(MOBILITY_PARAMS[0].default, undefined, "a layout keeps only the cells it changes");
  // a chosen profile: an adult without aids at the mean speed, unless it says otherwise
  assert.deepEqual(normalizeProfile({}), { age: "adult", aid: "none", luggage: "none", licence: true, car: false, base_mps: mob.everybody.walk_mps });
  assert.deepEqual(normalizeProfile({ age: "child", aid: "bogus", licence: true }), { age: "child", aid: "none", luggage: "none", licence: false, car: false, base_mps: mob.everybody.walk_mps });
  assert.equal(profileWords(normalizeProfile({ age: "old", aid: "rollator", luggage: "heavy" })), "old · rollator · heavy luggage");
  assert.equal(profileWords(normalizeProfile({})), "no special needs");
  assert.deepEqual(profileGroups({ age: "old", aid: "wheelchair", luggage: "heavy", licence: false, car: false }), ["all", "old", "wheelchair", "luggage", "captive"]);
});

test("boarding: the step, the traits, the luggage; a wheelchair needs level boarding or help", () => {
  const adult = normalizeProfile({}), old = normalizeProfile({ age: "old" }), wheelchair = normalizeProfile({ aid: "wheelchair" });
  assert.equal(isLevel(0.05, 0.05), true);
  assert.equal(isLevel(-0.06, 0), false, "a step down counts too");
  assert.equal(boardingTime(adult, {}, mob).s, 1.5);
  assert.equal(boardingTime(adult, { step_m: 0.2 }, mob).s, 2.3, "+0.4 s per 10 cm");
  assert.equal(boardingTime(old, {}, mob).s, Math.round(1.5 * 1.3 * 10) / 10, "little extra at level boarding");
  assert.equal(boardingTime(old, { step_m: 0.2 }, mob).s, Math.round(2.3 * 2.5 * 10) / 10, "much more with a step");
  assert.equal(boardingTime(normalizeProfile({ luggage: "heavy" }), { step_m: 0.2 }, mob).s, 2.3 + 6, "loading twice as long with a step");
  assert.deepEqual(boardingTime(wheelchair, {}, mob), { s: 3.8, ok: true, level: true, assist: null, help: 0, why: null, extra: { age: 0, aid: 2.3, luggage: 0 } });
  const no = boardingTime(wheelchair, { step_m: 0.2 }, mob);
  assert.equal(no.ok, false);
  assert.equal(no.why, "no level boarding");
  const ramp = boardingTime(wheelchair, { step_m: 0.14, assist: "ramp" }, mob);
  assert.ok(ramp.ok && ramp.assist === "ramp" && ramp.help === mob.wheelchair.ramp_s && ramp.s === Math.round((mob.wheelchair.ramp_s + 1.5 * 2.5) * 10) / 10);
  assert.equal(boardingTime(wheelchair, { step_m: 0.3, assist: "ramp" }, mob).ok, false, "too high for the ramp");
  assert.equal(boardingTime(wheelchair, { step_m: 0.4, assist: "lift" }, mob).s, Math.round((mob.wheelchair.lift_s + 3.75) * 10) / 10);
});

test("space: a person 1, a child less; aids and luggage add, squeezed down to their least", () => {
  assert.deepEqual(spaceOf(normalizeProfile({}), {}, mob), { space: 1, min: 0.8, wheelchair: false });
  assert.deepEqual(spaceOf(normalizeProfile({ age: "child" }), {}, mob), { space: 0.7, min: 0.56, wheelchair: false });
  assert.deepEqual(spaceOf(normalizeProfile({ aid: "pram" }), {}, mob), { space: 2.5, min: 2, wheelchair: false });
  assert.deepEqual(spaceOf(normalizeProfile({ aid: "wheelchair" }), {}, mob), { space: 2.5, min: 2.3, wheelchair: true }, "a wheelchair is not squeezed");
  assert.equal(spaceOf(normalizeProfile({ luggage: "heavy" }), {}, mob).space, 1.5);
  assert.equal(spaceOf(normalizeProfile({ luggage: "heavy" }), { racks: true }, mob).space, 1, "in the racks of a train");
  assert.equal(carLegTime([normalizeProfile({ aid: "pram" }), normalizeProfile({ luggage: "heavy" }), normalizeProfile({})], mob), mob.pram.car_s + mob.heavy.car_s);
});

/** A platform and a bus stop on a street, with a bus line to a second stop, and the passengers (only the people handed over). */
function stops(platform = {}, more = {}) {
  return createWorld({
    objects: [
      { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both", lines: "S 1", ...platform },
      { id: "main", type: "road", points: [[0, 600], [4000, 600]] },
      { id: "a", type: "bus-stop", name: "West", position: [500, 530], side: "both" },
      { id: "b", type: "bus-stop", name: "East", position: [3500, 530], side: "both" },
    ],
    simulations: [{ type: "passengers", base_rate: 0, others: false, ...more }],
    clock: { start: "10:00", profiles: false },
  }, { seed: 7 });
}

test("heights: a platform's height, a bus stop's kerb; the step into the vehicles and the help there", () => {
  const w = stops();
  const p1 = w.getStopArea("p1");
  assert.equal(p1.height_m, 0.76, "EBO: 76 cm by default");
  assert.deepEqual(boardingAccess(w, p1, "train"), { step_m: 0, gap_m: 0.05, level: true, assist: null });
  w.getObject("p1").set({ height_m: 0.38, assistance: true });
  w.step(0.1);
  const low = boardingAccess(w, w.getStopArea("p1"), "train");
  assert.equal(low.step_m, 0.38);
  assert.equal(low.level, false);
  assert.equal(low.assist, "lift", "the station's staff by day");
  assert.equal(boardingAccess(w, w.getStopArea("p1"), "train", 23 * 60).assist, null, "not at night");
  const kerb = w.stopAreas().find((a) => a.owner?.id === "a");
  assert.equal(kerb.height_m, 0.18, "a raised bus kerb");
  const bus = boardingAccess(w, kerb, "bus");
  assert.equal(bus.step_m, 0.14);
  assert.equal(bus.assist, "ramp");
  assert.equal(w.getObject("p1").card().rows.find((r) => r[0] === "Platform height")[1], "38 cm");
  // the places of the vehicles
  assert.deepEqual(vehicleSpaces(w, { kind: "bus" }, mob), { seats: 32, spaces: 76, wheelchair: 1 });
  const train = vehicleSpaces(w, { kind: "train", dock: p1.docks[0] }, mob);
  assert.ok(train.seats >= 80 && train.spaces === train.seats + (train.seats / 80) * 40, JSON.stringify(train));
});

/** Run a world for `seconds` of simulated time. */
function run(world, seconds, dt = 0.1, each = null) {
  world.speed = 1;
  for (let t = 0; t < seconds; t += dt) {
    world.step(dt);
    each?.();
  }
}

test("at a platform with a step: a wheelchair user is left behind without help, and gets on with the staff's lift", () => {
  for (const assistance of [false, true]) {
    const w = stops({ height_m: 0.38, assistance });
    const sim = w.simulations[0], events = [];
    for (const name of ["passenger.boarded", "passenger.denied"]) w.events.on(name, (e) => events.push({ name, ...e }));
    const agent = { id: "wc", profile: normalizeProfile({ aid: "wheelchair" }) };
    sim.enter("p1", { agent, at: [400, 0] });
    run(w, 300);
    if (assistance) {
      assert.ok(events.some((e) => e.name === "passenger.boarded" && e.agent === agent), "on board with the lift");
      assert.ok(sim.stats("p1").doorS >= mob.wheelchair.lift_s, "the lift took its time");
    } else {
      const denied = events.filter((e) => e.name === "passenger.denied" && e.agent === agent);
      assert.ok(denied.length >= 1 && denied.every((e) => e.reason === "step"), "left behind: no level boarding");
      assert.ok(!events.some((e) => e.name === "passenger.boarded"));
      assert.ok(sim.stats("p1").denied.step >= 1 && sim.stats("p1").deniedGroups.wheelchair >= 1);
      const p = sim.crowds.get("p1").people.find((q) => q.agent === agent);
      assert.equal(p.state, "waiting", "it waits for the next train (its owner decides)");
      assert.ok(p.mood < 0.7);
      assert.ok(sim.card({ label: "x", ref: { person: p, area: w.getStopArea("p1") } }).rows.some((r) => r[0] === "Left behind"));
    }
  }
});

test("doors: people get on one after the other, a slow one holds up those behind, and the train waits for them", () => {
  const w = stops({ height_m: 0.38 });
  const sim = w.simulations[0], boarded = [];
  w.events.on("passenger.boarded", (e) => boarded.push({ t: w.time, agent: e.agent, vehicle: e.vehicle }));
  let departed = null, arrived = null;
  w.events.on("vehicle.arrived", (e) => (arrived ??= { t: w.time, v: e.vehicle }));
  w.events.on("vehicle.departing", (e) => e.vehicle === arrived?.v && (departed ??= w.time));
  // six old people with rollators at the same spot: one door, the multi-purpose area's
  const agents = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, profile: normalizeProfile({ age: "old", aid: "rollator" }) }));
  for (const agent of agents) sim.enter("p1", { agent, at: [400, 0], dockId: "p1:left" });
  run(w, 400);
  const mine = boarded.filter((b) => agents.includes(b.agent));
  assert.ok(mine.length >= 2, `${mine.length} got on`);
  const first = mine.filter((b) => b.vehicle === mine[0].vehicle).map((b) => b.t);
  const each = boardingTime(agents[0].profile, { step_m: 0.38 }, mob).s;
  for (let i = 1; i < first.length; i++) assert.ok(first[i] - first[i - 1] >= each - 0.3, `one after the other: ${first.map((t) => t.toFixed(1)).join(", ")}`);
  assert.ok(departed - arrived.t > 24 + 1, `the doors stayed open past the dwell (${(departed - arrived.t).toFixed(1)} s)`);
  assert.ok(sim.stats("p1").held > 0);
});

test("room in the vehicles: squeezed in at a cost of mood, left behind when full; the load on the vehicle's card", () => {
  const w = stops();
  const sim = w.simulations[0], events = [];
  for (const name of ["passenger.boarded", "passenger.denied"]) w.events.on(name, (e) => events.push({ name, ...e }));
  const a = { id: "sq", profile: normalizeProfile({}) }, b = { id: "full", profile: normalizeProfile({}) };
  // the first train comes in nearly full: room for one squeezed person
  let first = null;
  w.events.on("vehicle.arrived", ({ vehicle }) => {
    first ??= vehicle;
    if (vehicle === first && vehicle.load) vehicle.load.spaces = vehicle.load.cap.spaces - 0.9;
  });
  sim.enter("p1", { agent: a, at: [400, 0], dockId: "p1:left", rideMin: 10 });
  run(w, 200, 0.1, () => {
    if (events.some((e) => e.name === "passenger.boarded" && e.agent === a) && !sim.crowds.get("p1").people.some((p) => p.agent === b)) sim.enter("p1", { agent: b, at: [400, 0], dockId: "p1:left" });
  });
  const got = events.find((e) => e.name === "passenger.boarded" && e.agent === a);
  assert.ok(got, "squeezed in");
  assert.ok(Math.abs(got.person.squeezed - 0.1) < 1e-6 && got.person.space === 0.9);
  assert.ok(sim.stats("p1").squeezed >= 1 && sim.stats("p1").moodLost > 0);
  const card = { rows: [] };
  sim.describeVehicle(got.vehicle, card);
  assert.equal(card.rows[0][0], "Occupancy");
  assert.match(card.rows[0][1], /^\d+ of \d+ spaces/);
  const denied = events.filter((e) => e.name === "passenger.denied" && e.agent === b);
  assert.ok(denied.length && denied[0].reason === "full" && denied[0].vehicle === first, "the next one is left behind");
  assert.ok(sim.states().some((g) => g.id === "vehicles"), "the Overview has the vehicles by their load");
});

test("the settings of the passengers are the people's of the whole layout", () => {
  const w = stops({}, { people: { wheelchair: { share: 0.5 }, old: { speed: 0.6 } } });
  assert.equal(mobilityOf(w).wheelchair.share, 0.5);
  assert.equal(mobilityOf(w).old.speed, 0.6);
  const sim = w.simulations.find((s) => s.constructor.type === "passengers");
  assert.deepEqual(sim.toJSON().people, { wheelchair: { share: 0.5 }, old: { speed: 0.6 } }, "saved: only the cells it changes");
  assert.equal(stops().simulations[0].toJSON().people, undefined, "nothing changed, nothing saved");
  sim.config.people = { old: { speed: 0.7 } };
  assert.equal(mobilityOf(w).old.speed, 0.7, "a change of the table is seen");
  // the layout check names rows and cells it does not know
  const check = (people) => validateLayout({ objects: [], simulations: [{ type: "passengers", people }] }, registry);
  assert.deepEqual(check({ old: { speed: 0.7 } }), []);
  assert.deepEqual(check({ wheelchairs: { share: 0.02 }, old: { sped: 0.7, board: "x" } }), [
    'simulations[0] (passengers): people: no row "wheelchairs" (everybody, child, adult, old, stick, rollator, wheelchair, pram, light, heavy, bulky)',
    'simulations[0] (passengers): people.old: no cell "sped" (share, speed, board, board_step, licence)',
    "simulations[0] (passengers): people.old.board must be a number",
  ]);
  assert.equal(mobilityOf(null), DEFAULT_MOBILITY);
});

test("drawPerson: the room as a circle (area by the space), a pram and luggage as boxes", () => {
  const calls = [];
  const view = { simple: true, m: (x) => x * 10, polygon: (pts, style) => calls.push(["polygon", pts, style]), prism: (fp) => calls.push(["prism", fp]), block: () => calls.push(["block"]), dim: (c) => c };
  drawPerson(view, [0, 0], { colour: "#0a777f", space: 2.5, aid: "pram", luggage: "heavy" });
  const circle = calls.find((c) => c[0] === "polygon");
  const r = Math.hypot(...circle[1][0]) / 10;
  assert.ok(Math.abs(Math.PI * r * r - Math.PI * 0.09 * 2.5) < 1e-9, "its area is π · 0.3² m² × the spaces");
  assert.equal(calls.filter((c) => c[0] === "prism").length, 2, "the pram and the suitcase");
  calls.length = 0;
  drawPerson(view, [0, 0], { colour: "#0a777f" });
  assert.deepEqual(calls.map((c) => c[0]), ["block"], "without them: the person alone");
});

/** A small town with a platform and a station far away (long ways). */
function town(extra = {}, people = {}) {
  return createWorld({
    objects: [
      { id: "home", type: "plattenbau", position: [0, 700] },
      { id: "office", type: "office", position: [3000, 700] },
      { id: "main", type: "road", points: [[-300, 450], [3600, 450]] },
      { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both" },
    ],
    simulations: [{ type: "passengers", base_rate: 0, ...people }, { type: "town", people_per_100: 30, ...extra }],
    clock: { start: "05:30", factor: 12 },
  }, { seed: 4 });
}

test("the town: every resident has a profile from its own stream; some drive their long ways; trips from door to door", () => {
  const w = town({ car_share: 1 }), w2 = town({ car_share: 1 });
  w.step(0.1);
  w2.step(0.1);
  const t = w.simulations.find((s) => s.constructor.type === "town"), t2 = w2.simulations.find((s) => s.constructor.type === "town");
  assert.ok(t.agents.length > 20);
  assert.ok(t.agents.every((a) => a.profile && a.speed === walkingSpeed(a.profile, mobilityOf(w))));
  assert.deepEqual(t.agents.map((a) => a.profile), t2.agents.map((a) => a.profile), "the same seed, the same people");
  assert.ok(t.agents.filter((a) => a.role === "pupil").every((a) => a.profile.age === "child"));
  assert.ok(t.agents.filter((a) => a.role === "senior").every((a) => a.profile.age === "old"));
  assert.ok(new Set(t.agents.map((a) => a.speed)).size > 5, "everybody at a speed of their own");
  let driving = 0;
  w.speed = 10;
  for (let i = 0; i < 20000 && w.clock.minutes < 9 * 60; i++) {
    w.step(0.1);
    driving = Math.max(driving, t.townStats().driving);
  }
  assert.ok(driving > 0, "people with a licence and a car drive to the office");
  assert.ok(t.agents.filter((a) => a.state === "driving" || (a.trips || []).some((r) => r.parts.car > 0)).every((a) => a.profile.licence && a.profile.car), "only those who can");
  const stats = t.tripStats();
  const all = stats.find((r) => r.group === "all");
  assert.ok(all && all.trips > 0 && all.minutes > 0, JSON.stringify(stats));
  assert.ok(all.car > 0);
  const csv = t.tripsCSV().split("\n");
  assert.equal(csv[0], "id,name,characteristics,purpose,from,to,start,minutes,walk,wait,doors,ride,car,end");
  assert.ok(csv.length > 2);
  const someone = t.agents.find((a) => a.trips?.length);
  assert.ok(t.describeAgent(someone).sections.some((s) => s.title === "Door to door"));
  assert.ok(t.describeAgent(someone).rows.some((r) => r[0] === "Characteristics"));
  assert.ok(t.townStats().captive > 0, "some cannot drive");
});

const LAB = readJSON("web/layouts/ebl-lab.json");

test("journeys: the planner plans with the traveller's own speed; a wheelchair user only gets plans it can take", async () => {
  const { loadPlugins, layoutPlugins } = await import("../../web/arail/index.js");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { ROOT } = await import("./helpers.js");
  await loadPlugins(layoutPlugins(LAB), pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);
  const w = createWorld(withLayers(LAB, ["journeys"]));
  w.step(0.1);
  const j = journeysOf(w);
  const from = { kind: "building", id: "plattenbau-2" }, to = { kind: "station", id: "waldau" };
  const quick = j.plan({ from, to, leave: "07:20" })[0];
  const slow = j.plan({ from, to, leave: "07:20", profile: { age: "old", aid: "rollator" } })[0];
  assert.ok(slow.legs[0].min > quick.legs[0].min * 1.5, `the walk to the station takes longer: ${quick.legs[0].min.toFixed(1)} → ${slow.legs[0].min.toFixed(1)} min`);
  assert.ok(Number.isFinite(quick.ride) && quick.ride > 0 && Number.isFinite(quick.transfer));
  // platforms of 38 cm without staff: no train for a wheelchair user
  for (const o of w.objects.filter((x) => x.type === "platform")) o.set({ height_m: 0.38 });
  w.step(0.1);
  const wheelchair = j.plan({ from, to, leave: "07:20", profile: { aid: "wheelchair" } });
  assert.ok(wheelchair.every((p) => !p.legs.some((l) => l.type === "train")), "no plan by train");
  assert.ok(j.plan({ from, to, leave: "07:20", profile: { age: "old" } }).some((p) => p.legs.some((l) => l.type === "train")), "the others still go by train");
  // a traveller keeps what it is like, in the layout file too, and its trip is recorded in parts
  const t = j.addTraveller({ from, to, plan: slow, profile: { age: "old", aid: "rollator" } });
  assert.deepEqual(t.toJSON().profile, { age: "old", aid: "rollator", luggage: "none" });
  assert.ok(t.speed < 0.7);
  w.speed = 10;
  for (let i = 0; i < 30000 && t.state !== "train" && t.state !== "arrived"; i++) w.step(0.1);
  const row = j.results().find((r) => r.id === t.id);
  assert.equal(row.characteristics, "old · rollator");
  assert.ok(row.parts.walk > 0 && row.plannedParts.walk > 0, JSON.stringify(row.parts));
  assert.ok(j.describeAgent(t).rows.some((r) => r[0] === "Walking speed"));
});

test("road traffic: every driver has a licence and a car; the people of a car walk at the slowest one's pace", () => {
  const w = createWorld({
    objects: [{ id: "main", type: "road", points: [[-500, 0], [5000, 0]] }],
    simulations: [{ type: "traffic", cars_per_km: 40 }],
    clock: { start: "10:00", profiles: false },
  }, { seed: 2 });
  w.speed = 5;
  for (let i = 0; i < 200; i++) w.step(0.1);
  const traffic = w.simulations[0];
  assert.ok(traffic.cars.length > 3);
  for (const car of traffic.cars) {
    assert.ok(car.driver.profile.licence && car.driver.profile.car && car.driver.profile.age !== "child");
    for (const p of car.passengers) assert.ok(p.profile);
  }
});

test("a bus line's card: the people who got on its buses, their time at the doors and their luggage", () => {
  const w = createWorld({
    objects: [
      { id: "main", type: "road", points: [[0, 0], [4000, 0]] },
      { id: "a", type: "bus-stop", name: "West", position: [500, -70], side: "both" },
      { id: "c", type: "bus-stop", name: "East", position: [3500, -70], side: "both" },
      { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "c"] },
    ],
    simulations: [{ type: "passengers", base_rate: 2 }],
    clock: { start: "10:00", profiles: false },
  }, { seed: 7 });
  run(w, 900);
  const pax = w.simulations[0], figures = pax.lineFigures("l");
  assert.ok(figures?.boarded > 0, JSON.stringify(figures));
  const card = { rows: [] };
  pax.describeObject(w.getObject("l"), card);
  assert.equal(card.rows[0][0], "Got on");
  assert.match(card.rows[1][1], /% heavy or bulky · luggage \+\d+\.\d s$/);
  const stop = { rows: [] };
  pax.describeObject(w.getObject("a"), stop);
  assert.ok(stop.rows.some((r) => r[0] === "Into the bus" && /^a step of 14 cm up · the bus's ramp$/.test(r[1])), JSON.stringify(stop.rows));
});

test("the town counts the captive people a closed stop strands", () => {
  // nobody has a driving licence: every adult is captive
  const w = town({ bus_share: 1 }, { people: { adult: { licence: 0 }, old: { licence: 0 } } });
  w.step(0.1);
  const t = w.simulations.find((s) => s.constructor.type === "town");
  w.disruptions.start({ type: "closure", target: "p1", params: { minutes: 600 } });
  w.speed = 10;
  for (let i = 0; i < 20000 && w.clock.minutes < 8 * 60; i++) w.step(0.1);
  assert.ok(t.townStats().stranded > 0, `${t.townStats().stranded} stranded`);
});
