// The situations of Settings → Simulation (web/app/situations.js): each day is the weekday its text
// says, its weather is one the world takes, setting one on a world gives what it promises (or, when
// it does not fit, changes nothing), and it holds until something sets the world otherwise.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, DAY_NAMES } from "../../web/arail/index.js";
import { applySituation, markSituation, SITUATIONS, situationHolds, situationProblem, situationReady } from "../../web/app/situations.js";

/** A small world with a platform, as the app's (only what applySituation reads). */
function app(layers = []) {
  const world = createWorld({
    objects: [{ id: "p", type: "platform", from: [0, 0], to: [800, 0], sides: "both" }],
    simulations: [{ type: "passengers" }],
  });
  return { world, layersOn: () => layers, chooseModules: async () => assert.fail("no modules to switch") };
}

test("situations: each has its own id, a name, a line of text, a day and a time", () => {
  assert.equal(new Set(SITUATIONS.map((s) => s.id)).size, SITUATIONS.length);
  for (const s of SITUATIONS) {
    assert.ok(s.label && s.text, s.id);
    assert.match(s.date, /^\d{4}-\d\d-\d\d$/, s.id);
    assert.match(s.time, /^\d\d:\d\d$/, s.id);
    assert.ok(["day", "event"].includes(s.kind), s.id);
    assert.ok(s.demand > 0, s.id);
  }
});

test("situations: the weekday in the text is the date's, and the weather is one the world takes", () => {
  const { world } = app();
  for (const s of SITUATIONS) {
    assert.ok(world.clock.isDate(s.date), `${s.id}: ${s.date}`);
    world.setDate(s.date);
    assert.ok(s.text.startsWith(`${DAY_NAMES[world.clock.weekday()]}, `), `${s.id}: "${s.text}" is a ${DAY_NAMES[world.clock.weekday()]}`);
    assert.ok(world.weather.isWeather(s.weather), `${s.id}: weather`);
    assert.ok(s.text.includes(s.time), `${s.id}: the time in its text`);
  }
});

test("situations: setting one sets the date, the time, the weather, the demand and an event's crowd", async () => {
  const a = app();
  const heat = SITUATIONS.find((s) => s.id === "future-heat");
  await applySituation(a, heat);
  const w = a.world;
  assert.equal(w.clock.dateString(), "2050-07-16");
  assert.equal(w.clock.label(), "15:00");
  assert.equal(w.clock.weekend(), true);
  assert.equal(Math.round(w.weather.now().temperature_c), 39);
  assert.equal(w.demand, 1);
  const match = SITUATIONS.find((s) => s.id === "after-match");
  assert.equal(situationReady(a, match), true);
  await applySituation(a, match);
  assert.deepEqual(w.disruptions.active.map((d) => [d.def.type, d.target]), [["crowd", "*"]]);
  // set again: still one crowd, not one on top of the other (× 6, not × 36)
  await applySituation(a, match);
  assert.equal(w.disruptions.active.length, 1);
  // another situation: the crowd ends
  await applySituation(a, SITUATIONS.find((s) => s.id === "spring-sunday"));
  assert.deepEqual(w.disruptions.active, []);
});

test("situations: an event that needs modules the layout does not have is not ready", () => {
  const market = SITUATIONS.find((s) => s.id === "christmas-market");
  assert.deepEqual(market.layers, ["wintermarkt", "market-visitors"]);
  assert.equal(situationReady(app(), market), false);
});

test("situations: one that does not fit is found before anything changes, also before its modules are switched on", async () => {
  const world = createWorld({
    objects: [{ id: "p", type: "platform", from: [0, 0], to: [800, 0], sides: "both" }],
    simulations: [{ type: "passengers" }],
    layers: [{ id: "wintermarkt", name: "Wintermarkt" }, { id: "market-visitors", name: "Market visitors" }],
  });
  const a = { world, layersOn: () => [], chooseModules: async () => assert.fail("no modules are switched for a situation that does not fit") };
  await applySituation(a, SITUATIONS.find((s) => s.id === "after-match"));
  const now = () => [world.clock.dateString(), world.clock.label(), world.weather.describe(), world.demand, world.disruptions.active.length];
  const was = now();
  const market = SITUATIONS.find((s) => s.id === "christmas-market");
  for (const [bad, reason] of [[{ weather: "hail" }, /weather is no weather/], [{ date: "2026-02-29" }, /date is no date/], [{ time: "25:00" }, /time is no time of day/], [{ demand: -1 }, /demand/]]) {
    const s = { ...market, ...bad };
    assert.match(situationProblem(a, s), reason);
    await assert.rejects(applySituation(a, s), reason);
    assert.deepEqual(now(), was, `${JSON.stringify(bad)}: the date, the time, the weather, the demand and the crowd as they were`);
  }
  assert.equal(situationProblem(a, market), null);
  assert.equal(situationProblem(app(), market), "this layout lacks what it needs");
});

test("situations: one set holds until the time, the date, the weather or the demand is set otherwise, by whoever", async () => {
  const a = app(), w = a.world;
  const sunday = SITUATIONS.find((s) => s.id === "spring-sunday");
  const set = async () => {
    await applySituation(a, sunday);
    return markSituation(w, sunday);
  };
  let mark = await set();
  assert.ok(situationHolds(w, mark));
  // the clock runs on, faster too: it holds
  w.clock.factor = 60;
  for (let i = 0; i < 300; i++) w.step(0.1);
  assert.ok(situationHolds(w, mark), "the clock running on");
  // a scenario sets 06:30 on a working day: it no longer holds (its card is no longer pressed)
  w.scenarios.load([{ id: "early", steps: [{ at: 0, set: { date: "2026-04-20", time: "06:30" } }] }]);
  w.scenarios.play("early");
  assert.equal(situationHolds(w, mark), false, "a scenario set the date and the time");
  for (const [what, change] of [["the time set", () => w.setTime("12:00")], ["the date set", () => w.setDate("2026-04-20")], ["another weather", () => w.setWeather("rain")], ["another demand", () => (w.demand = 4)]]) {
    mark.off();
    mark = await set();
    change();
    assert.equal(situationHolds(w, mark), false, what);
  }
  mark.off();
  mark = await set();
  w.setWeather("cloudy");
  assert.ok(situationHolds(w, mark), "the same weather set again");
  w.load(w.toJSON());
  assert.equal(situationHolds(w, mark), false, "the layout loaded again");
  assert.equal(situationHolds(w, null), false);
});
