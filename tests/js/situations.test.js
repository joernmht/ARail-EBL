// The situations of Settings → Simulation (web/app/situations.js): each day is the weekday its text
// says, its weather is one the world takes, and setting one on a world gives what it promises.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, DAY_NAMES } from "../../web/arail/index.js";
import { applySituation, SITUATIONS, situationReady } from "../../web/app/situations.js";

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
  assert.deepEqual(market.layers, ["striezelmarkt", "market-visitors"]);
  assert.equal(situationReady(app(), market), false);
});
