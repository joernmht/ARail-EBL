// The modes of transport, how people choose between them and what they and the town learn from their
// trips (core/modes.js); working the town's experience out ahead (sims/learning.js, tools/mobility-learn.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CAR_SHARE_MIN, DEFAULT_TASTE, Experience, LEARNING, MODES, MODE_KEYS, MODE_TABLE, TripMemory, carShare, chooseMode, choiceShares, createRng, createWorld, experienceProblems, exposure,
  modeProblems, modeSettings, perceived, personFactors, typicalParts, typicalShares, validateLayout, registry,
} from "../../web/arail/index.js";
import { experienceKey, layoutWithExperience, runLearning } from "../../web/arail/sims/learning.js";
import { ROOT, readJSON } from "./helpers.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} is not within ${tol} of ${b}`);

test("the modes: one list for everybody, and a table of tastes a layout changes cell by cell", () => {
  assert.deepEqual(MODE_KEYS, ["walk", "bike", "transit", "car"]);
  for (const m of MODE_KEYS) assert.ok(MODES[m].label && MODES[m].words);
  assert.deepEqual(MODE_TABLE.map((r) => r.key), ["everybody", ...MODE_KEYS]);
  for (const row of MODE_TABLE) for (const c of Object.values(row.cells)) assert.ok(c.label && c.unit && c.source && c.default >= c.min && c.default <= c.max, `${row.key}.${c.key}`);
  const T = modeSettings({ car: { constant: 3 }, everybody: { habit: "x", wait: 99 } });
  assert.equal(T.car.constant, 3);
  assert.equal(T.everybody.habit, DEFAULT_TASTE.everybody.habit, "not a number: the default");
  assert.equal(T.everybody.wait, 10, "cut to its range");
  assert.equal(T.walk.constant, DEFAULT_TASTE.walk.constant);
  assert.deepEqual(modeProblems(undefined), []);
  assert.deepEqual(modeProblems({ car: { constant: 3 } }), []);
  assert.match(modeProblems({ plane: {} })[0], /no row "plane"/);
  assert.match(modeProblems({ car: { wings: 2 } })[0], /no cell "wings"/);
  assert.match(modeProblems({ car: { constant: "3" } })[0], /must be a number/);
  assert.match(modeProblems([])[0], /must be an object/);
});

test("the constants are fitted to the shares of the modes by the length of the trip (MiD 2017)", () => {
  // for somebody who has all four modes: about what the survey finds for trips of these lengths
  const half = typicalShares(0.5), one = typicalShares(1.5), three = typicalShares(3);
  for (const [got, want] of [[half, { walk: 0.6, bike: 0.15, car: 0.21, transit: 0.04 }], [one, { walk: 0.25, bike: 0.21, car: 0.45, transit: 0.09 }]]) {
    for (const m of MODE_KEYS) near(got[m], want[m], 0.04, m);
    near(MODE_KEYS.reduce((s, m) => s + got[m], 0), 1, 1e-9, "shares add up");
  }
  assert.ok(three.walk < 0.08 && three.car > 0.5 && three.transit > one.transit, "long ways: by car, and more by bus and tram");
  // the longer the way, the fewer walk
  let last = 1;
  for (const km of [0.2, 0.5, 1, 2, 4]) {
    const s = typicalShares(km).walk;
    assert.ok(s < last, `${km} km`);
    last = s;
  }
  // who has no car and no bike walks or takes the bus
  const captive = typicalShares(1.5, { has: ["walk", "transit"] });
  assert.equal(captive.car, 0);
  assert.ok(captive.transit > one.transit * 2 && captive.walk + captive.transit > 0.999);
  // the parts as somebody plans them who knows only the length
  const p = typicalParts(1);
  near(p.walk.walk, 16.2, 0.2);
  near(p.bike.bike, 4.9, 0.1);
  near(p.car.drive, 2.6, 0.05);
  assert.ok(p.transit.wait > 0 && p.transit.eur === DEFAULT_TASTE.transit.fare_eur);
});

test("what a trip costs: minutes as people feel them, the weather, the person, money as time", () => {
  const T = DEFAULT_TASTE;
  // waiting counts twice the time on board, walking 1.6 times; a euro is worth five minutes
  near(perceived("transit", { ride: 10 }) - perceived("transit", { ride: 0 }), 10, 1e-9);
  near(perceived("transit", { wait: 5 }) - perceived("transit", {}), 5 * T.everybody.wait, 1e-9);
  near(perceived("walk", { walk: 10 }) - perceived("walk", {}), 10 * T.walk.minute, 1e-9);
  near(perceived("car", { eur: 1 }) - perceived("car", {}), 1 / T.everybody.eur_min, 1e-9);
  near(perceived("car", {}), T.car.constant, 1e-9, "the constant");
  near(perceived("bike", {}, { own: 4 }) - perceived("bike", {}), 4, 1e-9, "a person's own liking");
  // the weather: off, all as on a mild dry day; in rain walking and waiting count more, and half the cyclists stay off the bike
  const off = exposure({ on: false });
  assert.deepEqual(off, { walk: 1, wait: 1, bike: 1, dark: false });
  const weather = (now, cycle) => ({ on: true, now: () => ({ precipitation: "none", rate_mm_h: 0, temperature_c: 15, snow_cm: 0, ice: false, ...now }), cycleShare: () => cycle });
  const rain = exposure(weather({ precipitation: "rain", rate_mm_h: 2 }, 0.5));
  assert.ok(rain.walk > 1.2 && rain.wait > 1.2 && rain.bike === 0.5);
  const dry = { taste: T }, wet = { taste: T, weather: rain };
  assert.ok(perceived("walk", { walk: 10 }, wet) > perceived("walk", { walk: 10 }, dry));
  // … so that the odds of riding fall by just the weather's share of cyclists
  const options = (ctx) => [{ mode: "bike", cost: perceived("bike", { bike: 5 }, ctx) }, { mode: "car", cost: perceived("car", { drive: 5 }, ctx) }];
  const [b0, c0] = choiceShares(options(dry)), [b1, c1] = choiceShares(options(wet));
  near((b1 / c1) / (b0 / c0), 0.5, 1e-6, "the odds of the bike against the car");
  const ice = exposure(weather({ temperature_c: -3, ice: true }, 0.1), true);
  assert.ok(ice.walk > rain.walk && ice.dark, "frost, ice and the dark");
  // the person: old people and those with an aid or luggage walk less gladly; no bike with a rollator or a suitcase
  assert.deepEqual(personFactors({ age: "adult", aid: "none", luggage: "none" }), { walk: 1, wait: 1, bike: 1, canBike: true });
  const old = personFactors({ age: "old", aid: "rollator", luggage: "none" });
  assert.ok(old.walk > 2 && old.wait > 1 && !old.canBike);
  assert.equal(personFactors({ age: "adult", aid: "none", luggage: "heavy" }).canBike, false);
  assert.ok(perceived("walk", { walk: 10 }, { person: old }) > perceived("walk", { walk: 10 }));
});

test("the choice: a logit over the costs, the same for the same random numbers", () => {
  const options = [{ mode: "walk", cost: 10 }, { mode: "bike", cost: 10 }, { mode: "car", cost: 10 + Math.log(2) / 0.07 }];
  const p = choiceShares(options, 0.07);
  near(p[0], 0.4, 1e-9);
  near(p[2], 0.2, 1e-9, "a mode that costs ln 2 / sharpness more is taken half as often");
  assert.deepEqual(choiceShares([{ cost: 3 }, { cost: Infinity }]), [1, 0], "a mode nobody can take");
  assert.deepEqual(choiceShares([]), []);
  const count = { walk: 0, bike: 0, car: 0 }, rng = createRng(7);
  for (let i = 0; i < 4000; i++) count[chooseMode(rng, options, 0.07).mode]++;
  near(count.walk / 4000, 0.4, 0.03);
  near(count.car / 4000, 0.2, 0.03);
  const again = createRng(7), first = createRng(7);
  assert.equal(chooseMode(again, options).mode, chooseMode(first, options).mode);
  assert.equal(chooseMode(rng, []), null);
});

test("what a person remembers of a way: how the last trips went against what was expected, and the habit", () => {
  const m = new TripMemory();
  assert.equal(m.of("home>office", "car"), null);
  assert.equal(m.last("home>office"), null);
  m.learn("home>office", "car", 2, true, 0.3);
  assert.deepEqual(m.of("home>office", "car"), { ratio: 2, n: 1, bad: 0.3 });
  m.learn("home>office", "car", 1, false, 0.3);
  near(m.of("home>office", "car").ratio, 1.7, 1e-9, "the last trip counts three tenths");
  near(m.of("home>office", "car").bad, 0.21, 1e-9);
  assert.equal(m.last("home>office"), "car");
  m.learn("home>office", "bike", 1);
  assert.equal(m.last("home>office"), "bike");
  m.learn("home>office", "bike", 99);
  assert.ok(m.of("home>office", "bike").ratio <= 6 * 0.3 + 0.7 + 1e-9, "a ratio is cut to 6");
  // only the ways of a few days are kept
  for (let i = 0; i < 20; i++) m.learn(`way ${i}`, "walk", 1);
  assert.equal(m.ways.size, 12);
  assert.equal(m.of("home>office", "car"), null, "the oldest is forgotten");
});

test("what the town learns: by mode and hour, an hour's trips when it is over, damped; kept in the layout", () => {
  const x = new Experience();
  assert.equal(x.known, false);
  assert.equal(x.ratio("car", 8 * 60), 1);
  const clock = { minutes: 8 * 60 + 10, day: 0 };
  x.tick(clock);
  for (let i = 0; i < 20; i++) x.learn("car", 8 * 60 + 10, false, 3);
  assert.equal(x.known, true);
  // while the hour runs, its trips count against what was expected before
  const running = x.ratio("car", 8 * 60 + 30);
  near(running, (1 * LEARNING.today + 20 * 3) / (LEARNING.today + 20), 1e-9);
  assert.equal(x.table.car.weekday[8], 1, "not learned yet");
  // the hour after it is still open (trips are noted for the hour they began in); two hours on it is learned
  clock.minutes = 9 * 60 + 5;
  x.tick(clock);
  assert.equal(x.table.car.weekday[8], 1);
  clock.minutes = 10 * 60 + 5;
  x.tick(clock);
  near(x.table.car.weekday[8], 1 + LEARNING.rate * (20 / (20 + LEARNING.few)) * 2, 1e-9, "a bad morning moves it part of the way");
  assert.ok(x.table.car.weekday[8] < 2);
  assert.equal(x.table.car.weekend[8], 1, "a working day's trips");
  assert.equal(x.table.transit.weekday[8], 1);
  // read between the hours
  near(x.ratio("car", 8 * 60 + 30), x.table.car.weekday[8], 1e-9, "the middle of the hour");
  near(x.ratio("car", 9 * 60), (x.table.car.weekday[8] + 1) / 2, 1e-9);
  // few trips count less
  const few = new Experience();
  few.learn("car", 8 * 60, false, 3);
  few.settle();
  near(few.table.car.weekday[8], 1 + LEARNING.rate * (1 / (1 + LEARNING.few)) * 2, 1e-9);
  // the days are counted
  clock.day = 1;
  clock.minutes = 5;
  x.tick(clock);
  assert.equal(x.days, 1);
  // as a layout keeps it
  x.settle();
  const saved = JSON.parse(JSON.stringify({ ...x.toJSON(), for: "abc" }));
  assert.equal(saved.days, 1);
  assert.equal(saved.modes.car.weekday.length, 24);
  assert.deepEqual(experienceProblems(saved), []);
  const again = new Experience(saved);
  assert.ok(again.given && again.known && again.for === "abc");
  near(again.ratio("car", 8 * 60 + 30), Math.round(x.table.car.weekday[8] * 100) / 100, 1e-9);
  assert.match(experienceProblems({ modes: { plane: {} } })[0], /no mode "plane"/);
  assert.match(experienceProblems({ modes: { car: { weekday: [1, 2] } } })[0], /24 ratios/);
  assert.match(experienceProblems({ days: -1 })[0], /days/);
  assert.match(experienceProblems([])[0], /must be an object/);
  assert.ok(validateLayout({ objects: [], experience: { modes: { car: { someday: [] } } } }, registry).some((p) => /kind of day/.test(p)), "checked with the layout");
});

test("the cars from beyond the layout: the longer the drive takes, the fewer come; some always do", () => {
  assert.equal(carShare(1), 1);
  assert.equal(carShare(0.7), 1, "faster than planned: everybody");
  near(carShare(DEFAULT_TASTE.everybody.quit), 0.5 / (1 / (1 + Math.exp(-3))), 1e-9, "half give up where the setting says");
  let last = 1;
  for (const r of [1.2, 1.6, 2, 2.5, 3]) {
    const s = carShare(r);
    assert.ok(s < last, `${r}`);
    last = s;
  }
  assert.equal(carShare(10), CAR_SHARE_MIN, "through them the town learns when the streets are free again");
  assert.ok(carShare(2, 4) > carShare(2, 2.2), "a more patient town");
});

/** A small town on a street: homes at one end, an office at the other, a bus line between. */
function smallTown(town = {}, more = {}) {
  const house = (id, x, extra = {}) => ({ id, type: "building", name: id, position: [x, 260], width_m: 30, depth_m: 12, floors: 5, use: "residential", ...extra });
  return {
    scale: 87,
    objects: [
      { id: "street", type: "road", name: "Lange Straße", points: [[-3000, 0], [9000, 0]], profile: "bike-lanes" },
      house("home-1", 0), house("home-2", 700), house("home-3", 1400),
      house("office", 7000, { use: "work", floors: 6, width_m: 50 }),
      { id: "stop-a", type: "bus-stop", name: "Siedlung", road: "street", position: [700, 0], side: "both" },
      { id: "stop-b", type: "bus-stop", name: "Kontor", road: "street", position: [6800, 0], side: "both" },
      { id: "line-1", type: "bus-line", name: "Line 1", number: "1", stops: ["stop-a", "stop-b"], headway_s: 60 },
    ],
    simulations: [{ type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 30, walk_max_m: 100, ...town }, { type: "traffic", cars_per_km: 2 }, { type: "cycling", riders_per_km: 0 }],
    clock: { start: "05:30", factor: 12 },
    ...more,
  };
}

test("working the experience out ahead: a town is run for some days, what it learned is kept in the layout's text", () => {
  const layout = smallTown();
  assert.deepEqual(validateLayout(layout, registry), []);
  const world = createWorld(layout, { seed: 5 });
  world.step(0.1);
  const key = experienceKey(world);
  assert.match(key, /^[0-9a-z]+$/);
  assert.equal(experienceKey(createWorld(layout, { seed: 9 })), key, "the same layout, the same key");
  const other = smallTown({}, { objects: [...smallTown().objects, { id: "side", type: "road", name: "Querweg", points: [[3000, 0], [3000, 900]] }] });
  assert.notEqual(experienceKey(createWorld(other, { seed: 5 })), key, "another street: learned for another layout");
  assert.notEqual(experienceKey(createWorld(smallTown({ walk_max_m: 60 }), { seed: 5 })), key, "another setting too");
  const seen = [];
  const result = runLearning(world, { days: 1, onDay: (d) => seen.push(d) });
  assert.equal(result.days.length, 1);
  assert.deepEqual(seen, result.days);
  const day = result.days[0];
  assert.ok(day.split.trips > 20, `${day.split.trips} trips`);
  near(MODE_KEYS.reduce((s, m) => s + day.split.shares[m], 0), 1, 0.002);
  assert.ok(day.cars.drives > 0 && day.cars.speed_kmh > 5);
  assert.equal(result.experience.for, key);
  assert.equal(result.experience.days, 1);
  assert.deepEqual(experienceProblems(result.experience), []);
  assert.ok(MODE_KEYS.some((m) => result.experience.modes[m].weekday.some((r) => r !== 1)), "the town learned from its trips");
  // into the text of a layout file: on one line, before the simulations; again in the place of the old one; the rest untouched
  const text = `{\n  "format": "arail-layout/1",\n  "scale": 87,\n  "simulations": [\n    {"type": "town"}\n  ],\n  "objects": []\n}\n`;
  const first = layoutWithExperience(text, result.experience);
  assert.deepEqual(JSON.parse(first).experience, result.experience);
  assert.equal(first.split("\n").length, text.split("\n").length + 1);
  assert.equal(first.replace(/^ {2}"experience": .*\n/m, ""), text);
  const second = layoutWithExperience(first, { ...result.experience, days: 9 });
  assert.equal(JSON.parse(second).experience.days, 9);
  assert.equal(second.split("\n").length, first.split("\n").length);
  assert.equal(layoutWithExperience(`{"simulations":[]}`, result.experience), null, "no place found: the caller says so");
  // a world loaded with it starts where the learning ended
  const next = createWorld({ ...layout, experience: result.experience }, { seed: 5 });
  assert.ok(next.experience.given && next.experience.for === key);
  assert.deepEqual(next.toJSON().experience, result.experience, "kept when the layout is saved");
});

test("tools/mobility-learn.mjs: learns a layout from the command line, keeps it, and checks whether it is still the layout's own", () => {
  const dir = mkdtempSync(join(tmpdir(), "arail-learn-")), file = join(dir, "town.json");
  const text = JSON.stringify(smallTown(), null, 2).replace(/\n {2}"simulations": \[[\s\S]*?\n {2}\],/, (m) => m);
  writeFileSync(file, `${text}\n`);
  const run = (...args) => execFileSync(process.execPath, [join(ROOT, "tools/mobility-learn.mjs"), file, ...args], { encoding: "utf8" });
  assert.throws(() => run("--check"), /has no experience/);
  const out = run("--days", "1", "--write", "--json", join(dir, "learned.json"));
  assert.match(out, /learning for 1 days/);
  assert.match(out, /Kept in/);
  const kept = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(kept.experience.days, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "learned.json"), "utf8")).experience, kept.experience);
  assert.deepEqual({ ...kept, experience: undefined }, { ...JSON.parse(text), experience: undefined }, "nothing else changed");
  assert.match(run("--check"), /is the layout's own/);
  // the layout is changed: its experience is of another layout
  kept.objects.push({ id: "side", type: "road", name: "Querweg", points: [[3000, 0], [3000, 900]] });
  writeFileSync(file, JSON.stringify(kept, null, 2));
  assert.throws(() => run("--check"), /another state of the layout/);
});

test("Bf Neustadt: its experience is worked out for the layout as it is", () => {
  const layout = readJSON("web/layouts/ebl-neustadt.json");
  assert.ok(layout.experience, "the layout keeps what its town has learned");
  assert.deepEqual(experienceProblems(layout.experience), []);
  const world = createWorld(layout);
  world.step(0.1);
  assert.equal(layout.experience.for, experienceKey(world), "the layout was changed since: run  node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json --write");
  assert.ok(layout.experience.days >= 7, "at least a week of learning");
});
